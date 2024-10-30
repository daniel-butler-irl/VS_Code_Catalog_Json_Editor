// src/services/CatalogService.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { CatalogTreeItem } from '../models/CatalogTreeItem';
import { AddElementDialog } from '../ui/AddElementDialog';
import { IBMCloudService } from './IBMCloudService';
import { SchemaService } from '../services/SchemaService';
import { AuthService } from './AuthService';
import { LoggingService } from './LoggingService';
import type { OfferingFlavor } from './IBMCloudService';

/**
 * Service for managing IBM Catalog JSON data and operations
 */
export class CatalogService {
    private initialized: boolean = false;
    private _onDidChangeContent = new vscode.EventEmitter<void>();
    public readonly onDidChangeContent = this._onDidChangeContent.event;
    private logger = LoggingService.getInstance();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private catalogFilePath?: string,
        private catalogData: any = {},
        private readonly testFilePath?: string
    ) { }

    /**
     * Reloads the catalog data from disk
     * @returns Promise<void>
     * @throws Error if the file cannot be read or parsed
     */
    public async reloadCatalogData(): Promise<void> {
        this.logger.debug('Reloading catalog data');
        if (!this.initialized) {
            await this.initialize();
            return;
        }

        try {
            await this.loadCatalogData();
            this._onDidChangeContent.fire();
        } catch (error) {
            this.logger.error('Failed to reload catalog data', error);
            throw error;
        }
    }

    /**
     * Initializes the service by locating and loading the catalog file
     * @returns Promise<boolean> True if initialization was successful
     */
    public async initialize(): Promise<boolean> {
        try {
            // If test file path is provided, use it directly
            if (this.testFilePath) {
                this.catalogFilePath = this.testFilePath;
            } else {
                const catalogFile = await this.findCatalogFile();
                if (catalogFile) {
                    this.catalogFilePath = catalogFile;
                    await this.loadCatalogData();
                    this.initialized = true;
                    return true;
                } else {
                    // No file found, but we're still initialized with empty state
                    this.initialized = true;
                    this.logger.debug('No ibm_catalog.json file found in workspace');
                    return false;
                }
            }
            this.initialized = true;
            return true;
        } catch (error) {
            this.logger.error('Initialization error:', error);
            this.initialized = true; // Still mark as initialized to prevent loops
            return false;
        }
    }

    /**
     * Gets the current catalog data
     * @returns The loaded catalog data or empty object if not loaded
     */
    public async getCatalogData(): Promise<unknown | undefined> {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.catalogData;
    }

    /**
     * Gets the current catalog file path
     * @returns The path to the catalog file or undefined if not set
     */
    public getCatalogFilePath(): string | undefined {
        return this.catalogFilePath;
    }

    /**
     * Adds a new element to the catalog at the specified path.
     * @param parentNode The parent node where the new element will be added.
     * @param schemaService The schema service instance.
     */
    public async addElement(parentNode: CatalogTreeItem, schemaService: SchemaService): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            const newElement = await AddElementDialog.show(parentNode, schemaService);

            if (newElement === undefined) {
                return; // User cancelled
            }

            // Update the JSON data
            await this.updateJsonValue(`${parentNode.jsonPath}`, newElement);
            await this.loadCatalogData(); // Reload to ensure consistency
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add element: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }

    /**
     * Edits an existing element in the catalog
     * @param node The node to edit
     */
    public async editElement(node: CatalogTreeItem): Promise<void> {
        try {
            const newValue = await this.promptForValue(node, node.value);
            if (newValue === undefined) {
                return; // User cancelled
            }

            await this.updateJsonValue(node.jsonPath, newValue);
            await this.loadCatalogData(); // Reload to ensure consistency
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to edit element: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }

    /**
     * Finds the ibm_catalog.json file in the workspace
     * @returns The path to the catalog file or null if not found
     */
    private async findCatalogFile(): Promise<string | null> {
        if (this.testFilePath) {
            return this.testFilePath;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return null;
        }

        for (const folder of workspaceFolders) {
            try {
                const pattern = new vscode.RelativePattern(folder, '**/ibm_catalog.json');
                const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1);
                if (files.length > 0) {
                    return files[0].fsPath;
                }
            } catch (error) {
                console.error('Error searching for catalog file:', error);
            }
        }

        return null;
    }

    /**
     * Loads the catalog data from the file
     * @throws Error if the file cannot be read or parsed
     */
    private async loadCatalogData(): Promise<void> {
        if (!this.catalogFilePath) {
            this.catalogData = {};
            return;
        }

        try {
            const content = await fs.readFile(this.catalogFilePath, 'utf8');
            this.catalogData = JSON.parse(content) as any; // Explicitly cast as any
            this._onDidChangeContent.fire(); // Fire the event
        } catch (error) {
            this.catalogData = {};
            if (error instanceof Error) {
                throw new Error(`Failed to load catalog data: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Parses a JSONPath string into its segments.
     * @param jsonPath The JSONPath string.
     * @returns An array of strings and numbers representing the path segments.
     */
    private parseJsonPath(jsonPath: string): (string | number)[] {
        const segments: (string | number)[] = [];
        const regex = /\[(\d+)\]|\.([^.\[\]]+)/g;
        let match;
        while ((match = regex.exec(jsonPath)) !== null) {
            if (match[1] !== undefined) {
                // Array index
                segments.push(parseInt(match[1], 10));
            } else if (match[2] !== undefined) {
                // Object key
                segments.push(match[2]);
            }
        }
        return segments;
    }

    /**
    * Updates a value in the JSON data based on the JSONPath
    * @param jsonPath The JSONPath string
    * @param newValue The new value to set
    */
    public async updateJsonValue(jsonPath: string, newValue: unknown): Promise<void> {
        if (!this.catalogFilePath || !this.catalogData) {
            throw new Error('Catalog file not initialized');
        }

        try {
            const data = this.catalogData;
            const pathParts = this.parseJsonPath(jsonPath);
            this.logger.debug(`Parsed jsonPath: ${jsonPath} into pathParts: ${JSON.stringify(pathParts)}`);
            let current: any = data;

            // Navigate to the parent of the target
            for (let i = 0; i < pathParts.length - 1; i++) {
                const part = pathParts[i];
                this.logger.debug(`At path part ${i}, part: ${part}, current type: ${typeof current}, current: ${JSON.stringify(current)}`);
                if (typeof part === 'string') {
                    if (current !== null && !Array.isArray(current) && typeof current === 'object' && part in current) {
                        current = current[part];
                    } else {
                        this.logger.error(`Invalid path at part '${part}' for current: ${JSON.stringify(current)}`);
                        throw new Error(`Invalid path: ${jsonPath}`);
                    }
                } else if (typeof part === 'number') {
                    if (Array.isArray(current) && part >= 0 && part < current.length) {
                        current = current[part];
                    } else {
                        this.logger.error(`Invalid array index '${part}' for current: ${JSON.stringify(current)}`);
                        throw new Error(`Invalid path: ${jsonPath}`);
                    }
                } else {
                    this.logger.error(`Invalid part type '${typeof part}' for part '${part}'`);
                    throw new Error(`Invalid path: ${jsonPath}`);
                }
            }

            // Update the value
            const lastPart = pathParts[pathParts.length - 1];
            this.logger.debug(`Last part: ${lastPart}, current: ${JSON.stringify(current)}`);
            if (typeof lastPart === 'string') {
                if (current !== null && !Array.isArray(current) && typeof current === 'object') {
                    current[lastPart] = newValue;
                } else {
                    this.logger.error(`Cannot set property '${lastPart}' on current: ${JSON.stringify(current)}`);
                    throw new Error(`Invalid path: ${jsonPath}`);
                }
            } else if (typeof lastPart === 'number') {
                if (Array.isArray(current) && lastPart >= 0 && lastPart < current.length) {
                    current[lastPart] = newValue;
                } else {
                    this.logger.error(`Invalid array index '${lastPart}' on current: ${JSON.stringify(current)}`);
                    throw new Error(`Invalid path: ${jsonPath}`);
                }
            } else {
                this.logger.error(`Invalid last part type '${typeof lastPart}' for part '${lastPart}'`);
                throw new Error(`Invalid path: ${jsonPath}`);
            }

            // Write back to file
            await fs.writeFile(
                this.catalogFilePath,
                JSON.stringify(this.catalogData, null, 2),
                'utf8'
            );

            // Trigger refresh without waiting
            setImmediate(() => this._onDidChangeContent.fire());
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Failed to update JSON value: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Prompts the user for a value based on the node type
     */
    private async promptForValue(node: CatalogTreeItem, currentValue?: unknown): Promise<unknown> {
        if (node.label === 'catalog_id') {
            return this.promptForCatalogId(currentValue as string);
        }

        if (node.isOfferingIdInDependency()) {
            return this.promptForOfferingId(node, currentValue as string);
        }

        // Add flavor handling
        if (this.isFlavorSelection(node)) {
            return this.promptForFlavor(node, currentValue as string);
        }

        // Handle other types as before
        const value = await vscode.window.showInputBox({
            prompt: `Enter value for ${node.label}`,
            value: currentValue?.toString() ?? '',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Value cannot be empty';
                }
                return null;
            }
        });

        if (value === undefined) {
            return undefined;
        }

        // Parse value as before...
        if (value.toLowerCase() === 'true') { return true; }
        if (value.toLowerCase() === 'false') { return false; }
        if (!isNaN(Number(value))) { return Number(value); }
        return value;
    }

    /**
     * Prompts the user to select or enter a catalog ID
     */
    private async promptForCatalogId(currentValue?: string): Promise<string | undefined> {
        const logger = this.logger;
        const apiKey = await AuthService.getApiKey(this.context);

        if (!apiKey) {
            logger.debug('No API key available for catalog lookup');
            return this.promptForManualCatalogId(currentValue);
        }

        try {
            const ibmCloudService = new IBMCloudService(apiKey);
            const catalogs = await ibmCloudService.getAvailableCatalogs();

            // Create QuickPick items
            const items: vscode.QuickPickItem[] = [
                // Add option to enter custom ID
                {
                    label: "$(edit) Enter Custom Catalog ID",
                    description: "Manually enter a catalog ID",
                    alwaysShow: true
                },
                // Add separator
                {
                    label: "Available Catalogs",
                    kind: vscode.QuickPickItemKind.Separator
                },
                // Add available catalogs
                ...catalogs.map(catalog => ({
                    label: catalog.label,
                    description: catalog.id,
                    detail: catalog.shortDescription
                }))
            ];

            // Show QuickPick
            const selection = await vscode.window.showQuickPick(items, {
                title: 'Select Catalog',
                placeHolder: currentValue || 'Select a catalog or enter a custom ID',
                matchOnDescription: true, // Allow matching on catalog ID
                matchOnDetail: true // Allow matching on description
            });

            if (!selection) {
                return undefined; // User cancelled
            }

            // If user chose to enter custom ID, show input box
            if (selection.label === "$(edit) Enter Custom Catalog ID") {
                return this.promptForManualCatalogId(currentValue);
            }

            // Return the selected catalog ID
            return selection.description;

        } catch (error) {
            logger.error('Failed to fetch catalogs', error);
            // Fallback to manual entry
            return this.promptForManualCatalogId(currentValue);
        }
    }

    /**
     * Prompts for manual catalog ID entry
     */
    private async promptForManualCatalogId(currentValue?: string): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt: 'Enter the catalog ID',
            value: currentValue,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Catalog ID cannot be empty';
                }
                // Add any additional validation rules here
                return null;
            }
        });
    }

    /**
     * Prompts the user to select or enter an offering ID within a dependency
     * @param node The dependency node.
     * @param currentValue The current offering ID.
     * @returns The selected or entered offering ID.
     */
    private async promptForOfferingId(node: CatalogTreeItem, currentValue?: string): Promise<string | undefined> {
        const logger = this.logger;
        const apiKey = await AuthService.getApiKey(this.context);

        if (!apiKey) {
            logger.debug('No API key available for offering lookup');
            return this.promptForManualOfferingId(currentValue);
        }

        // Retrieve the corresponding catalog_id from the parent nodes
        const catalogId = await this.getCatalogIdForNode(node);
        if (!catalogId) {
            vscode.window.showErrorMessage('Cannot determine catalog_id for offering validation.');
            return undefined;
        }

        try {
            const ibmCloudService = new IBMCloudService(apiKey);
            const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);

            // Create QuickPick items
            const items: vscode.QuickPickItem[] = [
                // Add option to enter custom ID
                {
                    label: "$(edit) Enter Custom Offering ID",
                    description: "Manually enter an offering ID",
                    alwaysShow: true
                },
                // Add separator
                {
                    label: "Available Offerings",
                    kind: vscode.QuickPickItemKind.Separator
                },
                // Add available offerings
                ...offerings.map(offering => ({
                    label: offering.name,
                    description: offering.id,
                    detail: offering.shortDescription
                }))
            ];

            // Show QuickPick
            const selection = await vscode.window.showQuickPick(items, {
                title: 'Select Offering',
                placeHolder: currentValue || 'Select an offering or enter a custom ID',
                matchOnDescription: true, // Allow matching on offering ID
                matchOnDetail: true // Allow matching on description
            });

            if (!selection) {
                return undefined; // User cancelled
            }

            // If user chose to enter custom ID, show input box
            if (selection.label === "$(edit) Enter Custom Offering ID") {
                return this.promptForManualOfferingId(currentValue);
            }

            // Return the selected offering ID
            return selection.description;

        } catch (error) {
            logger.error('Failed to fetch offerings', error);
            // Fallback to manual entry
            return this.promptForManualOfferingId(currentValue);
        }
    }

    /**
     * Prompts for manual offering ID entry
     */
    private async promptForManualOfferingId(currentValue?: string): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt: 'Enter the offering ID',
            value: currentValue,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Offering ID cannot be empty';
                }
                // Add any additional validation rules here
                return null;
            }
        });
    }

    /**
     * Prompts the user to select or enter a flavor for a dependency
     * @param node The node representing the flavor field
     * @param currentValue The current flavor value
     * @returns Promise<string | undefined> The selected flavor name
     */
    private async promptForFlavor(node: CatalogTreeItem, currentValue?: string): Promise<string | undefined> {
        const logger = this.logger;
        const apiKey = await AuthService.getApiKey(this.context);

        if (!apiKey) {
            logger.debug('No API key available for flavor lookup');
            return this.promptForManualFlavorInput(currentValue);
        }

        // Get dependency context using CatalogTreeItem methods
        const dependencyNode = node.getDependencyParent();
        logger.debug('Finding dependency context', {
            currentPath: node.jsonPath,
            dependencyNodeFound: !!dependencyNode,
            dependencyPath: dependencyNode?.jsonPath,
            dependencyValue: dependencyNode?.value
        });

        const context = node.getDependencyContext();
        logger.debug('Resolved dependency context', {
            context,
            currentNodePath: node.jsonPath,
            parentNodePath: dependencyNode?.jsonPath
        });

        if (!context.catalogId || !context.offeringId) {
            logger.error('Missing dependency context', {
                node: node.jsonPath,
                context,
                parentNode: dependencyNode?.jsonPath,
                parentValue: dependencyNode?.value
            });
            vscode.window.showErrorMessage('Cannot determine catalog ID or offering ID for flavor selection.');
            return this.promptForManualFlavorInput(currentValue);
        }

        try {
            const ibmCloudService = new IBMCloudService(apiKey);
            logger.debug('Fetching flavors for offering', {
                catalogId: context.catalogId,
                offeringId: context.offeringId
            });

            const flavors = await ibmCloudService.getAvailableFlavors(context.catalogId, context.offeringId);
            logger.debug('Retrieved flavors', {
                count: flavors.length,
                flavors
            });

            if (flavors.length === 0) {
                logger.debug('No flavors available for offering', {
                    catalogId: context.catalogId,
                    offeringId: context.offeringId
                });
                vscode.window.showWarningMessage('No flavors available for this offering.');
                return this.promptForManualFlavorInput(currentValue);
            }

            // Create QuickPick items
            const items: vscode.QuickPickItem[] = [
                {
                    label: "$(edit) Enter Custom Flavor",
                    description: "Manually enter a flavor name",
                    alwaysShow: true
                },
                {
                    label: "Available Flavors",
                    kind: vscode.QuickPickItemKind.Separator
                }
            ];

            // Add available flavors with details
            for (const flavorName of flavors) {
                try {
                    const details = await ibmCloudService.getFlavorDetails(
                        context.catalogId,
                        context.offeringId,
                        flavorName
                    );

                    logger.debug('Retrieved flavor details', {
                        flavorName,
                        details,
                        isCurrentValue: flavorName === currentValue
                    });

                    items.push({
                        // If this is the current value, add a checkmark
                        label: `${flavorName === currentValue ? '$(check) ' : ''}${details?.label || flavorName}`,
                        description: flavorName,
                        detail: this.createFlavorDetail(flavorName, details, currentValue)
                    });
                } catch (error) {
                    logger.error('Failed to get flavor details', {
                        flavorName,
                        error,
                        catalogId: context.catalogId,
                        offeringId: context.offeringId
                    });
                    // Still add the flavor, just with minimal information
                    items.push({
                        label: `${flavorName === currentValue ? '$(check) ' : ''}${flavorName}`,
                        description: flavorName,
                        detail: flavorName === currentValue ? '(Current Selection)' : undefined
                    });
                }
            }

            // Show QuickPick
            const selection = await vscode.window.showQuickPick(items, {
                title: 'Select Flavor',
                placeHolder: currentValue || 'Select a flavor or enter a custom name',
                matchOnDescription: true, // Allow matching on flavor ID
                matchOnDetail: true // Allow matching on description
            });

            if (!selection) {
                return undefined; // User cancelled
            }

            // If user chose to enter custom flavor, show input box
            if (selection.label === "$(edit) Enter Custom Flavor") {
                return this.promptForManualFlavorInput(currentValue);
            }

            // Return the selected flavor name
            return selection.description;
        } catch (error) {
            logger.error('Failed to fetch flavors', error);
            // Fallback to manual entry
            return this.promptForManualFlavorInput(currentValue);
        }
    }

    /**
     * Prompts for manual flavor name entry
     * @param currentValue The current flavor value
     * @returns Promise<string | undefined> The entered flavor name
     */
    private async promptForManualFlavorInput(currentValue?: string): Promise<string | undefined> {
        const logger = this.logger;
        logger.debug('Prompting for manual flavor input', { currentValue });

        const result = await vscode.window.showInputBox({
            prompt: 'Enter the flavor name',
            value: currentValue,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Flavor name cannot be empty';
                }
                return null;
            }
        });

        logger.debug('Manual flavor input result', {
            result,
            currentValue,
            changed: result !== currentValue
        });

        return result;
    }

    /**
     * Creates a detail string for a flavor in the QuickPick
     * @param flavorName The name of the flavor
     * @param details The flavor details if available
     * @param currentValue The current selected value if any
     * @returns A formatted detail string
     */
    private createFlavorDetail(
        flavorName: string,
        details: OfferingFlavor | undefined,
        currentValue?: string
    ): string {
        const parts: string[] = [];

        // Add current selection indicator
        if (flavorName === currentValue) {
            parts.push('(Current Selection)');
        }

        // Add localized label if available
        if (details?.label_i18n?.['en']) {
            parts.push(details.label_i18n['en']);
        }

        // Add name if different from label
        if (details?.name && details.name !== details?.label) {
            parts.push(`Name: ${details.name}`);
        }

        // Add display name if available and different
        if (details?.displayName &&
            details.displayName !== details.label &&
            details.displayName !== details.name) {
            parts.push(`Display: ${details.displayName}`);
        }

        // Use raw flavor name if no other details available
        if (parts.length === 0) {
            return 'No additional details available';
        }

        return parts.join(' • ');
    }

    /**
     * Checks if the node represents a flavor selection within a dependency
     * @param node The tree item to check
     * @returns boolean True if the node is a flavor selection
     */
    private isFlavorSelection(node: CatalogTreeItem): boolean {
        const logger = this.logger;
        // Matches items in a dependency's flavors array
        const flavorPattern = /\.dependencies\[\d+\]\.flavors\[\d+\]$/;
        const result = flavorPattern.test(node.jsonPath);

        logger.debug('Checking if node is flavor selection', {
            path: node.jsonPath,
            isFlavorSelection: result,
            pattern: flavorPattern.toString()
        });

        return result;
    }

    /**
    * Retrieves the catalog_id associated with a given node.
    */
    public async getCatalogIdForNode(node: CatalogTreeItem): Promise<string | undefined> {
        const parentNode = node.parent;
        if (parentNode && typeof parentNode.value === 'object' && parentNode.value !== null) {
            // Type assertion to inform TypeScript about the structure
            const catalogId = (parentNode.value as Record<string, any>)['catalog_id'];
            if (typeof catalogId === 'string') {
                return catalogId;
            }
        }
        return undefined;
    }
}
