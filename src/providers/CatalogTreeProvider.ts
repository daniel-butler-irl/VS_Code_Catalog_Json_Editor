// src/providers/CatalogTreeProvider.ts

import * as vscode from 'vscode';
import { CatalogTreeItem, ValidationStatus, SchemaMetadata } from '../models/CatalogTreeItem';
import { CatalogService } from '../services/CatalogService';
import { SchemaService } from '../services/SchemaService';
import { AuthService } from '../services/AuthService';
import { IBMCloudService } from '../services/IBMCloudService';

/**
 * Provides a tree data provider for the IBM Catalog JSON structure
 */
export class CatalogTreeProvider implements vscode.TreeDataProvider<CatalogTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CatalogTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    private readonly expandedNodes: Set<string>;
    private static readonly EXPANDED_NODES_KEY = 'ibmCatalog.expandedNodes';
    private treeView?: vscode.TreeView<CatalogTreeItem>;

    constructor(
        private readonly catalogService: CatalogService,
        private readonly context: vscode.ExtensionContext,
        private readonly schemaService: SchemaService
    ) {
        this.expandedNodes = new Set(this.loadExpandedState());

        // Subscribe to catalog service events
        this.catalogService.onDidChangeContent(() => this.refresh());
    }

    /**
     * Sets the tree view and configures it
     */
    public setTreeView(treeView: vscode.TreeView<CatalogTreeItem>): void {
        this.treeView = treeView;

        // Track expanded/collapsed state changes
        this.treeView.onDidExpandElement(e => {
            this.expandedNodes.add(e.element.jsonPath);
            this.saveExpandedState();
        });

        this.treeView.onDidCollapseElement(e => {
            this.expandedNodes.delete(e.element.jsonPath);
            this.saveExpandedState();
        });

        // Dispose the tree view when the provider is disposed
        this.context.subscriptions.push(this.treeView);
    }

    /**
     * Refreshes the tree view
     */
    public refresh(item?: CatalogTreeItem): void {
        this._onDidChangeTreeData.fire(item);
    }

    /**
     * Updates validation status for a specific path
     */
    public updateValidation(path: string, status: ValidationStatus, message?: string): void {
        // Find and update the specific item
        this.refresh(); // For now, refresh the whole tree. This can be optimized later
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
                return await this.createTreeItems(catalogData, '$');
            }
            return await this.createTreeItems(element.value, element.jsonPath);
        } catch (error) {
            this.handleError('Failed to get tree items', error);
            return [];
        }
    }

    /**
     * Creates tree items from a JSON value
     */
    private async createTreeItems(value: unknown, parentPath: string): Promise<CatalogTreeItem[]> {
        if (typeof value !== 'object' || value === null) {
            return [];
        }

        const items: CatalogTreeItem[] = [];

        for (const [key, val] of Object.entries(value)) {
            const path = this.buildJsonPath(parentPath, key);
            const schemaMetadata = this.getSchemaMetadata(path);
            
            const item = new CatalogTreeItem(
                this.context,
                key,
                val,
                path,
                this.getCollapsibleState(val, this.expandedNodes.has(path)),
                this.getContextValue(val),
                schemaMetadata
            );

            if (this.needsValidation(key, schemaMetadata)) {
                await this.validateItem(item);
            }

            items.push(item);
        }

        return this.sortTreeItems(items);
    }

    // Determines if a field needs validation
    private needsValidation(key: string, schemaMetadata?: SchemaMetadata): boolean {
        return key === 'catalog_id'; // Add other fields as necessary
    }

    // Validates a tree item
    private async validateItem(item: CatalogTreeItem): Promise<void> {
  const apiKey = await AuthService.getApiKey(this.context);
  if (!apiKey) {
    item.updateValidationStatus(ValidationStatus.LoginRequired);
    return;
  }

  item.updateValidationStatus(ValidationStatus.Validating);

  const ibmCloudService = new IBMCloudService(apiKey);
  const isValid = await ibmCloudService.validateCatalogId(item.value as string);
  item.updateValidationStatus(
    isValid ? ValidationStatus.Valid : ValidationStatus.Invalid,
    isValid ? undefined : 'Invalid catalog ID'
  );
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
            case 'editable': return 0;    // Simple values first
            case 'container': return 1;   // Objects second
            case 'array': return 2;       // Arrays last
            default: return 3;
        }
    }

    /**
     * Determines the collapsible state for a value
     */
    private getCollapsibleState(
        value: unknown, 
        isExpanded: boolean
    ): vscode.TreeItemCollapsibleState {
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

    /**
     * Handles errors consistently
     */
    private handleError(message: string, error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`${message}: ${errorMessage}`);
        console.error(`${message}:`, error);
    }
}
