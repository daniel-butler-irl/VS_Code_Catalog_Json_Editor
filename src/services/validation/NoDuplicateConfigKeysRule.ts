// services/validation/NoDuplicateConfigKeysRule.ts
import { ValidationError } from '../../types/validation';
import { ValidationRuleConfig } from '../../types/validation/rules';
import { BaseValidationRule } from './BaseValidationRule';
import { parseTree, findNodeAtLocation, Node } from 'jsonc-parser';
import { LoggingService } from '../core/LoggingService';
// Remove unused imports that are causing errors
// import * as vscode from 'vscode';
// import { ValidationErrorCode } from '../../models/ValidationErrorCode';
// import { ValidationResult } from '../../models/ValidationTypes';
// import { Logger } from '../../utils/Logger';
// import * as jsonc from 'jsonc-parser';

/**
 * Rule to check for duplicate key values in products[*].flavors[*].configuration arrays.
 * 
 * This rule specifically checks for duplicate values in the "key" field across different
 * configuration items within the same configuration array. For example:
 * 
 * "configuration": [
 *   { "key": "api_key", "value": "value1" },
 *   { "key": "api_key", "value": "value2" }  // <-- This duplicate key value would be flagged
 * ]
 * 
 * WHY THIS RULE IS NEEDED:
 * In IBM Cloud Catalog, each configuration item within a flavor must have a unique key
 * to properly map configurations. Duplicate keys in this context would cause undefined
 * behavior when deploying resources.
 * 
 * HOW THIS DIFFERS FROM DuplicateConfigurationKeysRule:
 * - This rule checks for duplicate values in the "key" field across different items in a configuration array
 *   (semantic/business level validation)
 * - DuplicateConfigurationKeysRule checks for duplicate property names within the same JSON object
 *   (syntax level validation)
 * 
 * Example of what this rule catches:
 * In a product flavor's configuration array, having multiple items with the same key
 * is invalid even though the JSON itself is syntactically valid.
 */
export class NoDuplicateConfigKeysRule extends BaseValidationRule {
  private readonly logger = LoggingService.getInstance();
  private readonly logChannel = 'schemaValidation';

  constructor() {
    super(
      'no_duplicate_config_keys',
      'Business Validator: Ensures unique keys in configuration arrays (e.g., no two items with "key": "api_key" in the same array)'
    );
  }

  async validate(value: unknown, config?: ValidationRuleConfig, rawText?: string): Promise<ValidationError[]> {
    // Defensive check for config and enabled flag
    if (!config) {
      this.logger.debug('No configuration provided for NoDuplicateConfigKeysRule, using default enabled=true', {
        ruleId: this.id
      }, this.logChannel);
      config = { enabled: true };
    }

    // Explicitly log the state of the enabled flag to help debugging
    this.logger.debug('NoDuplicateConfigKeysRule validation requested', {
      ruleId: this.id,
      configProvided: !!config,
      enabled: config?.enabled === true,
      config
    }, this.logChannel);

    if (config.enabled !== true) {
      this.logger.debug('NoDuplicateConfigKeysRule is disabled, skipping validation', {
        config
      }, this.logChannel);
      return [];
    }

    if (typeof value !== 'object' || value === null) {
      this.logger.debug('Invalid value type for NoDuplicateConfigKeysRule, skipping validation', {
        valueType: typeof value,
        isNull: value === null
      }, this.logChannel);
      return [];
    }

    this.logger.debug('Validating duplicate config keys', {
      enabled: config.enabled,
      hasRawText: !!rawText,
      valueType: typeof value
    }, this.logChannel);

    const errors: ValidationError[] = [];

    // Parse the JSON tree if raw text is available
    const root = rawText ? parseTree(rawText) : null;

    // Helper function to check configuration array for duplicates
    const checkConfigurationArray = (configArray: any[], basePath: (string | number)[]) => {
      const seenKeys = new Map<string, { indices: number[], nodes: (Node | undefined)[] }>();

      // First pass: collect all keys and their indices
      configArray.forEach((item, index) => {
        if (item && typeof item === 'object' && 'key' in item) {
          const key = item.key;
          if (typeof key !== 'string') {
            return; // Skip non-string keys
          }

          // Find the node for this configuration item
          let keyNode: Node | undefined;
          if (root) {
            const configItemPath = [...basePath, index];
            const configNode = this.findNodeAtPath(root, configItemPath);

            // Find the key property node within the configuration item
            if (configNode) {
              keyNode = this.findPropertyNode(configNode, 'key');
              if (keyNode && keyNode.children && keyNode.children.length > 1) {
                keyNode = keyNode.children[1]; // The value of the key property
              }
            }
          }

          const existing = seenKeys.get(key) || { indices: [], nodes: [] };
          existing.indices.push(index);
          existing.nodes.push(keyNode);
          seenKeys.set(key, existing);
        }
      });

      // Second pass: report duplicates
      for (const [key, { indices, nodes }] of seenKeys.entries()) {
        if (indices.length > 1) {
          // Format the path for error reporting
          const normalizedPath = basePath.join('.');

          this.logger.debug('Found duplicate key in configuration array', {
            key,
            indices,
            path: normalizedPath
          }, this.logChannel);

          // Report errors for all instances of the duplicate key
          indices.forEach((index, arrayIndex) => {
            const keyNode = nodes[arrayIndex];
            const itemPath = [...basePath, index, 'key'];
            const errorPath = itemPath.join('.');

            const otherIndices = indices.filter((_, i) => i !== arrayIndex).join(', ');
            const errorMessage = `Duplicate key '${key}' found in configuration (other instances at indices ${otherIndices})`;

            if (keyNode && rawText) {
              // We have a node position we can use
              const position = this.getNodePosition(keyNode, rawText);

              errors.push({
                code: 'DUPLICATE_CONFIG_KEY',
                message: errorMessage,
                path: errorPath,
                range: {
                  start: position,
                  end: { line: position.line, character: position.character + key.length }
                }
              });
            } else if (rawText) {
              // Fall back to searching for the key in the text
              const keyPosition = this.findKeyPosition(key, rawText, 0);

              errors.push({
                code: 'DUPLICATE_CONFIG_KEY',
                message: errorMessage,
                path: errorPath,
                range: {
                  start: keyPosition,
                  end: { line: keyPosition.line, character: keyPosition.character + key.length }
                }
              });
            } else {
              // No position information available
              errors.push({
                code: 'DUPLICATE_CONFIG_KEY',
                message: errorMessage,
                path: errorPath
              });
            }
          });
        }
      }
    };

    // Traverse the catalog structure to find all configuration arrays
    const obj = value as any;
    if (Array.isArray(obj.products)) {
      obj.products.forEach((product: any, productIndex: number) => {
        if (product && Array.isArray(product.flavors)) {
          product.flavors.forEach((flavor: any, flavorIndex: number) => {
            if (flavor && Array.isArray(flavor.configuration)) {
              const path = ['products', productIndex, 'flavors', flavorIndex, 'configuration'];
              // Fix: Cast the path to any to avoid the type error
              checkConfigurationArray(flavor.configuration, path as any);
            }
          });
        }
      });
    }

    this.logger.debug('Duplicate config key validation complete', {
      errorCount: errors.length,
      errorSummary: errors.map(err => ({
        message: err.message,
        path: err.path
      }))
    }, this.logChannel);

    return errors;
  }
} 