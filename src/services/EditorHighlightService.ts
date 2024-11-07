// src/services/EditorHighlightService.ts

import * as vscode from 'vscode';
import { parseTree, findNodeAtLocation, Node } from 'jsonc-parser';
import { LoggingService } from './core/LoggingService';

export class EditorHighlightService implements vscode.Disposable {
    private decorationType: vscode.TextEditorDecorationType;
    private currentHighlight: vscode.Range | undefined;
    private currentEditor: vscode.TextEditor | null = null;
    private isHighlighting: boolean = false;
    private highlightVersion = 0;
    private parsedJsonCache: { [uri: string]: Node | undefined } = {};
    private readonly logger = LoggingService.getInstance();

    constructor() {
        this.logger.debug('Initializing EditorHighlightService');

        // Create a single decoration type to be reused
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
            isWholeLine: true
        });

        // Listen for selection changes
        vscode.window.onDidChangeTextEditorSelection(this.onSelectionChange, this);

        // Listen for active editor changes
        vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChange, this);

        // Listen for document changes to invalidate cache
        vscode.workspace.onDidChangeTextDocument(this.onDocumentChange, this);

        this.logger.debug('EditorHighlightService initialized');
    }

    public async highlightJsonPath(jsonPath: string, editor?: vscode.TextEditor): Promise<void> {
        const activeEditor = editor ?? vscode.window.activeTextEditor;
        if (!activeEditor || !jsonPath) {
            this.logger.error('No active editor or JSON path provided.');
            return;
        }

        this.isHighlighting = true;
        const currentVersion = ++this.highlightVersion;
        this.logger.debug(`Highlighting JSON path: ${jsonPath}, version: ${currentVersion}`);

        try {
            const document = activeEditor.document;
            const text = document.getText();

            // Use cached parsed JSON if available
            let rootNode = this.parsedJsonCache[document.uri.toString()];
            if (!rootNode) {
                rootNode = parseTree(text);
                this.parsedJsonCache[document.uri.toString()] = rootNode;
            }

            if (!rootNode) {
                this.logger.error('Failed to parse JSON document.');
                return;
            }

            const pathSegments = this.jsonPathToSegments(jsonPath);
            this.logger.debug(`JSON path segments: ${JSON.stringify(pathSegments)}`);

            const targetNode = findNodeAtLocation(rootNode, pathSegments);

            if (currentVersion !== this.highlightVersion) {
                // A newer highlight request has been made; abort this one
                this.logger.debug(`Aborting outdated highlight version: ${currentVersion}`);
                return;
            }

            if (targetNode) {
                const startPos = document.positionAt(targetNode.offset);
                const endPos = document.positionAt(targetNode.offset + targetNode.length);
                const range = new vscode.Range(startPos, endPos);

                this.logger.debug(`Target node found at range: ${range.start.line}:${range.start.character} - ${range.end.line}:${range.end.character}`);

                this.currentHighlight = range;
                this.currentEditor = activeEditor;

                // Apply the decoration
                activeEditor.setDecorations(this.decorationType, [range]);

                // Adjust the range to reveal to prevent horizontal scrolling
                const lineStart = new vscode.Position(startPos.line, 0);
                const revealRange = new vscode.Range(lineStart, lineStart);

                // Reveal the adjusted range vertically without scrolling horizontally
                activeEditor.revealRange(revealRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

                // Return focus to the tree view
                await vscode.commands.executeCommand('workbench.view.extension.ibm-catalog-explorer');

            } else {
                this.logger.error('Target node not found for the given JSON path.');
                this.clearHighlight();
            }
        } catch (error) {
            this.logger.error('Failed to highlight JSON path:', error);
        } finally {
            this.isHighlighting = false;
        }
    }

    /**
     * Clears any existing highlights
     */
    public clearHighlight(): void {
        if (this.currentEditor && this.currentHighlight) {
            this.currentEditor.setDecorations(this.decorationType, []);
            this.currentHighlight = undefined;
            this.currentEditor = null;
            this.logger.debug('Highlight cleared');
        }
    }

    private onSelectionChange(e: vscode.TextEditorSelectionChangeEvent): void {
        if (e.textEditor.document.fileName.endsWith('ibm_catalog.json')) {
            // Ignore if we're currently highlighting to prevent clearing during programmatic selection
            if (this.isHighlighting) {
                return;
            }

            // Clear the highlight whenever the selection changes
            this.logger.debug('Selection change detected, clearing highlight');
            this.clearHighlight();
        }
    }

    // Handle active editor changes to clear the highlight when ibm_catalog.json is clicked
    private onActiveEditorChange(editor: vscode.TextEditor | undefined): void {
        if (editor && editor.document.fileName.endsWith('ibm_catalog.json')) {
            this.logger.debug('Active editor changed to ibm_catalog.json, clearing highlight');
            this.clearHighlight();
        }
    }

    // Invalidate the cache when the document changes
    private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
        if (e.document.fileName.endsWith('ibm_catalog.json')) {
            this.logger.debug('Document changed, invalidating JSON cache');
            this.parsedJsonCache[e.document.uri.toString()] = undefined;
        }
    }

    /**
     * Converts a JSON path string to an array of segments
     */
    private jsonPathToSegments(jsonPath: string): (string | number)[] {
        const segments = [];
        const regex = /\[(\d+)\]|\.([^.\[\]]+)/g;
        let match;
        while ((match = regex.exec(jsonPath)) !== null) {
            if (match[1] !== undefined) {
                // Array index
                segments.push(parseInt(match[1], 10));
            } else if (match[2] !== undefined) {
                // Object key
                segments.push(match[2]);
            }
        }
        return segments;
    }

    /**
     * Dispose of the decoration and event listeners
     */
    public dispose(): void {
        this.clearHighlight();
        this.decorationType.dispose();
        // Event listeners are automatically disposed when the extension is deactivated
    }
}
