// services/validation/NoDuplicateConfigKeysRule.ts
import { ValidationError } from '../../types/validation';
import { ValidationRuleConfig } from '../../types/validation/rules';
import { BaseValidationRule } from './BaseValidationRule';
import { parseTree, findNodeAtLocation, Node } from 'jsonc-parser';
import { LoggingService } from '../core/LoggingService';

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
    if (!config?.enabled || !rawText || typeof value !== 'object' || value === null) {
      return [];
    }

    this.logger.debug('Validating duplicate config keys', {
      enabled: config.enabled,
      hasRawText: !!rawText,
      valueType: typeof value
    }, this.logChannel);

    const errors: ValidationError[] = [];
    const root = parseTree(rawText);

    interface KeyInfo {
      value: string;
      indices: Array<number>;
      nodes: Array<Node | undefined>;
    }

    // Helper function to check configuration array for duplicates
    const checkConfigurationArray = (configArray: any[], basePath: string[]) => {
      const seenKeys = new Map<string, KeyInfo>();

      // First pass: collect all keys and their indices
      configArray.forEach((item, index) => {
        if (item && typeof item === 'object' && 'key' in item) {
          const key = item.key;
          if (typeof key !== 'string') {
            return; // Skip non-string keys
          }

          // Find the node for this configuration item
          const configItemPath = [...basePath, String(index)];
          const nodePath = configItemPath.map(p => !isNaN(Number(p)) ? Number(p) : p);
          const configNode = this.findNodeAtPath(root, nodePath);

          // Find the key property node within the configuration item
          let keyNode: Node | undefined;
          if (configNode) {
            keyNode = findNodeAtLocation(configNode, ['key']);
          }

          const existing = seenKeys.get(key) || {
            value: key,
            indices: [] as Array<number>,
            nodes: [] as Array<Node | undefined>
          };

          existing.indices.push(index);
          existing.nodes.push(keyNode);
          seenKeys.set(key, existing);
        }
      });

      // Second pass: report duplicates
      for (const { value: key, indices, nodes } of seenKeys.values()) {
        if (indices.length > 1) {
          // Normalized path for easier ignore rule creation
          const normalizedPath = basePath.join('.');
          const formattedDollarPath = `$.${normalizedPath}`;

          this.logger.debug('Found duplicate key in configuration array', {
            key,
            indices,
            path: normalizedPath,
            formattedPath: formattedDollarPath
          }, this.logChannel);

          // Find all instances of this key in the configuration
          indices.forEach((index, arrayIndex) => {
            // Get the node for this specific instance
            const keyNode = nodes[arrayIndex];
            const configItemPath = [...basePath, String(index)];
            const errorPath = [...configItemPath, 'key'].join('.');

            if (keyNode) {
              // Use the key node for precise location
              const startPos = this.getNodePosition(keyNode.offset, rawText);
              const endPos = this.getNodePosition(keyNode.offset + keyNode.length, rawText);

              const otherIndices = indices.filter((_, i) => i !== arrayIndex);
              const errorMessage = `Duplicate key '${key}' found in configuration (other instances at indices ${otherIndices.join(', ')})`;

              // Create the error with enhanced information for filtering
              errors.push({
                code: 'DUPLICATE_CONFIG_KEY',
                message: errorMessage,
                path: errorPath,
                range: {
                  start: startPos,
                  end: endPos
                }
              });

              // Log additional information that could be used for creating ignore rules
              this.logger.debug('Duplicate key details', {
                key,
                path: errorPath,
                formattedPath: formattedDollarPath,
                message: errorMessage
              }, this.logChannel);
            } else {
              // Fallback to finding the entire configuration object if key node not found
              const nodePath = configItemPath.map(p => !isNaN(Number(p)) ? Number(p) : p);
              const configNode = this.findNodeAtPath(root, nodePath);

              if (configNode) {
                const startPos = this.getNodePosition(configNode.offset, rawText);
                const endPos = this.getNodePosition(configNode.offset + configNode.length, rawText);

                const otherIndices = indices.filter((_, i) => i !== arrayIndex);
                const errorMessage = `Duplicate key '${key}' found in configuration (other instances at indices ${otherIndices.join(', ')})`;

                errors.push({
                  code: 'DUPLICATE_CONFIG_KEY',
                  message: errorMessage,
                  path: configItemPath.join('.'),
                  range: {
                    start: startPos,
                    end: endPos
                  }
                });

                // Log additional information for ignore rules
                this.logger.debug('Duplicate key details (fallback)', {
                  key,
                  path: configItemPath.join('.'),
                  formattedPath: formattedDollarPath,
                  message: errorMessage
                }, this.logChannel);
              }
            }
          });
        }
      }
    };

    // Traverse the catalog structure
    const obj = value as any;
    if (Array.isArray(obj.products)) {
      obj.products.forEach((product: any, productIndex: number) => {
        if (product && Array.isArray(product.flavors)) {
          product.flavors.forEach((flavor: any, flavorIndex: number) => {
            if (flavor && Array.isArray(flavor.configuration)) {
              const path = ['products', String(productIndex), 'flavors', String(flavorIndex), 'configuration'];
              checkConfigurationArray(flavor.configuration, path);
            }
          });
        }
      });
    }

    this.logger.debug('Duplicate config key validation complete', {
      errorCount: errors.length,
      // Include summary of errors instead of full content
      errorSummary: errors.map(err => ({
        message: err.message,
        path: err.path
      }))
    }, this.logChannel);

    return errors;
  }
} 