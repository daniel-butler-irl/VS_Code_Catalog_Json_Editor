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
    OfferingVersion as IBMCloudOfferingVersion,
    OfferingFlavor,
} from '../types/ibmCloud';
import { deduplicateRequest } from '../decorators/requestDeduplication';
import { execAsync } from '../utils/execAsync';
import * as path from 'path';
import * as fs from 'fs';

// Update type references in the code
type OfferingVersion = IBMCloudOfferingVersion;

interface ImportVersionOptions {
    zipurl: string;
    targetVersion: string;
    repotype: string;
    catalogIdentifier: string;
    includeConfig?: boolean;
    isVSI?: boolean;
    tags?: string[];
    keywords?: string[];
    name?: string;
    label?: string;
    install_kind?: string;
    target_kinds: string[];
    format_kind: string;
    product_kind: string;
    product_kind_label?: string;
    sha?: string;
    version: string;
    flavor: {
        metadata: {
            name: string;
            label: string;
            index: number;
            working_directory?: string;
        }
    } | Array<{
        metadata: {
            name: string;
            label: string;
            index: number;
            working_directory?: string;
        }
    }>;
    working_directory: string;
    install_type?: 'extension' | 'fullstack';
}

/**
 * Service for interacting with IBM Cloud APIs and managing catalog data.
 */
export class IBMCloudService {
    private catalogManagement: CatalogManagementV1;
    private cacheService: CacheService;
    private logger: LoggingService;
    private backgroundCacheQueue: Set<string> = new Set();
    private isProcessingQueue: boolean = false;
    private readonly apiUrl = 'https://cm.globalcatalog.cloud.ibm.com/api/v1-beta';
    private readonly CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
    private apiKey: string;
    private authenticator: IamAuthenticator;
    private workspaceRoot?: string;

    /**
     * Constructor for IBMCloudService.
     * Initializes the service with API credentials and sets up logging and caching.
     * @param apiKey - API key for IBM Cloud.
     */
    constructor(apiKey: string) {
        this.apiKey = apiKey;
        this.logger = LoggingService.getInstance();
        this.logger.debug('Initializing IBMCloudService');
        this.authenticator = new IamAuthenticator({ apikey: apiKey });
        this.catalogManagement = new CatalogManagementV1({ authenticator: this.authenticator });
        this.cacheService = CacheService.getInstance();

        // Clear all caches when initializing with new API key
        this.clearAllCaches();

        // Initialize workspace root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.workspaceRoot = workspaceFolders[0].uri.fsPath;
            this.logger.debug('Workspace root initialized', { path: this.workspaceRoot }, 'preRelease');
        } else {
            this.logger.warn('No workspace root found', {}, 'preRelease');
        }
    }

    /**
     * Clears all caches related to IBM Cloud services
     * Should be called when authentication changes (new API key or GitHub login)
     */
    public async clearAllCaches(): Promise<void> {
        this.logger.debug('Starting clear of all caches', {
            timestamp: new Date().toISOString()
        }, 'preRelease');

        try {
            // Clear the main catalog cache
            this.cacheService.delete(CacheKeys.CATALOG);

            // Get all catalog IDs from the cache configuration
            const catalogIds = Object.values(CacheConfigurations)
                .filter(config => typeof config === 'object' && 'catalogId' in config)
                .map(config => (config as { catalogId: string }).catalogId);

            // Clear caches for each catalog ID
            for (const catalogId of catalogIds) {
                await this.clearOfferingCache(catalogId);
            }

            this.logger.info('Successfully cleared all caches', {
                clearedCatalogs: catalogIds.length,
                timestamp: new Date().toISOString()
            }, 'preRelease');
        } catch (error) {
            this.logger.error('Error clearing caches', {
                error,
                errorDetails: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                } : 'Unknown error type'
            }, 'preRelease');
            throw error;
        }
    }

    /**
     * Provides visual feedback in VS Code for long-running tasks.
     * @param title - Title of the progress bar.
     * @param task - Task function returning a Promise.
     * @param retryCount - Number of retry attempts.
     * @returns Promise<T> - Result of the task.
     */
    private async withProgress<T>(
        title: string,
        task: () => Promise<T>,
        retryCount: number = 3
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: false,
            },
            async (progress) => {
                let lastError: Error | undefined;

                for (let attempt = 1; attempt <= retryCount; attempt++) {
                    try {
                        progress.report({ message: `In Progress${attempt > 1 ? ` (Attempt ${attempt}/${retryCount})` : ''}` });

                        const result = await task();
                        progress.report({ message: `Complete` });
                        await this.delay(500);
                        return result;
                    } catch (error) {
                        lastError = error instanceof Error ? error : new Error(String(error));

                        if (attempt < retryCount) {
                            this.logger.warn(`Attempt ${attempt} failed, retrying...`, { error: lastError });
                            progress.report({ message: `Retrying...` });
                            await this.delay(1000 * attempt); // Exponential backoff
                        } else {
                            progress.report({ message: `Failed` });
                            await this.delay(1000);
                            vscode.window.showErrorMessage(`Task failed after ${retryCount} attempts: ${this.extractErrorMessage(lastError)}`);
                            throw lastError;
                        }
                    }
                }

                throw lastError || new Error('Task failed');
            }
        );
    }

    /**
     * Extracts error message from an error object.
     * @param error - Error object.
     * @returns string - Error message.
     */
    private extractErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        if (error && typeof error === 'object' && 'message' in error) {
            return String((error as { message: unknown }).message);
        }
        return 'An unknown error occurred';
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
    // src/services/IBMCloudService.ts

    /**
     * Validates a catalog ID using cached data.
     * @param catalogId - The catalog ID to validate
     * @returns Promise<boolean> indicating if the catalog ID is valid
     * @throws {Error} with 'not found in account' message if catalog doesn't exist
     */
    public async validateCatalogId(catalogId: string): Promise<boolean> {
        const cacheKey = DynamicCacheKeys.CATALOG_VALIDATION(catalogId);
        this.logger.debug(`Validating catalog ID: ${catalogId}`);

        const cached = this.cacheService.get<boolean>(cacheKey);
        if (cached !== undefined) {
            this.logger.debug(`Using cached validation result for ${catalogId}`, { isValid: cached });
            if (!cached) {
                throw new Error(`Catalog ID ${catalogId} not found in account`);
            }
            return cached;
        }

        try {
            const catalogs = await this.getAvailableCatalogs();
            const isValid = catalogs.some(cat => cat.id === catalogId);

            if (isValid) {
                this.logger.debug(`Catalog ${catalogId} validated successfully`);
                // Cache the validation result
                this.cacheService.set(cacheKey, true, CacheConfigurations[CacheKeys.CATALOG_VALIDATION]);
                return true;
            } else {
                this.logger.debug(`Catalog ${catalogId} not found in available catalogs`);
                this.cacheService.set(cacheKey, false, CacheConfigurations[CacheKeys.CATALOG_VALIDATION]);
                throw new Error(`Catalog ID ${catalogId} not found in account`);
            }
        } catch (error) {
            // If it's already our "not found" error, rethrow it
            if (error instanceof Error && error.message.includes('not found in account')) {
                throw error;
            }
            this.logger.error(`Error validating catalog ${catalogId}`, error);
            throw new Error(`Failed to validate catalog: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
     * @param skipCache - If true, bypass the cache and force a fresh API call.
     * @returns Promise<OfferingItem[]> - Array of offerings.
     */
    @deduplicateRequest({
        keyGenerator: (catalogId: string) => `offerings:${catalogId}`,
        timeoutMs: 60000,
        onDuplicate: (key) => {
            LoggingService.getInstance().debug('Duplicate offerings request detected', { key });
        },
    })
    public async getOfferingsForCatalog(catalogId: string, skipCache: boolean = false): Promise<OfferingItem[]> {
        this.logger.debug('Getting offerings for catalog', {
            catalogId,
            skipCache,
            timestamp: new Date().toISOString()
        }, 'preRelease');

        const cacheKey = DynamicCacheKeys.CATALOG_OFFERINGS(catalogId);

        // If skipCache is true, delete the cache entry first
        if (skipCache) {
            this.logger.debug('Skipping cache, clearing existing data', {
                catalogId,
                cacheKey
            }, 'preRelease');
            this.cacheService.delete(cacheKey);
        }

        // Try to get from cache first if not skipping cache
        if (!skipCache) {
            const cached = this.cacheService.get<OfferingItem[]>(cacheKey);
            this.logger.debug('Cache check result', {
                catalogId,
                cacheKey,
                hasCachedData: !!cached,
                cachedItemCount: cached?.length,
                cachedVersions: cached?.map(o => o.kinds?.map(k => k.versions?.map(v => v.version))).flat(2)
            }, 'preRelease');

            if (cached) {
                this.logger.debug('Returning cached offerings', {
                    catalogId,
                    count: cached.length,
                    versions: cached.map(o => o.kinds?.map(k => k.versions?.map(v => v.version))).flat(2)
                }, 'preRelease');
                return cached;
            }
        }

        try {
            this.logger.debug('Fetching fresh offerings from API', {
                catalogId,
                timestamp: new Date().toISOString()
            }, 'preRelease');

            const offerings = await this.withProgress(`Fetching offerings for ${catalogId}`, () =>
                this.catalogManagement.listOfferings({ catalogIdentifier: catalogId, limit: 1000 })
            );

            this.logger.debug('Raw API response', {
                catalogId,
                status: offerings.status,
                resourceCount: offerings.result.resources?.length,
                rawVersions: offerings.result.resources?.map(o => o.kinds?.map(k => k.versions?.map(v => v.version))).flat(2)
            }, 'preRelease');

            const resources = offerings.result.resources ?? [];
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

            // Log the mapped data before caching
            this.logger.debug('Mapped offerings before caching', {
                catalogId,
                count: offeringsPage.length,
                versions: offeringsPage.map(o => o.kinds?.map(k => k.versions?.map(v => v.version))).flat(2)
            }, 'preRelease');

            // Cache the result with TTL
            this.cacheService.set(cacheKey, offeringsPage, CacheConfigurations.CATALOG_OFFERINGS);

            this.logger.debug('Successfully fetched and cached offerings', {
                catalogId,
                count: offeringsPage.length,
                timestamp: new Date().toISOString(),
                versions: offeringsPage.map(o => o.kinds?.map(k => k.versions?.map(v => v.version))).flat(2)
            }, 'preRelease');

            return offeringsPage;
        } catch (error) {
            this.logger.error('Failed to get offerings', {
                error,
                catalogId,
                errorDetails: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                } : 'Unknown error type'
            }, 'preRelease');
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

    /**
     * Gets versions for a specific offering kind
     * @param catalogId The catalog identifier
     * @param offeringId The offering identifier
     * @param kindId The kind identifier
     * @returns Promise with the versions for the kind
     */
    public async getOfferingKindVersions(
        catalogId: string,
        offeringId: string,
        kindId: string
    ): Promise<{ versions: OfferingVersion[] }> {
        try {
            const response = await this.withProgress(`Fetching versions for kind ${kindId}`, () =>
                this.catalogManagement.getOffering({
                    catalogIdentifier: catalogId,
                    offeringId: offeringId
                })
            );

            const offering = response.result;
            // Find all kinds that match the requested kindId
            const matchingKinds = offering.kinds?.filter(k => {
                // Check target_kind first (most common case)
                if (k.target_kind === kindId) {
                    return true;
                }
                // Then check install_kind
                if (k.install_kind === kindId) {
                    return true;
                }
                // Finally check format_kind
                if (k.format_kind === kindId) {
                    return true;
                }
                return false;
            }) || [];

            this.logger.debug('Found kinds for version lookup', {
                kindId,
                foundKinds: matchingKinds.length,
                kindDetails: matchingKinds.map(k => ({
                    target_kind: k.target_kind,
                    install_kind: k.install_kind,
                    format_kind: k.format_kind,
                    versionCount: k.versions?.length
                }))
            }, 'preRelease');

            // Combine versions from all matching kinds
            const allVersions = matchingKinds.reduce<OfferingVersion[]>((acc, kind) => {
                const kindVersions = (kind.versions || []) as OfferingVersion[];
                return [...acc, ...kindVersions];
            }, []);

            return {
                versions: allVersions
            };
        } catch (error) {
            this.logger.error('Failed to fetch kind versions', {
                catalogId,
                offeringId,
                kindId,
                error: this.formatError(error)
            });
            throw error;
        }
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
     * Gets the list of available flavors for an offering
     * @param catalogId The catalog identifier
     * @param offeringId The offering identifier
     * @returns Array of flavor names
     */
    public async getAvailableFlavors(catalogId: string, offeringId: string): Promise<string[]> {
        try {
            const offering = await this.catalogManagement.getOffering({
                catalogIdentifier: catalogId,
                offeringId: offeringId
            });

            if (!offering.result) {
                throw new Error('No offering details returned');
            }

            // Extract flavors from the offering metadata
            // The API returns an array of versions, each with a flavor property
            const versions = offering.result.kinds?.[0]?.versions || [];
            const flavorNames = new Set<string>();
            versions.forEach(version => {
                if (version.flavor?.name) {
                    flavorNames.add(version.flavor.name);
                }
            });

            const flavors = Array.from(flavorNames);
            this.logger.debug('Retrieved available flavors', {
                catalogId,
                offeringId,
                flavors
            }, 'preRelease');

            return flavors;
        } catch (error) {
            this.logger.error('Failed to get available flavors', { error });
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

        const cached = this.cacheService.get<OfferingFlavor>(cacheKey);
        if (cached !== undefined) {
            this.logger.debug(`Using cached flavor details for ${flavorName}`);
            return cached;
        }

        try {
            const offerings = await this.getOfferingsForCatalog(catalogId);
            const offering = offerings.find(o => o.id === offeringId);

            if (!offering?.kinds?.length) {
                return undefined;
            }

            let flavorDetails: OfferingFlavor | undefined;

            for (const kind of offering.kinds) {
                if (!kind.versions?.length) { continue; }

                for (const version of kind.versions) {
                    if (version.flavor?.name === flavorName) {
                        flavorDetails = {
                            name: version.flavor.name,
                            label: version.flavor.label || version.flavor.name,
                            label_i18n: version.flavor.label_i18n,
                            index: version.flavor.index ?? 0,
                        };
                        break;
                    }
                }
                if (flavorDetails) { break; }
            }

            if (flavorDetails) {
                this.cacheService.set(
                    cacheKey,
                    flavorDetails,
                    CacheConfigurations[CacheKeys.FLAVOR_DETAILS]
                );
                this.logger.debug(`Cached flavor details for ${flavorName}`);
            }

            return flavorDetails;
        } catch (error) {
            this.logger.error('Failed to get flavor details', error);
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

    /**
     * Imports a version to an offering in the catalog
     * @param catalogId The catalog identifier
     * @param offeringId The offering identifier
     * @param options Import version options
     */
    public async importVersion(
        catalogId: string,
        offeringId: string,
        options: ImportVersionOptions
    ): Promise<void> {
        try {
            // Get all flavors from metadata
            const flavors = Array.isArray(options.flavor) ? options.flavor : [options.flavor];
            if (!flavors.length) {
                throw new Error('No flavors provided in metadata');
            }

            // Import each flavor
            for (const flavor of flavors) {
                const flavorName = flavor.metadata.name;
                if (!flavorName) {
                    this.logger.warn('Skipping flavor with no name', { flavor }, 'preRelease');
                    continue;
                }

                // Use the format_kind from options
                const formatKind = options.format_kind;

                // Log the request we're about to make
                this.logger.info('Making version import request', {
                    catalogId,
                    offeringId,
                    version: options.version,
                    formatKind,
                    targetKinds: ['terraform'],  // Always terraform
                    flavorName,
                    flavorLabel: flavor.metadata.label,
                    workingDirectory: flavor.metadata.working_directory
                }, 'preRelease');

                // Use the SDK to make the request
                const response = await this.catalogManagement.importOfferingVersion({
                    catalogIdentifier: catalogId,
                    offeringId: offeringId,
                    targetVersion: options.version,
                    zipurl: options.zipurl,
                    targetKinds: ['terraform'],  // Always terraform
                    formatKind: formatKind,  // Can be 'stack' or 'terraform'
                    productKind: 'solution',  // Always solution
                    flavor: {
                        name: flavorName,
                        label: flavor.metadata.label || flavorName
                    },
                    workingDirectory: flavor.metadata.working_directory || options.working_directory
                });

                this.logger.info('Successfully imported version for flavor', {
                    catalogId,
                    offeringId,
                    version: options.version,
                    flavorName,
                    status: response.status
                }, 'preRelease');

                // Add a small delay between flavor imports to prevent race conditions
                await this.delay(1000);
            }

            // Clear relevant caches after successful import
            await this.clearOfferingCache(catalogId);
            const cacheKey = DynamicCacheKeys.OFFERING_DETAILS(catalogId);
            this.cacheService.delete(cacheKey);

            // Also clear version-related caches
            const versionsCacheKey = DynamicCacheKeys.CATALOG_OFFERINGS(catalogId);
            this.cacheService.delete(versionsCacheKey);

            // Force a fresh fetch to ensure we have the latest data
            await this.getOfferingsForCatalog(catalogId, true);

            this.logger.info('Successfully imported all flavors and cleared caches', {
                catalogId,
                offeringId,
                version: options.version,
                flavorCount: flavors.length
            }, 'preRelease');

        } catch (error) {
            this.logger.error('Error importing version', {
                error,
                errorDetails: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                } : 'Unknown error type',
                catalogId,
                offeringId,
                version: options.version
            }, 'preRelease');
            throw error;
        }
    }

    /**
     * Clears the catalog cache
     */
    public async clearCatalogCache(): Promise<void> {
        this.logger.debug('Clearing catalog cache');
        this.cacheService.delete(CacheKeys.CATALOG);
    }

    /**
     * Clears the offering cache for a specific catalog
     * @param catalogId The catalog ID to clear cache for
     */
    public async clearOfferingCache(catalogId: string): Promise<void> {
        this.logger.debug('Starting cache clear operation', {
            catalogId,
            timestamp: new Date().toISOString()
        }, 'preRelease');

        // Clear all offering-related caches
        const cacheKeys = [
            DynamicCacheKeys.OFFERINGS(catalogId),
            DynamicCacheKeys.CATALOG_OFFERINGS(catalogId),
            DynamicCacheKeys.OFFERING_DETAILS(catalogId),
            DynamicCacheKeys.OFFERING_VALIDATION(catalogId, '*'),
            `offerings:${catalogId}` // Clear the deduplication cache key
        ];

        for (const key of cacheKeys) {
            this.logger.debug('Clearing cache key', {
                catalogId,
                key
            }, 'preRelease');
            this.cacheService.delete(key);
        }

        this.logger.info('Cleared all offering-related caches', {
            catalogId,
            clearedKeys: cacheKeys,
            timestamp: new Date().toISOString()
        }, 'preRelease');
    }
}
