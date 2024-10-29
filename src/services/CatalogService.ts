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
    ) {}

    /**
     * Initializes the service by locating and loading the catalog file
     * @returns True if initialization was successful, false otherwise
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
                    console.log('No ibm_catalog.json file found in workspace');
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.error('Initialization error:', error);
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

private async updateJsonValue(jsonPath: string, newValue: unknown): Promise<void> {
    if (!this.catalogFilePath || !this.catalogData) {
        throw new Error('Catalog file not initialized');
    }

    try {
        const data = this.catalogData;
        const pathParts = this.parseJsonPath(jsonPath);
        console.log(`Parsed jsonPath: ${jsonPath} into pathParts: ${JSON.stringify(pathParts)}`);
        let current: any = data;

        // Navigate to the parent of the target
        for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            console.log(`At path part ${i}, part: ${part}, current type: ${typeof current}, current: ${JSON.stringify(current)}`);
            if (typeof part === 'string') {
                if (current !== null && !Array.isArray(current) && typeof current === 'object' && part in current) {
                    current = current[part];
                } else {
                    console.log(`Invalid path at part '${part}' for current: ${JSON.stringify(current)}`);
                    throw new Error(`Invalid path: ${jsonPath}`);
                }
            } else if (typeof part === 'number') {
                if (Array.isArray(current) && part >= 0 && part < current.length) {
                    current = current[part];
                } else {
                    console.log(`Invalid array index '${part}' for current: ${JSON.stringify(current)}`);
                    throw new Error(`Invalid path: ${jsonPath}`);
                }
            } else {
                console.log(`Invalid part type '${typeof part}' for part '${part}'`);
                throw new Error(`Invalid path: ${jsonPath}`);
            }
        }

        // Update the value
        const lastPart = pathParts[pathParts.length - 1];
        console.log(`Last part: ${lastPart}, current: ${JSON.stringify(current)}`);
        if (typeof lastPart === 'string') {
            if (current !== null && !Array.isArray(current) && typeof current === 'object') {
                current[lastPart] = newValue;
            } else {
                console.log(`Cannot set property '${lastPart}' on current: ${JSON.stringify(current)}`);
                throw new Error(`Invalid path: ${jsonPath}`);
            }
        } else if (typeof lastPart === 'number') {
            if (Array.isArray(current) && lastPart >= 0 && lastPart < current.length) {
                current[lastPart] = newValue;
            } else {
                console.log(`Invalid array index '${lastPart}' on current: ${JSON.stringify(current)}`);
                throw new Error(`Invalid path: ${jsonPath}`);
            }
        } else {
            console.log(`Invalid last part type '${typeof lastPart}' for part '${lastPart}'`);
            throw new Error(`Invalid path: ${jsonPath}`);
        }

        // Write back to file
        await fs.writeFile(
            this.catalogFilePath,
            JSON.stringify(this.catalogData, null, 2),
            'utf8'
        );

        this._onDidChangeContent.fire(); // Fire the event
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
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        if (!isNaN(Number(value))) return Number(value);
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
}