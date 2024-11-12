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
