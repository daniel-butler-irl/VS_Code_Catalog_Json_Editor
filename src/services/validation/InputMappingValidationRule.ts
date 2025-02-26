import { ValidationError } from '../../types/validation';
import { ValidationRuleConfig } from '../../types/validation/rules';
import { BaseValidationRule } from './BaseValidationRule';
import { parseTree, findNodeAtLocation, Node } from 'jsonc-parser';
import { LoggingService } from '../core/LoggingService';

/**
 * Rule to validate input mappings, including field names and value types.
 * 
 * This rule performs multiple validations on input mappings:
 * 1. Detects misspelled field names (e.g., "dependencey_input" instead of "dependency_input")
 * 2. Identifies completely invalid field names not in the allowed set
 * 3. Validates that fields have the correct type:
 *    - dependency_input, dependency_output, version_input must be strings
 *    - reference_version must be a boolean
 *    - value can be any type
 * 
 * Example of issues this rule can detect:
 * {
 *   "dependencey_input": "region", // Misspelled field name
 *   "version_input": 42,           // Wrong type (should be string)
 *   "unknown_field": true          // Invalid field name
 * }
 * 
 * Valid input mapping fields are:
 * - dependency_input (string value only)
 * - dependency_output (string value only)
 * - version_input (string value only)
 * - value (any type)
 * - reference_version (boolean value only)
 * 
 * WHY THIS RULE IS NEEDED:
 * Invalid input mappings will not be caught by schema validation and can cause 
 * silent failures in the deployment process, leading to difficult-to-diagnose issues.
 */
export class InputMappingValidationRule extends BaseValidationRule {
  private readonly logger = LoggingService.getInstance();
  private readonly logChannel = 'schemaValidation';

  // Valid mapping fields
  private readonly validFields = new Set([
    'dependency_input',
    'dependency_output',
    'version_input',
    'value',
    'reference_version'
  ]);

  // Fields that must be strings
  private readonly stringFields = new Set([
    'dependency_input',
    'dependency_output',
    'version_input'
  ]);

  // Fields that must be booleans
  private readonly booleanFields = new Set([
    'reference_version'
  ]);

  // Common misspellings to detect and their corrections
  private readonly knownMisspellings: Record<string, string> = {
    'dependencey_input': 'dependency_input',
    'dependancy_input': 'dependency_input',
    'dependecy_input': 'dependency_input',
    'dependecny_input': 'dependency_input',
    'dependency_inputs': 'dependency_input',
    'dependencey_output': 'dependency_output',
    'dependancy_output': 'dependency_output',
    'dependecy_output': 'dependency_output',
    'dependecny_output': 'dependency_output',
    'dependency_outputs': 'dependency_output',
    'version_inputs': 'version_input',
  };

  constructor() {
    super(
      'input_mapping_validation',
      'Business Validator: Validates input_mapping field names and value types'
    );
  }

  /**
   * Validates the input value for misspelled input mapping fields.
   * @param value The value to validate.
   * @param config The validation rule configuration.
   * @param rawText The raw JSON text if available.
   * @returns An array of validation errors.
   */
  async validate(value: unknown, config?: ValidationRuleConfig, rawText?: string): Promise<ValidationError[]> {
    if (!config?.enabled) {
      return [];
    }

    const errors: ValidationError[] = [];

    try {
      if (typeof value !== 'object' || value === null) {
        return [];
      }

      let root: Node | null | undefined;
      if (rawText) {
        root = parseTree(rawText);
      }

      // Check all paths where input_mapping arrays might be found
      if ('products' in value && Array.isArray((value as any).products)) {
        // Check products.dependencies
        for (let prodIndex = 0; prodIndex < (value as any).products.length; prodIndex++) {
          const product = (value as any).products[prodIndex];
          if (!product || typeof product !== 'object') { continue; }

          // Check direct dependencies
          if ('dependencies' in product && Array.isArray(product.dependencies)) {
            this.checkDependencies(
              product.dependencies,
              ['products', prodIndex, 'dependencies'],
              errors,
              root,
              rawText
            );
          }

          // Check flavor dependencies
          if ('flavors' in product && Array.isArray(product.flavors)) {
            for (let flavorIndex = 0; flavorIndex < product.flavors.length; flavorIndex++) {
              const flavor = product.flavors[flavorIndex];
              if (!flavor || typeof flavor !== 'object') { continue; }

              if ('dependencies' in flavor && Array.isArray(flavor.dependencies)) {
                this.checkDependencies(
                  flavor.dependencies,
                  ['products', prodIndex, 'flavors', flavorIndex, 'dependencies'],
                  errors,
                  root,
                  rawText
                );
              }
            }
          }
        }
      }

      // Also check for direct input_mapping array (for partial validation)
      if ('input_mapping' in value && Array.isArray((value as any).input_mapping)) {
        this.checkInputMappings(
          (value as any).input_mapping,
          ['input_mapping'],
          errors,
          root,
          rawText
        );
      }

      return errors;
    } catch (error) {
      this.logger.error('Error validating misspelled input mapping fields', {
        error: error instanceof Error ? error.message : String(error)
      }, this.logChannel);
      return [];
    }
  }

  /**
   * Checks dependencies for misspelled input mapping fields
   */
  private checkDependencies(
    dependencies: any[],
    basePath: (string | number)[],
    errors: ValidationError[],
    root: Node | null | undefined,
    rawText?: string
  ): void {
    // Process each dependency in the array
    for (let depIndex = 0; depIndex < dependencies.length; depIndex++) {
      const dependency = dependencies[depIndex];

      if (!dependency || typeof dependency !== 'object') {
        continue; // Skip non-object dependencies
      }

      // Check for input_mapping array
      if (Array.isArray(dependency.input_mapping)) {
        const inputMappingPath = [...basePath, depIndex, 'input_mapping'];

        this.checkInputMappings(
          dependency.input_mapping,
          inputMappingPath,
          errors,
          root,
          rawText
        );
      }
    }
  }

  /**
   * Checks input mappings for misspelled field names
   */
  private checkInputMappings(
    mappings: any[],
    basePath: (string | number)[],
    errors: ValidationError[],
    root: Node | null | undefined,
    rawText?: string
  ): void {
    // Process each mapping in the input_mapping array
    for (let mappingIndex = 0; mappingIndex < mappings.length; mappingIndex++) {
      const mapping = mappings[mappingIndex];

      if (!mapping || typeof mapping !== 'object') {
        continue; // Skip non-object mappings
      }

      const mappingPath = [...basePath, mappingIndex];
      const mappingNode = root ? this.findNodeAtPathInternal(root, mappingPath) : undefined;

      // Check each property in the mapping object
      if (mappingNode?.children) {
        for (const child of mappingNode.children) {
          if (child.type === 'property' && child.children && child.children.length >= 2) {
            const keyNode = child.children[0];
            const valueNode = child.children[1];
            const fieldName = keyNode.value as string;

            // Validate field name (this handles invalid/misspelled fields)
            this.validateFieldName(fieldName, mappingPath, keyNode.offset, errors, rawText);

            // Only validate value types for valid fields
            if (this.validFields.has(fieldName)) {
              this.validateFieldValue(
                fieldName,
                valueNode.value,
                valueNode.type,
                mappingPath,
                valueNode.offset,
                errors,
                rawText
              );
            }
          }
        }
      } else {
        // Without a parsed node, we'll do a simpler check on the object properties
        for (const fieldName of Object.keys(mapping)) {
          // Validate field name (this handles invalid/misspelled fields)
          this.validateFieldName(fieldName, mappingPath, -1, errors);

          // Only validate value types for valid fields
          if (this.validFields.has(fieldName)) {
            const fieldValue = mapping[fieldName];
            this.validateFieldValue(
              fieldName,
              fieldValue,
              undefined, // We don't have the type from jsonc-parser here
              mappingPath,
              -1,
              errors
            );
          }
        }
      }
    }
  }

  /**
   * Validates a field name against known valid fields
   */
  private validateFieldName(
    fieldName: string,
    mappingPath: (string | number)[],
    offset: number,
    errors: ValidationError[],
    rawText?: string
  ): void {
    // Skip valid field names
    if (this.validFields.has(fieldName)) {
      return;
    }

    // Check for known misspellings
    const correction = this.knownMisspellings[fieldName];
    if (correction) {
      const position = offset >= 0 && rawText ? this.getNodePosition(offset, rawText) : undefined;
      errors.push({
        code: 'MISSPELLED_INPUT_MAPPING_FIELD',
        message: `"${fieldName}" appears to be a misspelling of "${correction}"`,
        path: [...mappingPath, fieldName].join('.'),
        ...(position && {
          range: {
            start: position,
            end: {
              line: position.line,
              character: position.character + fieldName.length + 2 // +2 for quotes
            }
          }
        })
      });
      return; // Return early to avoid adding duplicate errors
    }

    // Check for similar field names (potential misspellings)
    const closestMatch = this.findClosestMatch(fieldName);
    const similarity = closestMatch ? this.calculateSimilarity(fieldName, closestMatch) : 0;

    if (similarity > 0.5) {
      // It's a likely misspelling (above threshold)
      const position = offset >= 0 && rawText ? this.getNodePosition(offset, rawText) : undefined;
      errors.push({
        code: 'UNKNOWN_INPUT_MAPPING_FIELD',
        message: `Unknown field "${fieldName}". Did you mean "${closestMatch}"?`,
        path: [...mappingPath, fieldName].join('.'),
        ...(position && {
          range: {
            start: position,
            end: {
              line: position.line,
              character: position.character + fieldName.length + 2 // +2 for quotes
            }
          }
        })
      });
    } else {
      // It's a completely invalid field
      const position = offset >= 0 && rawText ? this.getNodePosition(offset, rawText) : undefined;
      errors.push({
        code: 'INVALID_INPUT_MAPPING_FIELD',
        message: `Invalid field "${fieldName}". Valid fields are: ${Array.from(this.validFields).join(', ')}`,
        path: [...mappingPath, fieldName].join('.'),
        ...(position && {
          range: {
            start: position,
            end: {
              line: position.line,
              character: position.character + fieldName.length + 2 // +2 for quotes
            }
          }
        })
      });
    }
  }

  /**
   * Finds node at a specific path in the JSON AST
   * Helper method to make TypeScript happy with handling null
   */
  private findNodeAtPathInternal(root: Node | null | undefined, path: (string | number)[]): Node | undefined {
    if (!root) {
      return undefined;
    }

    return findNodeAtLocation(root, path);
  }

  /**
   * Finds a property node by name in a given parent node
   */
  private findPropertyNodeInternal(node: Node, propertyName: string): Node | undefined {
    if (!node.children) {
      return undefined;
    }

    // Find the property node
    return node.children.find(child =>
      child.type === 'property' &&
      child.children?.[0]?.value === propertyName
    );
  }

  /**
   * Converts a character offset into a Position object
   */
  protected getNodePosition(offset: number, text: string): { line: number; character: number } {
    if (offset < 0 || offset >= text.length) {
      return { line: 0, character: 0 };
    }

    const lines = text.substring(0, offset).split('\n');
    const line = lines.length - 1;
    const character = lines[line].length;

    return { line, character };
  }

  /**
   * Finds the closest match for a given string from the set of valid fields
   */
  private findClosestMatch(input: string): string | undefined {
    let bestMatch: string | undefined;
    let highestSimilarity = 0;

    for (const validField of this.validFields) {
      const similarity = this.calculateSimilarity(input, validField);
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = validField;
      }
    }

    return bestMatch;
  }

  /**
   * Calculates a simple similarity score between two strings
   * Returns a value between 0 (no similarity) and 1 (identical)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    // Levenshtein distance implementation
    const len1 = str1.length;
    const len2 = str2.length;

    // Quick check for trivial cases
    if (len1 === 0) { return len2 === 0 ? 1 : 0; }
    if (len2 === 0) { return 0; }
    if (str1 === str2) { return 1; }

    // Create matrix
    const matrix: number[][] = [];
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + cost  // substitution
        );
      }
    }

    // Calculate similarity from distance
    const maxLen = Math.max(len1, len2);
    const distance = matrix[len1][len2];
    return 1 - distance / maxLen;
  }

  /**
   * Validates the value type for a field in the input mapping
   */
  private validateFieldValue(
    fieldName: string,
    value: any,
    nodeType: string | undefined,
    mappingPath: (string | number)[],
    offset: number,
    errors: ValidationError[],
    rawText?: string
  ): void {
    // Check string type fields
    if (this.stringFields.has(fieldName)) {
      const isString = typeof value === 'string' || (nodeType === 'string');

      if (!isString) {
        const position = offset >= 0 && rawText ? this.getNodePosition(offset, rawText) : undefined;
        errors.push({
          code: 'INVALID_INPUT_MAPPING_VALUE_TYPE',
          message: `Field "${fieldName}" must have a string value, found ${typeof value}`,
          path: [...mappingPath, fieldName].join('.'),
          ...(position && {
            range: {
              start: position,
              end: {
                line: position.line,
                character: position.character + (value ? String(value).length : 0) + 2 // +2 for quotes or delimiters
              }
            }
          })
        });
      }
    }

    // Check boolean type fields
    if (this.booleanFields.has(fieldName)) {
      const isBoolean = typeof value === 'boolean' || (nodeType === 'boolean');

      if (!isBoolean) {
        const position = offset >= 0 && rawText ? this.getNodePosition(offset, rawText) : undefined;
        errors.push({
          code: 'INVALID_INPUT_MAPPING_VALUE_TYPE',
          message: `Field "${fieldName}" must have a boolean value, found ${typeof value}`,
          path: [...mappingPath, fieldName].join('.'),
          ...(position && {
            range: {
              start: position,
              end: {
                line: position.line,
                character: position.character + (value ? String(value).length : 0) + 2 // +2 for quotes or delimiters
              }
            }
          })
        });
      }
    }
  }
} 