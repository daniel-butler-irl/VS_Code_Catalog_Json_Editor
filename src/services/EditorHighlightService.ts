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
    private static readonly HIGHLIGHT_DELAY = 1000; // 1 second delay before highlighting
    private static readonly DOUBLE_CLICK_THRESHOLD = 500; // 500ms threshold for double-click
    private static readonly CLICK_DEBOUNCE = 100; // 100ms debounce for click events

    private documentVersions = new Map<string, number>();
    private parsedDocuments = new Map<string, {
        version: number;
        root: Node;
        lastAccessed: number;
    }>();
    private decorationType: vscode.TextEditorDecorationType;
    private currentDecorations: vscode.DecorationOptions[] = [];
    private currentHighlightRange?: vscode.Range;
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
    private lineToPathCache = new Map<string, Map<number, string>>();
    private selectionListener?: vscode.Disposable;
    private treeView?: vscode.TreeView<any>;
    private lastHighlightedLine?: number;
    private lastHighlightTime = 0;
    private lastClickTime = 0;

    constructor(debounceDelay = 1000) {
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

        // Add selection change listener
        this.selectionListener = vscode.window.onDidChangeTextEditorSelection(
            this.handleSelectionChange.bind(this)
        );
    }

    private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        const uri = event.document.uri.toString();
        this.parsedDocuments.delete(uri);
        this.documentVersions.delete(uri);
        // Clear the line cache for the changed document
        this.lineToPathCache.delete(uri);
    }

    private async provideDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
        const root = await this.getParsedDocument(document);
        if (!root) { return []; }

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
        if (!node.children) { return; }

        for (const child of node.children) {
            if (child.type === 'property' && child.children) {
                const [propertyNode, valueNode] = child.children;
                if (!propertyNode || !valueNode) { continue; }

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
            this.logger.error('Failed to parse document', { error: error instanceof Error ? error.message : String(error) });
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
            if (!root) { return; }

            const pathSegments = this.parseJsonPath(jsonPath);
            if (!pathSegments) {
                this.logger.debug('Invalid JSON path format', { path: jsonPath });
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
                this.currentHighlightRange = range;
                activeEditor.setDecorations(this.decorationType, this.currentDecorations);

                // Reveal range without taking focus and keep in center
                activeEditor.revealRange(
                    range,
                    vscode.TextEditorRevealType.InCenterIfOutsideViewport
                );

                // Show document but always preserve focus
                if (this.treeView?.visible) {
                    void vscode.window.showTextDocument(activeEditor.document, {
                        viewColumn: activeEditor.viewColumn,
                        preserveFocus: true,
                        selection: activeEditor.selection
                    });
                }
            } else {
                this.logger.debug('Node not found for path', { path: jsonPath });
                this.clearHighlight();
            }
        } catch (error) {
            this.logger.error('Error performing highlight:', { error });
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
        this.currentHighlightRange = undefined;
    }

    public getCurrentHighlightRange(): vscode.Range | undefined {
        return this.currentHighlightRange;
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

        this.selectionListener?.dispose();
        this.lineToPathCache.clear();
    }

    /**
     * Sets the tree view to enable reverse highlighting
     */
    public setTreeView(treeView: vscode.TreeView<any>): void {
        this.treeView = treeView;
    }

    /**
     * Handles selection changes in the editor
     */
    private async handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): Promise<void> {
        const editor = event.textEditor;
        if (!editor || editor.document.languageId !== 'json') {
            return;
        }

        const currentTime = Date.now();
        const currentLine = event.selections[0].active.line;
        const timeSinceLastClick = currentTime - this.lastClickTime;

        // Ignore events that are too close together (debounce)
        if (timeSinceLastClick < EditorHighlightService.CLICK_DEBOUNCE) {
            return;
        }

        // Check if this is a word selection (which happens on double-click)
        const isWordSelection = event.selections[0].start.line === event.selections[0].end.line &&
            !event.selections[0].isEmpty &&
            timeSinceLastClick <= EditorHighlightService.DOUBLE_CLICK_THRESHOLD;

        // If it's not a word selection, check if it's a drag selection
        if (!event.selections[0].isEmpty && !isWordSelection) {
            return;
        }

        // Check for double-click (either through word selection or rapid clicks)
        if (isWordSelection || timeSinceLastClick <= EditorHighlightService.DOUBLE_CLICK_THRESHOLD) {
            this.logger.debug('Double-click detected', { line: currentLine, selection: 'word' });

            const document = editor.document;
            const position = event.selections[0].active;
            const jsonPath = await this.findJsonPathAtPosition(document, position);

            if (jsonPath) {
                this.logger.debug('Highlighting path', { path: jsonPath, line: currentLine });
                await this.highlightJsonPath(jsonPath, editor);
                // Reveal in tree without taking focus
                if (this.treeView) {
                    void vscode.commands.executeCommand('ibmCatalogTree.revealJsonPath', jsonPath, {
                        select: true,
                        focus: false
                    });
                }
            }

            // Reset click time after handling double-click
            this.lastClickTime = 0;
        } else {
            this.lastClickTime = currentTime;
        }
    }

    /**
     * Finds the JSON path at a given position in the document
     */
    private async findJsonPathAtPosition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<string | undefined> {
        const root = await this.getParsedDocument(document);
        if (!root) {
            return undefined;
        }

        // Try to get from cache first
        const docUri = document.uri.toString();
        const lineCache = this.lineToPathCache.get(docUri);
        if (lineCache?.has(position.line)) {
            return lineCache.get(position.line);
        }

        // If not in cache, traverse the tree to find the path
        return this.findPathInNode(root, document, position);
    }

    /**
     * Recursively finds the JSON path in a node at a given position
     */
    private findPathInNode(
        node: Node,
        document: vscode.TextDocument,
        position: vscode.Position,
        currentPath: (string | number)[] = []
    ): string | undefined {
        const nodeStartPos = document.positionAt(node.offset);
        const nodeEndPos = document.positionAt(node.offset + node.length);

        // Check if position is within node's range
        if (position.line < nodeStartPos.line || position.line > nodeEndPos.line) {
            return undefined;
        }

        if (node.type === 'property' && node.children && node.children.length > 0) {
            const [nameNode, valueNode] = node.children;
            if (nameNode && valueNode) {
                const propertyPath = [...currentPath, nameNode.value];
                return this.findPathInNode(valueNode, document, position, propertyPath);
            }
        }

        if (node.type === 'array' && node.children) {
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const childPath = this.findPathInNode(child, document, position, [...currentPath, i]);
                if (childPath) {
                    return childPath;
                }
            }
        }

        if (node.type === 'object' && node.children) {
            for (const child of node.children) {
                const childPath = this.findPathInNode(child, document, position, currentPath);
                if (childPath) {
                    return childPath;
                }
            }
        }

        // If we found the node containing the position
        if (position.line >= nodeStartPos.line && position.line <= nodeEndPos.line) {
            // Cache the result
            const docUri = document.uri.toString();
            if (!this.lineToPathCache.has(docUri)) {
                this.lineToPathCache.set(docUri, new Map());
            }
            const path = '$' + currentPath.map(segment =>
                typeof segment === 'number' ? `[${segment}]` : `.${segment}`
            ).join('');
            this.lineToPathCache.get(docUri)?.set(position.line, path);
            return path;
        }

        return undefined;
    }
}