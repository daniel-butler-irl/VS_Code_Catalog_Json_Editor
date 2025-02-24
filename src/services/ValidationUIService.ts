import * as vscode from 'vscode';
import { LoggingService } from './core/LoggingService';
import { parseTree, findNodeAtLocation } from 'jsonc-parser';
import { LogChannel } from './core/LoggingService';

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

      for (const error of errors) {
        let range = error.range;

        // If range is at position 0,0, try to find a better position
        if (range.start.line === 0 && range.start.character === 0 && range.end.line === 0 && range.end.character === 0) {
          const pathParts = error.message.split(':')[0].split('.');
          if (pathParts[0] === '$') {
            pathParts.shift();
          }

          if (root && pathParts.length > 0) {
            const node = findNodeAtLocation(root, pathParts);
            if (node) {
              const startPos = document.positionAt(node.offset);
              const endPos = document.positionAt(node.offset + node.length);
              range = new vscode.Range(startPos, endPos);
            }
          }
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

    vscode.window.visibleTextEditors
      .filter(editor => editor.document === document)
      .forEach(editor => {
        editor.setDecorations(this.errorDecorationType, []);
        editor.setDecorations(this.warningDecorationType, []);
      });
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