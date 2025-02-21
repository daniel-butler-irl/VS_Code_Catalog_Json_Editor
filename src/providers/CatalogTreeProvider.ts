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
    private batchUpdateTimeout: number | null = null;
    private isDisposed = false;

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
        this.logger.debug('Initializing CatalogTreeProvider', {
            hasContext: !!context,
            hasCatalogService: !!catalogService,
            hasSchemaService: !!schemaService
        });
        this.uiStateService = UIStateService.getInstance(context);

        // Initialize expanded nodes from persistent storage
        const treeState = this.uiStateService.getTreeState();
        this.logger.debug('Loading tree state', {
            expandedNodesCount: treeState.expandedNodes.length,
            expandedNodes: treeState.expandedNodes
        });

        treeState.expandedNodes.forEach(node => {
            this.expandedNodes.set(node, true);
        });

        // Setup content change handler with cache invalidation
        this.catalogService.onDidChangeContent(() => {
            this.logger.debug('Content changed, clearing caches');
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

        // Ensure cleanup on disposal
        context.subscriptions.push({
            dispose: () => {
                this.logger.debug('Disposing CatalogTreeProvider');
                this.dispose();
            }
        });
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
        if (this.isDisposed) {
            return;
        }

        if (this.batchUpdateTimeout !== null) {
            window.clearTimeout(this.batchUpdateTimeout);
            this.batchUpdateTimeout = null;
        }

        this.batchUpdateTimeout = window.setTimeout(async () => {
            if (this.isDisposed) {
                return;
            }

            try {
                const expandedNodes = Array.from(this.expandedNodes.keys());
                await this.uiStateService.updateTreeState({ expandedNodes });
            } catch (error) {
                this.logger.error('Failed to save expanded state', { error });
            } finally {
                this.batchUpdateTimeout = null;
            }
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
                const arrayLabel = `${propertyName} Array[${value.length}]`;
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

                let itemLabel = '';
                let description = '';

                // Special handling for input_mapping items
                if (parentPath.endsWith('input_mapping')) {
                    const mapping = item as Record<string, unknown>;
                    const referenceVersion = mapping.reference_version === true;

                    if ('dependency_input' in mapping && 'version_input' in mapping) {
                        itemLabel = referenceVersion ?
                            'version_input → dependency_input' :
                            'dependency_input → version_input';
                        description = `${mapping.version_input} → ${mapping.dependency_input}`;
                    } else if ('dependency_output' in mapping && 'version_input' in mapping) {
                        itemLabel = 'dependency_output → version_input';
                        description = `${mapping.dependency_output} → ${mapping.version_input}`;
                    } else if ('value' in mapping) {
                        if ('version_input' in mapping) {
                            itemLabel = 'value → version_input';
                            description = `${mapping.value} → ${mapping.version_input}`;
                        } else if ('dependency_input' in mapping) {
                            itemLabel = 'value → dependency_input';
                            description = `${mapping.value} → ${mapping.dependency_input}`;
                        }
                    }
                }
                // Handle array items with label and name fields
                else if (typeof item === 'object' && item !== null) {
                    const objItem = item as Record<string, unknown>;
                    if ('label' in objItem && typeof objItem.label === 'string') {
                        itemLabel = objItem.label;
                        if ('name' in objItem && typeof objItem.name === 'string') {
                            description = objItem.name;
                        }
                    } else {
                        itemLabel = this.getObjectLabel(objItem, index);
                    }
                }
                // Handle string items (like dependency flavors)
                else if (typeof item === 'string') {
                    itemLabel = item;
                    description = item;
                }
                else {
                    // For non-special items, use standard label logic
                    itemLabel = typeof item === 'string' ? item : this.getObjectLabel(item as Record<string, unknown>, index);
                }

                const treeItem = new CatalogTreeItem(
                    this.context,
                    itemLabel,
                    item,
                    path,
                    this.getCollapsibleState(item, this.expandedNodes.has(path)),
                    this.getContextValue(item),
                    schemaMetadata,
                    parentItem?.contextValue === 'array' ? parentItem : items[0]
                );

                if (description) {
                    treeItem.description = description;
                }

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

            // Set initial validation status
            const initialStatus = (key === 'catalog_id' || isIdNode)
                ? ValidationStatus.Pending
                : ValidationStatus.Unknown;

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

            if (initialStatus === ValidationStatus.Pending) {
                void this.queueValidation(item);
            }

            items.push(item);
        }

        return this.sortTreeItems(items);
    }

    /**
     * Gets a descriptive label for an object in an array
     */
    private getObjectLabel(obj: Record<string, unknown>, index: number): string {
        // Try to find a descriptive field
        const descriptiveFields = ['name', 'label', 'title', 'key', 'id'];
        for (const field of descriptiveFields) {
            if (field in obj && typeof obj[field] === 'string') {
                return obj[field] as string;
            }
        }
        return `Item ${index + 1}`;
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
        this.logger.debug('Disposing CatalogTreeProvider', {
            hasTimer: this.batchUpdateTimeout !== null,
            expandedNodesCount: this.expandedNodes.size
        });
        this.isDisposed = true;
        if (this.batchUpdateTimeout !== null) {
            window.clearTimeout(this.batchUpdateTimeout);
            this.batchUpdateTimeout = null;
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