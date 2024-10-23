import * as vscode from 'vscode';
import CatalogManagementV1 from '@ibm-cloud/platform-services/catalog-management/v1';
import { IamAuthenticator } from 'ibm-cloud-sdk-core';
import { createLoggerFor } from '../utils/outputManager';
import { ApiKeyRequiredError } from '../utils/errors';

interface CatalogListOptions {
    limit?: number;
    offset?: number;
    digest?: boolean;
}

export class ApiService {
    private readonly logger = createLoggerFor('API');
    private catalogService: CatalogManagementV1 | null = null;
    private apiKey: string | undefined;

    constructor(private secrets: vscode.SecretStorage, private globalState: vscode.Memento) {}

    /**
     * Initializes the API service
     */
    public async initialize() {
        this.apiKey = await this.secrets.get('catalogEditor.apiKey');
        if (this.apiKey) {
            const authenticator = new IamAuthenticator({ apikey: this.apiKey });
            this.catalogService = new CatalogManagementV1({
                authenticator,
                serviceUrl: 'https://api.us-south.catalog.cloud.ibm.com'
            });
        }
    }

    /**
     * Checks if user is authenticated
     */
    public isAuthenticated(): boolean {
        return !!this.apiKey && !!this.catalogService;
    }

    /**
     * Gets the list of available catalogs
     */
    public async listCatalogs(): Promise<any[]> {
        if (!this.isAuthenticated()) {
            throw new ApiKeyRequiredError();
        }

        try {
            const response = await this.catalogService!.listCatalogs();
            return response.result.resources || [];
        } catch (error) {
            this.logger.error('Error listing catalogs:', error);
            throw error;
        }
    }

    /**
     * Gets offerings from a specific catalog with filtering
     */
    public async getFilteredOfferings(catalogId: string, options: CatalogListOptions = {}): Promise<any[]> {
        if (!this.isAuthenticated()) {
            throw new ApiKeyRequiredError();
        }

        const offerings: any[] = [];
        const limit = options.limit || 100;
        let offset = options.offset || 0;
        let hasMore = true;

        try {
            while (hasMore) {
                const response = await this.catalogService!.listOfferings({
                    catalogIdentifier: catalogId,
                    digest: options.digest ?? true,
                    limit,
                    offset,
                });

                const resources = response.result.resources || [];
                offerings.push(...resources);

                if (resources.length < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            }

            return offerings;
        } catch (error) {
            this.logger.error(`Error fetching offerings for catalog ${catalogId}:`, error);
            throw error;
        }
    }

    /**
     * Gets details for a specific version
     */
    public async getVersionDetails(versionLocator: string): Promise<any> {
        if (!this.isAuthenticated()) {
            throw new ApiKeyRequiredError();
        }

        try {
            const response = await this.catalogService!.getVersion({
                versionLocId: versionLocator,
            });
            return response.result;
        } catch (error) {
            this.logger.error(`Error fetching version details for ${versionLocator}:`, error);
            throw error;
        }
    }

    /**
     * Gets a specific catalog by ID
     */
    public async getCatalog(catalogId: string): Promise<any> {
        if (!this.isAuthenticated()) {
            throw new ApiKeyRequiredError();
        }

        try {
            const response = await this.catalogService!.getCatalog({
                catalogIdentifier: catalogId
            });
            return response.result;
        } catch (error) {
            this.logger.error(`Error fetching catalog ${catalogId}:`, error);
            throw error;
        }
    }
}