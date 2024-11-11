import * as vscode from 'vscode';
import { LoggingService } from './core/LoggingService';
import { CacheConfig } from '../types/cache/cacheConfig';

/**
 * Service for caching API responses and other data with TTL and persistence support.
 */
export class CacheService {
    private static instance: CacheService;
    private cache: Map<string, { value: any; expiry: number; config: CacheConfig }> = new Map();
    private logger: LoggingService;
    private context?: vscode.ExtensionContext;
    private readonly CACHE_PREFIX = 'cache:'; // Prefix for all cache keys

    /**
     * Private constructor to enforce singleton pattern.
     */
    private constructor() {
        this.logger = LoggingService.getInstance();
        this.logger.debug('Initializing CacheService');
    }

    /**
     * Sets the VS Code extension context for persistence.
     * @param context - The VS Code extension context.
     */
    public setContext(context: vscode.ExtensionContext): void {
        this.context = context;
        void this.loadPersistedCache();
    }

    /**
     * Gets the singleton instance of the cache service.
     * @returns CacheService instance.
     */
    public static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    /**
     * Retrieves a value from the cache.
     * @param key - The cache key (without prefix).
     * @returns The cached value or undefined if not found or expired.
     */
    public get<T>(key: string): T | undefined {
        const prefixedKey = this.CACHE_PREFIX + key;
        this.logger.debug(`Cache lookup for key: ${prefixedKey}`);

        const record = this.cache.get(prefixedKey);
        if (!record) {
            this.logger.debug(`Cache MISS - Key not found: ${prefixedKey}`);
            return undefined;
        }

        const now = Date.now();
        if (now >= record.expiry) {
            this.logger.debug(`Cache MISS - Expired entry for key: ${prefixedKey}`);
            void this.invalidateKey(prefixedKey);
            return undefined;
        }

        this.logger.debug(`Cache HIT for key: ${prefixedKey}`);
        return record.value as T;
    }

    /**
     * Stores a value in the cache with the specified configuration.
     * @param key - The cache key (without prefix).
     * @param value - The value to cache.
     * @param config - Configuration for cache entry.
     */
    public set(key: string, value: any, config: CacheConfig): void {
        const prefixedKey = this.CACHE_PREFIX + key;
        const expiry = Date.now() + config.ttlSeconds * 1000;
        this.cache.set(prefixedKey, { value, expiry, config });

        if (config.persistent && this.context) {
            void this.persistCacheEntry(prefixedKey, value, expiry);
        }

        this.logger.debug(`Cache SET for key: ${prefixedKey}`);
    }

    /**
     * Persists a cache entry to VS Code's globalState.
     * @param key - The cache key (with prefix).
     * @param value - The value to persist.
     * @param expiry - Expiry timestamp in milliseconds.
     */
    private async persistCacheEntry(key: string, value: any, expiry: number): Promise<void> {
        if (!this.context) { return; }
        try {
            await this.context.globalState.update(key, { value, expiry });
            this.logger.debug(`Persisted cache entry: ${key}`);
        } catch (error) {
            this.logger.error(`Failed to persist cache entry: ${key}`, error);
        }
    }

    /**
     * Loads persisted cache entries from VS Code's globalState into the in-memory cache.
     */
    private async loadPersistedCache(): Promise<void> {
        if (!this.context) { return; }
        this.logger.debug('Loading persisted cache entries');

        try {
            const keys = this.context.globalState.keys();
            for (const key of keys) {
                if (!key.startsWith(this.CACHE_PREFIX)) {
                    continue; // Skip keys without the cache prefix
                }

                const record = this.context.globalState.get<{ value: any; expiry: number }>(key);
                if (record && record.expiry > Date.now()) {
                    this.cache.set(key, { ...record, config: { ttlSeconds: 0, persistent: true, storagePrefix: '' } });
                    this.logger.debug(`Loaded cache entry: ${key}`);
                } else {
                    await this.context.globalState.update(key, undefined);
                    this.logger.debug(`Removed expired cache entry: ${key}`);
                }
            }
        } catch (error) {
            this.logger.error('Failed to load persisted cache', error);
        }
    }

    /**
     * Invalidates a single cache entry and removes it from persisted storage if applicable.
     * @param key - The cache key (with prefix).
     */
    private async invalidateKey(key: string): Promise<void> {
        this.cache.delete(key);
        if (this.context) {
            await this.context.globalState.update(key, undefined);
        }
        this.logger.debug(`Cache entry invalidated: ${key}`);
    }

    /**
     * Clears the entire cache, both in-memory and persisted entries with the cache prefix.
     * This will remove all cache entries managed by CacheService and cannot be undone.
     */
    public async clearAll(): Promise<void> {
        // Clear in-memory cache
        this.cache.clear();
        this.logger.debug('In-memory cache cleared');

        if (this.context) {
            try {
                const keys = this.context.globalState.keys();
                const updatePromises: Thenable<void>[] = [];

                for (const key of keys) {
                    if (key.startsWith(this.CACHE_PREFIX)) {
                        updatePromises.push(this.context.globalState.update(key, undefined));
                    }
                }

                await Promise.all(updatePromises);
                this.logger.debug('Persisted cache entries cleared');
            } catch (error) {
                this.logger.error('Failed to clear persisted cache entries', error);
            }
        } else {
            this.logger.warn('CacheService context is not set. Persisted cache entries cannot be cleared.');
        }
    }

    /**
     * Invalidates all cache entries that start with a specific prefix.
     * @param prefix - The prefix to match cache keys.
     */
    public async invalidatePrefix(prefix: string): Promise<void> {
        const fullPrefix = this.CACHE_PREFIX + prefix;
        if (this.context) {
            try {
                const keys = this.context.globalState.keys();
                const updatePromises: Thenable<void>[] = [];

                for (const key of keys) {
                    if (key.startsWith(fullPrefix)) {
                        updatePromises.push(this.context.globalState.update(key, undefined));
                        this.cache.delete(key);
                        this.logger.debug(`Cache entry invalidated via prefix: ${key}`);
                    }
                }

                await Promise.all(updatePromises);
                this.logger.debug(`All cache entries with prefix "${fullPrefix}" have been invalidated`);
            } catch (error) {
                this.logger.error(`Failed to invalidate cache entries with prefix "${fullPrefix}"`, error);
            }
        } else {
            this.logger.warn('CacheService context is not set. Cannot invalidate cache entries by prefix.');
        }
    }
}
