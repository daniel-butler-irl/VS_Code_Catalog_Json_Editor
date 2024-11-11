// src/services/core/CachePrefetchService.ts

import { LoggingService } from './LoggingService';
import { IBMCloudService } from '../IBMCloudService';
import { CacheService } from '../CacheService';
import { chunk, throttle } from 'lodash';
import type { LookupItem, PrefetchOptions } from '../../types/cache';
import { CacheConfigurations, CacheKeys, DynamicCacheKeys } from '../../types/cache/cacheConfig';

/**
 * Service for managing cache prefetching of IBM Cloud data to improve performance.
 * Handles enqueuing, processing, and prefetching of items, as well as cache key generation.
 * Implements a hierarchical prefetching strategy for catalogs, offerings, and flavors.
 */
export class CachePrefetchService {
    private static instance: CachePrefetchService;
    private readonly logger = LoggingService.getInstance();
    private queue: LookupItem[] = [];
    private processing: boolean = false;
    private ibmCloudService?: IBMCloudService;
    private readonly cacheService: CacheService;

    /** Priority levels for different types of lookups */
    private static readonly PRIORITIES = {
        CATALOG: 1,
        OFFERING: 2,
        FLAVOR: 3
    } as const;

    /**
     * Constructs a CachePrefetchService instance with specified options.
     * @param options - Options to configure prefetching, including concurrency, retry attempts, and item limits per type.
     * @private
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
    }

    /**
     * Gets the IBM Cloud service instance, throwing an error if not initialized.
     * @private
     * @throws {Error} If IBM Cloud Service is not initialized
     * @returns {IBMCloudService} The initialized service
     */
    private getCloudService(): IBMCloudService {
        if (!this.ibmCloudService) {
            throw new Error('IBM Cloud Service not initialized');
        }
        return this.ibmCloudService;
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
     * Analyzes a catalog JSON structure and initiates prefetching for all referenced catalogs, offerings, and flavors.
     * @param catalogJson - The catalog JSON structure to analyze
     */
    public analyzeCatalogAndPrefetch(catalogJson: Record<string, unknown>): void {
        const catalogDependencies = new Map<string, {
            offerings: Map<string, {
                flavors: Set<string>
            }>
        }>();

        this.logger.debug('Starting catalog JSON analysis for dependencies');

        const extractDependencies = (obj: unknown): void => {
            if (!obj || typeof obj !== 'object') return;

            if (Array.isArray(obj)) {
                obj.forEach(item => extractDependencies(item));
                return;
            }

            const objRecord = obj as Record<string, unknown>;
            if (objRecord.dependencies && Array.isArray(objRecord.dependencies)) {
                this.logger.debug(`Found dependencies array with ${objRecord.dependencies.length} items`);

                for (const dependency of objRecord.dependencies) {
                    if (dependency && typeof dependency === 'object') {
                        const dep = dependency as Record<string, unknown>;
                        const catalogId = dep.catalog_id as string;
                        const offeringId = dep.id as string;
                        const flavors = dep.flavors as string[];
                        const name = dep.name as string; // For better logging

                        if (catalogId && offeringId) {
                            this.logger.debug('Found dependency:', {
                                name,
                                catalogId,
                                offeringId,
                                flavorCount: flavors?.length ?? 0,
                                flavors
                            });

                            let catalogEntry = catalogDependencies.get(catalogId);
                            if (!catalogEntry) {
                                catalogEntry = { offerings: new Map() };
                                catalogDependencies.set(catalogId, catalogEntry);
                                this.logger.debug(`Created new catalog entry for ${catalogId}`);
                            }

                            let offeringEntry = catalogEntry.offerings.get(offeringId);
                            if (!offeringEntry) {
                                offeringEntry = { flavors: new Set() };
                                catalogEntry.offerings.set(offeringId, offeringEntry);
                                this.logger.debug(`Created new offering entry for ${offeringId} in catalog ${catalogId}`);
                            }

                            if (Array.isArray(flavors)) {
                                for (const flavor of flavors) {
                                    offeringEntry.flavors.add(flavor);
                                    this.logger.debug(`Added flavor ${flavor} to offering ${offeringId}`);
                                }
                            }
                        } else {
                            this.logger.warn('Found incomplete dependency:', {
                                name,
                                catalogId,
                                offeringId,
                                hasFlavors: Boolean(flavors)
                            });
                        }
                    }
                }
            }

            Object.values(objRecord).forEach(value => extractDependencies(value));
        };

        extractDependencies(catalogJson);

        // Log summary of what we found
        if (catalogDependencies.size > 0) {
            this.logger.debug('Dependency analysis complete:', {
                totalCatalogs: catalogDependencies.size,
                catalogDetails: Array.from(catalogDependencies.entries()).map(([catalogId, data]) => ({
                    catalogId,
                    offeringCount: data.offerings.size,
                    offerings: Array.from(data.offerings.entries()).map(([offeringId, offeringData]) => ({
                        offeringId,
                        flavorCount: offeringData.flavors.size,
                        flavors: Array.from(offeringData.flavors)
                    }))
                }))
            });

            void this.prefetchCatalogsWithDependencies(catalogDependencies);
        } else {
            this.logger.debug('No dependencies found in catalog JSON');
        }
    }

    /**
     * Initiates prefetching for multiple catalogs with their dependencies.
     * Follows a hierarchical approach: catalogs -> offerings -> flavors.
     * @param catalogDependencies - Map of catalog IDs to their offerings and flavors
     * @private
     */
    private async prefetchCatalogsWithDependencies(
        catalogDependencies: Map<string, {
            offerings: Map<string, {
                flavors: Set<string>
            }>
        }>
    ): Promise<void> {
        this.logger.debug(`Initiating prefetch for ${catalogDependencies.size} catalogs with dependencies`);

        // Process catalogs in parallel, but wait for all to complete before moving to offerings
        const catalogResults = await Promise.all(
            Array.from(catalogDependencies.entries()).map(async ([catalogId, { offerings }]) => {
                try {
                    this.logger.debug(`Processing catalog ${catalogId} with ${offerings.size} offerings`);
                    const catalogExists = await this.prefetchCatalogIfExists(catalogId);
                    return { catalogId, offerings, exists: catalogExists };
                } catch (error) {
                    this.logger.error(`Error prefetching catalog ${catalogId}`, error);
                    return { catalogId, offerings, exists: false };
                }
            })
        );

        // Filter to valid catalogs and process their offerings in parallel
        const validCatalogs = catalogResults.filter(result => result.exists);
        if (validCatalogs.length > 0) {
            await Promise.all(
                validCatalogs.map(({ catalogId, offerings }) =>
                    this.prefetchOfferingsForCatalog(catalogId, offerings)
                )
            );
        }

        this.logger.debug('Completed prefetch initiation for all catalogs with dependencies');
    }

    /**
     * Prefetches catalog data if the catalog exists.
     * @param catalogId - The ID of the catalog to prefetch
     * @returns Promise<boolean> indicating if the catalog exists
     * @private
     */
    private async prefetchCatalogIfExists(catalogId: string): Promise<boolean> {
        try {
            const cloudService = this.getCloudService();
            const validationKey = DynamicCacheKeys.CATALOG_VALIDATION(catalogId);

            this.logger.debug(`Validating catalog ${catalogId}`);
            // First check validation cache
            const validationResult = this.cacheService.get<boolean>(validationKey);
            if (validationResult !== undefined) {
                this.logger.debug(`Using cached validation for catalog ${catalogId}`, {
                    isValid: validationResult
                });
                return validationResult;
            }

            const catalogs = await cloudService.getAvailableCatalogs();
            const exists = catalogs.some(catalog => catalog.id === catalogId);

            // Cache validation result
            this.cacheService.set(validationKey, exists, CacheConfigurations[CacheKeys.CATALOG_VALIDATION]);

            if (exists) {
                this.logger.debug(`Catalog ${catalogId} exists, fetching offerings`);
                // Also fetch and cache the catalog's offerings
                await cloudService.getOfferingsForCatalog(catalogId);
                return true;
            }

            this.logger.debug(`Catalog ${catalogId} not found`);
            return false;
        } catch (error) {
            this.logger.error(`Failed to validate catalog ${catalogId}`, error);
            return false;
        }
    }

    /**
     * Prefetches offerings for a specific catalog.
     * @param catalogId - The catalog ID
     * @param offerings - Map of offering IDs to their flavors
     * @private
     */
    private async prefetchOfferingsForCatalog(
        catalogId: string,
        offerings: Map<string, { flavors: Set<string> }>
    ): Promise<void> {
        this.logger.debug(`Processing ${offerings.size} offerings for catalog ${catalogId}`);

        // Process all offerings in parallel
        const offeringResults = await Promise.all(
            Array.from(offerings.entries()).map(async ([offeringId, { flavors }]) => {
                try {
                    this.logger.debug(
                        `Validating offering ${offeringId} with ${flavors.size} flavors in catalog ${catalogId}`
                    );
                    const offeringExists = await this.prefetchOfferingIfExists(catalogId, offeringId);
                    return { offeringId, flavors, exists: offeringExists };
                } catch (error) {
                    this.logger.error(
                        `Error prefetching offering ${offeringId} in catalog ${catalogId}`,
                        error
                    );
                    return { offeringId, flavors, exists: false };
                }
            })
        );

        // Filter to valid offerings and process their flavors in parallel
        const validOfferings = offeringResults.filter(result => result.exists);
        if (validOfferings.length > 0) {
            await Promise.all(
                validOfferings.map(({ offeringId, flavors }) =>
                    this.prefetchFlavorsForOffering(catalogId, offeringId, flavors)
                )
            );
        }
    }

    /**
     * Validates and prefetches an offering if it exists.
     * @param catalogId - The catalog ID
     * @param offeringId - The offering ID to validate and prefetch
     * @returns Promise<boolean> indicating if the offering exists
     * @private
     */
    private async prefetchOfferingIfExists(catalogId: string, offeringId: string): Promise<boolean> {
        try {
            const cloudService = this.getCloudService();
            this.logger.debug(`Validating offering ${offeringId} in catalog ${catalogId}`);

            // Get offerings for this catalog
            const offerings = await cloudService.getOfferingsForCatalog(catalogId);
            const exists = offerings.some(offering => offering.id === offeringId);

            if (exists) {
                this.logger.debug(`Offering ${offeringId} validated in catalog ${catalogId}`);
                // Fetch offering details only if offering exists
                await cloudService.getOfferingDetails(catalogId);
                return true;
            }

            this.logger.debug(`Offering ${offeringId} not found in catalog ${catalogId}`);
            return false;
        } catch (error) {
            this.logger.error(`Failed to validate offering ${offeringId}`, error);
            return false;
        }
    }

    /**
     * Prefetches flavors for a specific offering.
     * @param catalogId - The catalog ID
     * @param offeringId - The offering ID
     * @param flavors - Set of flavor IDs to prefetch
     * @private
     */
    private async prefetchFlavorsForOffering(
        catalogId: string,
        offeringId: string,
        flavors: Set<string>
    ): Promise<void> {
        this.logger.debug(
            `Prefetching ${flavors.size} flavors for offering ${offeringId} in catalog ${catalogId}`
        );

        // First fetch and cache the list of available flavors
        const cloudService = this.getCloudService();
        const availableFlavors = await cloudService.getAvailableFlavors(catalogId, offeringId);
        const cacheKey = DynamicCacheKeys.FLAVORS(catalogId, offeringId);
        this.cacheService.set(
            cacheKey,
            availableFlavors,
            CacheConfigurations[CacheKeys.DEFAULT]
        );

        // Process all flavors in parallel
        await Promise.all(
            Array.from(flavors).map(async (flavorName) => {
                try {
                    const detailsKey = DynamicCacheKeys.FLAVOR_DETAILS(
                        catalogId,
                        offeringId,
                        flavorName
                    );

                    if (this.cacheService.get(detailsKey) === undefined) {
                        this.logger.debug(
                            `Fetching details for flavor ${flavorName} in offering ${offeringId}`
                        );

                        const details = await cloudService.getFlavorDetails(
                            catalogId,
                            offeringId,
                            flavorName
                        );

                        if (details) {
                            this.cacheService.set(
                                detailsKey,
                                details,
                                CacheConfigurations[CacheKeys.FLAVOR_DETAILS]
                            );

                            const validationKey = DynamicCacheKeys.FLAVOR_VALIDATION(
                                catalogId,
                                offeringId,
                                flavorName
                            );
                            this.cacheService.set(
                                validationKey,
                                true,
                                CacheConfigurations[CacheKeys.FLAVOR_VALIDATION]
                            );
                        }
                    }
                } catch (error) {
                    this.logger.error(
                        `Failed to fetch details for flavor ${flavorName}`,
                        error
                    );
                }
            })
        );
    }

    /**
     * Validates a flavor exists and prefetches its details.
     */
    private async prefetchFlavorIfExists(
        catalogId: string,
        offeringId: string,
        flavorName: string
    ): Promise<boolean> {
        try {
            const cloudService = this.getCloudService();
            const detailsKey = DynamicCacheKeys.FLAVOR_DETAILS(catalogId, offeringId, flavorName);
            const validationKey = DynamicCacheKeys.FLAVOR_VALIDATION(catalogId, offeringId, flavorName);

            // Check cache first
            const validationResult = this.cacheService.get<boolean>(validationKey);
            if (validationResult !== undefined) {
                this.logger.debug(
                    `Using cached validation for flavor ${flavorName}`,
                    { isValid: validationResult }
                );
                return validationResult;
            }

            // Fetch flavor list if not cached
            const flavorsKey = DynamicCacheKeys.FLAVORS(catalogId, offeringId);
            let flavors = this.cacheService.get<string[]>(flavorsKey);

            if (!flavors) {
                flavors = await cloudService.getAvailableFlavors(catalogId, offeringId);
                this.cacheService.set(
                    flavorsKey,
                    flavors,
                    CacheConfigurations[CacheKeys.DEFAULT]
                );
            }

            const exists = flavors.includes(flavorName);

            if (exists) {
                // Fetch and cache flavor details
                const details = await cloudService.getFlavorDetails(
                    catalogId,
                    offeringId,
                    flavorName
                );

                if (details) {
                    this.cacheService.set(
                        detailsKey,
                        details,
                        CacheConfigurations[CacheKeys.FLAVOR_DETAILS]
                    );
                    this.cacheService.set(
                        validationKey,
                        true,
                        CacheConfigurations[CacheKeys.FLAVOR_VALIDATION]
                    );

                    this.logger.debug(
                        `Flavor ${flavorName} validated and details cached for offering ${offeringId}`
                    );
                    return true;
                }
            }

            // Cache negative validation result
            this.cacheService.set(
                validationKey,
                false,
                CacheConfigurations[CacheKeys.FLAVOR_VALIDATION]
            );
            this.logger.debug(`Flavor ${flavorName} not found for offering ${offeringId}`);
            return false;

        } catch (error) {
            this.logger.error(
                `Failed to validate flavor ${flavorName}`,
                error
            );
            return false;
        }
    }

    /**
     * Adds items to the prefetch queue, filtering out already cached items.
     * @param items - Array of LookupItems to enqueue for caching
     */
    public enqueueLookups(items: LookupItem[]): void {
        this.logger.debug(`Enqueueing ${items.length} items for cache prefetch`);

        const uncachedItems = items.filter(item => {
            const cacheKey = this.generateCacheKey(item);
            const cached = this.cacheService.get(cacheKey);
            if (cached !== undefined) {
                this.logger.debug(`Item already cached: ${cacheKey}`);
                return false;
            }
            return true;
        });

        if (uncachedItems.length === 0) {
            this.logger.debug('All items already cached');
            return;
        }

        // Sort items by priority before adding to queue
        const sortedItems = [...uncachedItems].sort((a, b) =>
            (a.priority ?? Infinity) - (b.priority ?? Infinity)
        );

        this.queue.push(...sortedItems);
        void this.processQueue();
    }

    /**
     * Processes the prefetch queue, handling items based on priority.
     * @private
     */
    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        try {
            const cloudService = this.getCloudService();
        } catch (error) {
            this.logger.warn('Cannot process queue - IBM Cloud Service not initialized');
            return;
        }

        this.processing = true;
        this.logger.debug(`Processing prefetch queue: ${this.queue.length} items remaining`);

        try {
            // Sort queue by priority
            this.queue.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));

            // Take all items of current priority level
            const currentPriority = this.queue[0].priority;
            const currentPriorityItems = this.queue.filter(item => item.priority === currentPriority);

            // Process items type by type
            const batchByType = new Map<string, LookupItem[]>();
            currentPriorityItems.forEach(item => {
                const items = batchByType.get(item.type) || [];
                items.push(item);
                batchByType.set(item.type, items);
            });

            // Process each type sequentially
            for (const [type, items] of batchByType) {
                this.logger.debug(`Processing batch of type ${type}`, {
                    count: items.length,
                    items: items.map(i => ({ value: i.value, context: i.context }))
                });

                const batch = items.slice(0, this.options.concurrency);
                await Promise.all(batch.map(item => this.prefetchItem(item)));

                // Remove processed items
                this.queue = this.queue.filter(item => !batch.includes(item));
            }

            this.logger.debug(`Batch processing complete. ${this.queue.length} items remaining`);
        } catch (error) {
            this.logger.error('Error processing batch:', error);
        } finally {
            this.processing = false;
            if (this.queue.length > 0) {
                setTimeout(() => void this.processQueue(), 100);
            }
        }
    }

    /**
     * Prefetches a single item by making the appropriate API call.
     * Includes retry logic for failed requests.
     * @param item - LookupItem to prefetch
     * @param attempt - Current attempt count for retrying
     * @private
     */
    private async prefetchItem(item: LookupItem, attempt: number = 1): Promise<void> {
        try {
            const cloudService = this.getCloudService();
            this.logger.debug(`Processing prefetch item`, {
                type: item.type,
                value: item.value,
                context: item.context,
                attempt,
                priority: item.priority
            });

            switch (item.type) {
                case 'catalog':
                    this.logger.debug(`Fetching catalog details for ${item.value}`);
                    await cloudService.getAvailableCatalogs();
                    break;
                case 'offerings':
                    this.logger.debug(
                        `Fetching offering details for ${item.value} in catalog ${item.context?.catalogId}`
                    );
                    if (!item.context?.catalogId) {
                        throw new Error('Catalog ID required for offerings lookup');
                    }
                    await cloudService.getOfferingDetails(item.context.catalogId);
                    break;
                case 'flavors':
                    this.logger.debug(
                        `Fetching flavor details for ${item.value} in offering ${item.context?.offeringId}`
                    );
                    if (!item.context?.catalogId || !item.context?.offeringId) {
                        throw new Error('Catalog ID and Offering ID required for flavors lookup');
                    }
                    await cloudService.getFlavorDetails(
                        item.context.catalogId,
                        item.context.offeringId,
                        item.value as string
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
     * Generates a cache key for the provided LookupItem.
     * @param item - LookupItem for which to generate a cache key
     * @returns Generated cache key string
     * @private
     */
    private generateCacheKey(item: LookupItem): string {
        switch (item.type) {
            case 'catalog':
                return CacheKeys.CATALOG;
            case 'offerings':
                // Use catalog-specific offerings cache
                return DynamicCacheKeys.OFFERINGS(item.context?.catalogId!);
            case 'catalog_validation':
                return DynamicCacheKeys.CATALOG_VALIDATION(item.context?.catalogId!);
            case 'flavors':
                return DynamicCacheKeys.FLAVORS(
                    item.context?.catalogId!,
                    item.context?.offeringId!
                );
            default:
                this.logger.error(`Unknown cache key type: ${item.type}`);
                return '';
        }
    }
}