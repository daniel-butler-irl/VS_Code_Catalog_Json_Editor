import { ValidationError } from '../../types/validation';
import { ValidationRuleConfig } from '../../types/validation/rules';
import { BaseValidationRule } from './BaseValidationRule';
import { parseTree, findNodeAtLocation, Node } from 'jsonc-parser';
import { LoggingService } from '../core/LoggingService';

/**
 * Rule to check for deprecated install_type usage in flavors with dependency_version_2 set to true.
 * 
 * This rule specifically checks if a flavor has both an install_type of "extension" 
 * and dependency_version_2 set to true, which is a deprecated pattern.
 * 
 * WHY THIS RULE IS NEEDED:
 * In IBM Cloud Catalog, the install_type property is deprecated for flavors that have
 * dependency_version_2 set to true. Using install_type="extension" in this case is redundant
 * and should be either removed or updated to "fullstack".
 * 
 * Example of what this rule catches:
 * ```json
 * {
 *   "flavors": [
 *     {
 *       "name": "basic",
 *       "install_type": "extension", // <- Deprecated when dependency_version_2 is true
 *       "dependency_version_2": true
 *     }
 *   ]
 * }
 * ```
 */
export class DeprecatedInstallTypeRule extends BaseValidationRule {
  private readonly logger = LoggingService.getInstance();
  private readonly logChannel = 'schemaValidation';

  constructor() {
    super(
      'deprecated_install_type',
      'Business Validator: Warns about deprecated install_type="extension" usage with dependency_version_2=true'
    );
  }

  /**
   * Override getNodePosition to use 0-based line numbers for VS Code compatibility
   */
  protected getNodePosition(nodeOrOffset: Node | number, rawText: string): { line: number; character: number } {
    let line = 0;
    let character = 0;
    let lastNewLine = -1;
    const offset = typeof nodeOrOffset === 'number' ? nodeOrOffset : nodeOrOffset.offset;

    // Find the position by counting newlines and characters
    for (let i = 0; i < offset; i++) {
      if (rawText[i] === '\n') {
        line++;
        lastNewLine = i;
      }
    }

    // Calculate the character offset from the last newline
    character = lastNewLine === -1 ? offset : offset - lastNewLine - 1;

    // Return 0-based line numbers for VS Code compatibility
    return { line, character };
  }

  async validate(value: unknown, config?: ValidationRuleConfig, rawText?: string): Promise<ValidationError[]> {
    // Defensive check for config and enabled flag
    if (!config) {
      config = { enabled: true };
    }

    if (config.enabled !== true) {
      return [];
    }

    if (typeof value !== 'object' || value === null) {
      return [];
    }

    const errors: ValidationError[] = [];

    // Parse the JSON tree if raw text is available
    const root = rawText ? parseTree(rawText) : null;

    // Traverse the catalog structure to find all flavors
    const obj = value as any;
    if (Array.isArray(obj.products)) {
      obj.products.forEach((product: any, productIndex: number) => {
        if (product && Array.isArray(product.flavors)) {
          product.flavors.forEach((flavor: any, flavorIndex: number) => {
            if (flavor &&
              flavor.install_type === "extension" &&
              flavor.dependency_version_2 === true) {

              // This is the deprecated pattern we're looking for
              const path = ['products', productIndex, 'flavors', flavorIndex, 'install_type'];
              const errorMessage = 'Deprecated: install_type="extension" is not needed for flavors with dependency_version_2=true. Consider removing it or updating to "fullstack".';

              // Default position
              let position = { line: 1, character: 0 };
              let endPosition = { line: 1, character: 20 };

              // Get position information if raw text is available
              if (root && rawText) {
                const flavorNode = findNodeAtLocation(root, ['products', productIndex, 'flavors', flavorIndex]);

                if (flavorNode) {
                  // Use the JSONC parser to locate the install_type property node directly
                  const installTypeNode = findNodeAtLocation(flavorNode, ['install_type']);

                  if (installTypeNode) {
                    // Get the precise position from the node
                    position = this.getNodePosition(installTypeNode.offset, rawText);
                    endPosition = {
                      line: position.line,
                      character: position.character + installTypeNode.length
                    };
                  } else {
                    // Fallback to the original approach if the node isn't found
                    const installTypeMatch = /"install_type"\s*:\s*"extension"/g;
                    const matches = [...rawText.matchAll(installTypeMatch)];

                    if (matches.length > 0) {
                      // Get the flavor's text bounds
                      const flavorStart = flavorNode.offset;
                      const flavorEnd = flavorStart + flavorNode.length;

                      // Find the match within the flavor's text bounds
                      for (const match of matches) {
                        if (match.index !== undefined &&
                          match.index >= flavorStart &&
                          match.index < flavorEnd) {

                          position = this.getNodePosition(match.index, rawText);
                          const matchText = match[0];
                          endPosition = {
                            line: position.line,
                            character: position.character + matchText.length
                          };
                          break;
                        }
                      }
                    }
                  }
                }
              }

              errors.push({
                code: 'DEPRECATED_INSTALL_TYPE',
                message: errorMessage,
                path: path.join('.'),
                severity: 'warning', // Set severity to warning to display in yellow
                range: {
                  start: position,
                  end: endPosition
                }
              });
            }
          });
        }
      });
    }

    // Only log when errors are found
    if (errors.length > 0) {
      this.logger.debug('Deprecated install_type validation found issues', {
        errorCount: errors.length,
        errorSummary: errors.map(err => ({
          message: err.message,
          path: err.path,
          severity: err.severity
        }))
      }, this.logChannel);
    }

    return errors;
  }
} 