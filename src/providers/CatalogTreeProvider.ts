// src/providers/CatalogTreeProvider.ts

import * as vscode from 'vscode';
import { CatalogTreeItem, ValidationStatus } from '../models/CatalogTreeItem';
import { CatalogService } from '../services/CatalogService';

/**
 * Provides a tree data provider for the IBM Catalog JSON structure
 * Implements VS Code's TreeDataProvider interface to render JSON data in a tree view
 */
export class CatalogTreeProvider implements vscode.TreeDataProvider<CatalogTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CatalogTreeItem | undefined | void> = 
        new vscode.EventEmitter<CatalogTreeItem | undefined | void>();

    readonly onDidChangeTreeData: vscode.Event<CatalogTreeItem | undefined | void> = 
        this._onDidChangeTreeData.event;

    // Track expanded nodes for state persistence
    private expandedNodes: Set<string> = new Set();

    constructor(
        private readonly catalogService: CatalogService
    ) {}

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
        if (element.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
            this.expandedNodes.add(element.path);
        } else {
            this.expandedNodes.delete(element.path);
        }
        return element;
    }

    /**
     * Gets the children for a given element
     * @param element The parent element, undefined for root
     * @returns Promise resolving to array of child items
     */
    async getChildren(element?: CatalogTreeItem): Promise<CatalogTreeItem[]> {
        try {
            if (!element) {
                const catalog = await this.catalogService.getCatalogData();
                return this.createTreeItems(catalog, '');
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

        const items: CatalogTreeItem[] = [];

        for (const [key, val] of Object.entries(value)) {
            const currentPath = parentPath ? `${parentPath}.${key}` : key;
            const collapsibleState = this.expandedNodes.has(currentPath)
                ? vscode.TreeItemCollapsibleState.Expanded
                : this.getCollapsibleState(val);

            const item = new CatalogTreeItem(
                key,
                val,
                currentPath,
                collapsibleState,
                this.getContextValue(val)
            );

            items.push(item);
        }

        return this.sortTreeItems(items);
    }

    /**
     * Sorts tree items for consistent display
     * @param items The items to sort
     * @returns Sorted array of items
     */
    private sortTreeItems(items: CatalogTreeItem[]): CatalogTreeItem[] {
        return items.sort((a, b) => {
            // Sort containers and arrays first
            const aIsContainer = a.contextValue === 'container' || a.contextValue === 'array';
            const bIsContainer = b.contextValue === 'container' || b.contextValue === 'array';
            
            if (aIsContainer && !bIsContainer) return -1;
            if (!aIsContainer && bIsContainer) return 1;
            
            // Then sort by label
            return a.label.localeCompare(b.label);
        });
    }

    /**
     * Determines the collapsible state for a value
     * @param value The value to check
     * @returns The appropriate collapsible state
     */
    private getCollapsibleState(value: unknown): vscode.TreeItemCollapsibleState {
        if (typeof value === 'object' && value !== null && Object.keys(value).length > 0) {
            return vscode.TreeItemCollapsibleState.Collapsed;
        }
        return vscode.TreeItemCollapsibleState.None;
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