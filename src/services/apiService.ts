// src/services/apiService.ts

import * as vscode from 'vscode';
import { Components, LogLevel } from '../utils/outputManager';
import { OutputManager } from '../utils/outputManager';
import CatalogManagementV1 from '@ibm-cloud/platform-services/catalog-management/v1';
import { IamAuthenticator } from 'ibm-cloud-sdk-core';
import { Offering, Flavor } from '../models/offerings'; // Adjust the path as necessary
import { version } from 'os';

/**
 * Handles API interactions with IBM Cloud.
 */
export class ApiService {
    private catalogClient: CatalogManagementV1 | null = null;

constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento,
    private readonly outputManager: OutputManager
) {
    this.log(Components.API_SERVICE, 'ApiService constructor started');
    
    // Initialize state
    this.catalogClient = null;
    
    // Initialize using an async IIFE (Immediately Invoked Function Expression)
    (async () => {
        try {
            const isAuthenticated = await this.isAuthenticated();
            this.log(Components.API_SERVICE, `Initial authentication state: ${isAuthenticated ? 'authenticated' : 'not authenticated'}`);
            
            if (isAuthenticated) {
                const apiKey = await this.secrets.get('catalogEditor.apiKey');
                if (apiKey) {
                    this.initializeCatalogClient(apiKey);
                    this.log(Components.API_SERVICE, 'Catalog client initialized from stored key');
                }
            }
        } catch (error) {
            this.log(Components.API_SERVICE, `Error during initialization: ${error}`, LogLevel.ERROR);
        }
    })();

    this.log(Components.API_SERVICE, 'ApiService constructor completed');
}

    /**
     * Initializes the API service from the stored API key.
     */
    private async initializeFromStoredKey(): Promise<void> {
        try {
            const apiKey = await this.secrets.get('catalogEditor.apiKey');
            if (apiKey) {
                this.log(Components.API_SERVICE, 'Found stored API key, initializing client');
                this.initializeCatalogClient(apiKey);
                this.log(Components.API_SERVICE, 'Client initialized from stored key');
            } else {
                this.log(Components.API_SERVICE, 'No stored API key found');
            }
        } catch (error) {
            this.log(Components.API_SERVICE, `Error in initializeFromStoredKey: ${error}`, LogLevel.ERROR);
            throw error;
        }
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
     * Logs errors with detailed information.
     * @param message The error message.
     * @param error The error object.
     */
    public logError(message: string, error: unknown): void {
        this.log(Components.API_SERVICE, `${message} - ${error instanceof Error ? error.message : String(error)}`, LogLevel.ERROR);
    }

    /**
     * Initializes the Catalog Management client with the API key.
     * Should be called after login or when the API key is updated.
     * @param apiKey The IBM Cloud API key.
     */
    private initializeCatalogClient(apiKey: string): void {
        // Dispose of the existing client if it exists
        if (this.catalogClient) {
            this.catalogClient = null;
            this.log(Components.API_SERVICE, 'Existing CatalogManagementV1 client disposed');
        }

        // Initialize the IAM Authenticator with the API key
        const authenticator = new IamAuthenticator({ apikey: apiKey });

        // Initialize the Catalog Management client with the authenticator
        this.catalogClient = new CatalogManagementV1({
            authenticator: authenticator,
            serviceUrl: 'https://catalog.cloud.ibm.com/v1' // Ensure this URL is correct for your region/service
        });

        this.log(Components.API_SERVICE, 'CatalogManagementV1 client initialized with new authenticator');
    }

    /**
     * Validates a catalog ID by attempting to fetch its details using the IBM Cloud SDK
     * @param catalogId The catalog ID to validate
     * @returns A promise resolving to true if the catalog ID is valid
     */
    public async validateCatalogId(catalogId: string): Promise<boolean> {
        try {
            this.log(Components.API_SERVICE, `Validating catalog ID: ${catalogId}`);

            // Retrieve the API key from secure storage
            const apiKey = await this.secrets.get('catalogEditor.apiKey');

            if (!apiKey) {
                throw new Error('API key not found. Please log in.');
            }

            // Initialize the Catalog Management client with the API key
            this.initializeCatalogClient(apiKey);

            if (!this.catalogClient) {
                throw new Error('Catalog Management client is not initialized.');
            }

            // Attempt to fetch the catalog details
            const response = await this.catalogClient.getCatalog({ catalogIdentifier: catalogId });

            // If the response is successful and contains catalog data, the ID is valid
            if (response.status === 200 && response.result) {
                this.log(Components.API_SERVICE, `Catalog ID ${catalogId} is valid.`);
                return true;
            } else {
                this.log(Components.API_SERVICE, `Catalog ID ${catalogId} is invalid.`);
                return false;
            }
        } catch (error) {
            this.logError(`Failed to validate catalog ID ${catalogId}`, error);
            return false;
        }
    }

    /**
     * Fetches offerings based on catalogId using the IBM Cloud SDK
     * @param catalogId The catalog ID to fetch offerings for.
     * @returns The offerings data.
     */
    public async getOfferings(catalogId: string): Promise<Offering[]> {
        try {
            this.log(Components.API_SERVICE, `Fetching offerings for catalogId: ${catalogId}`);

            // Retrieve the API key from secure storage
            const apiKey = await this.secrets.get('catalogEditor.apiKey');

            if (!apiKey) {
                throw new Error('API key not found. Please log in.');
            }

            // Initialize the Catalog Management client with the API key
            this.initializeCatalogClient(apiKey);

            if (!this.catalogClient) {
                throw new Error('Catalog Management client is not initialized.');
            }

            // Fetch offerings for the given catalog ID
            const response = await this.catalogClient.listOfferings({ catalogIdentifier: catalogId });

            if (response.status === 200 && response.result && response.result.resources) {
                // Map the SDK's response to your own Offering interface
                const offerings: Offering[] = response.result.resources.map((resource: any) => ({
                    id: resource.id,
                    name: resource.name,
                    description: resource.description,
                    flavors: resource.flavors?.map((flavor: any) => ({
                        id: flavor.id,
                        name: flavor.name,
                        // Add other relevant fields if necessary
                    })) || []
                }));
                this.log(Components.API_SERVICE, `Fetched ${offerings.length} offerings for catalogId ${catalogId}`);
                return offerings;
            } else {
                this.log(Components.API_SERVICE, `No offerings found for catalogId ${catalogId}`);
                return [];
            }
        } catch (error) {
            this.logError(`Failed to fetch offerings for catalogId ${catalogId}`, error);
            throw error;
        }
    }

    /**
     * Fetches flavors based on catalogId by extracting them from offerings.
     * @param catalogId The catalog ID to fetch flavors for.
     * @returns An array of flavor names.
     */
    public async getFlavors(catalogId: string): Promise<string[]> {
        try {
            this.log(Components.API_SERVICE, `Fetching flavors for catalogId: ${catalogId}`);

            // Retrieve the API key from secure storage
            const apiKey = await this.secrets.get('catalogEditor.apiKey');

            if (!apiKey) {
                throw new Error('API key not found. Please log in.');
            }

            // Initialize the Catalog Management client with the API key
            this.initializeCatalogClient(apiKey);

            if (!this.catalogClient) {
                throw new Error('Catalog Management client is not initialized.');
            }

            // Fetch offerings for the given catalog ID
            const offeringsResponse = await this.catalogClient.listOfferings({ catalogIdentifier: catalogId });

            if (offeringsResponse.status === 200 && offeringsResponse.result && offeringsResponse.result.resources) {
                // Map the SDK's response to your own Offering interface
                const offerings: Offering[] = offeringsResponse.result.resources.map((resource: any) => ({
                    id: resource.id,
                    name: resource.name,
                    description: resource.description,
                    flavors: resource.flavors?.map((flavor: any) => ({
                        id: flavor.id,
                        name: flavor.name,
                        // Add other relevant fields if necessary
                    })) || []
                }));

                // Extract unique flavor names
                const flavorsSet: Set<string> = new Set();
                offerings.forEach(offering => {
                    offering.flavors?.forEach(flavor => {
                        if (flavor.name) {
                            flavorsSet.add(flavor.name);
                        }
                    });
                });

                const flavors = Array.from(flavorsSet);
                this.log(Components.API_SERVICE, `Fetched ${flavors.length} unique flavors for catalogId ${catalogId}`);
                return flavors;
            } else {
                this.log(Components.API_SERVICE, `No offerings found for catalogId ${catalogId}. No flavors to extract.`);
                return [];
            }
        } catch (error) {
            this.logError(`Failed to fetch flavors for catalogId ${catalogId}`, error);
            throw error;
        }
    }

    /**
     * Handles user login by storing the API key and initializing the Catalog Management client.
     * @param apiKey The API key.
     */
    public async login(apiKey: string): Promise<void> {
        try {
            await this.secrets.store('catalogEditor.apiKey', apiKey);
            this.log(Components.API_SERVICE, 'User logged in with API key');
            // Initialize the Catalog Management client with the new API key
            this.initializeCatalogClient(apiKey);
        } catch (error) {
            this.logError(`Login failed: ${error}`, error);
            throw error;
        }
    }

    /**
     * Handles user logout by clearing the API key and disposing the Catalog Management client.
     */
    public async logout(): Promise<void> {
        try {
            await this.secrets.delete('catalogEditor.apiKey');
            this.log(Components.API_SERVICE, 'User logged out');
            // Dispose the Catalog Management client if necessary
            if (this.catalogClient) {
                this.catalogClient = null;
                this.log(Components.API_SERVICE, 'CatalogManagementV1 client disposed');
            }
        } catch (error) {
            this.log(Components.API_SERVICE, `Logout failed: ${error}`, LogLevel.ERROR);
            throw error;
        }
    }

    public async getVersionDetails(versionLocatorID:string): Promise<string> {
        try {
            const response = await this.catalogClient?.getVersion({ 'versionLocId': versionLocatorID });

            if (response?.status === 200 && response?.result) {
                return response.result.name ?? 'Unknown';
            }

            return 'Unknown';
        } catch (error) {
            this.logError('Failed to fetch version details', error);
            return 'Unknown';
        }
    }

    /**
     * Checks if the user is authenticated.
     * @returns True if authenticated, false otherwise.
     */
    public async isAuthenticated(): Promise<boolean> {
        const apiKey = await this.secrets.get('catalogEditor.apiKey');
        return !!apiKey;
    }
}
