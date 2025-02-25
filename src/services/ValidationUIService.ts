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

      // Get the schema service directly from its static instance
      const schemaService = SchemaService.getInstance();

      if (!schemaService) {
        // Try to get it from extension exports as a fallback
        const exportedSchemaService = vscode.extensions.getExtension('ibm.ibm-catalog')?.exports?.getSchemaService();

        if (!exportedSchemaService) {
          this.logger.error('Schema service not available', undefined, this.logChannel);

          // Add warning to problems panel
          this.showSchemaUnavailableWarning(document);

          // Run other validation rules that don't require schema
          this.runNonSchemaValidation(document);
          return;
        }

        // Use the exported schema service
        try {
          await exportedSchemaService.ensureInitialized();
          const schema = await exportedSchemaService.getSchema();
          const errors = await exportedSchemaService.validateDocument(document, schema);
          this.processValidationResults(document, errors);
        } catch (error) {
          // Log error but continue with non-schema validation
          this.logger.error('Error getting schema from exported service', {
            error: error instanceof Error ? error.message : String(error)
          }, this.logChannel);

          // Add warning to problems panel
          this.showSchemaUnavailableWarning(document);

          // Run other validation rules that don't require schema
          this.runNonSchemaValidation(document);
        }
        return;
      }

      // Use the schema service instance
      try {
        await schemaService.ensureInitialized();
        const schema = await schemaService.getSchema();
        const errors = await schemaService.validateDocument(document, schema);
        this.processValidationResults(document, errors);
      } catch (error) {
        // Log error but continue with non-schema validation
        this.logger.error('Error getting schema', {
          error: error instanceof Error ? error.message : String(error)
        }, this.logChannel);

        // Add warning to problems panel
        this.showSchemaUnavailableWarning(document);

        // Run other validation rules that don't require schema
        this.runNonSchemaValidation(document);
      }
    } catch (error: unknown) {
      this.logger.error('Error validating document', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        path: document.uri.fsPath
      }, this.logChannel);

      // Try to run non-schema validation even when an error occurs
      try {
        this.runNonSchemaValidation(document);
      } catch (e) {
        this.logger.error('Error running non-schema validation', {
          error: e instanceof Error ? e.message : String(e)
        }, this.logChannel);
      }
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
   * Runs only validation rules that don't require the schema
   */
  private async runNonSchemaValidation(document: vscode.TextDocument): Promise<void> {
    try {
      const text = document.getText();
      let value: any;

      try {
        value = JSON.parse(text);
      } catch (e) {
        // JSON parsing error, already handled elsewhere
        return;
      }

      // Run only the validation rules that don't require schema
      const ruleErrors = await ValidationRuleRegistry.getInstance().validateAll(value, text);

      // Get any existing diagnostics (including our schema warning)
      const existingDiagnostics = this.diagnosticCollection.get(document.uri) || [];

      // Convert rule errors to diagnostics and append to existing
      const ruleDiagnostics = ruleErrors.map(err => {
        const diagnostic = new vscode.Diagnostic(
          err.range ? new vscode.Range(
            err.range.start.line,
            err.range.start.character,
            err.range.end.line,
            err.range.end.character
          ) : new vscode.Range(0, 0, 0, 0),
          err.message,
          vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = 'ibm-catalog-validation';
        return diagnostic;
      });

      // Combine existing warnings with new rule errors
      const allDiagnostics = [...existingDiagnostics, ...ruleDiagnostics];

      // Update diagnostics
      this.diagnosticCollection.set(document.uri, allDiagnostics);

      this.logger.debug('Completed non-schema validation', {
        document: document.uri.fsPath,
        errorCount: ruleDiagnostics.length
      }, this.logChannel);
    } catch (error) {
      this.logger.error('Error in non-schema validation', {
        error: error instanceof Error ? error.message : String(error)
      }, this.logChannel);
    }
  }

  /**
   * Process validation results and update the UI
   */
  private processValidationResults(document: vscode.TextDocument, errors: Array<any>): void {
    this.logger.debug('Validation completed', {
      path: document.uri.fsPath,
      errorCount: errors.length,
      errors: errors.map((e: { message: string; path: string }) => ({
        message: e.message,
        path: e.path
      }))
    }, this.logChannel);

    // Convert errors to the format expected by updateValidation
    const diagnosticErrors = errors.map((error: { message: string; range?: vscode.Range; path: string }) => ({
      message: error.message,
      range: error.range || new vscode.Range(0, 0, 0, 0),
      severity: vscode.DiagnosticSeverity.Error
    }));

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