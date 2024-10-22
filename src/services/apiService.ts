// src/services/apiService.ts
import * as vscode from 'vscode';
import CatalogManagementV1 from '@ibm-cloud/platform-services/catalog-management/v1';
import { IamAuthenticator } from 'ibm-cloud-sdk-core';
import { createLoggerFor } from '../utils/outputManager';

export class ApiService {
    private readonly logger = createLoggerFor('API');
    private catalogService: CatalogManagementV1 | null = null;
    private apiKey: string | undefined;
    private cache: vscode.Memento;

    constructor(private secrets: vscode.SecretStorage, private globalState: vscode.Memento) {
        this.cache = globalState; // Use Global Memento for caching
    }

    /**
     * Initializes the API service by retrieving the API key and setting up the CatalogManagement service.
     */
    public async initialize() {
        this.apiKey = await this.secrets.get('catalogEditor.apiKey');
        if (this.apiKey) {
            const authenticator = new IamAuthenticator({ apikey: this.apiKey });
            this.catalogService = new CatalogManagementV1({
                authenticator,
                serviceUrl: 'https://api.us-south.catalog.cloud.ibm.com', // Update region as needed
            });
        }
    }

    /**
     * Checks if the user is authenticated.
     * @returns {boolean} - True if authenticated, else false.
     */
    public isAuthenticated(): boolean {
        return !!this.apiKey && !!this.catalogService;
    }

    /**
     * Fetches all offerings from the specified catalog and filters them based on 'product_kind' and 'target_kind'.
     * @param catalogId - The catalog ID to fetch offerings from.
     * @returns {Promise<any[]>} - Array of filtered offerings.
     * @throws Will throw an error if the API call fails.
     */
    public async getFilteredOfferings(catalogId: string): Promise<any[]> {
        if (!this.isAuthenticated()) {
            throw new Error('User is not authenticated. Please login.');
        }

        const cacheKey = `filtered_offerings_${catalogId}`;
        const cachedOfferings = this.cache.get<any[]>(cacheKey);

        if (cachedOfferings && cachedOfferings.length > 0) {
            this.logger.info(`Using cached filtered offerings for catalog_id: ${catalogId}`);
            return cachedOfferings;
        }

        const offerings: any[] = [];
        const limit = 100;
        let offset = 0;
        let hasMore = true;

        try {
            while (hasMore) {
                const response = await this.catalogService!.listOfferings({
                    catalogIdentifier: catalogId,
                    digest: true, // Optional: Strip down the content for smaller payload
                    limit: limit,
                    offset: offset,
                });

                const resources = response.result.resources || [];

                // Manual Filtering: product_kind == 'solution' and target_kind == 'terraform'
                const filteredResources = resources.filter(offering => {
                    const productKind = offering.product_kind;
                    if (productKind !== 'solution') return false;

                    const kinds = offering.kinds;
                    if (!kinds || kinds.length === 0) return false;

                    const firstKind = kinds[0];
                    return firstKind.target_kind === 'terraform';
                });

                offerings.push(...filteredResources);

                // Check if more offerings are available
                if (resources.length < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            }

            // Cache the filtered offerings
            await this.cache.update(cacheKey, offerings);
            this.logger.info(`Fetched and cached filtered offerings for catalog_id: ${catalogId}`);

            return offerings;
        } catch (error) {
            console.error(`Error fetching offerings for catalog_id ${catalogId}:`, error);
            throw error;
        }
    }

    /**
     * Fetches version details given a version locator.
     * @param versionLocator - The version locator string.
     * @returns {Promise<any>} - Version details.
     * @throws Will throw an error if the API call fails.
     */
    public async getVersionDetails(versionLocator: string): Promise<any> {
        if (!this.isAuthenticated()) {
            throw new Error('User is not authenticated. Please login.');
        }

        try {
            const response = await this.catalogService!.getVersion({
                versionLocId: versionLocator, // Corrected property name
            });
            return response.result;
        } catch (error) {
            console.error(`Error fetching version details for locator ${versionLocator}:`, error);
            throw error;
        }
    }

    /**
     * Clears cached offerings for a specific catalog_id.
     * @param catalogId - The catalog ID whose cache should be cleared.
     */
    public async clearOfferingsCache(catalogId: string): Promise<void> {
        const cacheKey = `filtered_offerings_${catalogId}`;
        await this.cache.update(cacheKey, undefined);
        this.logger.info(`Cleared cache for catalog_id: ${catalogId}`);
    }

    /**
     * Clears all cached offerings.
     */
    public async clearAllOfferingsCache(): Promise<void> {
        const keys = this.cache.keys();
        const offeringsKeys = keys.filter(key => key.startsWith('filtered_offerings_'));
        for (const key of offeringsKeys) {
            await this.cache.update(key, undefined);
            this.logger.info(`Cleared cache for key: ${key}`);
        }
    }
}
