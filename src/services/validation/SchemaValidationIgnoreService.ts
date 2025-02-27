import * as vscode from 'vscode';
import { LoggingService } from '../core/LoggingService';

/**
 * Interface to track both message pattern and path pattern for more targeted ignoring
 */
interface IgnorePattern {
  messagePattern: RegExp;
  pathPattern?: RegExp;  // Optional path pattern to make ignoring more targeted
  description: string;   // Description for better logging
}

/**
 * Service for managing schema validation error ignores
 * This is controlled by the extension developer, not the user
 */
export class SchemaValidationIgnoreService {
  private static instance: SchemaValidationIgnoreService;
  private readonly logger = LoggingService.getInstance();
  private readonly logChannel = 'schemaValidation';

  // List of schema validation error patterns to ignore
  private ignorePatterns: IgnorePattern[] = [
    // Ignore install_type required errors only in products.flavors section
    {
      messagePattern: /must have required property 'install_type'/,
      // Make path pattern more flexible to match various path formats
      // This will match any path that contains products and flavors in the right order
      pathPattern: /\.products\[\d+\]\.flavors\[\d+\]/,
      description: 'Missing install_type in products.flavors'
    },
    {
      messagePattern: /must have required property 'controls'/,
      // Updated to match both path formats (slash and dot notation)
      // The compliance path doesn't have an array index
      pathPattern: /(\.products\[\d+\]\.flavors\[\d+\]\.compliance|\/products\/\d+\/flavors\/\d+\/compliance)/,
      description: 'Missing controls property in products.flavors.compliance'
    }
    // Other patterns remain commented out

    /* HOW TO ADD NEW IGNORE PATTERNS:
     * 
     * 1. Check the debug logs for validation errors you want to ignore
     *    - Look for "All validation errors before filtering" entries
     *    - For each error, note the exact message and path format
     * 
     * 2. Create a new IgnorePattern object with:
     *    - messagePattern: RegExp matching the exact error message
     *    - pathPattern: RegExp matching the path to target specific locations
     *    - description: Clear description of what's being ignored
     * 
     * 3. Examples of different path formats that might appear in logs:
     *    - Dot notation: "$.products[0].flavors[0]"
     *    - Slash notation: "$/products/0/flavors/0"
     *    - Make your regex flexible enough to handle both formats
     * 
     * 4. For duplicate key errors, look for "Duplicate key details for ignore pattern creation"
     *    logs that include the formatted path and other helpful information
     */

    // {
    //   messagePattern: /must have required property 'authority'/,
    //   description: 'Missing authority property'
    // },
  ];

  // Map to track ignored errors for logging and debugging
  private ignoredErrorsMap: Map<string, number> = new Map();

  private constructor() { }

  public static getInstance(): SchemaValidationIgnoreService {
    if (!SchemaValidationIgnoreService.instance) {
      SchemaValidationIgnoreService.instance = new SchemaValidationIgnoreService();
    }
    return SchemaValidationIgnoreService.instance;
  }

  /**
   * Checks if a validation error should be ignored
   * @param errorMessage The validation error message
   * @param path The JSON path where the error occurred
   * @returns True if the error should be ignored
   */
  public shouldIgnoreError(errorMessage: string, path?: string): boolean {
    // Enhanced debug logging to understand exactly what's being matched
    this.logger.debug('Checking if error should be ignored', {
      message: errorMessage,
      path: path || 'undefined',
      patternsCount: this.ignorePatterns.length
    }, this.logChannel);

    // Special handling for install_type required property errors
    if (errorMessage.includes("must have required property 'install_type'")) {
      // Extract information about the path to determine if it's in a flavor
      const isInFlavorContext = this.isErrorInFlavorContext(path);

      if (isInFlavorContext) {
        this.logger.debug('Ignoring install_type error in flavor context', {
          message: errorMessage,
          path: path || 'undefined',
          inFlavorContext: isInFlavorContext
        }, this.logChannel);
        return true;
      }
    }

    // Check each ignore pattern
    const matchingPattern = this.ignorePatterns.find(pattern => {
      // Message must match
      const messageMatches = pattern.messagePattern.test(errorMessage);

      // Path matching logic
      let pathMatches = true;
      if (pattern.pathPattern && path) {
        pathMatches = pattern.pathPattern.test(path);

        // Log path matching results
        this.logger.debug('Path matching details', {
          messageMatches,
          pathMatches,
          path,
          pathPattern: pattern.pathPattern.toString(),
          description: pattern.description
        }, this.logChannel);
      } else if (pattern.pathPattern && !path) {
        pathMatches = false;
      }

      return messageMatches && pathMatches;
    });

    const shouldIgnore = !!matchingPattern;

    // Track ignored errors for debugging
    if (shouldIgnore) {
      const errorKey = `${errorMessage}${path ? ` at ${path}` : ''}`;
      const count = this.ignoredErrorsMap.get(errorKey) || 0;
      this.ignoredErrorsMap.set(errorKey, count + 1);

      // Log the ignored error for debugging
      this.logger.debug('Ignoring validation error', {
        message: errorMessage,
        path,
        pattern: matchingPattern?.description,
        count: count + 1
      }, this.logChannel);
    }

    return shouldIgnore;
  }

  /**
   * Determines if an error is in the context of a flavor object
   * This helps with more accurate filtering of install_type errors
   */
  private isErrorInFlavorContext(path?: string): boolean {
    if (!path) {
      return false;
    }

    // Check if the path includes products and flavors in the right order
    // Support both formats: products[0].flavors[0] and $/products/0/flavors/0
    const bracketFormatMatch = /products\[\d+\]\.flavors\[\d+\]/.test(path);
    const slashFormatMatch = /\$?\/products\/\d+\/flavors\/\d+/.test(path);
    const isInFlavorPath = bracketFormatMatch || slashFormatMatch;

    this.logger.debug('Checking if error is in flavor context', {
      path,
      bracketFormatMatch,
      slashFormatMatch,
      isInFlavorPath
    }, this.logChannel);

    return isInFlavorPath;
  }

  /**
   * Gets a summary of ignored errors for debugging
   * @returns A map of error messages to counts
   */
  public getIgnoredErrorsSummary(): Map<string, number> {
    return new Map(this.ignoredErrorsMap);
  }

  /**
   * Resets the ignored errors tracking
   */
  public resetIgnoredErrorsTracking(): void {
    this.ignoredErrorsMap.clear();
  }

  /**
   * Adds a pattern to the ignore list
   * @param pattern IgnorePattern to add
   */
  public addIgnorePattern(pattern: IgnorePattern): void {
    this.ignorePatterns.push(pattern);
    this.logger.debug('Added ignore pattern', {
      messagePattern: pattern.messagePattern.toString(),
      pathPattern: pattern.pathPattern?.toString(),
      description: pattern.description
    }, this.logChannel);
  }

  /**
   * Clears all ignore patterns
   */
  public clearIgnorePatterns(): void {
    this.ignorePatterns = [];
    this.logger.debug('Cleared all ignore patterns', undefined, this.logChannel);
  }

  /**
   * Sets the ignore patterns, replacing any existing ones
   * @param patterns Array of IgnorePattern to use
   */
  public setIgnorePatterns(patterns: IgnorePattern[]): void {
    this.ignorePatterns = [...patterns];
    this.logger.debug('Set ignore patterns', {
      patterns: patterns.map(p => ({
        messagePattern: p.messagePattern.toString(),
        pathPattern: p.pathPattern?.toString(),
        description: p.description
      }))
    }, this.logChannel);
  }

  /**
   * Filters out ignored validation errors
   * @param errors Array of validation errors
   * @returns Filtered array with ignored errors removed
   */
  public filterIgnoredErrors<T extends { message: string; path?: string }>(errors: T[]): T[] {
    const originalCount = errors.length;

    // Log all errors before filtering for debugging
    this.logger.debug('All validation errors before filtering', {
      errorCount: errors.length,
      errors: errors.map(e => ({
        message: e.message,
        path: e.path || 'undefined'
      }))
    }, this.logChannel);

    // For install_type errors specifically, print extra debugging
    const installTypeErrors = errors.filter(e => e.message.includes('install_type'));
    if (installTypeErrors.length > 0) {
      this.logger.debug('Found install_type errors', {
        count: installTypeErrors.length,
        errors: installTypeErrors.map(e => ({
          message: e.message,
          path: e.path || 'undefined'
        }))
      }, this.logChannel);
    }

    const filteredErrors = errors.filter(error => {
      const shouldBeIgnored = this.shouldIgnoreError(error.message, error.path);
      if (error.message.includes('install_type')) {
        this.logger.debug(`Decision for install_type error: ${shouldBeIgnored ? 'IGNORED' : 'KEPT'}`, {
          message: error.message,
          path: error.path || 'undefined'
        }, this.logChannel);
      }
      return !shouldBeIgnored;
    });

    const ignoredCount = originalCount - filteredErrors.length;

    if (ignoredCount > 0) {
      this.logger.debug('Filtered validation errors', {
        originalCount,
        filteredCount: filteredErrors.length,
        ignoredCount,
        ignoredErrors: errors
          .filter(error => this.shouldIgnoreError(error.message, error.path))
          .map(e => ({
            message: e.message,
            path: e.path
          }))
      }, this.logChannel);
    }

    return filteredErrors;
  }
} 