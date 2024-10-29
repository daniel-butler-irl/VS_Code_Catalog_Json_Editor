// src/services/CacheService.ts

import { LoggingService } from './LoggingService';

/**
 * Service for caching API responses and other data with TTL
 */
export class CacheService {
    private static instance: CacheService;
    private cache: Map<string, { value: any; expiry: number }> = new Map();
    private logger: LoggingService;

    private constructor(private ttlSeconds: number = 3600) {
        this.logger = LoggingService.getInstance();
        this.logger.debug(`Creating CacheService instance with TTL: ${ttlSeconds} seconds`);
    }

    public static getInstance(ttlSeconds: number = 3600): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService(ttlSeconds);
        }
        return CacheService.instance;
    }


    /**
     * Retrieves a value from the cache
     * @param key The cache key
     * @returns The cached value or undefined if not found or expired
     */
    public get(key: string): any | undefined {
        this.logger.debug(`Cache lookup for key: ${key}`);
        
        const record = this.cache.get(key);
        if (!record) {
            this.logger.debug(`Cache MISS - Key not found: ${key}`);
            return undefined;
        }

        const now = Date.now();
        const isExpired = now >= record.expiry;
        
        if (isExpired) {
            this.logger.debug(`Cache MISS - Expired entry for key: ${key}`, {
                expiredAt: new Date(record.expiry).toISOString(),
                now: new Date(now).toISOString(),
                age: Math.round((now - (record.expiry - this.ttlSeconds * 1000)) / 1000)
            });
            this.cache.delete(key);
            return undefined;
        }

        const timeLeft = Math.round((record.expiry - now) / 1000);
        this.logger.debug(`Cache HIT for key: ${key}`, {
            timeLeftSeconds: timeLeft,
            expiresAt: new Date(record.expiry).toISOString()
        });
        
        return record.value;
    }

    /**
     * Sets a value in the cache
     * @param key The cache key
     * @param value The value to cache
     */
    public set(key: string, value: any): void {
        const expiry = Date.now() + this.ttlSeconds * 1000;
        this.cache.set(key, { value, expiry });
        
        this.logger.debug(`Cache SET for key: ${key}`, {
            expiresAt: new Date(expiry).toISOString(),
            ttlSeconds: this.ttlSeconds,
            valueType: typeof value,
            isNull: value === null
        });
    }

    /**
     * Gets the current cache size
     * @returns The number of entries in the cache
     */
    public size(): number {
        return this.cache.size;
    }

    /**
     * Clears expired entries from the cache
     * @returns The number of entries cleared
     */
    public clearExpired(): number {
        const now = Date.now();
        let cleared = 0;
        
        this.cache.forEach((record, key) => {
            if (now >= record.expiry) {
                this.cache.delete(key);
                cleared++;
            }
        });

        if (cleared > 0) {
            this.logger.debug(`Cleared ${cleared} expired cache entries`, {
                remainingEntries: this.cache.size
            });
        }
        
        return cleared;
    }

    /**
     * Clears all entries from the cache
     */
    public clear(): void {
        const size = this.cache.size;
        this.cache.clear();
        this.logger.debug(`Cache cleared - removed ${size} entries`);
    }

    /**
     * Gets cache statistics
     * @returns Object containing cache statistics
     */
    public getStats(): Record<string, any> {
        const now = Date.now();
        const stats = {
            size: this.cache.size,
            activeEntries: 0,
            expiredEntries: 0,
            averageTimeLeft: 0
        };

        let totalTimeLeft = 0;
        this.cache.forEach((record) => {
            if (now < record.expiry) {
                stats.activeEntries++;
                totalTimeLeft += (record.expiry - now) / 1000;
            } else {
                stats.expiredEntries++;
            }
        });

        if (stats.activeEntries > 0) {
            stats.averageTimeLeft = Math.round(totalTimeLeft / stats.activeEntries);
        }

        this.logger.debug('Cache statistics', stats);
        return stats;
    }
}