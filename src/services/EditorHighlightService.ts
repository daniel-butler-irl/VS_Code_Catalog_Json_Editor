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
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            isWholeLine: true
        });
    }

/**
 * Finds the range in the JSON text corresponding to the given JSON path
 */
private findJsonPathRange(text: string, jsonPath: string): vscode.Range | undefined {
    const lines = text.split('\n');
    const pathParts = jsonPath.split('.');
    
    let currentDepth = 0;
    let arrayIndexStack: number[] = [];
    let currentArrayIndex = 0;
    let inString = false;
    let escapeNext = false;
    let foundArrayStart = false;
    let isArrayPath = !isNaN(Number(pathParts[pathParts.length - 1]));

    // Special handling for array values
    if (isArrayPath) {
        let foundTargetArray = false;
        let targetArrayIndex = parseInt(pathParts[pathParts.length - 1]);
        currentArrayIndex = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (!line || line.startsWith('//')) {
                continue;
            }

            if (foundTargetArray) {
                if (line.startsWith('"') || (line.startsWith('"') && line.endsWith('",')) || line.endsWith('"')) {
                    if (currentArrayIndex === targetArrayIndex) {
                        return new vscode.Range(i, 0, i, lines[i].length);
                    }
                    currentArrayIndex++;
                }
                if (line === ']' || line === '],') {
                    foundTargetArray = false;
                }
                continue;
            }

            // Look for array start
            if (line.includes(`"${pathParts[pathParts.length - 2]}"`) && line.includes('[')) {
                foundTargetArray = true;
                currentArrayIndex = 0;
            }
        }
    }

    // Regular object property handling
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (!line || line.startsWith('//')) {
            continue;
        }

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            
            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (char === '{' || char === '[') {
                    if (char === '[') {
                        foundArrayStart = true;
                        currentArrayIndex = 0;
                    }
                    currentDepth++;
                } else if (char === '}' || char === ']') {
                    currentDepth--;
                    if (char === ']') {
                        foundArrayStart = false;
                        if (arrayIndexStack.length > 0) {
                            arrayIndexStack.pop();
                        }
                    }
                } else if (foundArrayStart && char === ',' && currentDepth > 0) {
                    currentArrayIndex++;
                }
            }
        }

        const currentPathPart = pathParts[currentDepth - 1];
        if (currentPathPart && !isArrayPath) {
            if (line.includes(`"${currentPathPart}"`)) {
                const isArrayValue = line.includes('[') && line.includes(']');
                if (!isArrayValue && currentDepth === pathParts.length) {
                    return new vscode.Range(i, 0, i, lines[i].length);
                }
            }
        }
    }

    return undefined;
}
    /**
     * Highlights the JSON line corresponding to the given JSON path
     */
    public async highlightJsonPath(jsonPath: string, editor?: vscode.TextEditor): Promise<void> {
        const activeEditor = editor ?? vscode.window.activeTextEditor;
        if (!activeEditor || !jsonPath) {
            return;
        }

        try {
            const document = activeEditor.document;
            const text = document.getText();
            const range = this.findJsonPathRange(text, jsonPath);
            
            if (range) {
                this.currentHighlight = range;
                activeEditor.setDecorations(this.decorationType, [range]);
                activeEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
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
     * Disposes of the highlight service
     */
    public dispose(): void {
        this.decorationType.dispose();
    }
}