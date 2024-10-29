// src/providers/CatalogTreeProvider.ts

import * as vscode from 'vscode';
import { CatalogTreeItem, ValidationStatus } from '../models/CatalogTreeItem';
import { CatalogService } from '../services/CatalogService';

/**
 * Provides a tree data provider for the IBM Catalog JSON structure
 * Implements VS Code's TreeDataProvider interface to render JSON data in a tree view
 */
export class CatalogTreeProvider implements vscode.TreeDataProvider<CatalogTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CatalogTreeItem | undefined | void> = new vscode.EventEmitter<CatalogTreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<CatalogTreeItem | undefined | void> = this._onDidChangeTreeData.event;
    private expandedNodes: Set<string>;
    private static readonly EXPANDED_NODES_KEY = 'ibmCatalog.expandedNodes';
    private treeView: vscode.TreeView<CatalogTreeItem>;

    constructor(
        private readonly catalogService: CatalogService,
        private readonly context: vscode.ExtensionContext
    ) {
        this.expandedNodes = new Set(this.loadExpandedState());
        this.treeView = vscode.window.createTreeView('ibmCatalogTree', {
            treeDataProvider: this,
            showCollapseAll: true
        });

        // Register state change handlers
        this.treeView.onDidExpandElement(e => {
            this.expandedNodes.add(e.element.path);
            this.saveExpandedState();
        });

        this.treeView.onDidCollapseElement(e => {
            this.expandedNodes.delete(e.element.path);
            this.saveExpandedState();
        });
    }

    /**
     * Loads the expanded state from persistent storage
     */
    private loadExpandedState(): string[] {
        return this.context.globalState.get<string[]>(CatalogTreeProvider.EXPANDED_NODES_KEY, []);
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

    /**
     * Gets the tree view instance
     */
    public getTreeView(): vscode.TreeView<CatalogTreeItem> {
        return this.treeView;
    }

    /**
     * Registers handlers to track tree view state changes
     */
    private registerTreeViewStateHandler(): void {
        const treeView = vscode.window.createTreeView('ibmCatalogTree', {
            treeDataProvider: this,
            showCollapseAll: true
        });

        // Track expanded/collapsed state changes
        treeView.onDidExpandElement(e => {
            this.expandedNodes.add(e.element.path);
            this.saveExpandedState();
        });

        treeView.onDidCollapseElement(e => {
            this.expandedNodes.delete(e.element.path);
            this.saveExpandedState();
        });
    }


    /**
     * Refreshes the tree view
     */
    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Gets the tree item for a given element
     * @param element The catalog tree item
     * @returns The VS Code TreeItem
     */
    getTreeItem(element: CatalogTreeItem): vscode.TreeItem {
    const isExpanded = this.expandedNodes.has(element.path);
    const collapsibleState = this.getCollapsibleState(element.value, isExpanded);
    return element.withCollapsibleState(collapsibleState);
}
    /**
     * Gets the children for a given element
     * @param element The parent element, undefined for root
     * @returns Promise resolving to array of child items
     */
    async getChildren(element?: CatalogTreeItem): Promise<CatalogTreeItem[]> {
        try {
            if (!element) {
                const catalogData = await this.catalogService.getCatalogData();
                return this.createTreeItems(catalogData, '');
            }
            return this.createTreeItems(element.value, element.path);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to get tree items: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return [];
        }
    }

    /**
     * Creates tree items from a JSON object or value
     * @param value The JSON value to create items from
     * @param parentPath The JSON path to the parent
     * @returns Array of CatalogTreeItems
     */
     private createTreeItems(value: unknown, parentPath: string): CatalogTreeItem[] {
        if (typeof value !== 'object' || value === null) {
            return [];
        }

        const items = Object.entries(value).map(([key, val]) => {
            const path = parentPath ? `${parentPath}.${key}` : key;
            const isExpanded = this.expandedNodes.has(path);
            return new CatalogTreeItem(
                key,
                val,
                path,
                this.getCollapsibleState(val, isExpanded),
                this.getContextValue(val)
            );
        });

        return this.sortTreeItems(items);
    }

    /**
 * Sorts tree items for consistent display
 * @param items The items to sort
 * @returns Sorted array of items
 */
private sortTreeItems(items: CatalogTreeItem[]): CatalogTreeItem[] {
    return items.sort((a, b) => {
        // First sort by type: editable (simple values) first, then objects, then arrays
        const getTypeOrder = (item: CatalogTreeItem): number => {
            switch (item.contextValue) {
                case 'editable': return 0;  // Simple values first
                case 'container': return 1; // Objects second
                case 'array': return 2;     // Arrays last
                default: return 3;
            }
        };

        const aOrder = getTypeOrder(a);
        const bOrder = getTypeOrder(b);

        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }

        // If same type, sort alphabetically
        return a.label.localeCompare(b.label);
    });
}

    /**
     * Determines the collapsible state for a value
     * @param value The value to check
     * @returns The appropriate collapsible state
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
     * @param value The value to check
     * @returns The context value string
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
}