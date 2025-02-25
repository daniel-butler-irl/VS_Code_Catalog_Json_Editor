import { ValidationError } from '../../types/validation';
import { ValidationRuleConfig } from '../../types/validation/rules';
import { BaseValidationRule } from './BaseValidationRule';
import { parseTree, findNodeAtLocation, Node } from 'jsonc-parser';
import { LoggingService } from '../core/LoggingService';

/**
 * Rule to check for duplicate JSON property keys throughout the entire document.
 * 
 * This rule detects when the same property name appears multiple times within the same object,
 * which is a common JSON syntax issue. For example:
 * 
 * {
 *   "name": "value1",
 *   "name": "value2"  // This is a duplicate key that would be caught by this rule
 * }
 * 
 * WHY THIS RULE IS NEEDED:
 * When duplicate keys exist in a JSON object, the behavior is undefined in the JSON spec. 
 * Different parsers handle it differently - some use the first value, others the last value.
 * This can lead to unexpected behavior and hard-to-diagnose bugs.
 * 
 * HOW THIS DIFFERS FROM NoDuplicateConfigKeysRule:
 * - This rule checks for duplicate property names at the JSON syntax level (duplicate keys in the same object)
 * - NoDuplicateConfigKeysRule checks for duplicate values in the "key" field across different
 *   configuration items in products[*].flavors[*].configuration arrays, which is a semantic/business rule
 *
 * Example issue this rule catches:
 * {
 *   "prefix": "dev",
 *   "prefix": "prod"  // <-- This duplicate property key would be flagged
 * }
 */
export class DuplicateConfigurationKeysRule extends BaseValidationRule {
  private readonly logger = LoggingService.getInstance();
  private readonly logChannel = 'schemaValidation';

  constructor() {
    super(
      'duplicate_configuration_keys',
      'Syntax Validator: Checks for duplicate JSON property names within the same object (e.g., {"name": "value1", "name": "value2"})'
    );
  }

  async validate(value: unknown, config?: ValidationRuleConfig, rawText?: string): Promise<ValidationError[]> {
    if (!config?.enabled || !rawText || typeof value !== 'object' || value === null) {
      return [];
    }

    this.logger.debug('Validating duplicate configuration keys', {
      enabled: config.enabled,
      hasRawText: !!rawText,
      valueType: typeof value
    }, this.logChannel);

    const errors: ValidationError[] = [];
    const root = parseTree(rawText);

    // Helper function to find duplicate keys in an object
    const findDuplicateKeys = (obj: any, path: string[]): void => {
      if (!obj || typeof obj !== 'object') {
        return;
      }

      // Find the node for this object
      const nodePath = path.map(p => !isNaN(Number(p)) ? Number(p) : p);
      const objNode = this.findNodeAtPath(root, nodePath);

      if (objNode && objNode.type === 'object' && objNode.children) {
        // Track seen property names
        const seenProps = new Map<string, number[]>();

        // First pass: collect all property names and their positions
        objNode.children.forEach((propNode, index) => {
          if (propNode.type === 'property' && propNode.children && propNode.children.length > 0) {
            const keyNode = propNode.children[0];
            if (keyNode.type === 'string' && typeof keyNode.value === 'string') {
              const key = keyNode.value;
              const positions = seenProps.get(key) || [];
              positions.push(index);
              seenProps.set(key, positions);
            }
          }
        });

        // Second pass: report duplicates
        for (const [key, positions] of seenProps.entries()) {
          if (positions.length > 1) {
            // Generate a normalized path for ignore rules
            const normalizedPath = path.join('.');
            const formattedPath = `$.${normalizedPath}`;

            this.logger.debug('Found duplicate configuration key', {
              key,
              positions,
              path: normalizedPath,
              formattedPath // Include formatted path for ignore service
            }, this.logChannel);

            // Get the object context for better error messages
            const contextPath = path.join('.');
            const objectType = this.determineObjectType(contextPath);

            // Report each duplicate instance
            positions.forEach((pos, i) => {
              const propNode = objNode.children?.[pos];
              if (propNode && propNode.type === 'property' && propNode.children && propNode.children.length > 0) {
                const keyNode = propNode.children[0];
                const startPos = this.getNodePosition(keyNode.offset, rawText);
                const endPos = this.getNodePosition(keyNode.offset + keyNode.length, rawText);

                const ordinalPosition = this.getOrdinalString(i + 1);

                // Create an error with enhanced information for filtering
                const errorMessage = `Duplicate key '${key}' found (${ordinalPosition} occurrence) in ${objectType} at ${contextPath}`;
                const errorPath = [...path, key].join('.');

                errors.push({
                  code: 'DUPLICATE_CONFIGURATION_KEY',
                  message: errorMessage,
                  path: errorPath, // Include dot-notation path
                  range: {
                    start: startPos,
                    end: endPos
                  },
                });

                // Log detailed information that could be used for creating ignore patterns
                this.logger.debug('Duplicate key details for ignore pattern creation', {
                  errorMessage,
                  path: errorPath,
                  formattedPath,
                  key,
                  objectType,
                  duplicateIndex: i,
                  totalOccurrences: positions.length
                }, this.logChannel);
              }
            });
          }
        }
      }

      // Recursively check all objects in arrays
      if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          if (item && typeof item === 'object') {
            findDuplicateKeys(item, [...path, String(index)]);
          }
        });
      } else if (typeof obj === 'object' && obj !== null) {
        // Recursively check all object properties
        for (const key of Object.keys(obj)) {
          const value = obj[key];
          if (value && typeof value === 'object') {
            findDuplicateKeys(value, [...path, key]);
          }
        }
      }
    };

    // Start the recursive check from the root object
    findDuplicateKeys(value, []);

    this.logger.debug('Duplicate configuration keys validation complete', {
      errorCount: errors.length,
      // Include summary of errors for easier debugging without full content
      errorSummary: errors.map(err => ({
        message: err.message,
        path: err.path
      }))
    }, this.logChannel);

    return errors;
  }

  /**
   * Determines what type of object we're dealing with based on the path
   */
  private determineObjectType(path: string): string {
    if (path.includes('flavors') && path.includes('configuration')) {
      return 'flavor configuration';
    } else if (path.includes('flavors')) {
      return 'flavor';
    } else if (path.includes('compliance')) {
      return 'compliance configuration';
    } else {
      return 'configuration object';
    }
  }

  /**
   * Gets an ordinal string (1st, 2nd, 3rd, etc.) for a number
   */
  private getOrdinalString(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
} 