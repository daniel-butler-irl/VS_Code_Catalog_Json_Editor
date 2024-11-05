// src/decorators/requestDeduplication.ts

import type { DeduplicationOptions } from '../types/decorators';

/**
 * In-progress requests storage
 * Using WeakMap to allow garbage collection of class instances
 */
const inProgressRequests = new Map<string, Promise<any>>();

/**
 * Decorator for deduplicating concurrent method calls
 * 
 * @param options Configuration options for deduplication behavior
 * 
 * @example
 * ```typescript
 * @deduplicateRequest({
 *   keyGenerator: (catalogId, offeringId) => `validate:${catalogId}:${offeringId}`,
 *   timeoutMs: 30000
 * })
 * async validateOfferingId(catalogId: string, offeringId: string): Promise<boolean>
 * ```
 */
export function deduplicateRequest(options: DeduplicationOptions = {}) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            // Generate request key
            const key = options.keyGenerator
                ? options.keyGenerator(...args)
                : `${target.constructor.name}:${propertyKey}:${JSON.stringify(args)}`;

            // Check for in-progress request
            if (inProgressRequests.has(key)) {
                if (options.onDuplicate) {
                    options.onDuplicate(key);
                }
                return inProgressRequests.get(key);
            }

            // Create the promise
            const promise = options.timeoutMs
                ? Promise.race([
                    originalMethod.apply(this, args),
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new Error(`Request timed out after ${options.timeoutMs}ms`)),
                            options.timeoutMs
                        )
                    )
                ])
                : originalMethod.apply(this, args);

            // Store the promise
            inProgressRequests.set(key, promise);

            try {
                const result = await promise;
                return result;
            } finally {
                // Clean up only if this is still the stored promise
                if (inProgressRequests.get(key) === promise) {
                    inProgressRequests.delete(key);
                }
            }
        };

        return descriptor;
    };
}
