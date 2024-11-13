// src/services/EditorHighlightService.ts

import * as vscode from 'vscode';
import { parseTree, Node, findNodeAtLocation, ParseOptions } from 'jsonc-parser';
import { LoggingService } from './core/LoggingService';

/**
 * Service responsible for highlighting and tracking JSON paths in the editor
 * Handles document parsing, caching, and decoration management
 */
export class EditorHighlightService implements vscode.Disposable {
    private static readonly MAX_CACHE_SIZE = 100; // Prevent memory leaks
    private static readonly CACHE_CLEANUP_INTERVAL = 1000 * 60 * 5; // 5 minutes

    private documentVersions = new Map<string, number>();
    private parsedDocuments = new Map<string, {
        version: number;
        root: Node;
        lastAccessed: number;
    }>();
    private decorationType: vscode.TextEditorDecorationType;
    private currentDecorations: vscode.DecorationOptions[] = [];
    public readonly logger = LoggingService.getInstance();
    private readonly parseOptions: ParseOptions = {
        disallowComments: false,
        allowTrailingComma: true,
        allowEmptyContent: true
    };
    private pendingHighlight?: {
        timeout: NodeJS.Timeout;
        resolve: () => void;
    };
    private symbolProvider: vscode.Disposable;
    private readonly debounceDelay: number;
    private cleanupInterval: ReturnType<typeof setInterval>;

    constructor(debounceDelay = 50) {
        this.debounceDelay = debounceDelay;
        this.logger.debug('Initializing EditorHighlightService');

        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            isWholeLine: false,
            overviewRulerColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            overviewRulerLane: vscode.OverviewRulerLane.Center
        });

        this.symbolProvider = vscode.languages.registerDocumentSymbolProvider(
            { language: 'json', pattern: '**/ibm_catalog.json' },
            {
                provideDocumentSymbols: (document) => this.provideDocumentSymbols(document)
            }
        );

        // Setup cache cleanup
        this.cleanupInterval = setInterval(() => this.cleanupCache(),
            EditorHighlightService.CACHE_CLEANUP_INTERVAL);

        // Listen for document changes
        vscode.workspace.onDidChangeTextDocument(this.handleDocumentChange, this);
    }

    private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        const uri = event.document.uri.toString();
        this.parsedDocuments.delete(uri);
        this.documentVersions.delete(uri);
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
            if (child.type === 'property' && child.children) {
                const [propertyNode, valueNode] = child.children;
                if (!propertyNode || !valueNode) continue;

                const name = propertyNode.value;
                const range = new vscode.Range(
                    document.positionAt(child.offset),
                    document.positionAt(child.offset + child.length)
                );

                const selectionRange = new vscode.Range(
                    document.positionAt(propertyNode.offset),
                    document.positionAt(propertyNode.offset + propertyNode.length)
                );

                const kind = this.getSymbolKind(valueNode.type);
                const detail = parent ? `${parent.property}.${name}` : name;
                const symbol = new vscode.DocumentSymbol(name, detail, kind, range, selectionRange);

                if (valueNode.type === 'object' || valueNode.type === 'array') {
                    this.buildSymbolTree(document, valueNode, symbol.children, { property: name });
                }

                symbols.push(symbol);
            }
        }
    }

    private getSymbolKind(type: string): vscode.SymbolKind {
        const kindMap: Record<string, vscode.SymbolKind> = {
            'object': vscode.SymbolKind.Object,
            'array': vscode.SymbolKind.Array,
            'string': vscode.SymbolKind.String,
            'number': vscode.SymbolKind.Number,
            'boolean': vscode.SymbolKind.Boolean
        };
        return kindMap[type] ?? vscode.SymbolKind.Variable;
    }

    private async getParsedDocument(document: vscode.TextDocument): Promise<Node | undefined> {
        const uri = document.uri.toString();
        const version = document.version;

        const cached = this.parsedDocuments.get(uri);
        if (cached?.version === version) {
            cached.lastAccessed = Date.now();
            return cached.root;
        }

        try {
            const text = document.getText();
            const root = parseTree(text, undefined, this.parseOptions);
            if (root) {
                if (this.parsedDocuments.size >= EditorHighlightService.MAX_CACHE_SIZE) {
                    this.cleanupCache();
                }
                this.parsedDocuments.set(uri, {
                    version,
                    root,
                    lastAccessed: Date.now()
                });
                this.documentVersions.set(uri, version);
                return root;
            }
        } catch (error) {
            this.logger.error('Failed to parse document', error);
            this.parsedDocuments.delete(uri);
        }
        return undefined;
    }

    public async highlightJsonPath(jsonPath: string, editor?: vscode.TextEditor): Promise<void> {
        if (this.pendingHighlight) {
            clearTimeout(this.pendingHighlight.timeout);
            this.pendingHighlight.resolve();
        }

        return new Promise<void>((resolve) => {
            this.pendingHighlight = {
                timeout: setTimeout(async () => {
                    await this.performHighlight(jsonPath, editor);
                    resolve();
                }, this.debounceDelay),
                resolve
            };
        });
    }

    public async performHighlight(jsonPath: string, editor?: vscode.TextEditor): Promise<void> {
        const activeEditor = editor ?? vscode.window.activeTextEditor;
        if (!activeEditor || !jsonPath) {
            return;
        }

        try {
            const document = activeEditor.document;
            const root = await this.getParsedDocument(document);
            if (!root) return;

            const pathSegments = this.parseJsonPath(jsonPath);
            if (!pathSegments) {
                this.logger.debug('Invalid JSON path format', jsonPath);
                return;
            }

            const node = findNodeAtLocation(root, pathSegments);
            if (node) {
                const range = new vscode.Range(
                    document.positionAt(node.offset),
                    document.positionAt(node.offset + node.length)
                );

                const decoration: vscode.DecorationOptions = {
                    range,
                    hoverMessage: `JSON Path: ${jsonPath}`
                };

                this.currentDecorations = [decoration];
                activeEditor.setDecorations(this.decorationType, this.currentDecorations);

                activeEditor.revealRange(
                    range,
                    vscode.TextEditorRevealType.InCenterIfOutsideViewport
                );
            } else {
                this.logger.debug('Node not found for path', jsonPath);
                this.clearHighlight();
            }
        } catch (error) {
            this.logger.error('Failed to highlight JSON path:', error);
            this.clearHighlight();
        }
    }

    private parseJsonPath(jsonPath: string): (string | number)[] | null {
        try {
            const segments: (string | number)[] = [];
            const regex = /^\$|(\.([^.\[\]]+)|\[(\d+)\])/g;
            let match;

            // Validate basic format
            if (!jsonPath.startsWith('$')) {
                return null;
            }

            while ((match = regex.exec(jsonPath)) !== null) {
                if (match[2] !== undefined) {
                    segments.push(match[2]);
                } else if (match[3] !== undefined) {
                    segments.push(parseInt(match[3], 10));
                }
            }

            return segments.length > 0 ? segments : null;
        } catch {
            return null;
        }
    }

    private cleanupCache(): void {
        if (this.parsedDocuments.size <= EditorHighlightService.MAX_CACHE_SIZE / 2) {
            return;
        }

        const now = Date.now();
        const entries = Array.from(this.parsedDocuments.entries());
        entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

        // Remove older half of entries
        const removeCount = Math.floor(entries.length / 2);
        entries.slice(0, removeCount).forEach(([uri]) => {
            this.parsedDocuments.delete(uri);
            this.documentVersions.delete(uri);
        });
    }

    public clearHighlight(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            activeEditor.setDecorations(this.decorationType, []);
        }
        this.currentDecorations = [];
    }

    public dispose(): void {
        this.clearHighlight();
        this.decorationType.dispose();
        this.symbolProvider.dispose();
        clearInterval(this.cleanupInterval);
        this.parsedDocuments.clear();
        this.documentVersions.clear();

        if (this.pendingHighlight) {
            clearTimeout(this.pendingHighlight.timeout);
            this.pendingHighlight.resolve();
        }
    }
}