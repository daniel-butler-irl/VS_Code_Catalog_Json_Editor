// src/types/inputMapping.ts

export interface InputMapping {
    dependency_output?: string;
    dependency_input?: string;
    version_input: string;
}

export interface InputMappingContext {
    catalogId: string;
    offeringId: string;
    flavorName: string;
    version?: string;
}

export interface MappingOption {
    label: string;
    description: string;
    value: string;
    type: 'input' | 'output';
    detail?: string;
}