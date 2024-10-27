// src/services/catalogCacheService.ts

import { Components, LogLevel } from '../utils/outputManager';
import { OutputManager } from '../utils/outputManager';
import { ApiService } from './apiService';
import { Offering } from '../models/offerings';

/**
 * Represents the validation result for a catalog.
 */
interface CatalogValidationResult {
    isValid: boolean;
    timestamp: number;
    error?: string;
}

/**
 * Represents the overall cache structure.
 */
interface CatalogCache {
    validationResults: Map<string, CatalogValidationResult>;
    offerings: Map<string, Offering[]>;
    flavors: Map<string, string[]>;
}

/**
 * Represents the status of a catalog.
 */
interface CatalogStatus {
    status: 'ready' | 'loading' | 'error';
    error?: string;
}

/**
 * Service to manage caching of catalog validations, offerings, and flavors.
 */
export class CatalogCacheService {
    private cache: CatalogCache = {
        validationResults: new Map(),
        offerings: new Map(),
        flavors: new Map()
    };

    private readonly CACHE_DURATION = 1000 * 60 * 30; // 30 minutes

    constructor(
        private readonly apiService: ApiService,
        private readonly outputManager: OutputManager
    ) {
        this.log(Components.CATALOG_CACHE_SERVICE, 'CatalogCacheService initialized');
    }

    /**
     * Validates a catalog ID, using cache if available and not expired
     * @param catalogId The catalog ID to validate
     * @returns A promise resolving to true if valid, false if invalid
     */
    public async validateCatalogId(catalogId: string): Promise<boolean> {
        try {
            const cachedResult = this.cache.validationResults.get(catalogId);
            const now = Date.now();

            // Check if we have a valid cache entry
            if (cachedResult && (now - cachedResult.timestamp) < this.CACHE_DURATION) {
                this.log(Components.CATALOG_CACHE_SERVICE, `Cache hit for catalog validation: ${catalogId}`);
                return cachedResult.isValid;
            }

            // Perform validation through API service
            this.log(Components.CATALOG_CACHE_SERVICE, `Cache miss for catalog validation: ${catalogId}`);
            const isValid = await this.apiService.validateCatalogId(catalogId);
            
            // Cache the result
            this.cache.validationResults.set(catalogId, {
                isValid,
                timestamp: now
            });

            return isValid;
        } catch (error) {
            this.logError(`Error validating catalog ID ${catalogId}`, error);
            // Cache the error state
            this.cache.validationResults.set(catalogId, {
                isValid: false,
                timestamp: Date.now(),
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return false;
        }
    }

    /**
     * Clears validation results from the cache
     */
    public clearValidationCache(): void {
        this.cache.validationResults.clear();
        this.log(Components.CATALOG_CACHE_SERVICE, 'Validation cache cleared');
    }

    /**
     * Fetches offerings based on catalogId, using cache if available.
     * @param catalogId The catalog ID to fetch offerings for.
     * @returns The offerings data.
     */
    public async getOfferings(catalogId: string): Promise<Offering[]> {
        const cachedOfferings = this.cache.offerings.get(catalogId);
        if (cachedOfferings && cachedOfferings.length > 0) {
            this.log(Components.CATALOG_CACHE_SERVICE, `Cache hit for offerings of catalogId: ${catalogId}`);
            return cachedOfferings;
        }

        try {
            this.log(Components.CATALOG_CACHE_SERVICE, `Cache miss for offerings of catalogId: ${catalogId}. Fetching from API.`);
            const offerings = await this.apiService.getOfferings(catalogId);
            this.cache.offerings.set(catalogId, offerings);
            this.log(Components.CATALOG_CACHE_SERVICE, `Offerings for catalogId ${catalogId} cached`);
            return offerings;
        } catch (error) {
            this.logError(`Failed to fetch offerings for catalogId ${catalogId}`, error);
            throw error;
        }
    }

    /**
     * Fetches flavors based on catalogId, using cache if available.
     * @param catalogId The catalog ID to fetch flavors for.
     * @returns An array of flavor names.
     */
    public async getFlavors(catalogId: string): Promise<string[]> {
        const cachedFlavors = this.cache.flavors.get(catalogId);
        if (cachedFlavors && cachedFlavors.length > 0) {
            this.log(Components.CATALOG_CACHE_SERVICE, `Cache hit for flavors of catalogId: ${catalogId}`);
            return cachedFlavors;
        }

        try {
            this.log(Components.CATALOG_CACHE_SERVICE, `Cache miss for flavors of catalogId: ${catalogId}. Fetching from API.`);
            const flavors = await this.apiService.getFlavors(catalogId);
            this.cache.flavors.set(catalogId, flavors);
            this.log(Components.CATALOG_CACHE_SERVICE, `Flavors for catalogId ${catalogId} cached`);
            return flavors;
        } catch (error) {
            this.logError(`Failed to fetch flavors for catalogId ${catalogId}`, error);
            throw error;
        }
    }

    /**
     * Clears all caches.
     */
    public clearCache(): void {
        this.cache.validationResults.clear();
        this.cache.offerings.clear();
        this.cache.flavors.clear();
        this.log(Components.CATALOG_CACHE_SERVICE, 'All caches cleared');
    }

    /**
     * Refreshes all catalogs by re-fetching their offerings.
     */
    public async refreshAllCatalogs(): Promise<void> {
        try {
            const catalogIds = Array.from(this.cache.offerings.keys());
            if (catalogIds.length === 0) {
                this.log(Components.CATALOG_CACHE_SERVICE, 'No active catalogs to refresh');
                return;
            }

            this.log(Components.CATALOG_CACHE_SERVICE, `Refreshing ${catalogIds.length} catalogs`);
            await Promise.all(catalogIds.map(catalogId => this.getOfferings(catalogId)));
            this.log(Components.CATALOG_CACHE_SERVICE, 'All catalogs refreshed');
        } catch (error) {
            this.logError('Failed to refresh all catalogs', error);
            throw error;
        }
    }

    /**
     * Retrieves the list of active catalogs.
     * @returns An array of catalog IDs.
     */
    public getActiveCatalogs(): string[] {
        return Array.from(this.cache.offerings.keys());
    }

    /**
     * Retrieves the status of a catalog.
     * @param catalogId The catalog ID.
     * @returns The catalog status.
     */
    public getCatalogStatus(catalogId: string): CatalogStatus {
        if (this.cache.offerings.has(catalogId)) {
            return { status: 'ready' };
        }

        const validationResult = this.cache.validationResults.get(catalogId);
        if (validationResult) {
            if (validationResult.isValid) {
                return { status: 'ready' };
            } else {
                return { status: 'error', error: validationResult.error };
            }
        }

        return { status: 'loading' };
    }

    /**
     * Clears cache entries for a specific catalog ID.
     * @param catalogId The catalog ID to clear from cache.
     */
    public clearCatalogCache(catalogId: string): void {
        this.cache.validationResults.delete(catalogId);
        this.cache.offerings.delete(catalogId);
        this.cache.flavors.delete(catalogId);
        this.log(Components.CATALOG_CACHE_SERVICE, `Cache cleared for catalogId: ${catalogId}`);
    }

    /**
     * Logs messages using the OutputManager.
     * @param component The component enum.
     * @param message The message to log.
     * @param level The severity level.
     */
    private log(component: Components, message: string, level: LogLevel = LogLevel.INFO): void {
        this.outputManager.log(component, message, level);
    }

    /**
     * Logs errors.
     * @param message The error message.
     * @param error The error object.
     */
    public logError(message: string, error: unknown): void {
        this.log(Components.CATALOG_CACHE_SERVICE, `${message} - ${error instanceof Error ? error.message : String(error)}`, LogLevel.ERROR);
    }
}
