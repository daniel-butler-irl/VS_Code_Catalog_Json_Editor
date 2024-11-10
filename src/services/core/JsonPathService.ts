// src/services/core/JsonPathService.ts

import { LoggingService } from './LoggingService';

export interface JsonPathContext {
    catalogId?: string;
    offeringId?: string;
    // Could add other context properties as needed
}

export class JsonPathService {
    private static instance: JsonPathService;
    private readonly logger = LoggingService.getInstance();

    private constructor() {
        this.logger.debug('Initializing JsonPathService');
    }

    public static getInstance(): JsonPathService {
        if (!JsonPathService.instance) {
            JsonPathService.instance = new JsonPathService();
        }
        return JsonPathService.instance;
    }

    /**
     * Finds the context (catalog_id, offering_id) for a given JSON path
     * @param jsonPath The JSON path to find context for
     * @param data The JSON data to traverse
     * @returns Context containing catalogId and offeringId if found
     */
    public findContextForPath(jsonPath: string, data: any): JsonPathContext {
        const parts = this.splitJsonPath(jsonPath);
        let current = data;
        let catalogId: string | undefined;
        let offeringId: string | undefined;

        // Walk up the path looking for catalog_id and id
        for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i];
            const arrayMatch = part.match(/\[(\d+)\]/);
            
            if (arrayMatch) {
                const index = parseInt(arrayMatch[1], 10);
                current = current?.[index];
            } else {
                current = current?.[part];
            }

            if (current) {
                if (!catalogId && current.catalog_id) {
                    catalogId = current.catalog_id;
                }
                if (!offeringId && current.id && jsonPath.includes('dependencies')) {
                    offeringId = current.id;
                }
            }

            if (catalogId && offeringId) {
                break;
            }
        }

        return { catalogId, offeringId };
    }

    /**
     * Splits a JSON path into its component parts
     * @param jsonPath The JSON path to split
     * @returns Array of path segments
     */
    public splitJsonPath(jsonPath: string): string[] {
        const parts: string[] = [];
        const regex = /\[(\d+)\]|\.([^.\[\]]+)/g;
        let match;

        while ((match = regex.exec(jsonPath)) !== null) {
            if (match[1] !== undefined) {
                parts.push(`[${match[1]}]`);
            } else if (match[2] !== undefined) {
                parts.push(match[2]);
            }
        }

        return parts;
    }

   /**
     * Traverses JSON data and executes a callback for each node
     * @param data The JSON data to traverse
     * @param callback Function to call for each node
     * @param path Current path (defaults to '$')
     */
   public traverseJson<T>(
    data: any,
    callback: (key: string, value: any, path: string) => T | T[] | void,
    path: string = '$'
): T[] {
    const results: T[] = [];

    if (typeof data !== 'object' || data === null) {
        return results;
    }

    for (const [key, value] of Object.entries(data)) {
        const currentPath = path === '$' ? `$.${key}` : `${path}.${key}`;
        
        const result = callback(key, value, currentPath);
        if (result !== undefined) {
            if (Array.isArray(result)) {
                results.push(...result);
            } else {
                results.push(result);
            }
        }

        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                results.push(...this.traverseJson(
                    item,
                    callback,
                    `${currentPath}[${index}]`
                ));
            });
        } else if (typeof value === 'object' && value !== null) {
            results.push(...this.traverseJson(value, callback, currentPath));
        }
    }

    return results;
}
}
