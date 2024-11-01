import * as vscode from 'vscode';
import { CatalogTreeItem, ValidationStatus, SchemaMetadata } from '../models/CatalogTreeItem';
import { CatalogService } from '../services/CatalogService';
import { SchemaService } from '../services/SchemaService';
import { LoggingService } from '../services/LoggingService';

/**
 * Provides a tree data provider for the IBM Catalog JSON structure with optimized loading
 */
export class CatalogTreeProvider implements vscode.TreeDataProvider<CatalogTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CatalogTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private readonly expandedNodes: Set<string>;
    private static readonly EXPANDED_NODES_KEY = 'ibmCatalog.expandedNodes';
    private treeView?: vscode.TreeView<CatalogTreeItem>;
    private logger = LoggingService.getInstance();

    constructor(
        private readonly catalogService: CatalogService,
        private readonly context: vscode.ExtensionContext,
        private readonly schemaService: SchemaService
    ) {
        this.expandedNodes = new Set(this.loadExpandedState());
        this.catalogService.onDidChangeContent(() => this.refresh());
    }

    /**
     * Sets the tree view and configures it
     */
    public setTreeView(treeView: vscode.TreeView<CatalogTreeItem>): void {
        this.treeView = treeView;

        // Track expanded/collapsed state changes
        this.treeView.onDidExpandElement((e) => {
            this.expandedNodes.add(e.element.jsonPath);
            this.saveExpandedState();
        });

        this.treeView.onDidCollapseElement((e) => {
            this.expandedNodes.delete(e.element.jsonPath);
            this.saveExpandedState();
        });

        this.context.subscriptions.push(this.treeView);
    }

    /**
     * Refreshes the tree view
     */
    public refresh(item?: CatalogTreeItem): void {
        this._onDidChangeTreeData.fire(item);
    }

    /**
     * Gets the tree item for a given element
     */
    public getTreeItem(element: CatalogTreeItem): vscode.TreeItem {
        const isExpanded = this.expandedNodes.has(element.jsonPath);
        return element.withCollapsibleState(
            this.getCollapsibleState(element.value, isExpanded)
        );
    }

    /**
     * Gets the children for a given element
     */
    public async getChildren(element?: CatalogTreeItem): Promise<CatalogTreeItem[]> {
        try {
            if (!element) {
                const catalogData = await this.catalogService.getCatalogData();
                return this.createTreeItems(catalogData, '$', undefined);
            }
            return this.createTreeItems(element.value, element.jsonPath, element);
        } catch (error) {
            this.logger.error('Failed to get tree items', error);
            return [];
        }
    }

    /**
     * Creates tree items from a JSON value
     */
    private createTreeItems(
        value: unknown,
        parentPath: string,
        parentItem?: CatalogTreeItem
    ): CatalogTreeItem[] {
        if (typeof value !== 'object' || value === null) {
            return [];
        }

        const items: CatalogTreeItem[] = [];

        for (const [key, val] of Object.entries(value)) {
            const path = this.buildJsonPath(parentPath, key);
            const schemaMetadata = this.getSchemaMetadata(path);

            // Determine if this is an 'id' under 'dependencies'
            const isIdNode = parentItem?.isOfferingIdInDependency() && key === 'id';
            let catalogId: string | undefined = undefined;

            if (isIdNode && parentItem?.catalogId) {
                catalogId = parentItem.catalogId;
            }

            // Set initial validation status based on field type
            const initialStatus = (key === 'catalog_id' || isIdNode) ?
                ValidationStatus.Pending :
                ValidationStatus.Unknown;

            const item = new CatalogTreeItem(
                this.context,
                key,
                val,
                path,
                this.getCollapsibleState(val, this.expandedNodes.has(path)),
                this.getContextValue(val),
                schemaMetadata,
                parentItem,
                catalogId,
                initialStatus
            );

            // Queue validation if needed
            if (initialStatus === ValidationStatus.Pending) {
                void this.queueValidation(item);
            }

            items.push(item);
        }

        return this.sortTreeItems(items);
    }

    /**
     * Queues an item for background validation
     */
    private async queueValidation(item: CatalogTreeItem): Promise<void> {
        // Don't await - let validation happen in background
        void item.queueForValidation();
    }

    /**
     * Builds a JSONPath expression
     */
    private buildJsonPath(parentPath: string, key: string): string {
        if (/^\[\d+\]$/.test(key)) {
            // Key is already an array index
            return `${parentPath}${key}`;
        }
        if (/^\d+$/.test(key)) {
            // Numeric key indicates array index
            return `${parentPath}[${key}]`;
        }
        if (parentPath === '$') {
            return `$.${key}`;
        }
        return `${parentPath}.${key}`;
    }

    /**
     * Gets schema metadata for a JSON path
     */
    private getSchemaMetadata(path: string): SchemaMetadata | undefined {
        return this.schemaService?.getSchemaForPath(path);
    }

    /**
     * Sorts tree items for consistent display
     */
    private sortTreeItems(items: CatalogTreeItem[]): CatalogTreeItem[] {
        return items.sort((a, b) => {
            // First priority: Required fields (if schema is available)
            const aRequired = a.schemaMetadata?.required ?? false;
            const bRequired = b.schemaMetadata?.required ?? false;
            if (aRequired !== bRequired) {
                return bRequired ? 1 : -1;
            }

            // Second priority: Type order
            const aOrder = this.getTypeOrder(a);
            const bOrder = this.getTypeOrder(b);
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }

            // Final priority: Alphabetical
            return a.label.localeCompare(b.label);
        });
    }

    /**
     * Gets the sort order for a tree item type
     */
    private getTypeOrder(item: CatalogTreeItem): number {
        switch (item.contextValue) {
            case 'editable':
                return 0; // Simple values first
            case 'container':
                return 1; // Objects second
            case 'array':
                return 2; // Arrays last
            default:
                return 3;
        }
    }

    /**
     * Determines the collapsible state for a value
     */
    private getCollapsibleState(value: unknown, isExpanded: boolean): vscode.TreeItemCollapsibleState {
        if (typeof value !== 'object' || value === null) {
            return vscode.TreeItemCollapsibleState.None;
        }
        return isExpanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
    }

    /**
     * Determines the context value for menu contributions
     */
    private getContextValue(value: unknown): string {
        if (Array.isArray(value)) {
            return 'array';
        }
        if (typeof value === 'object' && value !== null) {
            return 'container';
        }
        return 'editable';
    }

    /**
     * Loads the expanded state from persistent storage
     */
    private loadExpandedState(): string[] {
        return this.context.globalState.get<string[]>(
            CatalogTreeProvider.EXPANDED_NODES_KEY,
            []
        );
    }

    /**
     * Saves the current expanded state to persistent storage
     */
    private saveExpandedState(): void {
        this.context.globalState.update(
            CatalogTreeProvider.EXPANDED_NODES_KEY,
            Array.from(this.expandedNodes)
        );
    }
}