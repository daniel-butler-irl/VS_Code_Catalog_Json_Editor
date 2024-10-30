// src/services/EditorHighlightService.ts

import * as vscode from 'vscode';

/**
 * Manages highlighting of JSON lines in the editor
 */
export class EditorHighlightService implements vscode.Disposable {
    private decorationType: vscode.TextEditorDecorationType;
    private currentHighlight: vscode.Range | undefined;

    constructor() {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
            isWholeLine: true
        });
    }

    /**
     * Highlights the JSON element corresponding to the given JSON path
     */
    public async highlightJsonPath(jsonPath: string, editor?: vscode.TextEditor): Promise<void> {
        const activeEditor = editor ?? vscode.window.activeTextEditor;
        if (!activeEditor || !jsonPath) {
            return;
        }

        try {
            const document = activeEditor.document;
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (!symbols) {
                return;
            }

            const pathSegments = this.jsonPathToSegments(jsonPath);
            const targetSymbol = this.findSymbolAtPath(symbols, pathSegments);

            if (targetSymbol) {
                this.currentHighlight = targetSymbol.range;
                activeEditor.setDecorations(this.decorationType, [targetSymbol.range]);
                activeEditor.revealRange(targetSymbol.range, vscode.TextEditorRevealType.InCenter);
            } else {
                this.clearHighlight();
            }
        } catch (error) {
            console.error('Failed to highlight JSON path:', error);
        }
    }

    /**
     * Clears any existing highlights
     */
    public clearHighlight(): void {
        if (vscode.window.activeTextEditor) {
            vscode.window.activeTextEditor.setDecorations(this.decorationType, []);
        }
        this.currentHighlight = undefined;
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
     * Recursively searches for a symbol matching the JSON path segments
     */
    private findSymbolAtPath(symbols: vscode.DocumentSymbol[], pathSegments: (string | number)[], depth = 0): vscode.DocumentSymbol | undefined {
        if (depth >= pathSegments.length) {
            return undefined;
        }

        const segment = pathSegments[depth];
        for (const symbol of symbols) {
            if (symbol.name === segment.toString()) {
                if (depth === pathSegments.length - 1) {
                    return symbol;
                } else if (symbol.children && symbol.children.length > 0) {
                    const result = this.findSymbolAtPath(symbol.children, pathSegments, depth + 1);
                    if (result) {
                        return result;
                    }
                }
            }
        }
        return undefined;
    }

    /**
     * Disposes of the highlight service
     */
    public dispose(): void {
        this.decorationType.dispose();
    }
}
