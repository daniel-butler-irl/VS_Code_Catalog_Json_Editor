// types/validation/index.ts

/**
 * Represents the various states a validation process can be in.
 * - Unknown: Initial state, no validation needed or not started
 * - Pending: Validation needed and queued for processing
 * - Validating: Currently being validated
 * - Valid: Validation passed successfully
 * - Invalid: Validation failed
 * - LoginRequired: Authentication needed before validation
 */
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


export interface ValidationResult<T = unknown> {
    isValid: boolean;
    value?: T;
    errors?: ValidationError[];
    metadata?: ValidationMetadata;
}

export interface ValidationError {
    code: string;
    message: string;
    path?: string;
}

// For typed validations
export interface ValidationContext {
    catalogId?: string;
    offeringId?: string;
    path?: string;
    parentContext?: Record<string, unknown>;
}

// For validation strategies
export interface Validator<T = unknown> {
    validate(value: unknown, context?: ValidationContext): Promise<ValidationResult<T>>;
}