// src/services/CachePrefetchService.ts

import { LoggingService } from './LoggingService';
import { IBMCloudService } from '../IBMCloudService';
import { CacheService } from '../CacheService';
import { chunk, throttle } from 'lodash';
import type { LookupItem, PrefetchOptions } from '../../types/cache';
import { CacheKeys, DynamicCacheKeys } from '../../types/cache/cacheConfig';

/**
 * Service for managing cache prefetching of IBM Cloud data to improve performance.
 * Handles enqueuing, processing, and prefetching of items, as well as cache key generation.
 */
export class CachePrefetchService {
    private static instance: CachePrefetchService;
    private readonly logger = LoggingService.getInstance();
    private queue: LookupItem[] = [];
    private processing: boolean = false;
    private ibmCloudService?: IBMCloudService;
    private readonly cacheService: CacheService;

    /**
     * Constructs a CachePrefetchService instance with specified options.
     * @param options - Options to configure prefetching, including concurrency, retry attempts, and item limits per type.
     */
    private constructor(private options: PrefetchOptions = {}) {
        this.options = {
            concurrency: 3,
            retryAttempts: 3,
            retryDelay: 1000,
            maxItemsPerType: {
                catalog: 50,
                offerings: 20,
                flavors: 30
            },
            ...options
        };
        this.cacheService = CacheService.getInstance();

        this.processQueue = throttle(this.processQueue.bind(this), 1000, {
            leading: true,
            trailing: true
        });
    }

    /**
     * Gets the singleton instance of CachePrefetchService, creating it if necessary.
     * @param options - Optional prefetch options.
     * @returns CachePrefetchService instance.
     */
    public static getInstance(options?: PrefetchOptions): CachePrefetchService {
        if (!CachePrefetchService.instance) {
            CachePrefetchService.instance = new CachePrefetchService(options);
        }
        return CachePrefetchService.instance;
    }

    /**
     * Sets the IBMCloudService instance used for API calls during prefetching.
     * @param service - IBMCloudService instance.
     */
    public setIBMCloudService(service: IBMCloudService): void {
        this.ibmCloudService = service;
    }

    /**
     * Adds items to the prefetch queue, filtering out already cached items and respecting type limits.
     * @param items - Array of LookupItems to enqueue for caching.
     */
    public enqueueLookups(items: LookupItem[]): void {
        this.logger.debug(`Enqueueing ${items.length} items for cache prefetch`);

        const uncachedItems = items.filter(item => {
            const cacheKey = this.generateCacheKey(item);
            return this.cacheService.get(cacheKey) === undefined;
        });

        if (uncachedItems.length === 0) {
            this.logger.debug('All items already cached');
            return;
        }

        const itemsByType = new Map<string, LookupItem[]>();
        uncachedItems.forEach(item => {
            const items = itemsByType.get(item.type) || [];
            items.push(item);
            itemsByType.set(item.type, items);
        });

        const limitedItems: LookupItem[] = [];
        itemsByType.forEach((items, type) => {
            const limit = this.options.maxItemsPerType?.[type as LookupItem['type']] || 10;
            limitedItems.push(...items.slice(0, limit));
        });

        this.queue.push(...limitedItems);
        void this.processQueue();
    }

    /**
     * Processes the prefetch queue, handling up to the configured concurrency of items at once.
     */
    private async processQueue(): Promise<void> {
        if (this.processing || !this.ibmCloudService || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        this.logger.debug(`Processing prefetch queue: ${this.queue.length} items remaining`);

        try {
            const batch = this.queue.splice(0, this.options.concurrency);
            await Promise.all(batch.map(item => this.prefetchItem(item)));
        } finally {
            this.processing = false;
            if (this.queue.length > 0) {
                void this.processQueue();
            }
        }
    }

    /**
     * Prefetches a single item by making the appropriate API call based on the item's type.
     * Retries if an error occurs, up to the configured limit.
     * @param item - LookupItem to prefetch.
     * @param attempt - Current attempt count for retrying.
     */
    private async prefetchItem(item: LookupItem, attempt: number = 1): Promise<void> {
        if (!this.ibmCloudService) {
            return;
        }

        try {
            switch (item.type) {
                case 'catalog':
                    this.logger.debug(`Prefetching catalog data for ${item.value}`);
                    if (item.context?.isPublic) {
                        await this.ibmCloudService.getAvailablePublicCatalogs();
                    } else {
                        await this.ibmCloudService.getAvailablePrivateCatalogs();
                    }
                    break;
                case 'offerings':
                    this.logger.debug(`Prefetching offerings for catalog ${item.context?.catalogId}`);
                    if (!item.context?.catalogId) {
                        throw new Error('Catalog ID required for offerings lookup');
                    }
                    await this.ibmCloudService.getOfferingsForCatalog(item.context.catalogId);
                    break;
                case 'flavors':
                    this.logger.debug(`Prefetching flavors for offering ${item.context?.offeringId}`);
                    if (!item.context?.catalogId || !item.context?.offeringId) {
                        throw new Error('Catalog ID and Offering ID required for flavors lookup');
                    }
                    await this.ibmCloudService.getAvailableFlavors(
                        item.context.catalogId,
                        item.context.offeringId
                    );
                    break;
            }

            this.logger.debug(`Cache prefetch complete for ${item.type}`, {
                value: item.value,
                context: item.context
            });

        } catch (error) {
            this.logger.error(`Cache prefetch failed for ${item.type}`, {
                value: item.value,
                context: item.context,
                attempt,
                error
            });

            if (attempt < this.options.retryAttempts!) {
                await new Promise(resolve => setTimeout(resolve, this.options.retryDelay!));
                await this.prefetchItem(item, attempt + 1);
            }
        }
    }

    /**
     * Generates a cache key for the provided LookupItem, using predefined cache key enums.
     * @param item - LookupItem for which to generate a cache key.
     * @returns string - Generated cache key.
     */
    private generateCacheKey(item: LookupItem): string {
        switch (item.type) {
            case 'catalog':
                return item.context?.isPublic ? CacheKeys.CATALOG : CacheKeys.CATALOG_ID;
            case 'offerings':
                return DynamicCacheKeys.OFFERINGS(item.context?.catalogId!);
            case 'flavors':
                return DynamicCacheKeys.FLAVORS(item.context?.catalogId!, item.context?.offeringId!);
            default:
                this.logger.error(`Unknown cache key type: ${item.type}`);
                return '';
        }
    }

    /**
     * Initiates prefetching for a catalog and all its related data.
     * @param catalogId - The catalog ID to prefetch data for
     */
    public async prefetchCatalogData(catalogId: string): Promise<void> {
        if (!this.ibmCloudService) {
            this.logger.warn('Cannot prefetch - IBM Cloud Service not initialized');
            return;
        }

        try {
            // First enqueue catalog validation and details
            this.enqueueLookups([{
                type: 'catalog',
                value: catalogId,
                context: { catalogId }
            }]);

            // Fetch and cache offerings
            const offerings = await this.ibmCloudService.getOfferingsForCatalog(catalogId);

            // Enqueue flavor prefetch for each offering
            const flavorLookups: LookupItem[] = offerings.map(offering => ({
                type: 'flavors',
                value: offering.id,
                context: {
                    catalogId,
                    offeringId: offering.id
                }
            }));

            this.enqueueLookups(flavorLookups);

        } catch (error) {
            this.logger.error(`Failed to initiate prefetch for catalog ${catalogId}`, error);
        }
    }

    /**
     * Prefetches data for multiple catalogs concurrently.
     * @param catalogIds - Array of catalog IDs to prefetch
     */
    public async prefetchMultipleCatalogs(catalogIds: string[]): Promise<void> {
        this.logger.debug(`Initiating prefetch for ${catalogIds.length} catalogs`);

        // Use lodash chunk instead of our local implementation
        const batches = chunk(catalogIds, this.options.concurrency || 3);

        for (const catalogBatch of batches) {
            await Promise.all(
                catalogBatch.map(catalogId => this.prefetchCatalogData(catalogId))
            );
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    /**
     * Analyzes a catalog JSON structure and initiates prefetching for all referenced catalogs.
     * @param catalogJson - The catalog JSON structure to analyze
     */
    public analyzeCatalogAndPrefetch(catalogJson: Record<string, unknown>): void {
        const catalogIds = new Set<string>();

        const extractCatalogIds = (obj: unknown): void => {
            if (!obj || typeof obj !== 'object') return;

            if (
                obj &&
                typeof obj === 'object' &&
                'catalog_id' in obj &&
                typeof obj.catalog_id === 'string'
            ) {
                catalogIds.add(obj.catalog_id);
            }

            if (Array.isArray(obj)) {
                obj.forEach(item => extractCatalogIds(item));
            } else if (obj && typeof obj === 'object') {
                Object.values(obj).forEach(value => extractCatalogIds(value));
            }
        };

        extractCatalogIds(catalogJson);

        if (catalogIds.size > 0) {
            this.logger.debug(`Found ${catalogIds.size} catalogs to prefetch`);
            void this.prefetchMultipleCatalogs(Array.from(catalogIds));
        }
    }
}
