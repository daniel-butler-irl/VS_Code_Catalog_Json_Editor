// src/services/CatalogTreeProvider.ts

import * as vscode from 'vscode';
import { CatalogTreeItem } from '../models/CatalogTreeItem';
import { CatalogService } from '../services/CatalogService';
import { SchemaService } from '../services/SchemaService';
import { LoggingService } from '../services/core/LoggingService';
import { UIStateService } from '../services/core/UIStateService';
import { SchemaMetadata } from '../types/schema';
import { ValidationStatus } from '../types/validation';

/**
* Provides a performant tree view representation of the IBM Catalog JSON structure.
* Handles tree item creation, state persistence, validation, and dynamic updates.
*/
export class CatalogTreeProvider implements vscode.TreeDataProvider<CatalogTreeItem> {
    //
    // Event Emitters & Core Properties
    //
    private _onDidChangeTreeData: vscode.EventEmitter<CatalogTreeItem | undefined> = new vscode.EventEmitter<CatalogTreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<CatalogTreeItem | undefined> = this._onDidChangeTreeData.event;
    private treeView?: vscode.TreeView<CatalogTreeItem>;
    private readonly logger: LoggingService;
    private readonly uiStateService: UIStateService;

    //
    // Performance Optimizations & Caching
    //
    private readonly expandedNodes = new Map<string, boolean>();
    private readonly memoizedPaths = new Map<string, string>();
    private readonly memoizedSchemaMetadata = new Map<string, SchemaMetadata | undefined>();
    private batchStateUpdateTimer: NodeJS.Timeout | null = null;

    /**
     * Creates a new CatalogTreeProvider instance.
     * Initializes state management and sets up change listeners.
     */
    constructor(
        private readonly catalogService: CatalogService,
        private readonly context: vscode.ExtensionContext,
        private readonly schemaService: SchemaService
    ) {
        this.logger = LoggingService.getInstance();
        this.uiStateService = UIStateService.getInstance(context);

        // Initialize expanded nodes from persistent storage
        this.uiStateService.getTreeState().expandedNodes.forEach(node => {
            this.expandedNodes.set(node, true);
        });

        // Setup content change handler with cache invalidation
        this.catalogService.onDidChangeContent(() => {
            this.clearCaches();
            this.refresh();
        });

        // Listen for refresh context changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('ibmCatalog.refresh')) {
                    this.refresh();
                }
            })
        );
    }

    //
    // TreeDataProvider Implementation 
    //

    /**
     * Gets the rendered tree item for a given element.
     * Uses cached state for expanded/collapsed status.
     */
    public getTreeItem(element: CatalogTreeItem): vscode.TreeItem {
        const isExpanded = this.expandedNodes.has(element.jsonPath);
        return element.withCollapsibleState(
            this.getCollapsibleState(element.value, isExpanded)
        );
    }

    /**
     * Gets child tree items for a given element.
     * Returns root items if no element is provided.
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
     * Refreshes all or part of the tree view.
     * Clears caches on full refresh.
     */
    public refresh(item?: CatalogTreeItem): void {
        if (!item) {
            this.clearCaches();
        }
        this._onDidChangeTreeData.fire(item);
    }

    //
    // Tree View Management
    //

    /**
     * Sets up the tree view and configures state tracking.
     * Registers expand/collapse handlers and state persistence.
     */
    public setTreeView(treeView: vscode.TreeView<CatalogTreeItem>): void {
        this.treeView = treeView;
        this.setupEventHandlers();
        this.context.subscriptions.push(this.treeView);
    }

    /**
     * Sets up event handlers for tree view interactions.
     * Implements debounced state updates for performance.
     */
    private setupEventHandlers(): void {
        if (!this.treeView) { return; }

        this.treeView.onDidExpandElement((e) => {
            this.expandedNodes.set(e.element.jsonPath, true);
            this.queueStateUpdate();
        });

        this.treeView.onDidCollapseElement((e) => {
            this.expandedNodes.delete(e.element.jsonPath);
            this.queueStateUpdate();
        });
    }

    //
    // State Management
    //

    /**
     * Queues a state update with debouncing.
     * Prevents rapid consecutive saves for better performance.
     */
    private queueStateUpdate(): void {
        if (this.batchStateUpdateTimer) {
            clearTimeout(this.batchStateUpdateTimer);
        }

        this.batchStateUpdateTimer = setTimeout(async () => {
            try {
                await this.uiStateService.updateTreeState({
                    expandedNodes: Array.from(this.expandedNodes.keys())
                });
            } catch (error) {
                this.logger.error('Failed to save expanded state', error);
            }
            this.batchStateUpdateTimer = null;
        }, 250);
    }

    /**
     * Clears all internal caches.
     * Called during full refresh or catalog content changes.
     */
    private clearCaches(): void {
        this.memoizedPaths.clear();
        this.memoizedSchemaMetadata.clear();
    }

    //
    // Tree Item Creation & Modification
    //

    /**
     * Creates tree items from a JSON value.
     * Handles validation state and special node types.
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

        // Handle array items
        if (Array.isArray(value)) {
            // Create array header item if this is not a child of an array
            if (parentItem?.contextValue !== 'array') {
                const propertyName = parentPath.split('.').pop()?.replace(/\[\d+\]/g, '') || '';
                const arrayLabel = `${propertyName} Array [${value.length}]`;
                const arrayItem = new CatalogTreeItem(
                    this.context,
                    arrayLabel,
                    value,
                    parentPath,
                    this.getCollapsibleState(value, this.expandedNodes.has(parentPath)),
                    'array',
                    undefined,
                    parentItem
                );
                items.push(arrayItem);
            }

            // Create items for array elements
            value.forEach((item, index) => {
                const path = this.buildJsonPath(parentPath, index.toString());
                const schemaMetadata = this.getSchemaMetadata(path);

                // For array items, if the item is a string, use it directly as the label
                const itemLabel = typeof item === 'string' ? item : this.getObjectLabel(item, index);

                const treeItem = new CatalogTreeItem(
                    this.context,
                    itemLabel,
                    item,
                    path,
                    this.getCollapsibleState(item, this.expandedNodes.has(path)),
                    this.getContextValue(item),
                    schemaMetadata,
                    parentItem?.contextValue === 'array' ? parentItem : items[0] // Link to array header if exists
                );

                items.push(treeItem);
            });
            return items;
        }

        // Handle object properties
        for (const [key, val] of Object.entries(value)) {
            const path = this.buildJsonPath(parentPath, key);
            const schemaMetadata = this.getSchemaMetadata(path);

            const isIdNode = parentItem?.isOfferingIdInDependency() && key === 'id';
            const catalogId = isIdNode && parentItem?.catalogId ? parentItem.catalogId : undefined;

            // Set initial validation status based on authentication state
            const initialStatus = (key === 'catalog_id' || isIdNode)
                ? ValidationStatus.Unknown  // Always start as Unknown
                : ValidationStatus.Unknown;

            // Remove array indices from the key display
            const displayKey = key.replace(/\[\d+\]/g, '');

            const item = new CatalogTreeItem(
                this.context,
                displayKey,
                val,
                path,
                this.getCollapsibleState(val, this.expandedNodes.has(path)),
                this.getContextValue(val),
                schemaMetadata,
                parentItem,
                catalogId,
                initialStatus
            );

            // Queue validation only if we're authenticated and the item needs validation
            if ((key === 'catalog_id' || isIdNode) && this.catalogService.hasFullFunctionality()) {
                void this.queueValidation(item);
            }

            items.push(item);
        }

        return this.sortTreeItems(items);
    }

    /**
     * Gets a display label for an object in an array
     */
    private getObjectLabel(item: unknown, index: number): string {
        if (typeof item !== 'object' || item === null) {
            return `${index + 1}`;
        }

        const obj = item as Record<string, unknown>;
        this.logger.debug('Resolving object label - Full object details', {
            index,
            availableProperties: Object.keys(obj),
            hasLabel: 'label' in obj,
            hasName: 'name' in obj,
            hasId: 'id' in obj,
            isDependency: 'catalog_id' in obj && 'id' in obj,
            objectValue: obj,
            labelValue: obj.label,
            nameValue: obj.name,
            idValue: obj.id,
            storedLabel: typeof obj.label === 'string' ? obj.label : undefined
        });

        // For dependency nodes, check if we have a cached label
        if ('id' in obj && typeof obj.id === 'string' && 'catalog_id' in obj) {
            this.logger.debug('Processing dependency node label', {
                id: obj.id,
                catalogId: obj.catalog_id,
                hasLabel: 'label' in obj,
                labelValue: obj.label,
                hasName: 'name' in obj,
                nameValue: obj.name,
                storedLabel: typeof obj.label === 'string' ? obj.label : undefined
            });

            if ('label' in obj && typeof obj.label === 'string') {
                this.logger.debug('Using cached label for dependency', {
                    label: obj.label,
                    id: obj.id,
                    fullObject: obj
                });
                return obj.label;
            }
            if ('name' in obj && typeof obj.name === 'string') {
                this.logger.debug('Using name for dependency (no label found)', {
                    name: obj.name,
                    id: obj.id,
                    fullObject: obj
                });
                return obj.name;
            }
            this.logger.debug('No label or name found for dependency, falling back to id', {
                id: obj.id,
                fullObject: obj
            });
            return obj.name as string || obj.id as string; // Fallback to name, then ID
        }

        // Always prioritize label over name for display
        if ('label' in obj && typeof obj.label === 'string') {
            return obj.label;
        }

        // Fallback to name if no label
        if ('name' in obj && typeof obj.name === 'string') {
            return obj.name;
        }

        // Try other identifier properties
        const labelProperties = ['title', 'id'];
        for (const prop of labelProperties) {
            if (prop in obj && typeof obj[prop] === 'string') {
                return obj[prop] as string;
            }
        }

        // If no meaningful label is found, use the first string property
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                return value;
            }
        }

        // If no string property is found, return empty string (the object icon will still show)
        return '';
    }

    /**
     * Queues an item for background validation.
     */
    private async queueValidation(item: CatalogTreeItem): Promise<void> {
        void item.queueForValidation();
    }

    //
    // Path & Schema Management
    //

    /**
     * Builds a JSONPath expression with caching.
     */
    private buildJsonPath(parentPath: string, key: string): string {
        const cacheKey = `${parentPath}:${key}`;
        const cached = this.memoizedPaths.get(cacheKey);
        if (cached) { return cached; }

        let result: string;
        if (/^\[\d+\]$/.test(key)) {
            result = `${parentPath}${key}`;
        } else if (/^\d+$/.test(key)) {
            result = `${parentPath}[${key}]`;
        } else if (parentPath === '$') {
            result = `$.${key}`;
        } else {
            result = `${parentPath}.${key}`;
        }

        this.memoizedPaths.set(cacheKey, result);
        return result;
    }

    /**
     * Gets cached schema metadata for a path.
     */
    private getSchemaMetadata(path: string): SchemaMetadata | undefined {
        const cached = this.memoizedSchemaMetadata.get(path);
        if (cached !== undefined) { return cached; }

        const metadata = this.schemaService?.getSchemaForPath(path);
        this.memoizedSchemaMetadata.set(path, metadata);
        return metadata;
    }

    //
    // Tree Item Utilities
    //

    /**
     * Determines the collapsible state for a value.
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
     * Gets the context value for menu contributions.
     */
    private getContextValue(value: unknown): string {
        if (Array.isArray(value)) { return 'array'; }
        if (typeof value === 'object' && value !== null) { return 'container'; }
        return 'editable';
    }

    /**
     * Sorts tree items for consistent display.
     */
    private sortTreeItems(items: CatalogTreeItem[]): CatalogTreeItem[] {
        return items.sort((a, b) => {
            const aRequired = a.schemaMetadata?.required ?? false;
            const bRequired = b.schemaMetadata?.required ?? false;
            if (aRequired !== bRequired) {
                return bRequired ? 1 : -1;
            }

            const aOrder = this.getTypeOrder(a);
            const bOrder = this.getTypeOrder(b);
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }

            return a.label.localeCompare(b.label);
        });
    }

    /**
     * Gets sort order priority for tree item types.
     */
    private getTypeOrder(item: CatalogTreeItem): number {
        switch (item.contextValue) {
            case 'editable': return 0;
            case 'container': return 1;
            case 'array': return 2;
            default: return 3;
        }
    }

    /**
     * Disposes of resources and cleans up event handlers.
     */
    public dispose(): void {
        if (this.batchStateUpdateTimer) {
            clearTimeout(this.batchStateUpdateTimer);
        }
        this.clearCaches();
        this._onDidChangeTreeData.dispose();
    }

    /**
     * Finds a tree item by its JSON path
     * @param jsonPath The JSON path to search for
     * @returns The found tree item or undefined
     */
    public async findTreeItemByPath(jsonPath: string): Promise<CatalogTreeItem | undefined> {
        this.logger.debug('Finding tree item for path', { path: jsonPath });

        // Parse the path into segments
        const segments = jsonPath.split(/\.|\[|\]/).filter(s => s && s !== '$');
        this.logger.debug('Path segments', { segments });

        // Start from root and traverse
        let currentItems = await this.getChildren();
        this.logger.debug(`Found ${currentItems.length} root items`);

        let currentItem: CatalogTreeItem | undefined;

        for (const segment of segments) {
            // For array indices, convert to number
            const isArrayIndex = !isNaN(Number(segment));
            const searchValue = isArrayIndex ? Number(segment) : segment;

            this.logger.debug('Searching for segment', {
                segment,
                isArrayIndex,
                searchValue,
                availableLabels: currentItems.map(item => item.label)
            });

            // Find matching item in current level
            currentItem = currentItems.find(item => {
                if (isArrayIndex) {
                    // Try different array index formats
                    return (
                        item.label === `[${searchValue}]` || // Format: [0]
                        item.label === searchValue.toString() || // Format: 0
                        item.jsonPath.endsWith(`[${searchValue}]`) // Check path ending
                    );
                }
                return item.label === searchValue;
            });

            if (!currentItem) {
                this.logger.debug('No matching item found for segment', { segment });
                return undefined;
            }

            this.logger.debug('Found matching item', {
                label: currentItem.label,
                path: currentItem.jsonPath,
                type: currentItem.contextValue
            });

            // Get children for next iteration
            currentItems = await this.getChildren(currentItem);
            this.logger.debug(`Found ${currentItems.length} children for next iteration`);
        }

        if (currentItem) {
            this.logger.debug('Successfully found item for path', {
                label: currentItem.label,
                path: currentItem.jsonPath
            });
        }

        return currentItem;
    }

    /**
     * Gets the parent of a tree item
     * Required for the reveal functionality to work
     */
    public getParent(element: CatalogTreeItem): vscode.ProviderResult<CatalogTreeItem> {
        this.logger.debug('Getting parent for item:', {
            label: element.label,
            path: element.jsonPath
        });

        // The parent is already tracked in the CatalogTreeItem
        return element.parent;
    }

    /**
     * Finds tree items by their JSON path
     */
    public async findItemsByJsonPath(jsonPath: string): Promise<CatalogTreeItem[]> {
        const items: CatalogTreeItem[] = [];
        const rootItems = await this.getChildren();

        const findInItems = async (currentItems: CatalogTreeItem[]): Promise<void> => {
            for (const item of currentItems) {
                if (item.jsonPath === jsonPath) {
                    items.push(item);
                }
                const children = await this.getChildren(item);
                await findInItems(children);
            }
        };

        await findInItems(rootItems);
        return items;
    }
}