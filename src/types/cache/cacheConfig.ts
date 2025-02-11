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
    CATALOG_VALIDATION = 'catalogValidation',
    FLAVOR_DETAILS = 'flavorDetails',
    FLAVOR_VALIDATION = 'flavorValidation',
    OFFERING_VALIDATION = 'offeringValidation',
    OFFERING_DETAILS = 'offering_details',
    API_RESPONSE = 'apiResponse',
    CATALOG_OFFERINGS = 'CATALOG_OFFERINGS',
    GITHUB_RELEASES = 'github_releases'
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
    [CacheKeys.FLAVOR_DETAILS]: {
        ttlSeconds: 24 * 60 * 60, // 1 day
        persistent: true,
        storagePrefix: 'flavor_details_'
    },
    [CacheKeys.FLAVOR_VALIDATION]: {
        ttlSeconds: 12 * 60 * 60, // 12 hours
        persistent: true,
        storagePrefix: 'flavor_validation_'
    },
    [CacheKeys.OFFERING_VALIDATION]: {
        ttlSeconds: 12 * 60 * 60, // 12 hours
        persistent: true,
        storagePrefix: 'offering_validation_'
    },
    [CacheKeys.OFFERING_DETAILS]: {
        ttlSeconds: 24 * 60 * 60, // 1 day
        persistent: true,
        storagePrefix: 'offering_details_'
    },
    [CacheKeys.API_RESPONSE]: {
        ttlSeconds: 5 * 60, // 5 minutes
        persistent: false,
        storagePrefix: 'api_response_'
    },
    [CacheKeys.CATALOG_VALIDATION]: {
        ttlSeconds: 12 * 60 * 60, // 12 hours
        persistent: true,
        storagePrefix: 'catalog_validation_'
    },
    [CacheKeys.CATALOG_OFFERINGS]: {
        ttlSeconds: 300,  // 5 minutes
        persistent: true,
        storagePrefix: 'catalog_offerings'
    },
    [CacheKeys.GITHUB_RELEASES]: {
        ttlSeconds: 60,  // 1 minute
        persistent: false,  // Don't persist GitHub releases
        storagePrefix: 'github_releases'
    }
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
     * Generates a key for caching catalog offerings.
     * @param catalogId - The ID of the catalog.
     * @returns The cache key for the catalog offerings.
     */
    CATALOG_OFFERINGS: (catalogId: string) => `${CacheKeys.CATALOG_OFFERINGS}:${catalogId}`,

    /**
     * Generates a key for caching flavors of a specific offering in a catalog.
     * @param catalogId - The ID of the catalog.
     * @param offeringId - The ID of the offering.
     * @returns The cache key for the flavors of the specified offering in the catalog.
     */
    FLAVORS: (catalogId: string, offeringId: string) => `flavors:${catalogId}:${offeringId}`,

    FLAVOR_DETAILS: (catalogId: string, offeringId: string, flavorName: string) =>
        `${CacheKeys.FLAVOR_DETAILS}:${catalogId}:${offeringId}:${flavorName}`,

    FLAVOR_VALIDATION: (catalogId: string, offeringId: string, flavorName: string) =>
        `${CacheKeys.FLAVOR_VALIDATION}:${catalogId}:${offeringId}:${flavorName}`,

    OFFERING_VALIDATION: (catalogId: string, offeringId: string) =>
        `${CacheKeys.OFFERING_VALIDATION}:${catalogId}:${offeringId}`,

    OFFERING_DETAILS: (catalogId: string) =>
        `${CacheKeys.OFFERING_DETAILS}:${catalogId}`,

    CATALOG_VALIDATION: (catalogId: string) =>
        `${CacheKeys.CATALOG_VALIDATION}:${catalogId}`,
};