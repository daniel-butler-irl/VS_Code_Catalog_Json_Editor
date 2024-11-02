// src/services/IBMCloudService.ts
import * as vscode from 'vscode';
import { IamAuthenticator } from 'ibm-cloud-sdk-core';
import CatalogManagementV1 = require('@ibm-cloud/platform-services/catalog-management/v1');
import { LoggingService } from './LoggingService';
import { CacheService } from './CacheService';
import { throttle } from 'lodash';
import { deduplicateRequest } from '../decorators/requestDeduplication';

interface CatalogResponse {
    id: string;
    rev?: string;
    label: string;
    short_description?: string;
    catalog_icon_url?: string;
    tags?: string[];
    url?: string;
    crn?: string;
    offerings_url?: string;
    features?: any[];
    disabled?: boolean;
    created?: string;
    updated?: string;
}

export interface CatalogItem {
    id: string;
    label: string;
    shortDescription?: string;
    disabled?: boolean;
    isPublic: boolean; // Indicates if the catalog is public
}

/**
 * Represents a complete offering with all its details
 */
export interface OfferingItem {
    id: string;
    name: string;
    label?: string;
    shortDescription?: string;
    kinds?: Kind[];
    created?: string;
    updated?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Represents a kind within an offering
 */
export interface Kind {
    id: string;
    format_kind?: string;
    format_kind_label?: string;
    install_kind?: string;
    install_kind_label?: string;
    target_kind?: string;
    target_kind_label?: string;
    versions?: OfferingVersion[];
    metadata?: Record<string, unknown>;
}

export interface Output {
    key: string;
    description?: string;
}

export interface OfferingVersion {
    id: string;
    version: string;
    flavor?: OfferingFlavor;
    created?: string;
    updated?: string;
    catalog_id?: string;
    offering_id?: string;
    kind_id?: string;
    tags?: string[];
    configuration?: Configuration[];
    outputs?: Output[];
}

/**
 * Represents a flavor configuration within an offering version
 */
export interface OfferingFlavor {
    name: string;
    label: string;
    label_i18n?: Record<string, string>;
    index?: number;
    description?: string;
    displayName?: string;
}

export interface Configuration {
    key: string;
    type: string;
    description?: string;
    default_value?: string | number | boolean;
    required?: boolean;
}

interface IBMCloudError extends Error {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: any;
}

/**
 * Service for interacting with IBM Cloud APIs and managing catalog data
 */
export class IBMCloudService {
    private catalogManagement: CatalogManagementV1;
    private cacheService: CacheService;
    private logger: LoggingService;
    private pendingValidations: Map<string, Promise<boolean>> = new Map();
    private backgroundCacheQueue: Set<string> = new Set();
    private isProcessingQueue: boolean = false;


    private async withProgress<T>(
        title: string,
        task: () => Promise<T>
    ): Promise<T> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
            const result = await task();
            progress.report({ increment: 100 });
            return result;
        });
    }

    // Throttle the background processing to avoid API rate limits
    private processBackgroundCacheThrottled = throttle(
        () => this.processBackgroundCache(),
        5000, // Process every 5 seconds
        { leading: true, trailing: true }
    );

    constructor(private apiKey: string) {
        this.logger = LoggingService.getInstance();
        this.logger.debug('Initializing IBMCloudService');

        const authenticator = new IamAuthenticator({ apikey: apiKey });
        this.catalogManagement = new CatalogManagementV1({
            authenticator: authenticator,
        });

        this.cacheService = CacheService.getInstance();
    }

    /**
     * Enqueues a catalog ID for background caching
     * @param catalogId The catalog ID to cache
     */
    private enqueueCatalogId(catalogId: string): void {
        if (!this.backgroundCacheQueue.has(catalogId)) {
            this.logger.debug(`Enqueuing catalog ID for background caching: ${catalogId}`);
            this.backgroundCacheQueue.add(catalogId);
            void this.processBackgroundCacheThrottled();
        }
    }

    /**
     * Processes the background cache queue
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
                    const cacheKey = `offering:${catalogId}`;
                    if (!this.cacheService.get(cacheKey)) {
                        const details = await this.withProgress(`Fetching offering details for ${catalogId}`, () =>
                            this.fetchOfferingDetails(catalogId)
                        );
                        this.cacheService.set(cacheKey, details);
                        this.logger.debug(`Background cached offering details for: ${catalogId}`);
                    }
                } catch (error) {
                    this.logger.error(`Failed to background cache offering: ${catalogId}`, error);
                    // Don't throw - continue with next item
                }

                // Small delay between requests
                await this.delay(200); // 200ms delay
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    /**
     * Fetches offering details from IBM Cloud
     * @param catalogId The catalog ID to fetch details for
     * @returns Promise<CatalogResponse> The offering details
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string) => `fetchOfferingDetails:${catalogId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug(
                'Duplicate offering details request detected',
                { key }
            );
        }
    })
    private async fetchOfferingDetails(catalogId: string): Promise<CatalogResponse> {
        const response = await this.catalogManagement.getCatalog({
            catalogIdentifier: catalogId,
        });

        return response.result as CatalogResponse;
    }

    /**
   * Validates a catalog ID against IBM Cloud with request deduplication
   * @param catalogId The catalog ID to validate
   * @returns Promise<boolean> True if the catalog ID is valid
   */
    @deduplicateRequest({
        keyGenerator: (catalogId: string) => `validateCatalogId:${catalogId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug(
                'Duplicate catalog validation request detected',
                { key }
            );
        }
    })
    public async validateCatalogId(catalogId: string): Promise<boolean> {
        const cacheKey = `catalogId:${catalogId}`;
        this.logger.debug(`Validating catalog ID: ${catalogId}`);

        const cachedValue = this.cacheService.get<boolean>(cacheKey);
        if (cachedValue !== undefined) {
            this.logger.debug(`Using cached validation result for ${catalogId}`, { isValid: cachedValue });

            // If valid, ensure we have the offering details cached
            if (cachedValue) {
                this.enqueueCatalogId(catalogId);
            }

            return cachedValue;
        }

        let pendingValidation = this.pendingValidations.get(catalogId);
        if (pendingValidation) {
            this.logger.debug(`Using pending validation for ${catalogId}`);
            return pendingValidation;
        }

        pendingValidation = this.performValidation(catalogId, cacheKey);
        this.pendingValidations.set(catalogId, pendingValidation);

        try {
            const isValid = await pendingValidation;
            if (isValid) {
                this.enqueueCatalogId(catalogId);
            }
            return isValid;
        } finally {
            this.pendingValidations.delete(catalogId);
        }
    }

    /**
     * Performs the actual validation request to IBM Cloud
     * @param catalogId The catalog ID to validate
     * @param cacheKey The cache key to use for storing the result
     * @returns Promise<boolean> True if the catalog ID is valid
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string, cacheKey: string) => `validateCatalog:${catalogId}:${cacheKey}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug(
                'Duplicate validation request detected',
                { key }
            );
        }
    })
    private async performValidation(catalogId: string, cacheKey: string): Promise<boolean> {
        this.logger.debug('Making validation request to IBM Cloud');
        try {
            const response = await this.catalogManagement.getCatalog({
                catalogIdentifier: catalogId,
            });

            const isValid = response.status === 200;
            const responseData = response.result;

            this.logger.debug('Received validation response', {
                catalogId,
                status: response.status,
                isValid,
                label: responseData?.label,
                id: responseData?.id
            });

            this.cacheService.set(cacheKey, isValid);

            // If valid, also cache the details
            if (isValid && responseData) {
                const detailsCacheKey = `catalogDetails:${catalogId}`;
                this.cacheService.set(detailsCacheKey, responseData);
            }

            return isValid;
        } catch (error) {
            const errorDetails = this.formatError(error);
            this.logger.error('Failed to validate catalog ID', {
                catalogId,
                error: errorDetails,
                maskedApiKey: this.maskApiKey(this.apiKey)
            });

            this.cacheService.set(cacheKey, false);
            return false;
        }
    }

    /**
   * Fetches all offerings for a given catalog ID, including versions and flavors
   * @param catalogId The catalog ID
   * @returns Promise<OfferingItem[]> Array of all offerings with their details
   */
    @deduplicateRequest({
        keyGenerator: (catalogId: string) => `offerings:${catalogId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug(
                'Duplicate offerings request detected',
                { key }
            );
        }
    })
    public async getOfferingsForCatalog(catalogId: string): Promise<OfferingItem[]> {
        const cacheKey = `offerings:${catalogId}`;
        const logger = this.logger;

        // Check cache first
        const cachedOfferings = this.cacheService.get<OfferingItem[]>(cacheKey);
        if (cachedOfferings) {
            logger.debug(`Using cached offerings for catalog ID: ${catalogId}`, {
                count: cachedOfferings.length,
                withKinds: cachedOfferings.filter(o => o.kinds?.length).length
            });
            return cachedOfferings;
        }

        const PAGE_LIMIT = 1000; // Maximum allowed per API documentation
        let offset = 0;
        let totalCount = 0;
        let fetchedOfferings: OfferingItem[] = [];

        logger.debug(`Starting to fetch offerings for catalog ID: ${catalogId}`);

        try {
            do {
                logger.debug(`Fetching offerings with limit=${PAGE_LIMIT} and offset=${offset}`);

                const response = await this.withProgress(`Fetching offerings for ${catalogId}`, () =>
                    this.catalogManagement.listOfferings({
                        catalogIdentifier: catalogId,
                        limit: PAGE_LIMIT,
                        offset: offset,
                    }));

                const resources = response.result.resources ?? [];
                const offeringsPage: OfferingItem[] = resources
                    .filter(offering => offering.id && offering.name)
                    .map(offering => ({
                        id: offering.id!,
                        name: offering.name!,
                        label: offering.label,
                        shortDescription: offering.short_description,
                        kinds: this.mapKinds(offering.kinds ?? [], offering.id!, catalogId),
                        created: offering.created,
                        updated: offering.updated,
                        metadata: offering.metadata
                    }));

                fetchedOfferings = fetchedOfferings.concat(offeringsPage);

                // Update pagination variables
                offset += PAGE_LIMIT;
                totalCount = response.result.total_count ?? fetchedOfferings.length;

                logger.debug(`Fetched ${offeringsPage.length} offerings. Total fetched so far: ${fetchedOfferings.length}/${totalCount}`, {
                    withKinds: offeringsPage.filter(o => o.kinds?.length).length,
                    totalVersions: offeringsPage.reduce((sum, o) =>
                        sum + (o.kinds?.reduce((ksum, k) => ksum + (k.versions?.length || 0), 0) || 0), 0)
                });

                // Introduce a small delay to respect API rate limits
                await this.delay(200);

            } while (fetchedOfferings.length < totalCount);

            logger.debug(`Successfully fetched all offerings for catalog ID: ${catalogId}`, {
                total: fetchedOfferings.length,
                withKinds: fetchedOfferings.filter(o => o.kinds?.length).length,
                totalVersions: fetchedOfferings.reduce((sum, o) =>
                    sum + (o.kinds?.reduce((ksum, k) => ksum + (k.versions?.length || 0), 0) || 0), 0)
            });

            // Cache the results with metadata
            this.cacheService.set(cacheKey, fetchedOfferings, {
                catalogId,
                timestamp: new Date().toISOString(),
                totalOfferings: fetchedOfferings.length,
                totalKinds: fetchedOfferings.reduce((sum, o) => sum + (o.kinds?.length || 0), 0),
                totalVersions: fetchedOfferings.reduce((sum, o) =>
                    sum + (o.kinds?.reduce((ksum, k) => ksum + (k.versions?.length || 0), 0) || 0), 0)
            });

            return fetchedOfferings;
        } catch (error) {
            logger.error(`Failed to fetch offerings for catalog ID: ${catalogId}`, error);
            throw error;
        }
    }

    /**
     * Maps raw kind data to typed Kind objects
     * @param kinds Raw kind data from API
     * @param offeringId The offering ID
     * @param catalogId The catalog ID
     * @returns Array of typed Kind objects
     */
    private mapKinds(kinds: any[], offeringId: string, catalogId: string): Kind[] {
        return kinds.map(kind => ({
            id: kind.id,
            format_kind: kind.format_kind,
            format_kind_label: kind.format_kind_label,
            install_kind: kind.install_kind,
            install_kind_label: kind.install_kind_label,
            target_kind: kind.target_kind,
            target_kind_label: kind.target_kind_label,
            versions: this.mapVersions(kind.versions ?? [], offeringId, catalogId, kind.id),
            metadata: kind.metadata
        }));
    }

    /**
     * Maps raw version data to typed OfferingVersion objects
     * @param versions Raw version data from API
     * @param offeringId The offering ID
     * @param catalogId The catalog ID
     * @param kindId The kind ID
     * @returns Array of typed OfferingVersion objects
     */
    private mapVersions(versions: any[], offeringId: string, catalogId: string, kindId: string): OfferingVersion[] {
        return versions.map(version => ({
            id: version.id,
            version: version.version,
            flavor: version.flavor ? {
                name: version.flavor.name,
                label: version.flavor.label,
                label_i18n: version.flavor.label_i18n,
                index: version.flavor.index
            } : undefined,
            created: version.created,
            updated: version.updated,
            catalog_id: catalogId,
            offering_id: offeringId,
            kind_id: kindId,
            tags: version.tags,
            configuration: version.configuration,
            outputs: version.outputs
        }));
    }

    /**
  * Gets all available flavors for a given offering
  * @param catalogId The catalog ID
  * @param offeringId The offering ID
  * @returns Promise<string[]> Array of unique flavor names
  */
    @deduplicateRequest({
        keyGenerator: (catalogId: string, offeringId: string) =>
            `flavors:${catalogId}:${offeringId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug(
                'Duplicate flavors request detected',
                { key }
            );
        }
    })
    public async getAvailableFlavors(catalogId: string, offeringId: string): Promise<string[]> {
        const cacheKey = `flavors:${catalogId}:${offeringId}`;
        this.logger.debug(`Fetching available flavors for offering ${offeringId} in catalog ${catalogId}`);

        // Check cache first
        const cachedFlavors = this.cacheService.get<string[]>(cacheKey);
        if (cachedFlavors) {
            this.logger.debug('Using cached flavors', { count: cachedFlavors.length });
            return cachedFlavors;
        }

        try {
            // Get offering details which includes kinds with versions and flavors
            const response = await this.withProgress(`Fetching flavors for offering ${offeringId}`, () =>
                this.catalogManagement.getOffering({
                    catalogIdentifier: catalogId,
                    offeringId: offeringId
                }));

            const offering = response.result;
            if (!offering?.kinds?.length) {
                return [];
            }

            // Extract unique flavor names across all versions of all kinds
            const flavorSet = new Set<string>();
            offering.kinds.forEach(kind => {
                if (kind.versions) {
                    kind.versions.forEach(version => {
                        if (version.flavor?.name) {
                            flavorSet.add(version.flavor.name);
                        }
                    });
                }
            });

            const flavors = Array.from(flavorSet);

            // Cache the results
            this.cacheService.set(cacheKey, flavors, {
                catalogId,
                offeringId,
                timestamp: new Date().toISOString()
            });

            this.logger.debug('Successfully fetched flavors', { count: flavors.length });
            return flavors;

        } catch (error) {
            this.logger.error('Failed to fetch flavors', {
                catalogId,
                offeringId,
                error: this.formatError(error)
            });
            throw error;
        }
    }

    /**
     * Gets detailed information about a specific flavor
     * @param catalogId The catalog ID
     * @param offeringId The offering ID
     * @param flavorName The flavor name
     * @returns Promise<OfferingFlavor | undefined> The flavor details if found
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string, offeringId: string, flavorName: string) =>
            `flavorDetails:${catalogId}:${offeringId}:${flavorName}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug(
                'Duplicate flavor details request detected',
                { key }
            );
        }
    })
    public async getFlavorDetails(catalogId: string, offeringId: string, flavorName: string): Promise<OfferingFlavor | undefined> {
        const cacheKey = `flavorDetails:${catalogId}:${offeringId}:${flavorName}`;

        // Check cache first
        const cachedDetails = this.cacheService.get<OfferingFlavor>(cacheKey);
        if (cachedDetails) {
            return cachedDetails;
        }

        try {
            const response = await this.withProgress(`Fetching flavor details for ${flavorName}`, () =>
                this.catalogManagement.getOffering({
                    catalogIdentifier: catalogId,
                    offeringId: offeringId
                }));

            const offering = response.result;
            if (!offering?.kinds?.length) {
                return undefined;
            }

            // Find the first matching flavor with details
            let flavorDetails: OfferingFlavor | undefined;

            // Iterate through kinds and versions to find matching flavor
            for (const kind of offering.kinds) {
                if (!kind.versions?.length) { continue; }

                for (const version of kind.versions) {
                    const flavor = version.flavor;
                    if (flavor?.name && flavor.name === flavorName) {
                        // Ensure all required properties are present
                        if (flavor.name && flavor.label) {
                            flavorDetails = {
                                name: flavor.name,
                                label: flavor.label,
                                label_i18n: flavor.label_i18n,
                                index: flavor.index ?? 0
                            };
                            break;
                        }
                    }
                }
                if (flavorDetails) { break; }
            }

            if (flavorDetails) {
                // Cache the details
                this.cacheService.set(cacheKey, flavorDetails);

                this.logger.debug('Found and cached flavor details', {
                    catalogId,
                    offeringId,
                    flavorName,
                    label: flavorDetails.label
                });
            } else {
                this.logger.debug('No matching flavor found', {
                    catalogId,
                    offeringId,
                    flavorName
                });
            }

            return flavorDetails;

        } catch (error) {
            this.logger.error('Failed to get flavor details', {
                catalogId,
                offeringId,
                flavorName,
                error: this.formatError(error)
            });
            return undefined;
        }
    }

    /**
     * Validates if a flavor exists for a given offering
     * @param catalogId The catalog ID
     * @param offeringId The offering ID
     * @param flavorName The flavor name to validate
     * @returns Promise<boolean> True if the flavor exists
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string, offeringId: string, flavorName: string) =>
            `validateFlavor:${catalogId}:${offeringId}:${flavorName}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug(
                'Duplicate flavor validation request detected',
                { key }
            );
        }
    })
    public async validateFlavor(catalogId: string, offeringId: string, flavorName: string): Promise<boolean> {
        const cacheKey = `flavorValidation:${catalogId}:${offeringId}:${flavorName}`;

        // Check cache first
        const cachedResult = this.cacheService.get<boolean>(cacheKey);
        if (cachedResult !== undefined) {
            return cachedResult;
        }

        try {
            const availableFlavors = await this.getAvailableFlavors(catalogId, offeringId);
            const isValid = availableFlavors.includes(flavorName);

            // Cache the result
            this.cacheService.set(cacheKey, isValid);

            return isValid;
        } catch (error) {
            this.logger.error('Failed to validate flavor', {
                catalogId,
                offeringId,
                flavorName,
                error: this.formatError(error)
            });
            return false;
        }
    }
    /**
     * Validates an offering ID within a catalog
     * @param catalogId The catalog ID
     * @param offeringId The offering ID
     * @returns Promise<boolean> True if the offering ID is valid
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string, offeringId: string) =>
            `validateOffering:${catalogId}:${offeringId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug(
                'Duplicate offering validation request detected',
                { key }
            );
        }
    })
    public async validateOfferingId(catalogId: string, offeringId: string): Promise<boolean> {
        const cacheKey = `offeringValidation:${catalogId}:${offeringId}`;
        const cachedValue = this.cacheService.get<boolean>(cacheKey);
        if (cachedValue !== undefined) {
            return cachedValue;
        }

        const offerings = await this.getOfferingsForCatalog(catalogId);
        const isValid = offerings.some(offering => offering.id === offeringId);

        // Cache the result
        this.cacheService.set(cacheKey, isValid);

        return isValid;
    }

    /**
     * Gets offering details from IBM Cloud
     * @param catalogId The catalog ID to get details for
     * @returns Promise<CatalogResponse> The catalog details
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string) =>
            `getOfferingDetails:${catalogId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug(
                'Duplicate offering details request detected',
                { key }
            );
        }
    })
    public async getOfferingDetails(catalogId: string): Promise<CatalogResponse> {
        const cacheKey = `catalogDetails:${catalogId}`;
        this.logger.debug(`Fetching offering details for catalog ID: ${catalogId}`);

        const cachedValue = this.cacheService.get<CatalogResponse>(cacheKey);
        if (cachedValue !== undefined) {
            this.logger.debug(`Using cached offering details for ${catalogId}`, {
                label: cachedValue.label,
                id: cachedValue.id
            });
            return cachedValue;
        }

        this.logger.debug('Making offering details request to IBM Cloud');
        try {
            const response = await this.withProgress(`Fetching catalog details for ${catalogId}`, () =>
                this.catalogManagement.getCatalog({
                    catalogIdentifier: catalogId,
                }));

            const details = response.result as CatalogResponse;
            this.logger.debug('Received offering details', {
                catalogId,
                label: details.label,
                id: details.id,
                status: response.status,
                updated: details.updated
            });

            this.cacheService.set(cacheKey, details);
            return details;
        } catch (error) {
            const errorDetails = this.formatError(error);
            this.logger.error('Failed to fetch offering details', {
                catalogId,
                error: errorDetails,
                maskedApiKey: this.maskApiKey(this.apiKey)
            });

            throw new Error(this.getErrorMessage(error));
        }
    }

    /**
     * Fetches all available private catalogs
     * @returns Promise<CatalogItem[]> Array of available private catalogs
     */
    @deduplicateRequest({
        keyGenerator: () => 'getAvailablePrivateCatalogs',
        timeoutMs: 30000,
        onDuplicate: () => {
            LoggingService.getInstance().debug(
                'Duplicate private catalogs request detected'
            );
        }
    })
    public async getAvailablePrivateCatalogs(): Promise<CatalogItem[]> {
        const cacheKey = 'available_private_catalogs';
        const logger = this.logger;

        logger.debug('Fetching available private catalogs');

        // Check cache first
        const cachedCatalogs = this.cacheService.get<CatalogItem[]>(cacheKey);
        if (cachedCatalogs) {
            logger.debug('Using cached private catalogs', { count: cachedCatalogs.length });
            return cachedCatalogs;
        }

        try {
            const response = await this.withProgress('Fetching private catalogs', () =>
                this.catalogManagement.listCatalogs());

            const catalogs: CatalogItem[] = (response.result.resources ?? [])
                .filter(catalog => !catalog.disabled && catalog.id && catalog.label)
                .map(catalog => ({
                    id: catalog.id!,
                    label: catalog.label!,
                    shortDescription: catalog.short_description,
                    disabled: catalog.disabled,
                    isPublic: false // Mark as private
                }));

            logger.debug('Successfully fetched private catalogs', { count: catalogs.length });

            // Cache the results
            this.cacheService.set(cacheKey, catalogs);

            return catalogs;
        } catch (error) {
            logger.error('Failed to fetch available private catalogs', error);
            throw error;
        }
    }

    /**
     * Fetches all available public catalogs
     * @returns Promise<CatalogItem[]> Array of available public catalogs
     */
    public async getAvailablePublicCatalogs(): Promise<CatalogItem[]> {
        const cacheKey = 'available_public_catalogs';
        const logger = this.logger;

        logger.debug('Fetching available public catalogs');
        logger.debug('Not yet implmented...');
        // Check cache first
        const cachedCatalogs = this.cacheService.get<CatalogItem[]>(cacheKey);
        if (cachedCatalogs) {
            logger.debug('Using cached public catalogs', { count: cachedCatalogs.length });
            return cachedCatalogs;
        }

        try {
            // Currently no API available to fetch public catalogs
            // We do know the current public catalogs are:
            // - IBM Cloud Catalog
            // - Community Registry
            // We can hardcode these for now

            const publicCatalogs: CatalogItem[] = [
                {
                    id: '1082e7d2-5e2f-0a11-a3bc-f88a8e1931fc',
                    label: 'IBM Cloud Catalog',
                    shortDescription: 'IBM Cloud Catalog',
                    isPublic: true
                },
                {
                    id: '7a4d68b4-cf8b-40cd-a3d1-f49aff526eb3',
                    label: 'Community Registry',
                    shortDescription: 'Community Registry',
                    isPublic: true
                }
            ];

            logger.debug('Successfully fetched public catalogs', { count: publicCatalogs.length });

            // Cache the results
            this.cacheService.set(cacheKey, publicCatalogs);

            return publicCatalogs;
        } catch (error) {
            logger.error('Failed to fetch available public catalogs', error);
            throw error;
        }
    }

    /**
     * Fetches all available catalogs (both private and public)
     * @returns Promise<CatalogItem[]> Array of all available catalogs
     */
    @deduplicateRequest({
        keyGenerator: () => 'getAvailableCatalogs',
        timeoutMs: 30000,
        onDuplicate: () => {
            LoggingService.getInstance().debug(
                'Duplicate all catalogs request detected'
            );
        }
    })
    public async getAvailableCatalogs(): Promise<CatalogItem[]> {
        const cacheKey = 'available_catalogs';
        const logger = this.logger;

        logger.debug('Fetching all available catalogs (private and public)');

        // Check cache first
        const cachedCatalogs = this.cacheService.get<CatalogItem[]>(cacheKey);
        if (cachedCatalogs) {
            logger.debug('Using cached all catalogs', { count: cachedCatalogs.length });
            return cachedCatalogs;
        }

        try {
            const [privateCatalogs, publicCatalogs] = await Promise.all([
                this.getAvailablePublicCatalogs().catch(error => {
                    logger.error('Failed to fetch public catalogs', error);
                    return []; // Proceed with private catalogs if public fetch fails
                }),
                this.getAvailablePrivateCatalogs()
            ]);

            const allCatalogs = [...publicCatalogs, ...privateCatalogs];

            logger.debug('Successfully fetched all catalogs', { count: allCatalogs.length });

            // Cache the combined results
            this.cacheService.set(cacheKey, allCatalogs);

            return allCatalogs;
        } catch (error) {
            logger.error('Failed to fetch all available catalogs', error);
            throw error;
        }
    }

    /**
     * Gets cached validation result
     * @param catalogId The catalog ID to get validation for
     * @returns Promise<boolean | undefined> The cached validation result or undefined if not cached
     */
    public async getCachedValidation(catalogId: string): Promise<boolean | undefined> {
        const cacheKey = `catalogId:${catalogId}`;
        return this.cacheService.get<boolean>(cacheKey);
    }

    /**
     * Gets cached offering details
     * @param catalogId The catalog ID to get details for
     * @returns Promise<CatalogResponse | undefined> The cached details or undefined if not cached
     */
    public async getCachedOfferingDetails(catalogId: string): Promise<CatalogResponse | undefined> {
        const cacheKey = `catalogDetails:${catalogId}`;
        return this.cacheService.get<CatalogResponse>(cacheKey);
    }


    /**
     * Masks an API key for secure logging
     * @param apiKey The API key to mask
     * @returns string The masked API key
     */
    private maskApiKey(apiKey: string): string {
        if (!apiKey) { return ''; }
        if (apiKey.length <= 8) { return '***'; }
        return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
    }

    /**
     * Formats an error for logging
     * @param error The error to format
     * @returns Record<string, any> The formatted error details
     */
    private formatError(error: unknown): Record<string, any> {
        if (error instanceof Error) {
            const ibmError = error as IBMCloudError;
            return {
                message: ibmError.message,
                status: ibmError.status,
                statusText: ibmError.statusText,
                stack: ibmError.stack,
                body: ibmError.body
            };
        }
        return { error: String(error) };
    }

    /**
     * Gets a user-friendly error message
     * @param error The error to get a message for
     * @returns string The error message
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

    /**
     * Utility method to introduce a delay.
     * @param ms Milliseconds to delay.
     * @returns Promise<void>
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
