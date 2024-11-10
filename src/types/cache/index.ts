// src/types/cache/index.ts
export interface LookupContext {
    catalogId?: string;
    offeringId?: string;
    isPublic?: boolean;
}

export interface LookupItem {
    type: 'catalog' | 'offerings' | 'flavors';
    value: string;
    context?: LookupContext;
    priority?: number;
}

export interface PrefetchOptions {
    concurrency?: number;
    retryAttempts?: number;
    retryDelay?: number;
    // Maximum items to prefetch per type to avoid excessive API calls
    maxItemsPerType?: Record<LookupItem['type'], number>;
}
