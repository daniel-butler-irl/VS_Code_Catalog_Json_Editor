// src/services/EditorHighlightService.ts

import * as vscode from 'vscode';
import { parseTree, Node, findNodeAtLocation, ParseOptions } from 'jsonc-parser';
import { LoggingService } from './core/LoggingService';

export class EditorHighlightService implements vscode.Disposable {
    private documentVersions = new Map<string, number>();
    private parsedDocuments = new Map<string, { version: number; root: Node }>();
    private decorationType: vscode.TextEditorDecorationType;
    private currentDecorations: string[] = [];
    private readonly logger = LoggingService.getInstance();
    private parseOptions: ParseOptions = { disallowComments: false };
    private pendingHighlight: NodeJS.Timeout | undefined;
    private symbolProvider: vscode.Disposable;

    constructor() {
        this.logger.debug('Initializing EditorHighlightService');
        
        // Use a more performant decoration type
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });

        // Register document symbol provider for ibm_catalog.json
        this.symbolProvider = vscode.languages.registerDocumentSymbolProvider(
            { language: 'json', pattern: '**/ibm_catalog.json' },
            {
                provideDocumentSymbols: (document) => this.provideDocumentSymbols(document)
            }
        );
    }

    private async provideDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
        const root = await this.getParsedDocument(document);
        if (!root) return [];

        const symbols: vscode.DocumentSymbol[] = [];
        this.buildSymbolTree(document, root, symbols);
        return symbols;
    }

    private buildSymbolTree(
        document: vscode.TextDocument,
        node: Node,
        symbols: vscode.DocumentSymbol[],
        parent?: { property: string }
    ): void {
        if (!node.children) return;

        for (const child of node.children) {
            if (child.type === 'property') {
                const propertyNode = child.children?.[0];
                if (!propertyNode) continue;

                const name = propertyNode.value;
                const valueNode = child.children?.[1];
                if (!valueNode) continue;

                const range = new vscode.Range(
                    document.positionAt(child.offset),
                    document.positionAt(child.offset + child.length)
                );

                const selectionRange = new vscode.Range(
                    document.positionAt(propertyNode.offset),
                    document.positionAt(propertyNode.offset + propertyNode.length)
                );

                const kind = this.getSymbolKind(valueNode.type);
                const symbol = new vscode.DocumentSymbol(
                    name,
                    parent ? `${parent.property}.${name}` : name,
                    kind,
                    range,
                    selectionRange
                );

                if (valueNode.type === 'object' || valueNode.type === 'array') {
                    this.buildSymbolTree(document, valueNode, symbol.children, { property: name });
                }

                symbols.push(symbol);
            }
        }
    }

    private getSymbolKind(type: string): vscode.SymbolKind {
        switch (type) {
            case 'object': return vscode.SymbolKind.Object;
            case 'array': return vscode.SymbolKind.Array;
            case 'string': return vscode.SymbolKind.String;
            case 'number': return vscode.SymbolKind.Number;
            case 'boolean': return vscode.SymbolKind.Boolean;
            default: return vscode.SymbolKind.Variable;
        }
    }

    private async getParsedDocument(document: vscode.TextDocument): Promise<Node | undefined> {
        const uri = document.uri.toString();
        const version = document.version;
        
        // Check if we have a valid cached version
        const cached = this.parsedDocuments.get(uri);
        if (cached && cached.version === version) {
            return cached.root;
        }

        // Parse and cache the document
        try {
            const text = document.getText();
            const root = parseTree(text, undefined, this.parseOptions);
            if (root) {
                this.parsedDocuments.set(uri, { version, root });
                this.documentVersions.set(uri, version);
                return root;
            }
        } catch (error) {
            this.logger.error('Failed to parse document', error);
        }
        return undefined;
    }

    public async highlightJsonPath(jsonPath: string, editor?: vscode.TextEditor): Promise<void> {
        if (this.pendingHighlight) {
            clearTimeout(this.pendingHighlight);
        }

        // Debounce highlights to prevent rapid updates
        this.pendingHighlight = setTimeout(async () => {
            await this.performHighlight(jsonPath, editor);
        }, 50);
    }

    private async performHighlight(jsonPath: string, editor?: vscode.TextEditor): Promise<void> {
        const activeEditor = editor ?? vscode.window.activeTextEditor;
        if (!activeEditor || !jsonPath) {
            return;
        }

        try {
            const document = activeEditor.document;
            const root = await this.getParsedDocument(document);
            if (!root) return;

            const pathSegments = this.jsonPathToSegments(jsonPath);
            const node = findNodeAtLocation(root, pathSegments);

            if (node) {
                const range = new vscode.Range(
                    document.positionAt(node.offset),
                    document.positionAt(node.offset + node.length)
                );

                // Apply decorations more efficiently
                const decorations = [{
                    range,
                    hoverMessage: `JSON Path: ${jsonPath}`
                }];

                activeEditor.setDecorations(this.decorationType, decorations);
                this.currentDecorations = [range.start.line.toString()];

                // Reveal the range without changing selection
                activeEditor.revealRange(
                    range,
                    vscode.TextEditorRevealType.InCenterIfOutsideViewport
                );
            }
        } catch (error) {
            this.logger.error('Failed to highlight JSON path:', error);
        }
    }

    private jsonPathToSegments(jsonPath: string): (string | number)[] {
        const segments: (string | number)[] = [];
        const regex = /\[(\d+)\]|\.([^.\[\]]+)/g;
        let match;

        while ((match = regex.exec(jsonPath)) !== null) {
            if (match[1] !== undefined) {
                segments.push(parseInt(match[1], 10));
            } else if (match[2] !== undefined) {
                segments.push(match[2]);
            }
        }

        return segments;
    }

    public clearHighlight(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            activeEditor.setDecorations(this.decorationType, []);
            this.currentDecorations = [];
        }
    }

    public dispose(): void {
        this.clearHighlight();
        this.decorationType.dispose();
        this.symbolProvider.dispose();
        this.parsedDocuments.clear();
        this.documentVersions.clear();
    }
}