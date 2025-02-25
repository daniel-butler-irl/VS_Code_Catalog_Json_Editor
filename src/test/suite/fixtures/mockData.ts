// src/test/suite/fixtures/mockData.ts
import { FlavorObject, Dependency, InputMapping } from '../../../types/catalog';

export const mockCatalogData = {
    products: [
        {
            label: "test_product",
            name: "test_product",
            product_kind: "software",
            flavors: [
                {
                    name: "test_flavor",
                    label: "Test Flavor",
                    dependencies: [],
                    dependency_version_2: true
                }
            ]
        }
    ]
};

export const mockIBMCloudResponses = {
    validCatalogId: {
        id: "test-catalog-id",
        label: "Test Catalog",
        short_description: "Test Description"
    },
    invalidCatalogId: {
        status: 404,
        message: "Catalog not found"
    }
};

/**
 * Generates a large mock catalog data structure for performance testing
 * @param numFlavors Number of flavors to generate for the single product
 * @returns Mock catalog data with a single product containing specified number of flavors
 */
export function generateLargeMockData(numFlavors: number): Record<string, any> {
    return {
        catalog_id: 'test-catalog',
        label: 'Test Catalog',
        short_description: 'A test catalog for performance testing',
        catalog_icon_url: 'https://example.com/icon.png',
        tags: ['test', 'performance'],
        provider: {
            name: 'Test Provider',
            email: 'test@example.com'
        },
        products: [
            {
                label: 'Single Product',
                name: 'single-product',
                short_description: 'Test product description',
                kind: 'solution',
                catalog_id: 'test-catalog',
                offering_id: 'offering-id',
                version: '1.0.0',
                flavors: Array.from({ length: numFlavors }, (_, i) => ({
                    label: `Flavor ${i}`,
                    name: `flavor-${i}`,
                    dependencies: [
                        {
                            catalog_id: `dep-catalog-${i}`,
                            id: `dep-${i}`,
                            name: `Dependency ${i}`,
                            offering_id: `dep-offering-${i}`,
                            version: '1.0.0',
                            flavors: ['default', 'minimal'],
                            optional: false,
                            on_by_default: true,
                            features: ['feature1', 'feature2'],
                            input_mapping: [
                                {
                                    dependency_output: 'output1',
                                    dependency_input: 'input1',
                                    version_input: 'version1'
                                } as InputMapping
                            ]
                        } as Dependency
                    ]
                } as FlavorObject))
            }
        ]
    };
}