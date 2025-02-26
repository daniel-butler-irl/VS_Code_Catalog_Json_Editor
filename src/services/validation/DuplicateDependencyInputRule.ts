import { ValidationError } from '../../types/validation';
import { ValidationRuleConfig } from '../../types/validation/rules';
import { BaseValidationRule } from './BaseValidationRule';
import { parseTree, findNodeAtLocation, Node } from 'jsonc-parser';
import { LoggingService } from '../core/LoggingService';

/**
 * Rule to check for duplicate dependency input mappings in dependencies.
 * 
 * This rule detects when the same dependency_input is mapped multiple times within the
 * input_mapping arrays of dependencies, which can cause conflicts in input mapping.
 * 
 * Examples of duplicates:
 * [
 *  {
 *    "input_mapping": [
 *      {
 *        "dependency_input": "region",
 *        "version_input": "prefix"
 *      }
 *    ]
 *  },
 *  {
 *    "input_mapping": [
 *      {
 *        "dependency_input": "region",
 *        "version_input": "region"
 *      }
 *    ]
 *  }
 * ]
 * 
 * WHY THIS RULE IS NEEDED:
 * When the same dependency_input is mapped multiple times across different dependencies,
 * it creates ambiguity about which mapping should be used, potentially causing deployment issues.
 */
export class DuplicateDependencyInputRule extends BaseValidationRule {
  private readonly logger = LoggingService.getInstance();
  private readonly logChannel = 'schemaValidation';

  constructor() {
    super(
      'duplicate_dependency_input',
      'Business Validator: Checks for duplicate dependency_input mappings within input_mapping arrays'
    );
  }

  async validate(value: unknown, config?: ValidationRuleConfig, rawText?: string): Promise<ValidationError[]> {
    // Defensive check for config and enabled flag
    if (!config) {
      this.logger.debug('No configuration provided for DuplicateDependencyInputRule, using default enabled=true', {
        ruleId: this.id
      }, this.logChannel);
      config = { enabled: true };
    }

    this.logger.debug('DuplicateDependencyInputRule validation requested', {
      ruleId: this.id,
      configProvided: !!config,
      enabled: config?.enabled === true,
      config
    }, this.logChannel);

    if (config.enabled !== true) {
      this.logger.debug('DuplicateDependencyInputRule is disabled, skipping validation', {
        config
      }, this.logChannel);
      return [];
    }

    if (typeof value !== 'object' || value === null) {
      this.logger.debug('Invalid value type for DuplicateDependencyInputRule, skipping validation', {
        valueType: typeof value,
        isNull: value === null
      }, this.logChannel);
      return [];
    }

    this.logger.debug('Validating duplicate dependency inputs', {
      enabled: config.enabled,
      hasRawText: !!rawText,
      valueType: typeof value
    }, this.logChannel);

    const errors: ValidationError[] = [];

    // Parse the JSON tree if raw text is available
    const root = rawText ? parseTree(rawText) : null;

    // Check each product's dependencies section
    const obj = value as any;
    if (Array.isArray(obj.products)) {
      obj.products.forEach((product: any, productIndex: number) => {
        if (product) {
          // Check for top-level dependencies
          if (Array.isArray(product.dependencies)) {
            this.checkDependencies(
              product.dependencies,
              ['products', productIndex, 'dependencies'],
              errors,
              root,
              rawText
            );
          }

          // Also check at the flavor level if needed
          if (Array.isArray(product.flavors)) {
            product.flavors.forEach((flavor: any, flavorIndex: number) => {
              if (flavor && Array.isArray(flavor.dependencies)) {
                this.checkDependencies(
                  flavor.dependencies,
                  ['products', productIndex, 'flavors', flavorIndex, 'dependencies'],
                  errors,
                  root,
                  rawText
                );
              }
            });
          }
        }
      });
    }

    this.logger.debug('Duplicate dependency input validation complete', {
      errorCount: errors.length,
      errorSummary: errors.map(err => ({
        message: err.message,
        path: err.path
      }))
    }, this.logChannel);

    return errors;
  }

  /**
   * Checks an array of dependencies for duplicate dependency_input values
   * in their input_mapping arrays
   */
  private checkDependencies(
    dependencies: any[],
    basePath: (string | number)[],
    errors: ValidationError[],
    root: Node | null | undefined,
    rawText?: string
  ): void {
    // Map to track dependency_input values and their occurrences across input_mappings
    interface DependencyInputOccurrence {
      depIndex: number;
      mappingIndex: number;
      path: (string | number)[];
      node?: Node;
    }

    const seenInputs = new Map<string, DependencyInputOccurrence[]>();

    // Process each dependency in the array
    for (let depIndex = 0; depIndex < dependencies.length; depIndex++) {
      const dependency = dependencies[depIndex];

      if (!dependency || typeof dependency !== 'object') {
        continue; // Skip non-object dependencies
      }

      // Check for input_mapping array
      if (Array.isArray(dependency.input_mapping)) {
        const inputMappingPath = [...basePath, depIndex, 'input_mapping'];

        this.logger.debug('Checking input_mapping array', {
          dependencyIndex: depIndex,
          inputMappingCount: dependency.input_mapping.length,
          path: inputMappingPath.join('.')
        }, this.logChannel);

        // Process each mapping in the input_mapping array
        for (let mappingIndex = 0; mappingIndex < dependency.input_mapping.length; mappingIndex++) {
          const mapping = dependency.input_mapping[mappingIndex];

          if (mapping && typeof mapping === 'object' && mapping.dependency_input) {
            const depInput = mapping.dependency_input;

            if (typeof depInput !== 'string') {
              continue; // Skip non-string dependency_input values
            }

            // Find the node for this mapping
            let depInputNode: Node | undefined;
            if (root) {
              const mappingPath = [...inputMappingPath, mappingIndex];
              const mappingNode = this.findNodeAtPathInternal(root, mappingPath);

              if (mappingNode) {
                // Find the dependency_input property
                const propNode = this.findPropertyNodeInternal(mappingNode, 'dependency_input');
                if (propNode?.children && propNode.children.length > 1) {
                  depInputNode = propNode.children[1]; // Get the value node
                }
              }
            }

            // Record this occurrence
            const fullPath = [...inputMappingPath, mappingIndex, 'dependency_input'];
            const occurrences = seenInputs.get(depInput) || [];
            occurrences.push({
              depIndex,
              mappingIndex,
              path: fullPath,
              node: depInputNode
            });
            seenInputs.set(depInput, occurrences);

            this.logger.debug('Found dependency_input in mapping', {
              depInput,
              depIndex,
              mappingIndex,
              occurrences: occurrences.length
            }, this.logChannel);
          }
        }
      }
    }

    // Report duplicates
    for (const [depInput, occurrences] of seenInputs.entries()) {
      if (occurrences.length > 1) {
        this.logger.debug('Found duplicate dependency_input across input_mappings', {
          depInput,
          occurrenceCount: occurrences.length,
          locations: occurrences.map(o => `${o.depIndex}:${o.mappingIndex}`)
        }, this.logChannel);

        // Create error for each occurrence
        occurrences.forEach((occurrence, idx) => {
          // Format the error location details
          const otherLocations = occurrences
            .filter((_, i) => i !== idx)
            .map(o => `dependency[${o.depIndex}].input_mapping[${o.mappingIndex}]`)
            .join(', ');

          const errorPath = occurrence.path.join('.');
          const errorMessage = `Duplicate dependency_input '${depInput}' found. Also appears in: ${otherLocations}`;

          if (occurrence.node && rawText) {
            // Get position from node
            const position = this.getNodePositionInternal(occurrence.node.offset, rawText);

            errors.push({
              code: 'DUPLICATE_DEPENDENCY_INPUT',
              message: errorMessage,
              path: errorPath,
              range: {
                start: position,
                end: {
                  line: position.line,
                  character: position.character + depInput.length
                }
              }
            });
          } else if (rawText) {
            // Fall back to text search
            const pattern = new RegExp(`"dependency_input"\\s*:\\s*"${depInput}"`, 'g');
            let matchIndex = 0;
            let match;

            while ((match = pattern.exec(rawText)) !== null) {
              if (matchIndex === idx) {
                const matchStart = match.index + match[0].indexOf(depInput);
                const position = this.getNodePositionInternal(matchStart, rawText);

                errors.push({
                  code: 'DUPLICATE_DEPENDENCY_INPUT',
                  message: errorMessage,
                  path: errorPath,
                  range: {
                    start: position,
                    end: {
                      line: position.line,
                      character: position.character + depInput.length
                    }
                  }
                });
                break;
              }
              matchIndex++;
            }
          } else {
            // No position information
            errors.push({
              code: 'DUPLICATE_DEPENDENCY_INPUT',
              message: errorMessage,
              path: errorPath
            });
          }
        });
      }
    }
  }

  /**
   * Gets a position object (line, character) from a node or offset in the raw text
   */
  private getNodePositionInternal(offsetOrNode: number | Node, rawText: string): { line: number; character: number } {
    const offset = typeof offsetOrNode === 'number' ? offsetOrNode : offsetOrNode.offset;
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
   * Finds a node in the JSON parse tree by path
   */
  private findNodeAtPathInternal(root: Node, path: (string | number)[]): Node | undefined {
    return findNodeAtLocation(root, path);
  }

  /**
   * Finds a property node by name within a parent node
   */
  private findPropertyNodeInternal(node: Node, propertyName: string): Node | undefined {
    if (!node.children) {
      return undefined;
    }

    for (const child of node.children) {
      if (
        child.type === 'property' &&
        child.children &&
        child.children.length > 0 &&
        child.children[0].value === propertyName
      ) {
        return child;
      }
    }

    return undefined;
  }
} 