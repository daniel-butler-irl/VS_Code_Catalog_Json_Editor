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
    if (!config?.enabled || !rawText) {
      this.logger.debug('DuplicateConfigurationKeysRule skipped - disabled or no raw text', {
        enabled: config?.enabled,
        hasRawText: !!rawText
      }, this.logChannel);
      return [];
    }

    this.logger.debug('Validating duplicate configuration keys', {
      enabled: config.enabled,
      hasRawText: !!rawText,
      valueType: typeof value
    }, this.logChannel);

    const errors: ValidationError[] = [];

    try {
      const root = parseTree(rawText);

      if (!root) {
        this.logger.debug('No parse tree generated', {}, this.logChannel);
        return [];
      }

      // Recursive function to detect duplicate keys in the JSON structure
      const findDuplicateKeys = (node: Node, path: string[] = []): void => {
        if (node.type === 'object' && node.children) {
          const keysSeen = new Map<string, number[]>();

          // First pass: collect property names and their indices
          node.children.forEach((prop, index) => {
            if (prop.type === 'property' && prop.children && prop.children.length > 0) {
              const keyNode = prop.children[0];
              if (keyNode.type === 'string' && typeof keyNode.value === 'string') {
                const key = keyNode.value;
                const positions = keysSeen.get(key) || [];
                positions.push(index);
                keysSeen.set(key, positions);

                this.logger.debug('Found property key', {
                  key,
                  index,
                  pathJoined: path.join('.')
                }, this.logChannel);
              }
            }
          });

          // Second pass: report duplicates
          for (const [key, positions] of keysSeen.entries()) {
            if (positions.length > 1) {
              const normalizedPath = path.join('.');

              this.logger.debug('Found duplicate configuration key', {
                key,
                positions,
                path: normalizedPath
              }, this.logChannel);

              // Get object context for better error messages
              const objectType = this.determineObjectType(normalizedPath);

              // Report each duplicate instance
              positions.forEach((pos, i) => {
                const propNode = node.children?.[pos];
                if (propNode && propNode.type === 'property' && propNode.children && propNode.children.length > 0) {
                  const keyNode = propNode.children[0];
                  const startPos = this.getNodePositionInternal(keyNode.offset, rawText);
                  const endPos = this.getNodePositionInternal(keyNode.offset + keyNode.length, rawText);

                  const ordinalPosition = this.getOrdinalString(i + 1);

                  // Create error with enhanced information
                  const errorMessage = `Duplicate key '${key}' found (${ordinalPosition} occurrence) in ${objectType} at ${normalizedPath}`;
                  const errorPath = path.length > 0 ? [...path, key].join('.') : key;

                  errors.push({
                    code: 'DUPLICATE_CONFIGURATION_KEY',
                    message: errorMessage,
                    path: errorPath,
                    range: {
                      start: startPos,
                      end: endPos
                    }
                  });
                }
              });
            }
          }

          // Recursively process all child objects and array items
          node.children.forEach(child => {
            // For property nodes, we need to process the value (second child)
            if (child.type === 'property' && child.children && child.children.length > 1) {
              const keyNode = child.children[0];
              const valueNode = child.children[1];
              const propertyKey = keyNode.value as string;

              // Only recurse if the value is an object or array
              if (valueNode.type === 'object' || valueNode.type === 'array') {
                const newPath = [...path, propertyKey];
                findDuplicateKeys(valueNode, newPath);
              }
            }
            // For array nodes, process each item
            else if (child.type === 'array' && child.children) {
              child.children.forEach((item, index) => {
                const newPath = [...path, index.toString()];
                findDuplicateKeys(item, newPath);
              });
            }
          });
        }
        // Handle arrays - each item could be an object that needs checking
        else if (node.type === 'array' && node.children) {
          node.children.forEach((item, index) => {
            const newPath = [...path, index.toString()];
            findDuplicateKeys(item, newPath);
          });
        }
      };

      // Start the recursive check from the root node
      findDuplicateKeys(root);

      this.logger.debug('Duplicate configuration keys validation complete', {
        errorCount: errors.length,
        errorSummary: errors.map(err => ({
          message: err.message,
          path: err.path
        }))
      }, this.logChannel);
    } catch (error) {
      this.logger.error('Error in duplicate configuration keys validation', {
        error: error instanceof Error ? error.message : String(error)
      }, this.logChannel);
    }

    return errors;
  }

  /**
   * Finds a node in the JSON parse tree by path
   * @param root The root node of the JSON parse tree
   * @param path The path to the node as an array of string or number indices
   * @returns The node if found, undefined otherwise
   */
  private findNodeAtPathInternal(root: Node | undefined, path: (string | number)[]): Node | undefined {
    if (!root) {
      return undefined;
    }
    return findNodeAtLocation(root, path);
  }

  /**
   * Gets a position object (line, character) from an offset in the raw text
   * @param offset The character offset in the raw text
   * @param rawText The raw JSON text
   * @returns A position object with line and character properties
   */
  private getNodePositionInternal(offset: number, rawText?: string): { line: number; character: number } {
    if (!rawText) {
      return { line: 0, character: 0 };
    }

    let line = 0;
    let character = 0;
    for (let i = 0; i < offset && i < rawText.length; i++) {
      if (rawText[i] === '\n') {
        line++;
        character = 0;
      } else {
        character++;
      }
    }

    return { line, character };
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