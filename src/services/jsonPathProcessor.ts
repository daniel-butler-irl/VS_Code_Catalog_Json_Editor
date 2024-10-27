// src/services/jsonPathProcessor.ts

import { createJsonPathFunctionConfigs, JsonPathFunctionConfig, FunctionResult } from '../utils/jsonPathFunctionRegistry';
import jsonpath from 'jsonpath';
import { CatalogCacheService } from './catalogCacheService';
import { ApiService } from './apiService';

/**
 * Processes JSON data based on JSONPath-function configurations.
 */
export class JsonPathProcessor {
    private jsonPathFunctionConfigs: JsonPathFunctionConfig[];
    
    constructor(
        private readonly catalogCacheService: CatalogCacheService,
        private readonly apiService: ApiService
    ) {
        this.jsonPathFunctionConfigs = createJsonPathFunctionConfigs(apiService, catalogCacheService);
    }

    /**
     * Processes JSON data and returns enhancement results.
     * @param jsonData The JSON data to process.
     * @returns An array of FunctionResults.
     */
    public async processJsonPaths(jsonData: any): Promise<FunctionResult[]> {
        // Sort configurations based on priority (ascending)
        const sortedConfigs = [...this.jsonPathFunctionConfigs].sort((a, b) => a.priority - b.priority);
        const enhancementResults: FunctionResult[] = [];

        for (const config of sortedConfigs) {
            const matches = jsonpath.paths(jsonData, config.jsonPath);
            const matchValues = matches.map(path => jsonpath.value(jsonData, path.join('.')));

            if (config.runInParallel) {
                // Execute all functions in parallel
                const results = await Promise.all(matchValues.map(value => config.function(value)));
                enhancementResults.push(...results.filter(result => result !== undefined));
            } else {
                // Execute functions sequentially
                for (const value of matchValues) {
                    const result = await config.function(value);
                    if (result) {
                        enhancementResults.push(result);
                    }
                }
            }
        }

        return enhancementResults;
    }
}
