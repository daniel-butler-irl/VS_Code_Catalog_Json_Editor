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

    constructor(
        private readonly context: vscode.ExtensionContext,
        private catalogFilePath?: string,
        private catalogData: unknown = {},  // Initialize with empty object
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
    public async getCatalogData(): Promise<unknown> {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.catalogData || {};
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

            await this.updateJsonValue(parentNode.path, newValue);
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

            await this.updateJsonValue(node.path, newValue);
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
            this.catalogData = JSON.parse(content);
        } catch (error) {
            this.catalogData = {};
            if (error instanceof Error) {
                throw new Error(`Failed to load catalog data: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Updates a value in the JSON file at the specified path
     * @param jsonPath The path to the value in the JSON
     * @param newValue The new value to set
     */
    private async updateJsonValue(jsonPath: string, newValue: unknown): Promise<void> {
        if (!this.catalogFilePath || !this.catalogData) {
            throw new Error('Catalog file not initialized');
        }

        try {
            const data = this.catalogData as Record<string, unknown>;
            const pathParts = jsonPath.split('.');
            let current = data;

            // Navigate to the parent of the target
            for (let i = 0; i < pathParts.length - 1; i++) {
                const part = pathParts[i];
                if (typeof current[part] === 'object' && current[part] !== null) {
                    current = current[part] as Record<string, unknown>;
                } else {
                    throw new Error(`Invalid path: ${jsonPath}`);
                }
            }

            // Update the value
            const lastPart = pathParts[pathParts.length - 1];
            current[lastPart] = newValue;

            // Write back to file
            await fs.writeFile(
                this.catalogFilePath,
                JSON.stringify(this.catalogData, null, 2),
                'utf8'
            );
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
}