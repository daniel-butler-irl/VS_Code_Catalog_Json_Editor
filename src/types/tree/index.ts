// types/tree/index.ts
export enum ValidationStatus {
    Unknown = 'unknown',
    Pending = 'pending',
    Validating = 'validating',
    Valid = 'valid',
    Invalid = 'invalid',
    LoginRequired = 'loginRequired',
}

export interface ValidationMetadata {
    status: ValidationStatus;
    message?: string;
    lastChecked?: Date;
    details?: Record<string, unknown>;
}

export interface FlavorNodeValue {
    configuration: Array<{
        key: string;
        type: string;
        default_value?: string | number | boolean;
        required: boolean;
    }>;
}

export interface SchemaMetadata {
    readonly type: string;
    readonly required: boolean;
    readonly enum?: unknown[];
    readonly description?: string;
}
