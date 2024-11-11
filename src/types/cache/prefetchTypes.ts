// src/types/cache/prefetchTypes.ts

/**
 * Context interface for items being looked up.
 */
export interface LookupContext {
    catalogId?: string;
    offeringId?: string;
    isPublic?: boolean;
}

/**
 * Item interface used for cache prefetching.
 */
export interface LookupItem {
    type: 'catalog' | 'offerings' | 'flavors';
    value: string;
    context?: LookupContext;
    priority?: number;
}

/**
 * Options for cache prefetching.
 */
export interface PrefetchOptions {
    concurrency?: number;
    retryAttempts?: number;
    retryDelay?: number;
    maxItemsPerType?: Record<LookupItem['type'], number>;
}
