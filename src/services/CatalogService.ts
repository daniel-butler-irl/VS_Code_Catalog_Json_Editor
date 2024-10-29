// src/services/CatalogService.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { CatalogTreeItem } from '../models/CatalogTreeItem';

/**
 * Service for managing IBM Catalog JSON data and operations
 */
export class CatalogService {
    private initialized: boolean = false;
    private _onDidChangeContent = new vscode.EventEmitter<void>();
    public readonly onDidChangeContent = this._onDidChangeContent.event;


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
     * Adds a new element to the catalog
     * @param parentNode The parent node to add the element to
     */
    public async addElement(parentNode?: CatalogTreeItem): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            if (!parentNode) {
                throw new Error('No parent node specified');
            }

            const newValue = await this.promptForValue(parentNode);
            if (newValue === undefined) {
                return; // User cancelled
            }

            await this.updateJsonValue(parentNode.jsonPath, newValue);
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
     * @param node The node being edited or the parent node for new elements
     * @param currentValue The current value when editing
     * @returns The new value or undefined if cancelled
     */
    private async promptForValue(node: CatalogTreeItem, currentValue?: unknown): Promise<unknown> {
        // For Phase 1, we'll handle basic types. Phase 2 will add more sophisticated input handling
        const value = await vscode.window.showInputBox({
            prompt: `Enter value for ${node.label}`,
            value: currentValue?.toString() ?? '',
            validateInput: (value) => {
                // Basic validation for Phase 1
                if (!value.trim()) {
                    return 'Value cannot be empty';
                }
                return null;
            }
        });

        if (value === undefined) {
            return undefined;
        }

        // Try to parse as number or boolean if appropriate
        if (value.toLowerCase() === 'true') {return true;}
        if (value.toLowerCase() === 'false') {return false;}
        if (!isNaN(Number(value))) {return Number(value);}
        return value;
    }

    public async reloadCatalogData(): Promise<void> {
    await this.loadCatalogData();
}
}