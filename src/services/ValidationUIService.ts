import * as vscode from 'vscode';
import { LoggingService } from './core/LoggingService';
import { parseTree, findNodeAtLocation } from 'jsonc-parser';
import { LogChannel } from './core/LoggingService';
import { SchemaService } from './SchemaService';
import { ValidationRuleRegistry } from './validation/ValidationRuleRegistry';

/**
 * Service for managing validation UI feedback including diagnostics and decorations
 */
export class ValidationUIService {
  private static instance: ValidationUIService;
  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private readonly logger = LoggingService.getInstance();
  private readonly errorDecorationType: vscode.TextEditorDecorationType;
  private readonly warningDecorationType: vscode.TextEditorDecorationType;
  private readonly logChannel: LogChannel = 'schemaValidation';

  private constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('ibm-catalog-validation');

    // Create decoration types for errors and warnings with more subtle styling
    this.errorDecorationType = vscode.window.createTextEditorDecorationType({
      borderWidth: '0 0 2px 0',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('errorForeground'),
      light: {
        borderColor: new vscode.ThemeColor('errorForeground')
      },
      dark: {
        borderColor: new vscode.ThemeColor('errorForeground')
      },
      overviewRulerColor: new vscode.ThemeColor('errorForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: false,
      after: {
        margin: '0 0 0 1em',
        contentText: '⚠️',
        color: new vscode.ThemeColor('errorForeground')
      }
    });

    this.warningDecorationType = vscode.window.createTextEditorDecorationType({
      borderWidth: '0 0 2px 0',
      borderStyle: 'dotted',
      borderColor: new vscode.ThemeColor('editorWarning.foreground'),
      light: {
        borderColor: new vscode.ThemeColor('editorWarning.foreground')
      },
      dark: {
        borderColor: new vscode.ThemeColor('editorWarning.foreground')
      },
      overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: false,
      after: {
        margin: '0 0 0 1em',
        contentText: '⚠️',
        color: new vscode.ThemeColor('editorWarning.foreground')
      }
    });
  }

  public static getInstance(): ValidationUIService {
    if (!ValidationUIService.instance) {
      ValidationUIService.instance = new ValidationUIService();
    }
    return ValidationUIService.instance;
  }

  /**
   * Updates validation UI feedback for a document
   * @param document The document to update validation for
   * @param errors Array of validation errors
   */
  public updateValidation(document: vscode.TextDocument, errors: Array<{ message: string; range: vscode.Range; severity: vscode.DiagnosticSeverity }>): void {
    try {
      const diagnostics: vscode.Diagnostic[] = [];
      const text = document.getText();
      const root = parseTree(text);

      this.logger.debug('Updating validation UI with errors', {
        documentUri: document.uri.toString(),
        errorCount: errors.length,
        errors: errors.map(e => ({
          message: e.message,
          line: e.range.start.line,
          character: e.range.start.character
        }))
      }, this.logChannel);

      for (const error of errors) {
        let range = error.range;

        // If range is at position 0,0, try to find a better position
        if (range.start.line === 0 && range.start.character === 0 && range.end.line === 0 && range.end.character === 0) {
          // Extract path from error message if possible
          let pathParts: string[] = [];

          // Try to extract path from error message formats like "$.products[0].flavors[0]" or "products[0].flavors[0]"
          const pathMatch = error.message.match(/(\$\.|^)([a-zA-Z0-9_\[\]\.]+)(?=:|\s|$)/);
          if (pathMatch) {
            const path = pathMatch[2];
            pathParts = path.split('.').map(part => {
              // Handle array indices like products[0]
              const indexMatch = part.match(/^([a-zA-Z0-9_]+)\[(\d+)\]$/);
              if (indexMatch) {
                return [indexMatch[1], indexMatch[2]];
              }
              return part;
            }).flat();
          } else {
            // Default path extraction from message
            pathParts = error.message.split(':')[0].split('.');
            if (pathParts[0] === '$') {
              pathParts.shift();
            }
          }

          this.logger.debug('Trying to find node location', {
            message: error.message,
            extractedPath: pathParts
          }, this.logChannel);

          if (root && pathParts.length > 0) {
            const node = findNodeAtLocation(root, pathParts);
            if (node) {
              const startPos = document.positionAt(node.offset);
              const endPos = document.positionAt(node.offset + node.length);
              range = new vscode.Range(startPos, endPos);

              this.logger.debug('Found node location', {
                path: pathParts.join('.'),
                startLine: startPos.line,
                startChar: startPos.character,
                endLine: endPos.line,
                endChar: endPos.character
              }, this.logChannel);
            } else {
              this.logger.debug('Could not find node at location', {
                path: pathParts.join('.')
              }, this.logChannel);
            }
          }
        }

        // Special handling for duplicate key errors
        if (error.message.includes('DUPLICATE_CONFIG_KEY') || error.message.includes('Duplicate key')) {
          // These errors already have proper ranges from the NoDuplicateConfigKeysRule
          this.logger.debug('Processing duplicate key error', {
            message: error.message,
            range: `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`
          }, this.logChannel);
        }

        const diagnostic = new vscode.Diagnostic(
          range,
          error.message,
          error.severity
        );
        diagnostic.source = 'ibm-catalog-validation';
        diagnostics.push(diagnostic);
      }

      this.diagnosticCollection.set(document.uri, diagnostics);
      this.logger.debug('Updated validation UI', {
        documentUri: document.uri.toString(),
        errorCount: diagnostics.length
      }, this.logChannel);

      // Update decorations in visible editors
      vscode.window.visibleTextEditors
        .filter(editor => editor.document === document)
        .forEach(editor => this.updateDecorations(editor, errors));
    } catch (error) {
      this.logger.error('Error updating validation UI', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        documentUri: document.uri.toString()
      }, this.logChannel);
    }
  }

  /**
   * Updates decorations in the editor
   */
  private updateDecorations(editor: vscode.TextEditor, errors: { range: vscode.Range; severity: vscode.DiagnosticSeverity }[]): void {
    const errorRanges = errors
      .filter(error => error.severity === vscode.DiagnosticSeverity.Error)
      .map(error => error.range);

    const warningRanges = errors
      .filter(error => error.severity === vscode.DiagnosticSeverity.Warning)
      .map(error => error.range);

    editor.setDecorations(this.errorDecorationType, errorRanges);
    editor.setDecorations(this.warningDecorationType, warningRanges);
  }

  /**
   * Clears all validation UI feedback
   */
  public clearValidation(document: vscode.TextDocument): void {
    this.logger.debug('Cleared validation UI', {
      documentUri: document.uri.toString()
    }, this.logChannel);

    this.diagnosticCollection.delete(document.uri);

    // Clear decorations in any editor showing this document
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === document.uri.toString()) {
        editor.setDecorations(this.errorDecorationType, []);
        editor.setDecorations(this.warningDecorationType, []);
      }
    }
  }

  /**
   * Validates a document and updates the UI with any validation errors
   * @param document The document to validate
   */
  public async validateDocument(document: vscode.TextDocument): Promise<void> {
    try {
      this.logger.debug('Validating document', {
        path: document.uri.fsPath
      }, this.logChannel);

      // Always run non-schema validation rules first
      const nonSchemaErrors = await this.runNonSchemaValidationAndGetErrors(document);
      this.logger.info('Non-schema validation completed', {
        errorCount: nonSchemaErrors.length,
        errors: nonSchemaErrors.map(e => ({
          code: e.code,
          severity: e.severity,
          message: e.message.substring(0, 50)
        }))
      }, this.logChannel);

      // Get the schema service directly from its static instance
      const schemaService = SchemaService.getInstance();
      let schemaErrors: any[] = [];

      if (!schemaService) {
        // Try to get it from extension exports as a fallback
        const exportedSchemaService = vscode.extensions.getExtension('ibm.ibm-catalog')?.exports?.getSchemaService();

        if (!exportedSchemaService) {
          this.logger.error('Schema service not available', undefined, this.logChannel);
          // Add warning to problems panel
          this.showSchemaUnavailableWarning(document);
          // Use only non-schema validation results
          this.processValidationResults(document, nonSchemaErrors);
          return;
        }

        // Use the exported schema service
        try {
          await exportedSchemaService.ensureInitialized();
          const schema = await exportedSchemaService.getSchema();
          schemaErrors = await exportedSchemaService.validateDocument(document, schema);
        } catch (error) {
          // Log error but continue with non-schema validation
          this.logger.error('Error getting schema from exported service', {
            error: error instanceof Error ? error.message : String(error)
          }, this.logChannel);
          // Add warning to problems panel
          this.showSchemaUnavailableWarning(document);
          // Use only non-schema validation results
          this.processValidationResults(document, nonSchemaErrors);
          return;
        }
      } else {
        // Use the schema service instance
        try {
          await schemaService.ensureInitialized();
          const schema = await schemaService.getSchema();
          schemaErrors = await schemaService.validateDocument(document, schema);
        } catch (error) {
          // Log error but continue with non-schema validation
          this.logger.error('Error getting schema', {
            error: error instanceof Error ? error.message : String(error)
          }, this.logChannel);
          // Add warning to problems panel
          this.showSchemaUnavailableWarning(document);
          // Use only non-schema validation results
          this.processValidationResults(document, nonSchemaErrors);
          return;
        }
      }

      // Combine schema and non-schema validation results
      const allErrors = [...nonSchemaErrors, ...schemaErrors];
      this.processValidationResults(document, allErrors);

    } catch (error: unknown) {
      this.logger.error('Error validating document', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        path: document.uri.fsPath
      }, this.logChannel);
    }
  }

  /**
   * Shows a warning in the problems panel that schema is not available
   */
  private showSchemaUnavailableWarning(document: vscode.TextDocument): void {
    const warning = {
      message: 'IBM Catalog schema could not be retrieved. Schema validation is unavailable. Other validation rules are still active.',
      range: new vscode.Range(0, 0, 0, 0),
      severity: vscode.DiagnosticSeverity.Warning
    };

    // Create diagnostics with the warning
    const diagnostics = [new vscode.Diagnostic(
      warning.range,
      warning.message,
      warning.severity
    )];

    diagnostics[0].source = 'ibm-catalog-validation';

    // Add to the document's diagnostics
    this.diagnosticCollection.set(document.uri, diagnostics);

    this.logger.warn('Added schema unavailable warning to problems panel', {
      document: document.uri.fsPath
    }, this.logChannel);
  }

  /**
   * Runs non-schema validation and returns the errors
   */
  private async runNonSchemaValidationAndGetErrors(document: vscode.TextDocument): Promise<any[]> {
    try {
      const text = document.getText();
      let value: any;

      try {
        value = JSON.parse(text);
      } catch (e) {
        // JSON parsing error, already handled elsewhere
        return [];
      }

      // Run only the validation rules that don't require schema
      const ruleErrors = await ValidationRuleRegistry.getInstance().validateAll(value, text);

      // Log validation errors with severity
      const errorsWithSeverity = ruleErrors.filter(err => err.severity);
      if (errorsWithSeverity.length > 0) {
        this.logger.info('Non-schema validation errors with severity', {
          errors: errorsWithSeverity.map(err => ({
            code: err.code,
            severity: err.severity,
            message: err.message.substring(0, 50)
          }))
        }, this.logChannel);
      }

      return ruleErrors;
    } catch (error) {
      this.logger.error('Error in non-schema validation', {
        error: error instanceof Error ? error.message : String(error)
      }, this.logChannel);
      return [];
    }
  }

  /**
   * Process validation results and update the UI
   */
  private processValidationResults(document: vscode.TextDocument, errors: Array<any>): void {
    // Deduplicate errors based on message and path
    const uniqueErrors = new Map<string, any>();
    errors.forEach(error => {
      const key = `${error.message}:${error.path || ''}`;
      // Keep the error with severity if it exists, otherwise keep the first occurrence
      if (!uniqueErrors.has(key) || error.severity) {
        uniqueErrors.set(key, error);
      }
    });

    const deduplicatedErrors = Array.from(uniqueErrors.values());

    // Log all errors with their original severities
    this.logger.info('Processing validation results (after deduplication)', {
      errorCount: deduplicatedErrors.length,
      allErrors: deduplicatedErrors.map(e => ({
        code: e.code || 'UNKNOWN',
        severity: e.severity,
        message: e.message.substring(0, 50)
      }))
    }, this.logChannel);

    // Convert errors to the format expected by updateValidation
    const diagnosticErrors = deduplicatedErrors.map((error: { message: string; range?: vscode.Range; path: string; severity?: string; code?: string }) => {
      // Map validation severity to VS Code DiagnosticSeverity
      let diagnosticSeverity = vscode.DiagnosticSeverity.Error; // Default to error

      if (error.severity) {
        switch (error.severity.toLowerCase()) {
          case 'warning':
            diagnosticSeverity = vscode.DiagnosticSeverity.Warning;
            break;
          case 'information':
            diagnosticSeverity = vscode.DiagnosticSeverity.Information;
            break;
          case 'hint':
            diagnosticSeverity = vscode.DiagnosticSeverity.Hint;
            break;
        }

        // Log each severity mapping
        this.logger.info('Severity mapping', {
          code: error.code || 'UNKNOWN',
          message: error.message.substring(0, 50),
          originalSeverity: error.severity,
          mappedSeverity: vscode.DiagnosticSeverity[diagnosticSeverity]
        }, this.logChannel);
      }

      return {
        message: error.message,
        range: error.range || new vscode.Range(0, 0, 0, 0),
        severity: diagnosticSeverity
      };
    });

    // Log final diagnostics before updating UI
    this.logger.info('Final diagnostics', {
      diagnostics: diagnosticErrors.map(d => ({
        message: d.message.substring(0, 50),
        severity: vscode.DiagnosticSeverity[d.severity]
      }))
    }, this.logChannel);

    // Update the UI
    this.updateValidation(document, diagnosticErrors);
  }

  /**
   * Disposes of all resources
   */
  public dispose(): void {
    this.diagnosticCollection.dispose();
    this.errorDecorationType.dispose();
    this.warningDecorationType.dispose();
  }
} 