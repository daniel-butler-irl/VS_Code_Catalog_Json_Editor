// src/viewProviders/handlers/offeringsHandler.ts
import * as vscode from 'vscode';
import { ApiService } from '../../services/apiService';
import { ApiKeyRequiredError } from '../../utils/errors';
import { createLoggerFor } from '../../utils/outputManager';

interface Version {
    version: string;
    version_locator: string;
    flavor?: string;
}

interface Offering {
    name: string;
    id: string;
    catalog_id: string;
    catalog_name: string;
    versions: Version[];
}

interface OfferingResponse {
    name: string;
    id: string;
    catalog_id: string;
    catalog_name: string;
    kinds?: Array<{
        target_kind: string;
        versions: Version[];
    }>;
    product_kind?: string;
}

interface CachedOfferings {
    data: Offering[];
    timestamp: number;
}

export class OfferingsHandler {
    private readonly logger = createLoggerFor('OFFERINGS');
    private readonly CACHE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    private offeringCache: Map<string, CachedOfferings> = new Map();

    constructor(
        private readonly apiService: ApiService,
    ) {}

    /**
     * Fetches offerings for a specific catalog ID with caching
     */
    public async fetchOfferings(catalogId: string): Promise<Offering[]> {
        try {
            // Check authentication
            if (!this.apiService.isAuthenticated()) {
                throw new ApiKeyRequiredError('Authentication required to fetch offerings');
            }

            // Check cache first
            const cachedData = this.offeringCache.get(catalogId);
            if (cachedData && this.isCacheValid(cachedData)) {
                this.logger.info(`Using cached offerings for catalog ${catalogId}`);
                return cachedData.data;
            }

            // Fetch fresh data
            const rawOfferings = await this.apiService.getFilteredOfferings(catalogId);
            const processedOfferings = this.processOfferings(rawOfferings);
            
            // Update cache
            this.offeringCache.set(catalogId, {
                data: processedOfferings,
                timestamp: Date.now()
            });

            this.logger.info(`Successfully fetched ${processedOfferings.length} offerings for catalog ${catalogId}`);
            return processedOfferings;
        } catch (error) {
            this.logger.error('Error fetching offerings:', error);
            throw this.handleError(error);
        }
    }

    /**
     * Processes raw offerings data into the required format
     */
    private processOfferings(rawOfferings: OfferingResponse[]): Offering[] {
        return rawOfferings
            .filter(this.filterValidOffering)
            .map(offering => this.transformOffering(offering));
    }

    /**
     * Filters valid offerings based on product_kind and target_kind
     */
    private filterValidOffering(offering: OfferingResponse): boolean {
        return (
            offering.product_kind === 'solution' &&
            offering.kinds?.some(kind => kind.target_kind === 'terraform') === true
        );
    }

    /**
     * Transforms a raw offering into the required format
     */
    private transformOffering(offering: OfferingResponse): Offering {
        const terraformKind = offering.kinds?.find(kind => kind.target_kind === 'terraform');
        
        return {
            name: offering.name,
            id: offering.id,
            catalog_id: offering.catalog_id,
            catalog_name: offering.catalog_name,
            versions: terraformKind?.versions || []
        };
    }

    /**
     * Checks if cached data is still valid
     */
    private isCacheValid(cachedData: CachedOfferings): boolean {
        const age = Date.now() - cachedData.timestamp;
        return age < this.CACHE_TIMEOUT;
    }

    /**
     * Gets the cache status for a catalog
     */
    private getCacheStatus(catalogId: string): { isCached: boolean; isValid: boolean } {
        const cachedData = this.offeringCache.get(catalogId);
        return {
            isCached: !!cachedData,
            isValid: cachedData ? this.isCacheValid(cachedData) : false
        };
    }

    /**
     * Clears cache for a specific catalog
     */
    public async clearCacheForCatalog(catalogId: string): Promise<void> {
        try {
            this.offeringCache.delete(catalogId);
            this.logger.info(`Cleared cache for catalog ${catalogId}`);
        } catch (error) {
            this.logger.error('Error clearing cache for catalog:', error);
            throw this.handleError(error);
        }
    }

    /**
     * Clears all cached offerings
     */
    public async clearCache(): Promise<void> {
        try {
            this.offeringCache.clear();
            this.logger.info('Cleared all offering caches');
        } catch (error) {
            this.logger.error('Error clearing all caches:', error);
            throw this.handleError(error);
        }
    }

    /**
     * Gets version details for a specific version locator
     */
    public async getVersionDetails(versionLocator: string): Promise<any> {
        try {
            if (!this.apiService.isAuthenticated()) {
                throw new ApiKeyRequiredError('Authentication required to fetch version details');
            }

            return await this.apiService.getVersionDetails(versionLocator);
        } catch (error) {
            this.logger.error(`Error fetching version details for ${versionLocator}:`, error);
            throw this.handleError(error);
        }
    }

    /**
     * Validates a version locator
     */
    public validateVersionLocator(versionLocator: string): boolean {
        const pattern = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/[0-9]+\.[0-9]+\.[0-9]+$/;
        return pattern.test(versionLocator);
    }

    /**
     * Gets offering details by ID
     */
    public async getOfferingById(catalogId: string, offeringId: string): Promise<Offering | undefined> {
        try {
            const offerings = await this.fetchOfferings(catalogId);
            return offerings.find(o => o.id === offeringId);
        } catch (error) {
            this.logger.error(`Error fetching offering ${offeringId}:`, error);
            throw this.handleError(error);
        }
    }

    /**
     * Searches offerings by name
     */
    public async searchOfferings(catalogId: string, searchTerm: string): Promise<Offering[]> {
        try {
            const offerings = await this.fetchOfferings(catalogId);
            const lowercaseSearch = searchTerm.toLowerCase();
            
            return offerings.filter(offering => 
                offering.name.toLowerCase().includes(lowercaseSearch)
            );
        } catch (error) {
            this.logger.error(`Error searching offerings with term ${searchTerm}:`, error);
            throw this.handleError(error);
        }
    }

    /**
     * Gets all available versions for an offering
     */
    public async getOfferingVersions(catalogId: string, offeringId: string): Promise<Version[]> {
        try {
            const offering = await this.getOfferingById(catalogId, offeringId);
            return offering?.versions || [];
        } catch (error) {
            this.logger.error(`Error fetching versions for offering ${offeringId}:`, error);
            throw this.handleError(error);
        }
    }

    /**
     * Error handler that transforms errors into appropriate types
     */
    private handleError(error: unknown): Error {
        if (error instanceof Error) {
            return error;
        }
        return new Error(
            typeof error === 'string' ? error : 'An unknown error occurred'
        );
    }
}