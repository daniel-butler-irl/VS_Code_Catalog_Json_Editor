import * as vscode from 'vscode';
import { createLoggerFor } from '../../utils/outputManager';

export interface DecorationOptions {
    backgroundColor?: string;
    borderColor?: string;
    borderStyle?: string;
    borderWidth?: string;
    borderRadius?: string;
    color?: string;
    fontWeight?: string;
    fontStyle?: string;
    textDecoration?: string;
    opacity?: string;
    outline?: string;
}

export interface HighlightRange {
    range: vscode.Range;
    hoverMessage?: string;
}

export class DecorationManager implements vscode.Disposable {
    private readonly logger = createLoggerFor('DECORATIONS');
    private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
    private activeDecorations: Map<string, vscode.Range[]> = new Map();
    private readonly COMPONENT = 'DecorationManager';
    private readonly defaultOptions: DecorationOptions = {
        backgroundColor: 'rgba(255, 215, 0, 0.3)',
        borderColor: 'rgba(255, 215, 0, 0.5)',
        borderStyle: 'solid',
        borderWidth: '1px',
        borderRadius: '3px'
    };

    constructor() {
        this.logger.info('Initializing DecorationManager');
    }


    /**
     * Creates a new decoration type with given options
     */
    public createDecorationType(
        key: string,
        options: DecorationOptions = {}
    ): vscode.TextEditorDecorationType {
        // Dispose existing decoration type if it exists
        this.disposeDecorationType(key);

        const mergedOptions = { ...this.defaultOptions, ...options };
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: mergedOptions.backgroundColor,
            border: `${mergedOptions.borderWidth} ${mergedOptions.borderStyle} ${mergedOptions.borderColor}`,
            borderRadius: mergedOptions.borderRadius,
            color: mergedOptions.color,
            fontWeight: mergedOptions.fontWeight,
            fontStyle: mergedOptions.fontStyle,
            textDecoration: mergedOptions.textDecoration,
            opacity: mergedOptions.opacity,
            outline: mergedOptions.outline,
        });

        this.decorationTypes.set(key, decorationType);
        return decorationType;
    }

    /**
     * Highlights ranges in the editor
     */
    public highlight(
        editor: vscode.TextEditor,
        key: string,
        ranges: HighlightRange[],
        options?: DecorationOptions
    ): void {
        try {
            let decorationType = this.decorationTypes.get(key);
            if (!decorationType) {
                decorationType = this.createDecorationType(key, options);
            }

            const decorationOptions = ranges.map(range => ({
                range: range.range,
                hoverMessage: range.hoverMessage ? 
                    new vscode.MarkdownString(range.hoverMessage) : 
                    undefined
            }));

            editor.setDecorations(decorationType, decorationOptions);
            this.activeDecorations.set(key, ranges.map(r => r.range));
            
            this.logger.info(`Applied decoration '${key}' to ${ranges.length} ranges`);
        } catch (error) {
            this.logger.error(`Error applying decoration '${key}':`, error);
        }
    }

    /**
     * Highlights JSON keys in the editor
     */
    public highlightJsonKey(
        editor: vscode.TextEditor,
        key: string,
        jsonPath: string,
        options?: DecorationOptions
    ): void {
        try {
            const document = editor.document;
            const text = document.getText();
            const ranges = this.findJsonKeyRanges(text, jsonPath);

            if (ranges.length > 0) {
                this.highlight(editor, key, ranges.map(range => ({
                    range,
                    hoverMessage: `JSON Path: ${jsonPath}`
                })), options);
                
                // Reveal the first range
                editor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenter);
            }
        } catch (error) {
            this.logger.error(`Error highlighting JSON key '${jsonPath}':`, error);
        }
    }

     /**
     * Finds ranges for a JSON key path in text
     */
    private findJsonKeyRanges(text: string, jsonPath: string): vscode.Range[] {
        const ranges: vscode.Range[] = [];
        const keys = jsonPath.split('.');
        let currentIndex = 0;

        for (const key of keys) {
            const keyPattern = `"${key}"\\s*:`;
            const regex = new RegExp(keyPattern, 'g');
            let matchResult: RegExpExecArray | null;
            let lastMatch: RegExpExecArray | null = null;

            while ((matchResult = regex.exec(text.substring(currentIndex))) !== null) {
                const startPos = this.indexToPosition(text, currentIndex + matchResult.index);
                const endPos = this.indexToPosition(text, currentIndex + matchResult.index + key.length + 2);
                ranges.push(new vscode.Range(startPos, endPos));
                lastMatch = matchResult;
            }

            // Update search start position for nested keys
            if (lastMatch) {
                currentIndex = currentIndex + lastMatch.index + key.length;
            }
        }

        return ranges;
    }

    /**
     * Converts string index to Position
     */
    private indexToPosition(text: string, index: number): vscode.Position {
        const textBefore = text.substring(0, index);
        const lines = textBefore.split('\n');
        return new vscode.Position(
            lines.length - 1,
            lines[lines.length - 1].length
        );
    }

    /**
     * Removes decorations for a specific key
     */
    public removeDecorations(editor: vscode.TextEditor, key: string): void {
        const decorationType = this.decorationTypes.get(key);
        if (decorationType) {
            editor.setDecorations(decorationType, []);
            this.activeDecorations.delete(key);
            this.logger.info(`Removed decoration '${key}'`);
        }
    }

    /**
     * Removes all decorations
     */
    public removeAllDecorations(editor: vscode.TextEditor): void {
        for (const [key, decorationType] of this.decorationTypes) {
            editor.setDecorations(decorationType, []);
            this.activeDecorations.delete(key);
        }
        this.logger.info('Removed all decorations');
    }

    /**
     * Gets active decoration ranges for a key
     */
    public getActiveDecorations(key: string): vscode.Range[] | undefined {
        return this.activeDecorations.get(key);
    }

    /**
     * Updates decorations after document changes
     */
    public updateDecorations(editor: vscode.TextEditor, changes: readonly vscode.TextDocumentContentChangeEvent[]): void {
        for (const [key, ranges] of this.activeDecorations) {
            const updatedRanges = ranges.map(range => {
                let updatedRange = range;
                for (const change of changes) {
                    updatedRange = this.adjustRange(updatedRange, change);
                }
                return updatedRange;
            });

            const decorationType = this.decorationTypes.get(key);
            if (decorationType) {
                editor.setDecorations(decorationType, updatedRanges);
                this.activeDecorations.set(key, updatedRanges);
            }
        }
    }

    /**
     * Adjusts a range based on a document change
     */
    private adjustRange(
        range: vscode.Range,
        change: vscode.TextDocumentContentChangeEvent
    ): vscode.Range {
        const changeRange = change.range;
        const newEnd = change.range.start.translate(0, change.text.length);

        // If the change is after the range, no adjustment needed
        if (changeRange.start.isAfter(range.end)) {
            return range;
        }

        // If the change is before the range, adjust the range
        if (changeRange.end.isBefore(range.start)) {
            const lineDelta = newEnd.line - changeRange.end.line;
            const charDelta = newEnd.character - changeRange.end.character;
            return new vscode.Range(
                range.start.translate(lineDelta, charDelta),
                range.end.translate(lineDelta, charDelta)
            );
        }

        // If the change overlaps with the range, attempt to preserve the range
        return new vscode.Range(
            range.start,
            range.end.translate(
                newEnd.line - changeRange.end.line,
                newEnd.character - changeRange.end.character
            )
        );
    }

    /**
     * Disposes a specific decoration type
     */
    private disposeDecorationType(key: string): void {
        const existing = this.decorationTypes.get(key);
        if (existing) {
            existing.dispose();
            this.decorationTypes.delete(key);
            this.activeDecorations.delete(key);
        }
    }

     /**
     * Disposes all resources
     */
    public dispose(): void {
        for (const decorationType of this.decorationTypes.values()) {
            decorationType.dispose();
        }
        this.decorationTypes.clear();
        this.activeDecorations.clear();
    }
}