// src/services/IBMCloudService.ts

import { IamAuthenticator } from 'ibm-cloud-sdk-core';
import CatalogManagementV1 = require('@ibm-cloud/platform-services/catalog-management/v1');
import { BaseService } from 'ibm-cloud-sdk-core/lib/base-service';
import { LoggingService } from './LoggingService';
import { CacheService } from './CacheService';
import { throttle } from 'lodash';

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
}

export interface OfferingItem {
    id: string;
    name: string;
    shortDescription?: string;
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
                        const details = await this.fetchOfferingDetails(catalogId);
                        this.cacheService.set(cacheKey, details);
                        this.logger.debug(`Background cached offering details for: ${catalogId}`);
                    }
                } catch (error) {
                    this.logger.error(`Failed to background cache offering: ${catalogId}`, error);
                    // Don't throw - continue with next item
                }

                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, 200));
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
    private async fetchOfferingDetails(catalogId: string): Promise<CatalogResponse> {
        const response = await this.catalogManagement.getCatalog({
            catalogIdentifier: catalogId,
        });

        return response.result as CatalogResponse;
    }

    /**
    * Validates a catalog ID against IBM Cloud
    * @param catalogId The catalog ID to validate
    * @returns Promise<boolean> True if the catalog ID is valid
    */
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
     * Fetches offerings for a given catalog ID.
     * @param catalogId The catalog ID.
     * @returns Promise<OfferingItem[]> Array of offerings.
     */
    public async getOfferingsForCatalog(catalogId: string): Promise<OfferingItem[]> {
        const cacheKey = `offerings:${catalogId}`;
        const logger = this.logger;

        // Check cache first
        const cachedOfferings = this.cacheService.get<OfferingItem[]>(cacheKey);
        if (cachedOfferings) {
            logger.debug(`Using cached offerings for catalog ID: ${catalogId}`, { count: cachedOfferings.length });
            return cachedOfferings;
        }

        try {
            // Fetch offerings using the IBM Cloud SDK
            const response = await this.catalogManagement.listOfferings({
                catalogIdentifier: catalogId
            });

            const offerings: OfferingItem[] = (response.result.resources ?? [])
                .filter(offering => offering.id && offering.name)
                .map(offering => ({
                    id: offering.id!,
                    name: offering.name!,
                    shortDescription: offering.short_description
                }));

            logger.debug('Successfully fetched offerings', { catalogId, count: offerings.length });

            // Cache the results
            this.cacheService.set(cacheKey, offerings);

            return offerings;
        } catch (error) {
            logger.error(`Failed to fetch offerings for catalog ID: ${catalogId}`, error);
            throw error;
        }
    }

    /**
     * Validates an offering ID within a catalog.
     * @param catalogId The catalog ID.
     * @param offeringId The offering ID.
     * @returns Promise<boolean> True if the offering ID is valid within the catalog.
     */
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
            const response = await this.catalogManagement.getCatalog({
                catalogIdentifier: catalogId,
            });

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
     * Fetches all available catalogs
     * @returns Promise<CatalogItem[]> Array of available catalogs
     */
    public async getAvailableCatalogs(): Promise<CatalogItem[]> {
        const cacheKey = 'available_catalogs';
        const logger = this.logger;

        logger.debug('Fetching available catalogs');

        // Check cache first
        const cachedCatalogs = this.cacheService.get<CatalogItem[]>(cacheKey);
        if (cachedCatalogs) {
            logger.debug('Using cached catalogs', { count: cachedCatalogs.length });
            return cachedCatalogs;
        }

        try {
            const response = await this.catalogManagement.listCatalogs();

            const catalogs: CatalogItem[] = (response.result.resources ?? [])
                .filter(catalog => !catalog.disabled && catalog.id && catalog.label)
                .map(catalog => ({
                    id: catalog.id!,
                    label: catalog.label!,
                    shortDescription: catalog.short_description,
                    disabled: catalog.disabled
                }));

            logger.debug('Successfully fetched catalogs', { count: catalogs.length });

            // Cache the results
            this.cacheService.set(cacheKey, catalogs);

            return catalogs;
        } catch (error) {
            logger.error('Failed to fetch available catalogs', error);
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
}
