// src/services/IBMCloudService.ts

import * as vscode from 'vscode';
import { IamAuthenticator } from 'ibm-cloud-sdk-core';
import CatalogManagementV1 = require('@ibm-cloud/platform-services/catalog-management/v1');
import { LoggingService } from './core/LoggingService';
import { CacheService } from './CacheService';
import { throttle } from 'lodash';
import { CacheKeys, CacheConfigurations, DynamicCacheKeys } from '../types/cache/cacheConfig';
import {
    IBMCloudError,
    CatalogResponse,
    CatalogItem,
    OfferingItem,
    Kind,
    OfferingVersion,
    OfferingFlavor,
} from '../types/ibmCloud';
import { deduplicateRequest } from '../decorators/requestDeduplication';

/**
 * Service for interacting with IBM Cloud APIs and managing catalog data.
 */
export class IBMCloudService {
    private catalogManagement: CatalogManagementV1;
    private cacheService: CacheService;
    private logger: LoggingService;
    private backgroundCacheQueue: Set<string> = new Set();
    private isProcessingQueue: boolean = false;

    /**
     * Constructor for IBMCloudService.
     * Initializes the service with API credentials and sets up logging and caching.
     * @param apiKey - API key for IBM Cloud.
     */
    constructor(private apiKey: string) {
        this.logger = LoggingService.getInstance();
        this.logger.debug('Initializing IBMCloudService');
        const authenticator = new IamAuthenticator({ apikey: apiKey });
        this.catalogManagement = new CatalogManagementV1({ authenticator });
        this.cacheService = CacheService.getInstance();
    }

    /**
     * Provides visual feedback in VS Code for long-running tasks.
     * @param title - Title of the progress bar.
     * @param task - Task function returning a Promise.
     * @returns Promise<T> - Result of the task.
     */
    private async withProgress<T>(
        title: string,
        task: () => Promise<T>
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: `In Progress` });

                try {
                    const result = await task();
                    progress.report({ message: `Complete` });
                    await this.delay(500);
                    return result;
                } catch (error) {
                    progress.report({ message: `Failed` });
                    await this.delay(1000);
                    vscode.window.showErrorMessage(`Task failed: ${this.extractErrorMessage(error)}`);
                    throw error;
                }
            }
        );
    }

    /**
     * Extracts error message from an error object.
     * @param error - Error object.
     * @returns string - Error message.
     */
    private extractErrorMessage(error: any): string {
        return error instanceof Error ? error.message : String(error);
    }

    /**
     * Throttles the processBackgroundCache method to prevent frequent API calls.
     */
    private processBackgroundCacheThrottled = throttle(
        () => this.processBackgroundCache(),
        5000,
        { leading: true, trailing: true }
    );

    /**
     * Adds a catalog ID to the background caching queue.
     * @param catalogId - Catalog ID to cache.
     */
    private enqueueCatalogId(catalogId: string): void {
        if (!this.backgroundCacheQueue.has(catalogId)) {
            this.logger.debug(`Enqueuing catalog ID for background caching: ${catalogId}`);
            this.backgroundCacheQueue.add(catalogId);
            void this.processBackgroundCacheThrottled();
        }
    }

    /**
     * Processes the background cache queue for catalog IDs.
     * Caches offering details for each catalog ID.
     */
    private async processBackgroundCache(): Promise<void> {
        if (this.isProcessingQueue || this.backgroundCacheQueue.size === 0) {
            return;
        }

        this.isProcessingQueue = true;
        this.logger.debug(`Processing background cache queue: ${this.backgroundCacheQueue.size} items`);

        try {
            const catalogIds = Array.from(this.backgroundCacheQueue);
            this.backgroundCacheQueue.clear();

            for (const catalogId of catalogIds) {
                try {
                    const cacheKey = DynamicCacheKeys.OFFERINGS(catalogId);
                    if (!this.cacheService.get(cacheKey)) {
                        const details = await this.withProgress(`Fetching offering details for ${catalogId}`, () =>
                            this.fetchOfferingDetails(catalogId)
                        );
                        this.cacheService.set(cacheKey, details, CacheConfigurations[CacheKeys.OFFERING]);
                        this.logger.debug(`Background cached offering details for: ${catalogId}`);
                    }
                } catch (error) {
                    this.logger.error(`Failed to background cache offering: ${catalogId}`, error);
                }
                await this.delay(200);
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    /**
     * Fetches offering details for a given catalog ID.
     * @param catalogId - ID of the catalog.
     * @returns Promise<CatalogResponse> - The offering details.
     */
    private async fetchOfferingDetails(catalogId: string): Promise<CatalogResponse> {
        const response = await this.catalogManagement.getCatalog({ catalogIdentifier: catalogId });
        return response.result as CatalogResponse;
    }

    /**
     * Validates a catalog ID using cached data only.
     * Does not trigger any API lookup.
     * @param catalogId - ID of the catalog to validate.
     * @returns Promise<boolean> - True if catalog ID is valid, false otherwise.
     */
    public async validateCatalogId(catalogId: string): Promise<boolean> {
        const cacheKey = DynamicCacheKeys.CATALOG_VALIDATION(catalogId);
        this.logger.debug(`Validating catalog ID: ${catalogId} using cached data`);

        const cachedValue = this.cacheService.get<boolean>(cacheKey);
        if (cachedValue !== undefined) {
            this.logger.debug(`Using cached validation result for ${catalogId}`, { isValid: cachedValue });
            if (cachedValue) {
                this.enqueueCatalogId(catalogId);
            }
            return cachedValue;
        }

        this.logger.debug(`No cached validation result for ${catalogId}. Validation cannot proceed.`);
        return false;
    }

    /**
     * Validates a flavor using cached data only.
     * Does not trigger any API lookup.
     * @param catalogId - The catalog ID.
     * @param offeringId - The offering ID.
     * @param flavorName - The flavor name to validate.
     * @returns Promise<boolean> - True if the flavor exists in cache, false otherwise.
     */
    public async validateFlavor(catalogId: string, offeringId: string, flavorName: string): Promise<boolean> {
        const cacheKey = DynamicCacheKeys.FLAVOR_VALIDATION(catalogId, offeringId, flavorName);
        this.logger.debug(`Validating flavor: ${flavorName} for offering ${offeringId} in catalog ${catalogId} using cached data`);

        const cachedResult = this.cacheService.get<boolean>(cacheKey);
        if (cachedResult !== undefined) {
            this.logger.debug(`Using cached flavor validation result`, { catalogId, offeringId, flavorName, isValid: cachedResult });
            return cachedResult;
        }

        this.logger.debug(`No cached validation result for flavor: ${flavorName}. Validation cannot proceed.`);
        return false;
    }

    /**
     * Validates an offering ID within a catalog using cached data only.
     * Does not trigger any API lookup.
     * @param catalogId - The catalog ID.
     * @param offeringId - The offering ID.
     * @returns Promise<boolean> - True if the offering ID is valid in cache, false otherwise.
     */
    public async validateOfferingId(catalogId: string, offeringId: string): Promise<boolean> {
        const cacheKey = DynamicCacheKeys.OFFERING_VALIDATION(catalogId, offeringId);
        this.logger.debug(`Validating offering ID: ${offeringId} in catalog ${catalogId} using cached data`);

        const cachedValue = this.cacheService.get<boolean>(cacheKey);
        if (cachedValue !== undefined) {
            this.logger.debug(`Using cached offering validation result for ${offeringId}`, { isValid: cachedValue });
            return cachedValue;
        }

        this.logger.debug(`No cached validation result for offering ID: ${offeringId}. Validation cannot proceed.`);
        return false;
    }

    /**
     * Fetches all offerings for a catalog and caches the result.
     * @param catalogId - ID of the catalog.
     * @returns Promise<OfferingItem[]> - Array of offerings.
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string) => `offerings:${catalogId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug('Duplicate offerings request detected', { key });
        },
    })
    public async getOfferingsForCatalog(catalogId: string): Promise<OfferingItem[]> {
        const cacheKey = DynamicCacheKeys.OFFERINGS(catalogId);
        const logger = this.logger;

        const cachedOfferings = this.cacheService.get<OfferingItem[]>(cacheKey);
        if (Array.isArray(cachedOfferings)) {
            logger.debug(`Using cached offerings for catalog ID: ${catalogId}`, { count: cachedOfferings.length });
            return cachedOfferings;
        }

        const PAGE_LIMIT = 1000;
        let offset = 0;
        let totalCount = 0;
        let fetchedOfferings: OfferingItem[] = [];

        logger.debug(`Starting to fetch offerings for catalog ID: ${catalogId}`);

        try {
            do {
                logger.debug(`Fetching offerings with limit=${PAGE_LIMIT} and offset=${offset}`);
                const response = await this.withProgress(`Fetching offerings for ${catalogId}`, () =>
                    this.catalogManagement.listOfferings({ catalogIdentifier: catalogId, limit: PAGE_LIMIT, offset })
                );

                const resources = response.result.resources ?? [];
                const offeringsPage: OfferingItem[] = resources.map((offering) => ({
                    id: offering.id!,
                    name: offering.name!,
                    label: offering.label,
                    shortDescription: offering.short_description,
                    kinds: this.mapKinds(offering.kinds ?? [], offering.id!, catalogId),
                    created: offering.created,
                    updated: offering.updated,
                    metadata: offering.metadata,
                }));

                fetchedOfferings = fetchedOfferings.concat(offeringsPage);
                offset += PAGE_LIMIT;
                totalCount = response.result.total_count ?? fetchedOfferings.length;
                await this.delay(200);
            } while (fetchedOfferings.length < totalCount);

            logger.debug(`Successfully fetched all offerings for catalog ID: ${catalogId}`, { total: fetchedOfferings.length });
            this.cacheService.set(cacheKey, fetchedOfferings, CacheConfigurations[CacheKeys.OFFERING]);
            return fetchedOfferings;
        } catch (error) {
            logger.error(`Failed to fetch offerings for catalog ID: ${catalogId}`, error);
            throw error;
        }
    }

    /**
     * Maps raw kind data to typed Kind objects.
     * @param kinds - Raw kind data from API.
     * @param offeringId - Offering ID.
     * @param catalogId - Catalog ID.
     * @returns Kind[] - Array of mapped Kind objects.
     */
    private mapKinds(kinds: any[], offeringId: string, catalogId: string): Kind[] {
        return kinds.map((kind) => ({
            id: kind.id,
            format_kind: kind.format_kind,
            format_kind_label: kind.format_kind_label,
            install_kind: kind.install_kind,
            install_kind_label: kind.install_kind_label,
            target_kind: kind.target_kind,
            target_kind_label: kind.target_kind_label,
            versions: this.mapVersions(kind.versions ?? [], offeringId, catalogId, kind.id),
            metadata: kind.metadata,
        }));
    }

    /**
     * Maps raw version data to OfferingVersion objects.
     * @param versions - Raw version data from API.
     * @param offeringId - Offering ID.
     * @param catalogId - Catalog ID.
     * @param kindId - Kind ID.
     * @returns OfferingVersion[] - Array of mapped OfferingVersion objects.
     */
    private mapVersions(versions: any[], offeringId: string, catalogId: string, kindId: string): OfferingVersion[] {
        return versions.map((version) => ({
            id: version.id,
            version: version.version,
            flavor: version.flavor
                ? {
                    name: version.flavor.name,
                    label: version.flavor.label,
                    label_i18n: version.flavor.label_i18n,
                    index: version.flavor.index,
                }
                : undefined,
            created: version.created,
            updated: version.updated,
            catalog_id: catalogId,
            offering_id: offeringId,
            kind_id: kindId,
            tags: version.tags,
            configuration: version.configuration,
            outputs: version.outputs,
        }));
    }

    /**
     * Utility function to introduce a delay.
     * @param ms - Milliseconds to delay.
     * @returns Promise<void>
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Formats an error for logging.
     * @param error - Error to format.
     * @returns Record<string, any> - Formatted error details.
     */
    private formatError(error: unknown): Record<string, any> {
        if (error instanceof Error) {
            const ibmError = error as IBMCloudError;
            return {
                message: ibmError.message,
                status: ibmError.status,
                statusText: ibmError.statusText,
                stack: ibmError.stack,
                body: ibmError.body,
            };
        }
        return { error: String(error) };
    }

    /**
     * Masks an API key for secure logging.
     * @param apiKey - API key to mask.
     * @returns string - Masked API key.
     */
    private maskApiKey(apiKey: string): string {
        if (!apiKey) {
            return '';
        }
        if (apiKey.length <= 8) {
            return '***';
        }
        return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
    }

    public async getAvailablePublicCatalogs(): Promise<CatalogItem[]> {
        this.logger.debug('Fetching available public catalogs');

        const cachedCatalogs = this.cacheService.get<CatalogItem[]>(CacheKeys.CATALOG);
        if (cachedCatalogs?.some(catalog => catalog.isPublic)) {
            const publicCatalogs = cachedCatalogs.filter(catalog => catalog.isPublic);
            this.logger.debug('Using cached public catalogs', { count: publicCatalogs.length });
            return publicCatalogs;
        }

        try {
            // No API for fetching public catalogs; hardcoding known public catalogs
            const publicCatalogs: CatalogItem[] = [
                {
                    id: '1082e7d2-5e2f-0a11-a3bc-f88a8e1931fc',
                    label: 'IBM Cloud Catalog',
                    shortDescription: 'IBM Cloud Catalog',
                    isPublic: true,
                },
                {
                    id: '7a4d68b4-cf8b-40cd-a3d1-f49aff526eb3',
                    label: 'Community Registry',
                    shortDescription: 'Community Registry',
                    isPublic: true,
                },
            ];

            // Merge with any existing private catalogs
            const existingCatalogs = this.cacheService.get<CatalogItem[]>(CacheKeys.CATALOG) || [];
            const mergedCatalogs = [...existingCatalogs.filter(c => !c.isPublic), ...publicCatalogs];

            this.cacheService.set(CacheKeys.CATALOG, mergedCatalogs, CacheConfigurations[CacheKeys.CATALOG]);

            this.logger.debug('Successfully fetched public catalogs', { count: publicCatalogs.length });
            return publicCatalogs;
        } catch (error) {
            this.logger.error('Failed to fetch available public catalogs', error);
            throw error;
        }
    }

    public async getAvailablePrivateCatalogs(): Promise<CatalogItem[]> {
        this.logger.debug('Fetching available private catalogs');

        const cachedCatalogs = this.cacheService.get<CatalogItem[]>(CacheKeys.CATALOG);
        if (cachedCatalogs?.some(catalog => !catalog.isPublic)) {
            const privateCatalogs = cachedCatalogs.filter(catalog => !catalog.isPublic);
            this.logger.debug('Using cached private catalogs', { count: privateCatalogs.length });
            return privateCatalogs;
        }

        try {
            const response = await this.withProgress('Fetching private catalogs', () =>
                this.catalogManagement.listCatalogs()
            );

            const privateCatalogs: CatalogItem[] = (response.result.resources ?? [])
                .filter((catalog) => !catalog.disabled && catalog.id && catalog.label)
                .map((catalog) => ({
                    id: catalog.id!,
                    label: catalog.label!,
                    shortDescription: catalog.short_description,
                    disabled: catalog.disabled,
                    isPublic: false,
                }));

            // Merge with any existing public catalogs
            const existingCatalogs = this.cacheService.get<CatalogItem[]>(CacheKeys.CATALOG) || [];
            const mergedCatalogs = [...existingCatalogs.filter(c => c.isPublic), ...privateCatalogs];

            this.cacheService.set(CacheKeys.CATALOG, mergedCatalogs, CacheConfigurations[CacheKeys.CATALOG]);

            this.logger.debug('Successfully fetched private catalogs', { count: privateCatalogs.length });
            return privateCatalogs;
        } catch (error) {
            this.logger.error('Failed to fetch available private catalogs', error);
            throw error;
        }
    }

    /**
     * Fetches all available catalogs (both private and public).
     * @returns Promise<CatalogItem[]> - Array of all available catalogs.
     */
    public async getAvailableCatalogs(): Promise<CatalogItem[]> {
        const cacheKey = CacheKeys.CATALOG;
        this.logger.debug('Fetching all available catalogs (private and public)');

        const cachedCatalogs = this.cacheService.get<CatalogItem[]>(cacheKey);
        if (cachedCatalogs) {
            this.logger.debug('Using cached all catalogs', { count: cachedCatalogs.length });
            return cachedCatalogs;
        }

        try {
            const [publicCatalogs, privateCatalogs] = await Promise.all([
                this.getAvailablePublicCatalogs(),
                this.getAvailablePrivateCatalogs(),
            ]);

            const allCatalogs = [...publicCatalogs, ...privateCatalogs];
            this.logger.debug('Successfully fetched all catalogs', { count: allCatalogs.length });
            this.cacheService.set(cacheKey, allCatalogs, CacheConfigurations[CacheKeys.CATALOG]);

            return allCatalogs;
        } catch (error) {
            this.logger.error('Failed to fetch all available catalogs', error);
            throw error;
        }
    }

    /**
     * Fetches all available flavors for a given offering.
     * @param catalogId - Catalog ID.
     * @param offeringId - Offering ID.
     * @returns Promise<string[]> - Array of unique flavor names.
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string, offeringId: string) => `flavors:${catalogId}:${offeringId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug('Duplicate flavors request detected', { key });
        },
    })
    public async getAvailableFlavors(catalogId: string, offeringId: string): Promise<string[]> {
        const cacheKey = DynamicCacheKeys.FLAVORS(catalogId, offeringId);
        this.logger.debug(`Fetching available flavors for offering ${offeringId} in catalog ${catalogId}`);

        const cachedFlavors = this.cacheService.get<string[]>(cacheKey);
        if (cachedFlavors) {
            this.logger.debug('Using cached flavors', { count: cachedFlavors.length });
            return cachedFlavors;
        }

        try {
            const response = await this.withProgress(`Fetching flavors for offering ${offeringId}`, () =>
                this.catalogManagement.getOffering({
                    catalogIdentifier: catalogId,
                    offeringId: offeringId,
                })
            );

            const offering = response.result;
            if (!offering?.kinds?.length) {
                return [];
            }

            const flavorSet = new Set<string>();
            offering.kinds.forEach((kind) => {
                if (kind.versions) {
                    kind.versions.forEach((version) => {
                        if (version.flavor?.name) {
                            flavorSet.add(version.flavor.name);
                        }
                    });
                }
            });

            const flavors = Array.from(flavorSet);
            this.cacheService.set(cacheKey, flavors, CacheConfigurations[CacheKeys.DEFAULT]);
            this.logger.debug('Successfully fetched flavors', { count: flavors.length });
            return flavors;
        } catch (error) {
            this.logger.error('Failed to fetch flavors', {
                catalogId,
                offeringId,
                error: this.formatError(error),
            });
            throw error;
        }
    }

    /**
     * Gets detailed information about a specific flavor.
     * @param catalogId - Catalog ID.
     * @param offeringId - Offering ID.
     * @param flavorName - Flavor name.
     * @returns Promise<OfferingFlavor | undefined> - The flavor details if found.
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string, offeringId: string, flavorName: string) =>
            `flavorDetails:${catalogId}:${offeringId}:${flavorName}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug('Duplicate flavor details request detected', { key });
        },
    })
    public async getFlavorDetails(
        catalogId: string,
        offeringId: string,
        flavorName: string
    ): Promise<OfferingFlavor | undefined> {
        const cacheKey = DynamicCacheKeys.FLAVOR_DETAILS(catalogId, offeringId, flavorName);

        const cachedDetails = this.cacheService.get<OfferingFlavor>(cacheKey);
        if (cachedDetails) {
            return cachedDetails;
        }

        try {
            const response = await this.withProgress(`Fetching flavor details for ${flavorName}`, () =>
                this.catalogManagement.getOffering({
                    catalogIdentifier: catalogId,
                    offeringId: offeringId,
                })
            );

            const offering = response.result;
            if (!offering?.kinds?.length) {
                return undefined;
            }

            let flavorDetails: OfferingFlavor | undefined;

            for (const kind of offering.kinds) {
                if (!kind.versions?.length) {
                    continue;
                }

                for (const version of kind.versions) {
                    const flavor = version.flavor;
                    if (flavor?.name && flavor.name === flavorName) {
                        if (flavor.name && flavor.label) {
                            flavorDetails = {
                                name: flavor.name,
                                label: flavor.label,
                                label_i18n: flavor.label_i18n,
                                index: flavor.index ?? 0,
                            };
                            break;
                        }
                    }
                }
                if (flavorDetails) {
                    break;
                }
            }

            if (flavorDetails) {
                this.cacheService.set(cacheKey, flavorDetails, CacheConfigurations[CacheKeys.DEFAULT]);
                this.logger.debug('Found and cached flavor details', {
                    catalogId,
                    offeringId,
                    flavorName,
                    label: flavorDetails.label,
                });
            } else {
                this.logger.debug('No matching flavor found', {
                    catalogId,
                    offeringId,
                    flavorName,
                });
            }

            return flavorDetails;
        } catch (error) {
            this.logger.error('Failed to get flavor details', {
                catalogId,
                offeringId,
                flavorName,
                error: this.formatError(error),
            });
            return undefined;
        }
    }

    /**
     * Gets detailed information about a specific flavor.
     * @param catalogId - The catalog ID to get details for.
     * @returns Promise<CatalogResponse> - The catalog details.
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string) => `getOfferingDetails:${catalogId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug('Duplicate offering details request detected', { key });
        },
    })
    public async getOfferingDetails(catalogId: string): Promise<CatalogResponse> {
        const cacheKey = DynamicCacheKeys.OFFERING_DETAILS(catalogId);
        this.logger.debug(`Fetching offering details for catalog ID: ${catalogId}`);

        const cachedValue = this.cacheService.get<CatalogResponse>(cacheKey);
        if (cachedValue !== undefined) {
            this.logger.debug(`Using cached offering details for ${catalogId}`, {
                label: cachedValue.label,
                id: cachedValue.id,
            });
            return cachedValue;
        }

        this.logger.debug('Making offering details request to IBM Cloud');
        try {
            const response = await this.withProgress(`Fetching catalog details for ${catalogId}`, () =>
                this.catalogManagement.getCatalog({
                    catalogIdentifier: catalogId,
                })
            );

            const details = response.result as CatalogResponse;
            this.logger.debug('Received offering details', {
                catalogId,
                label: details.label,
                id: details.id,
                status: response.status,
                updated: details.updated,
            });

            this.cacheService.set(cacheKey, details, CacheConfigurations[CacheKeys.CATALOG]);

            return details;
        } catch (error) {
            const errorDetails = this.formatError(error);
            this.logger.error('Failed to fetch offering details', {
                catalogId,
                error: errorDetails,
                maskedApiKey: this.maskApiKey(this.apiKey),
            });

            throw new Error(this.getErrorMessage(error));
        }
    }

    /**
     * Retrieves a user-friendly error message from an error object.
     * @param error - Error object.
     * @returns string - Error message.
     */
    private getErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            const ibmError = error as IBMCloudError;
            if (ibmError.status === 404) {
                return 'Catalog ID not found';
            }
            if (ibmError.status === 401 || ibmError.status === 403) {
                return 'Authentication failed - please check your API key';
            }
            return ibmError.message;
        }
        return 'An unknown error occurred';
    }
}
