// src/services/CacheService.ts

import { LoggingService } from './LoggingService';

/**
 * Configuration for different cache types
 */
interface CacheConfig {
    /** Time-to-live in seconds */
    ttlSeconds: number;
    /** Whether to persist across sessions */
    persistent?: boolean;
}

/**
 * Cache record structure
 */
interface CacheRecord {
    value: any;
    expiry: number;
}

/**
 * Service for caching API responses and other data with TTL
 */
export class CacheService {
    private static instance: CacheService;
    private cache: Map<string, CacheRecord> = new Map();
    private logger: LoggingService;

    // Cache configuration for different types of data
    private readonly cacheConfigs: Record<string, CacheConfig> = {
        'catalog': { ttlSeconds: 7 * 24 * 60 * 60, persistent: true },    // 1 week
        'offering': { ttlSeconds: 24 * 60 * 60, persistent: true },       // 1 day
        'validation': { ttlSeconds: 24 * 60 * 60, persistent: true },     // 1 day
        'catalogId': { ttlSeconds: 12 * 60 * 60, persistent: true },      // 12 hours
        'default': { ttlSeconds: 3600 }                                   // 1 hour
    };
    private constructor() {
        this.logger = LoggingService.getInstance();
        this.logger.debug('Initializing CacheService');
    }

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
     * Retrieves a value from the cache
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
            this.cache.delete(key);
            return undefined;
        }

        this.logger.debug(`Cache HIT for key: ${key}`, {
            timeLeftSeconds: Math.round((record.expiry - now) / 1000),
            expiresAt: new Date(record.expiry).toISOString()
        });
        
        return record.value as T;
    }

    /**
     * Sets a value in the cache
     * @param key The cache key
     * @param value The value to cache
     */
    public set(key: string, value: any): void {
        const config = this.getConfigForKey(key);
        const expiry = Date.now() + config.ttlSeconds * 1000;
        
        this.cache.set(key, { value, expiry });
        
        this.logger.debug(`Cache SET for key: ${key}`, {
            expiresAt: new Date(expiry).toISOString(),
            ttlSeconds: config.ttlSeconds,
            isPersistent: config.persistent
        });
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
     * Clears the entire cache
     */
    public clearAll(): void {
        const size = this.cache.size;
        this.cache.clear();
        this.logger.info(`Cleared entire cache (${size} entries)`);
    }

    /**
     * Clears cache entries matching a prefix
     * @param prefix The key prefix to clear
     * @returns Number of entries cleared
     */
    public clearPrefix(prefix: string): number {
        let cleared = 0;
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
                cleared++;
            }
        }
        
        if (cleared > 0) {
            this.logger.info(`Cleared ${cleared} cache entries with prefix: ${prefix}`);
        }
        
        return cleared;
    }

    /**
     * Gets cache statistics
     */
    public getStats(): Record<string, any> {
        const now = Date.now();
        const stats = {
            totalSize: this.cache.size,
            entriesByPrefix: {} as Record<string, number>,
            activeEntries: 0,
            expiredEntries: 0
        };

        this.cache.forEach((record, key) => {
            const prefix = key.split(':')[0];
            stats.entriesByPrefix[prefix] = (stats.entriesByPrefix[prefix] || 0) + 1;
            
            if (now < record.expiry) {
                stats.activeEntries++;
            } else {
                stats.expiredEntries++;
            }
        });

        return stats;
    }
}
