// src/services/CachePrefetchService.ts
import { LoggingService } from './LoggingService';
import { IBMCloudService } from '../IBMCloudService';
import { CacheService } from '../CacheService';
import { throttle } from 'lodash';
import type { LookupItem, PrefetchOptions } from '../../types/cache';

export class CachePrefetchService {
    private static instance: CachePrefetchService;
    private readonly logger = LoggingService.getInstance();
    private queue: LookupItem[] = [];
    private processing: boolean = false;
    private ibmCloudService?: IBMCloudService;
    private readonly cacheService: CacheService;

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

    public static getInstance(options?: PrefetchOptions): CachePrefetchService {
        if (!CachePrefetchService.instance) {
            CachePrefetchService.instance = new CachePrefetchService(options);
        }
        return CachePrefetchService.instance;
    }

    public setIBMCloudService(service: IBMCloudService): void {
        this.ibmCloudService = service;
    }

    public enqueueLookups(items: LookupItem[]): void {
        this.logger.debug(`Enqueueing ${items.length} items for cache prefetch`);
        
        // Filter out items that are already cached
        const uncachedItems = items.filter(item => {
            const cacheKey = this.getCacheKey(item);
            return this.cacheService.get(cacheKey) === undefined;
        });

        if (uncachedItems.length === 0) {
            this.logger.debug('All items already cached');
            return;
        }

        // Apply limits per type to avoid excessive API calls
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

    private async prefetchItem(item: LookupItem, attempt: number = 1): Promise<void> {
        if (!this.ibmCloudService) {
            return;
        }

        try {
            switch (item.type) {
                case 'catalog':
                    if (item.context?.isPublic) {
                        await this.ibmCloudService.getAvailablePublicCatalogs();
                    } else {
                        await this.ibmCloudService.getAvailablePrivateCatalogs();
                    }
                break;
                case 'offerings':
                    if (!item.context?.catalogId) {
                        throw new Error('Catalog ID required for offerings lookup');
                    }
                    await this.ibmCloudService.getOfferingsForCatalog(item.context.catalogId);
                    break;
                case 'flavors':
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

    private getCacheKey(item: LookupItem): string {
        switch (item.type) {
            case 'catalog':
                this.logger.debug(`Generating cache key for catalog`, {
                    type: item.type,
                    value: item.value,
                    key: `available_public_catalogs`
                });
                return `available_public_catalogs`;
            case 'offerings':
                this.logger.debug(`Generating cache key for offerings`, {
                    type: item.type,
                    value: item.value,
                    key: `offerings:${item.context?.catalogId}`
                });
                return `offerings:${item.context?.catalogId}`;
            case 'flavors':
                this.logger.debug(`Generating cache key for flavors`, {
                    type: item.type,
                    value: item.value,
                    key: `flavors:${item.context?.catalogId}:${item.context?.offeringId}`
                });
                return `flavors:${item.context?.catalogId}:${item.context?.offeringId}`;
            default:
                this.logger.error(`Unknown cache key type: ${item.type}`);
                return '';
        }
    }
}