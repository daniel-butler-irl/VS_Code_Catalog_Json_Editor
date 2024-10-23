import * as vscode from 'vscode';
import { ApiService } from './apiService';
import { createLoggerFor } from '../utils/outputManager';
import { ApiKeyRequiredError } from '../utils/errors';

interface CacheEntry {
    data: ProcessedOffering[];
    timestamp: number;
    status: CacheStatus;
    error?: string;
}

interface ProcessedOffering {
    name: string;
    id: string;
    label: string;
    catalogId: string;
    catalogName: string;  // Added for multiple catalog support
    versions: Array<{
        version: string;
        versionLocator: string;
        flavor?: string;
    }>;
    metadata?: {
        [key: string]: any;
    };
}

type CacheStatus = 'ready' | 'loading' | 'error' | 'stale';

interface CatalogInfo {
    id: string;
    name: string;
    description?: string;
    isPublic: boolean;
}

export class CatalogCacheService {
    private readonly logger = createLoggerFor('CACHE');
    private cache: Map<string, CacheEntry> = new Map();
    private readonly CACHE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    private activeCatalogs: Set<string> = new Set();
    private fetchPromises: Map<string, Promise<ProcessedOffering[]>> = new Map();

    constructor(private readonly apiService: ApiService) {}

    /**
     * Gets catalog offerings from cache or fetches them
     */
    public async getOfferings(catalogId: string, forceFetch: boolean = false): Promise<ProcessedOffering[]> {
        try {
            // Check if there's already a fetch in progress for this catalog
            const existingFetch = this.fetchPromises.get(catalogId);
            if (existingFetch) {
                this.logger.info(`Using existing fetch promise for catalog ${catalogId}`);
                return existingFetch;
            }

            const cached = this.cache.get(catalogId);
            if (!forceFetch && cached && this.isCacheValid(cached)) {
                this.logger.info(`Using cached data for catalog ${catalogId}`);
                return cached.data;
            }

            // Create and store the fetch promise
            const fetchPromise = this.fetchAndProcessOfferings(catalogId);
            this.fetchPromises.set(catalogId, fetchPromise);

            try {
                const offerings = await fetchPromise;
                return offerings;
            } finally {
                // Clean up the promise regardless of success/failure
                this.fetchPromises.delete(catalogId);
            }
        } catch (error) {
            this.logger.error(`Error getting offerings for catalog ${catalogId}:`, error);
            this.updateCacheStatus(catalogId, 'error', error);
            throw error;
        }
    }

    /**
     * Fetches and processes offerings from the API
     */
    private async fetchAndProcessOfferings(catalogId: string): Promise<ProcessedOffering[]> {
        if (!this.apiService.isAuthenticated()) {
            throw new ApiKeyRequiredError('Authentication required to fetch offerings');
        }

        this.updateCacheStatus(catalogId, 'loading');

        try {
            const rawOfferings = await this.apiService.getFilteredOfferings(catalogId);
            const processedOfferings = this.processOfferings(rawOfferings);
            
            this.cache.set(catalogId, {
                data: processedOfferings,
                timestamp: Date.now(),
                status: 'ready'
            });

            this.activeCatalogs.add(catalogId);
            this.logger.info(`Cached ${processedOfferings.length} offerings for catalog ${catalogId}`);
            
            return processedOfferings;
        } catch (error) {
            this.updateCacheStatus(catalogId, 'error', error);
            throw error;
        }
    }

    /**
     * Updates the status of a catalog in the cache
     */
    private updateCacheStatus(catalogId: string, status: CacheStatus, error?: any): void {
        const cached = this.cache.get(catalogId);
        if (cached) {
            cached.status = status;
            cached.error = error ? (error instanceof Error ? error.message : String(error)) : undefined;
        } else {
            this.cache.set(catalogId, {
                data: [],
                timestamp: Date.now(),
                status: status,
                error: error ? (error instanceof Error ? error.message : String(error)) : undefined
            });
        }
    }

    /**
     * Gets the status of a catalog in the cache
     */
    public getCatalogStatus(catalogId: string): { status: CacheStatus; error?: string } {
        const cached = this.cache.get(catalogId);
        if (!cached) {
            return { status: 'stale' };
        }
        return { 
            status: cached.status,
            error: cached.error
        };
    }

    /**
     * Processes raw offerings into a standardized format
     */
    private processOfferings(rawOfferings: any[]): ProcessedOffering[] {
        return rawOfferings
            .filter(offering => 
                offering.product_kind === 'solution' &&
                offering.kinds?.some((kind: any) => kind.target_kind === 'terraform')
            )
            .map(offering => ({
                name: offering.name,
                id: offering.id,
                label: offering.label || offering.name,
                catalogId: offering.catalog_id,
                catalogName: offering.catalog_name || 'Unknown Catalog',
                versions: offering.kinds
                    ?.find((kind: any) => kind.target_kind === 'terraform')
                    ?.versions.map((version: any) => ({
                        version: version.version,
                        versionLocator: version.version_locator,
                        flavor: version.flavor?.name
                    })) || [],
                metadata: {
                    updated: offering.updated,
                    created: offering.created,
                    kind: offering.product_kind,
                    tags: offering.tags || []
                }
            }));
    }

    /**
     * Fetches offerings for multiple catalogs in parallel
     */
    public async getOfferingsForCatalogs(catalogIds: string[]): Promise<Map<string, ProcessedOffering[]>> {
        const results = new Map<string, ProcessedOffering[]>();
        
        await Promise.all(
            catalogIds.map(async (catalogId) => {
                try {
                    const offerings = await this.getOfferings(catalogId);
                    results.set(catalogId, offerings);
                } catch (error) {
                    this.logger.error(`Error fetching catalog ${catalogId}:`, error);
                    results.set(catalogId, []);
                }
            })
        );

        return results;
    }

    /**
     * Gets a list of active catalogs
     */
    public getActiveCatalogs(): string[] {
        return Array.from(this.activeCatalogs);
    }

    /**
     * Checks if a cache entry is valid
     */
    private isCacheValid(cached: CacheEntry): boolean {
        return cached.status === 'ready' && 
               (Date.now() - cached.timestamp) < this.CACHE_TIMEOUT;
    }

    /**
     * Clears the entire cache
     */
    public clearCache(): void {
        this.cache.clear();
        this.activeCatalogs.clear();
        this.fetchPromises.clear();
        this.logger.info('Catalog cache cleared');
    }

    /**
     * Clears cache for a specific catalog
     */
    public clearCatalogCache(catalogId: string): void {
        this.cache.delete(catalogId);
        this.activeCatalogs.delete(catalogId);
        this.fetchPromises.delete(catalogId);
        this.logger.info(`Cache cleared for catalog ${catalogId}`);
    }

    /**
     * Forces a refresh of all active catalogs
     */
    public async refreshAllCatalogs(): Promise<void> {
        const catalogs = this.getActiveCatalogs();
        await Promise.all(
            catalogs.map(catalogId => this.getOfferings(catalogId, true))
        );
        this.logger.info('All active catalogs refreshed');
    }

    /**
     * Checks if a catalog is cached and valid
     */
    public isCatalogCached(catalogId: string): boolean {
        const cached = this.cache.get(catalogId);
        if (!cached) return false;
        return this.isCacheValid(cached);
    }
}