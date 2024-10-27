// src/utils/jsonPathFunctionRegistry.ts

import { ApiService } from '../services/apiService';
import { CatalogCacheService } from '../services/catalogCacheService';
import { Components, LogLevel } from './outputManager';

/**
 * Configuration for JSONPath-function associations.
 */
export interface JsonPathFunctionConfig {
    jsonPath: string;
    function: (data: any) => Promise<FunctionResult | undefined>;
    priority: number;
    runInParallel?: boolean;
}

/**
 * Result of a function associated with a JSONPath.
 */
export interface FunctionResult {
    path: string; // Relative path within the JSON to target element
    highlightColor?: 'red' | 'green';
    elementType?: 'textbox' | 'combobox';
    options?: string[]; // For combobox
}

/**
 * Factory function to create JSONPath-function configurations.
 * @param apiService An instance of ApiService.
 * @param catalogCacheService An instance of CatalogCacheService.
 * @returns An array of JsonPathFunctionConfig.
 */
export function createJsonPathFunctionConfigs(
    apiService: ApiService,
    catalogCacheService: CatalogCacheService
): JsonPathFunctionConfig[] {
    return [
        {
            jsonPath: "$.products[*].flavors[*].dependencies[*].catalog_id",
            function: async (data) => {
                const catalogId = data.catalog_id;
                try {
                    const offering = await apiService.getOfferings(catalogId);
                    if (offering) {
                        return { path: 'catalog_id', highlightColor: 'green' };
                    } else {
                        return { path: 'catalog_id', highlightColor: 'red' };
                    }
                } catch (error) {
                    // Log the error but do not apply any UI enhancement
                    apiService.logError(`Failed to fetch offering for catalog_id: ${catalogId}`, error);
                    return undefined; // Do not apply any UI enhancement
                }
            },
            priority: 1,
            runInParallel: true
        },
        {
            jsonPath: "$.products[*].flavors[*].dependencies[*].flavors",
            function: async (data) => {
                const catalogId = data.catalog_id;
                try {
                    const flavors = await catalogCacheService.getFlavors(catalogId);
                    if (flavors && flavors.length > 0) {
                        return { path: 'flavors', elementType: 'combobox', options: flavors };
                    }
                    return { path: 'flavors', elementType: 'textbox' };
                } catch (error) {
                    // Log the error but default to textbox
                    catalogCacheService.logError(`Failed to fetch flavors for catalog_id: ${catalogId}`, error);
                    return { path: 'flavors', elementType: 'textbox' };
                }
            },
            priority: 2,
            runInParallel: false
        },
        // Add more configurations as needed
    ];
}
