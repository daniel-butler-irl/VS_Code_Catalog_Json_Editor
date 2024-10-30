// src/services/CacheService.ts

import * as vscode from 'vscode';
import { LoggingService } from './LoggingService';

/**
 * Configuration for different cache types
 */
interface CacheConfig {
    /** Time-to-live in seconds */
    ttlSeconds: number;
    /** Whether to persist across sessions */
    persistent: boolean;
    /** Storage key prefix for persistence */
    storagePrefix: string;
}

/**
 * Cache record structure for storing values with metadata
 */
interface CacheRecord {
    /** The cached value */
    value: any;
    /** Expiration timestamp */
    expiry: number;
    /** Key-specific metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Service for caching API responses and other data with TTL and persistence support
 */
export class CacheService {
    private static instance: CacheService;
    private cache: Map<string, CacheRecord> = new Map();
    private logger: LoggingService;
    private context?: vscode.ExtensionContext;

    // Cache configuration for different types of data
    private readonly cacheConfigs: Record<string, CacheConfig> = {
        'catalog': { 
            ttlSeconds: 7 * 24 * 60 * 60,     // 1 week
            persistent: true,
            storagePrefix: 'catalog_cache_'
        },
        'offering': { 
            ttlSeconds: 24 * 60 * 60,         // 1 day
            persistent: true,
            storagePrefix: 'offering_cache_'
        },
        'validation': { 
            ttlSeconds: 24 * 60 * 60,         // 1 day
            persistent: true,
            storagePrefix: 'validation_cache_'
        },
        'catalogId': { 
            ttlSeconds: 12 * 60 * 60,         // 12 hours
            persistent: true,
            storagePrefix: 'catalogid_cache_'
        },
        'default': { 
            ttlSeconds: 3600,                 // 1 hour
            persistent: false,
            storagePrefix: 'default_cache_'
        }
    };

    private constructor() {
        this.logger = LoggingService.getInstance();
        this.logger.debug('Initializing CacheService');
    }

    /**
     * Sets the VS Code extension context for persistence
     * @param context The VS Code extension context
     */
    public setContext(context: vscode.ExtensionContext): void {
        this.context = context;
        void this.loadPersistedCache();
    }

    /**
     * Gets the singleton instance of the cache service
     */
    public static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    /**
     * Gets the appropriate cache configuration for a key
     */
    private getConfigForKey(key: string): CacheConfig {
        const prefix = key.split(':')[0];
        return this.cacheConfigs[prefix] || this.cacheConfigs.default;
    }

    /**
     * Builds a cache key for offerings specific to a catalog
     * @param catalogId The catalog ID
     * @param offeringId Optional specific offering ID
     */
    public static buildOfferingKey(catalogId: string, offeringId?: string): string {
        return `offering:${catalogId}${offeringId ? `:${offeringId}` : ''}`;
    }

    /**
     * Gets a value from the cache with optional type safety
     * @param key The cache key
     * @returns The cached value or undefined if not found or expired
     */
    public get<T>(key: string): T | undefined {
        this.logger.debug(`Cache lookup for key: ${key}`);
        
        const record = this.cache.get(key);
        if (!record) {
            this.logger.debug(`Cache MISS - Key not found: ${key}`);
            return undefined;
        }

        const now = Date.now();
        if (now >= record.expiry) {
            this.logger.debug(`Cache MISS - Expired entry for key: ${key}`, {
                expiredAt: new Date(record.expiry).toISOString(),
                now: new Date(now).toISOString()
            });
            void this.invalidateKey(key);
            return undefined;
        }

        this.logger.debug(`Cache HIT for key: ${key}`, {
            timeLeftSeconds: Math.round((record.expiry - now) / 1000),
            expiresAt: new Date(record.expiry).toISOString(),
            metadata: record.metadata
        });
        
        return record.value as T;
    }

    /**
     * Sets a value in the cache
     * @param key The cache key
     * @param value The value to cache
     * @param metadata Optional metadata to store with the value
     */
    public set(key: string, value: any, metadata?: Record<string, unknown>): void {
        const config = this.getConfigForKey(key);
        const expiry = Date.now() + config.ttlSeconds * 1000;
        
        const record: CacheRecord = {
            value,
            expiry,
            metadata
        };
        
        this.cache.set(key, record);
        
        if (config.persistent && this.context) {
            void this.persistCacheEntry(key, record);
        }
        
        this.logger.debug(`Cache SET for key: ${key}`, {
            expiresAt: new Date(expiry).toISOString(),
            ttlSeconds: config.ttlSeconds,
            isPersistent: config.persistent,
            metadata
        });
    }

    /**
     * Persists a cache entry to VS Code storage
     */
    private async persistCacheEntry(key: string, record: CacheRecord): Promise<void> {
        if (!this.context) return;

        const config = this.getConfigForKey(key);
        const storageKey = `${config.storagePrefix}${key}`;
        
        try {
            await this.context.globalState.update(storageKey, record);
            this.logger.debug(`Persisted cache entry: ${key}`);
        } catch (error) {
            this.logger.error(`Failed to persist cache entry: ${key}`, error);
        }
    }

    /**
     * Loads persisted cache entries from VS Code storage
     */
    private async loadPersistedCache(): Promise<void> {
        if (!this.context) return;

        this.logger.debug('Loading persisted cache entries');

        try {
            const keys = this.context.globalState.keys();
            let loadedCount = 0;

            for (const storageKey of keys) {
                // Only load keys matching our cache prefixes
                const config = Object.values(this.cacheConfigs).find(
                    c => storageKey.startsWith(c.storagePrefix)
                );

                if (config) {
                    const record = this.context.globalState.get<CacheRecord>(storageKey);
                    if (record) {
                        const key = storageKey.substring(config.storagePrefix.length);
                        // Only load if not expired
                        if (record.expiry > Date.now()) {
                            this.cache.set(key, record);
                            loadedCount++;
                        } else {
                            // Clean up expired entries
                            await this.context.globalState.update(storageKey, undefined);
                        }
                    }
                }
            }

            this.logger.debug(`Loaded ${loadedCount} persisted cache entries`);
        } catch (error) {
            this.logger.error('Failed to load persisted cache', error);
        }
    }

    /**
     * Invalidates a single cache entry and removes it from persistent storage
     */
    private async invalidateKey(key: string): Promise<void> {
        this.cache.delete(key);
        
        if (this.context) {
            const config = this.getConfigForKey(key);
            const storageKey = `${config.storagePrefix}${key}`;
            await this.context.globalState.update(storageKey, undefined);
        }
    }

    /**
     * Updates expiry for all cached items matching a prefix
     * @param prefix The key prefix to refresh
     */
    public refreshPrefix(prefix: string): void {
        const config = this.getConfigForKey(prefix);
        const now = Date.now();
        const newExpiry = now + config.ttlSeconds * 1000;

        let refreshCount = 0;
        this.cache.forEach((record, key) => {
            if (key.startsWith(prefix)) {
                record.expiry = newExpiry;
                if (config.persistent) {
                    void this.persistCacheEntry(key, record);
                }
                refreshCount++;
            }
        });

        if (refreshCount > 0) {
            this.logger.debug(`Refreshed ${refreshCount} cache entries with prefix: ${prefix}`, {
                newExpiryTime: new Date(newExpiry).toISOString()
            });
        }
    }

    /**
     * Clears the entire cache including persistent storage
     */
    public async clearAll(): Promise<void> {
        const size = this.cache.size;
        this.cache.clear();
        
        if (this.context) {
            // Clear all persisted cache entries
            for (const config of Object.values(this.cacheConfigs)) {
                if (config.persistent) {
                    const keys = this.context.globalState.keys()
                        .filter(key => key.startsWith(config.storagePrefix));
                    
                    for (const key of keys) {
                        await this.context.globalState.update(key, undefined);
                    }
                }
            }
        }
        
        this.logger.info(`Cleared entire cache (${size} entries)`);
    }

    /**
     * Clears cache entries matching a prefix
     * @param prefix The key prefix to clear
     * @returns Number of entries cleared
     */
    public async clearPrefix(prefix: string): Promise<number> {
        let cleared = 0;
        const config = this.getConfigForKey(prefix);
        
        // Clear in-memory cache
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
                cleared++;
            }
        }
        
        // Clear persistent storage if applicable
        if (config.persistent && this.context) {
            const storageKeys = this.context.globalState.keys()
                .filter(key => key.startsWith(config.storagePrefix));
            
            for (const key of storageKeys) {
                await this.context.globalState.update(key, undefined);
            }
        }
        
        if (cleared > 0) {
            this.logger.info(`Cleared ${cleared} cache entries with prefix: ${prefix}`);
        }
        
        return cleared;
    }

    /**
     * Gets cache statistics and health metrics
     */
    public getStats(): Record<string, any> {
        const now = Date.now();
        const stats = {
            totalSize: this.cache.size,
            entriesByPrefix: {} as Record<string, number>,
            activeEntries: 0,
            expiredEntries: 0,
            persistentEntries: 0
        };

        this.cache.forEach((record, key) => {
            const prefix = key.split(':')[0];
            stats.entriesByPrefix[prefix] = (stats.entriesByPrefix[prefix] || 0) + 1;
            
            if (now < record.expiry) {
                stats.activeEntries++;
            } else {
                stats.expiredEntries++;
            }

            const config = this.getConfigForKey(key);
            if (config.persistent) {
                stats.persistentEntries++;
            }
        });

        return stats;
    }
}