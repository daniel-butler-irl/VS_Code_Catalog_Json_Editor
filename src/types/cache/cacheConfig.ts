// src/types/cache/cacheConfig.ts

/**
 * Enumeration for cache types, used to standardize cache names across the application.
 */
export enum CacheKeys {
    CATALOG = 'catalog',
    OFFERING = 'offering',
    VALIDATION = 'validation',
    CATALOG_ID = 'catalogId',
    DEFAULT = 'default',
}

/**
 * Interface representing the configuration for cache entries.
 */
export interface CacheConfig {
    /** Time-to-live in seconds before the cache expires */
    ttlSeconds: number;
    /** Whether the cache entry should be persisted across sessions */
    persistent: boolean;
    /** Prefix used for storage keys when persisting cache entries */
    storagePrefix: string;
}

/**
 * Centralized cache configuration object, containing settings for different cache types.
 * This provides consistency in cache settings and helps reduce hard-coded values.
 */
export const CacheConfigurations: Record<CacheKeys, CacheConfig> = {
    [CacheKeys.CATALOG]: {
        ttlSeconds: 7 * 24 * 60 * 60, // 1 week
        persistent: true,
        storagePrefix: 'catalog_cache_',
    },
    [CacheKeys.OFFERING]: {
        ttlSeconds: 7 * 24 * 60 * 60, // 1 week
        persistent: true,
        storagePrefix: 'offering_cache_',
    },
    [CacheKeys.VALIDATION]: {
        ttlSeconds: 24 * 60 * 60, // 1 day
        persistent: true,
        storagePrefix: 'validation_cache_',
    },
    [CacheKeys.CATALOG_ID]: {
        ttlSeconds: 7 * 24 * 60 * 60, // 1 week
        persistent: true,
        storagePrefix: 'catalogid_cache_',
    },
    [CacheKeys.DEFAULT]: {
        ttlSeconds: 7 * 24 * 60 * 60, // 1 week
        persistent: true,
        storagePrefix: 'default_cache_',
    },
};


/**
 * Dynamic cache key generation functions for offerings and flavors.
 */
export const DynamicCacheKeys = {
    /**
     * Generates a key for caching offerings of a specific catalog.
     * @param catalogId - The ID of the catalog.
     * @returns The cache key for the offerings of the specified catalog.
     */
    OFFERINGS: (catalogId: string) => `offerings:${catalogId}`,

    /**
     * Generates a key for caching flavors of a specific offering in a catalog.
     * @param catalogId - The ID of the catalog.
     * @param offeringId - The ID of the offering.
     * @returns The cache key for the flavors of the specified offering in the catalog.
     */
    FLAVORS: (catalogId: string, offeringId: string) => `flavors:${catalogId}:${offeringId}`
};