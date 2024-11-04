// src/types/schema.ts
export interface SchemaMetadata {
    type: string;
    required: boolean;
    description?: string;
    properties?: Record<string, SchemaMetadata>;
    items?: SchemaMetadata;
    enum?: string[];
    title?: string;
}