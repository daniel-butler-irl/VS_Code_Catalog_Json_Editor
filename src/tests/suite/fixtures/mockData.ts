// src/test/suite/fixtures/mockData.ts
export const mockCatalogData = {
    products: [
        {
            label: "Test Product",
            name: "test_product",
            product_kind: "solution",
            offering_icon_url: "test_url",
            flavors: [
                {
                    label: "Basic",
                    name: "basic",
                    configuration: []
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

export function generateLargeMockData(productCount: number) {
    const products = [];

    for (let i = 0; i < productCount; i++) {
        products.push({
            label: `Test Product ${i}`,
            name: `test_product_${i}`,
            product_kind: "solution",
            tags: ["test", "performance"],
            offering_icon_url: "test_url",
            flavors: [
                {
                    label: "Basic",
                    name: `basic-${i}`,
                    licenses: [
                        {
                            id: "LICENSE",
                            name: "LICENSE",
                            type: "text/plain",
                            description: "LICENSE"
                        }
                    ],
                    dependencies: [
                        {
                            catalog_id: "test-catalog-id",
                            id: `test-offering-${i}`,
                            flavors: ["standard"],
                            input_mapping: [
                                {
                                    dependency_output: "workload_resource_group_name",
                                    version_input: "existing_resource_group_name"
                                }
                            ],
                            name: "test-dependency"
                        }
                    ],
                    configuration: [
                        {
                            key: "region",
                            type: "string",
                            default_value: "us-south",
                            required: true
                        }
                    ]
                }
            ]
        });
    }

    return { products };
}