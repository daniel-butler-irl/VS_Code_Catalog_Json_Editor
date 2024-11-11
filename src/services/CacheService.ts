// src/services/CacheService.ts

import * as vscode from 'vscode';
import { LoggingService } from './core/LoggingService';
import { CacheKeys, CacheConfigurations } from '../types/cache/cacheConfig';
import type { CacheConfig } from '../types/cache/cacheConfig';

/**
 * Structure for individual cache records stored in memory or persisted.
 */
interface CacheRecord {
    /** The value being cached */
    value: any;
    /** Expiry timestamp in milliseconds */
    expiry: number;
    /** Optional metadata associated with the cache entry */
    metadata?: Record<string, unknown>;
}

/**
 * Service for managing cache entries with configurable TTL and persistence settings.
 * Uses centralized configuration for consistency and maintainability.
 */
export class CacheService {
    private static instance: CacheService;
    private cache: Map<string, CacheRecord> = new Map();
    private logger: LoggingService;
    private context?: vscode.ExtensionContext;

    /**
     * The centralized cache configuration imported from cacheConfig.ts.
     */
    private readonly cacheConfigs = CacheConfigurations;

    private constructor() {
        this.logger = LoggingService.getInstance();
        this.logger.debug('Initializing CacheService');
    }

    /**
     * Sets the VS Code extension context to enable persistence of cache entries.
     * @param context - The VS Code extension context
     */
    public setContext(context: vscode.ExtensionContext): void {
        this.context = context;
        void this.loadPersistedCache();
    }

    /**
     * Returns the singleton instance of CacheService, creating it if necessary.
     * @returns The singleton CacheService instance
     */
    public static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    /**
     * Retrieves the cache configuration for a given cache key based on its prefix.
     * Falls back to a default configuration if no specific config is found.
     * @param key - The cache key to retrieve configuration for
     * @returns The corresponding cache configuration
     */
    private getConfigForKey(key: string): CacheConfig {
        const prefix = key.split(':')[0] as CacheKeys;
        return this.cacheConfigs[prefix] || this.cacheConfigs[CacheKeys.DEFAULT];
    }

    /**
     * Constructs a cache key for offerings associated with a specific catalog.
     * This standardized key generation method ensures consistency across calls.
     * @param catalogId - The catalog ID
     * @param offeringId - Optional specific offering ID
     * @returns A formatted cache key string
     */
    public static buildOfferingKey(catalogId: string, offeringId?: string): string {
        return `${CacheKeys.OFFERING}:${catalogId}${offeringId ? `:${offeringId}` : ''}`;
    }

    /**
     * Retrieves a value from the cache if it exists and hasn't expired.
     * @param key - The cache key to retrieve
     * @returns The cached value, or undefined if not found or expired
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
                now: new Date(now).toISOString(),
            });
            void this.invalidateKey(key);
            return undefined;
        }

        this.logger.debug(`Cache HIT for key: ${key}`, {
            timeLeftSeconds: Math.round((record.expiry - now) / 1000),
            expiresAt: new Date(record.expiry).toISOString(),
            metadata: record.metadata,
        });

        return record.value as T;
    }

    /**
     * Stores a value in the cache with metadata and optional persistence.
     * @param key - The cache key to set
     * @param value - The value to cache
     * @param metadata - Optional metadata to store with the cache entry
     */
    public set(key: string, value: any, metadata?: Record<string, unknown>): void {
        const config = this.getConfigForKey(key);
        const expiry = Date.now() + config.ttlSeconds * 1000;

        const record: CacheRecord = {
            value,
            expiry,
            metadata,
        };

        this.cache.set(key, record);

        if (config.persistent && this.context) {
            void this.persistCacheEntry(key, record);
        }

        this.logger.debug(`Cache SET for key: ${key}`, {
            expiresAt: new Date(expiry).toISOString(),
            ttlSeconds: config.ttlSeconds,
            isPersistent: config.persistent,
            metadata,
        });
    }

    /**
     * Persists a cache entry to VS Code storage for use across sessions.
     * @param key - The cache key
     * @param record - The cache record to store
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
     * Loads persisted cache entries from VS Code storage into memory.
     * This allows previously cached data to be available across extension sessions.
     */
    private async loadPersistedCache(): Promise<void> {
        if (!this.context) return;

        this.logger.debug('Loading persisted cache entries');

        try {
            const keys = this.context.globalState.keys();
            let loadedCount = 0;

            for (const storageKey of keys) {
                const config = Object.values(this.cacheConfigs).find(c => storageKey.startsWith(c.storagePrefix));
                if (config) {
                    const record = this.context.globalState.get<CacheRecord>(storageKey);
                    if (record) {
                        const key = storageKey.substring(config.storagePrefix.length);
                        if (record.expiry > Date.now()) {
                            this.cache.set(key, record);
                            loadedCount++;
                            this.logger.debug(`Loaded cache entry: ${key}`, { expiry: new Date(record.expiry).toISOString() });
                        } else {
                            await this.context.globalState.update(storageKey, undefined);
                            this.logger.debug(`Removed expired cache entry: ${key}`);
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
     * Invalidates a cache entry, removing it from memory and persistent storage.
     * @param key - The cache key to invalidate
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
     * Updates expiry timestamps for all cache entries matching a specified prefix.
     * This effectively "refreshes" matching entries, extending their validity.
     * @param prefix - The prefix of the keys to refresh
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
                newExpiryTime: new Date(newExpiry).toISOString(),
            });
        }
    }

    /**
     * Clears all cache entries, including those in persistent storage.
     */
    public async clearAll(): Promise<void> {
        const size = this.cache.size;
        this.cache.clear();

        if (this.context) {
            for (const config of Object.values(this.cacheConfigs)) {
                if (config.persistent) {
                    const keys = this.context.globalState.keys().filter(key => key.startsWith(config.storagePrefix));
                    for (const key of keys) {
                        await this.context.globalState.update(key, undefined);
                    }
                }
            }
        }

        this.logger.info(`Cleared entire cache (${size} entries)`);
    }

    /**
     * Clears cache entries that match a given prefix.
     * This removes both in-memory and persistent entries with the specified prefix.
     * @param prefix - The prefix of the keys to clear
     * @returns The number of entries cleared
     */
    public async clearPrefix(prefix: string): Promise<number> {
        let cleared = 0;
        const config = this.getConfigForKey(prefix);

        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
                cleared++;
            }
        }

        if (config.persistent && this.context) {
            const storageKeys = this.context.globalState.keys().filter(key => key.startsWith(config.storagePrefix));
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
     * Retrieves statistics and health metrics for the current cache.
     * @returns An object with various cache statistics
     */
    public getStats(): Record<string, any> {
        const now = Date.now();
        const stats = {
            totalSize: this.cache.size,
            entriesByPrefix: {} as Record<string, number>,
            activeEntries: 0,
            expiredEntries: 0,
            persistentEntries: 0,
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
