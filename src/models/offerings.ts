// src/models/offerings.ts

export interface Flavor {
    id: string;
    name: string;
    // Add other relevant fields based on the API response
}

export interface Offering {
    id: string;
    name: string;
    description?: string;
    flavors?: Flavor[];
    // Add other relevant fields based on the API response
}
