// src/services/IBMCloudService.ts

import { IamAuthenticator } from 'ibm-cloud-sdk-core';
import CatalogManagementV1 = require('@ibm-cloud/platform-services/catalog-management/v1');
import { CacheService } from './CacheService';

/**
 * Service for interacting with IBM Cloud for validation.
 */
export class IBMCloudService {
  private catalogManagement: CatalogManagementV1;
  private cacheService: CacheService;

  /**
   * Initializes the IBM Cloud service with the provided API key.
   * @param apiKey The IBM Cloud API key.
   */
  constructor(private apiKey: string) {
    const authenticator = new IamAuthenticator({ apikey: apiKey });
    this.catalogManagement = new CatalogManagementV1({
      authenticator: authenticator,
    });
    this.cacheService = new CacheService(3600); // Set TTL as needed
  }

  /**
   * Validates the given catalog ID against IBM Cloud.
   * @param catalogId The catalog ID to validate.
   */
  public async validateCatalogId(catalogId: string): Promise<boolean> {
    const cacheKey = `catalogId:${catalogId}`;
    const cachedValue = this.cacheService.get(cacheKey);

    if (cachedValue !== undefined) {
      return cachedValue;
    }

    try {
      const response = await this.catalogManagement.getCatalog({
        catalogIdentifier: catalogId,
      });
      const isValid = response.status === 200;
      this.cacheService.set(cacheKey, isValid);
      return isValid;
    } catch (error) {
      this.cacheService.set(cacheKey, false);
      return false;
    }
  }

  /**
   * Retrieves offering details for tooltips.
   * @param catalogId The catalog ID.
   */
  public async getOfferingDetails(catalogId: string): Promise<any> {
    const cacheKey = `catalogDetails:${catalogId}`;
    const cachedValue = this.cacheService.get(cacheKey);

    if (cachedValue !== undefined) {
      return cachedValue;
    }

    try {
      const response = await this.catalogManagement.getCatalog({
        catalogIdentifier: catalogId,
      });
      const details = response.result;
      this.cacheService.set(cacheKey, details);
      return details;
    } catch (error) {
      this.cacheService.set(cacheKey, null);
      throw new Error('Offering not found');
    }
  }
}
