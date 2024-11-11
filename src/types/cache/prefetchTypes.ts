// src/types/cache/prefetchTypes.ts

import { OfferingItem } from "../ibmCloud";

/**
 * Context interface for items being looked up.
 */
export interface LookupContext {
    catalogId?: string;
    offeringId?: string;
    isPublic?: boolean;
}

export type LookupType = 'catalog' | 'offerings' | 'flavors';

/**
 * Item interface used for cache prefetching.
 */
export interface LookupItem {
    type: LookupType;
    value: string;
    context?: {
        catalogId?: string;
        offeringId?: string;
        isPublic?: boolean;
    }
}

/**
 * Options for cache prefetching.
 */
export interface PrefetchOptions {
    concurrency?: number;
    retryAttempts?: number;
    retryDelay?: number;
    maxItemsPerType?: {
        [K in LookupType]?: number;
    };
}

export interface CatalogPrefetchContext {
    catalogId: string;
    offerings?: OfferingItem[];
    isPublic?: boolean;
}
