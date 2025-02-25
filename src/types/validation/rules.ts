import { ValidationError } from './index';

/**
 * Interface for validation rule configuration
 */
export interface ValidationRuleConfig {
  enabled: boolean;
  params?: Record<string, unknown>;
}

/**
 * Type of schema modification a rule can perform
 */
export enum SchemaModificationType {
  RemoveRequired = 'remove_required',
  // Add more modification types as needed
  // AddRequired = 'add_required',
  // ModifyType = 'modify_type',
  // etc.
}

/**
 * Schema modification specification
 */
export interface SchemaModification {
  type: SchemaModificationType;
  property: string;
  // Add more properties as needed for different modification types
}

/**
 * Interface for a validation rule
 */
export interface ValidationRule {
  id: string;
  description: string;
  overrideSchema?: boolean; // If true, this rule's validation supersedes schema validation for the same path
  schemaModifications?: SchemaModification[]; // Specifies how this rule modifies the schema
  validate(value: unknown, config?: ValidationRuleConfig, rawText?: string): Promise<ValidationError[]>;
} 