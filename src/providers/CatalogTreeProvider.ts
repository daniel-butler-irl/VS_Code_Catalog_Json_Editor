// src/providers/CatalogTreeProvider.ts

import * as vscode from 'vscode';
import { CatalogTreeItem } from '../models/CatalogTreeItem';
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
                // Root level - get the main JSON structure
                const catalog = await this.catalogService.getCatalogData();
                return this.createTreeItems(catalog, '');
            }

            // Child level - get the children of the current node
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
            const item = new CatalogTreeItem(
                key,
                val,
                currentPath,
                this.getCollapsibleState(val),
                this.getContextValue(val)
            );

            items.push(item);
        }

        return items;
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