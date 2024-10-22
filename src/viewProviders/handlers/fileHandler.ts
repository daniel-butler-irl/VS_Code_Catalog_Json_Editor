// src/viewProviders/handlers/fileHandler.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from '../../utils/fileUtils';
import { JsonUtils } from '../../utils/jsonUtils';
import { readSchema } from '../../services/schemaFetcher';
import { WorkspaceRequiredError, FileOperationError } from '../../utils/errors';
import { createLoggerFor } from '../../utils/outputManager';


export interface JsonValidationResult {
    isValid: boolean;
    errors?: string[];
}

export class FileHandler {
    private readonly logger = createLoggerFor('FILES');
    private schema: any = null;
    private lastKnownContent: string = '';
    private readonly jsonFileName = 'ibm_catalog.json';

    constructor() {
        this.initializeSchema().catch(error => 
            this.logger.error('Failed to initialize schema:', error)
        );
    }

    /**
     * Initializes the JSON schema for validation
     */
    private async initializeSchema(): Promise<void> {
        try {
            this.schema = await readSchema();
            this.logger.info('Schema initialized successfully');
        } catch (error) {
            this.logger.error('Error initializing schema:', error);
            throw error;
        }
    }

    /**
     * Gets the current schema
     */
    public async getSchema(): Promise<any> {
        if (!this.schema) {
            await this.initializeSchema();
        }
        return this.schema;
    }

    /**
     * Reads and parses the JSON data from the file
     */
    public async readJsonData(): Promise<any> {
        try {
            const filePath = this.getFilePath();
            const content = await FileUtils.readFileContent(filePath);
            
            // Cache the content for change detection
            this.lastKnownContent = content;
            
            const jsonData = JsonUtils.parseJson(content);
            this.logger.info('Successfully read and parsed JSON data');
            return jsonData;
        } catch (error) {
            if (error instanceof WorkspaceRequiredError) {
                throw error;
            }
            this.logger.error('Error reading JSON data:', error);
            throw new FileOperationError(
                'Failed to read or parse JSON data',
                this.getFilePath()
            );
        }
    }

    /**
     * Saves JSON data to the file
     */
    public async saveJsonData(data: any): Promise<void> {
        try {
            const filePath = this.getFilePath();
            
            // Validate JSON before saving
            const validationResult = await this.validateJson(data);
            if (!validationResult.isValid) {
                const errorMessage = `Invalid JSON data: ${validationResult.errors?.join(', ')}`;
                this.logger.error(errorMessage);
                throw new Error(errorMessage);
            }

            const content = JsonUtils.stringifyJson(data);
            
            // Check if content has actually changed
            if (content === this.lastKnownContent) {
                this.logger.info('No changes detected in JSON content');
                return;
            }

            await FileUtils.writeFileContent(filePath, content);
            this.lastKnownContent = content;
            this.logger.info('Successfully saved JSON data');
        } catch (error) {
            if (error instanceof WorkspaceRequiredError) {
                throw error;
            }
            this.logger.error('Error saving JSON data:', error);
            throw new FileOperationError(
                'Failed to save JSON data',
                this.getFilePath()
            );
        }
    }

    /**
     * Validates JSON data against the schema
     */
    public async validateJson(data: any): Promise<JsonValidationResult> {
        try {
            if (!this.schema) {
                await this.initializeSchema();
            }

            // TODO: Actual schema validation would be implemented here
            // This is a placeholder for the validation logic
            // You might want to use a library like Ajv for proper JSON Schema validation
            
            // For now, we'll just check if it's valid JSON
            JsonUtils.stringifyJson(data);
            return { isValid: true };
        } catch (error) {
            this.logger.error('Error validating JSON:', error);
            return {
                isValid: false,
                errors: [error instanceof Error ? error.message : 'Unknown validation error']
            };
        }
    }

    /**
     * Creates a new IBM catalog JSON file with default content
     */
    public async createNewFile(): Promise<void> {
        try {
            const filePath = this.getFilePath();
            const defaultContent = {
                products: {}
            };

            const content = JsonUtils.stringifyJson(defaultContent);
            await FileUtils.writeFileContent(filePath, content);
            this.lastKnownContent = content;
            this.logger.info('Created new IBM catalog JSON file');
        } catch (error) {
            this.logger.error('Error creating new file:', error);
            throw error;
        }
    }

    /**
     * Checks if the IBM catalog JSON file exists
     */
    public async fileExists(): Promise<boolean> {
        try {
            const filePath = this.getFilePath();
            await FileUtils.readFileContent(filePath);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Gets the full path to the IBM catalog JSON file
     */
    private getFilePath(): string {
        return FileUtils.getWorkspaceFilePath(this.jsonFileName);
    }

    /**
     * Watches for changes to the IBM catalog JSON file
     */
    public watchFile(onChange: (content: string) => void): vscode.Disposable {
        const watcher = vscode.workspace.createFileSystemWatcher(
            `**/${this.jsonFileName}`,
            false, // Don't ignore creates
            false, // Don't ignore changes
            false  // Don't ignore deletes
        );

        watcher.onDidChange(async uri => {
            try {
                const content = await FileUtils.readFileContent(uri.fsPath);
                if (content !== this.lastKnownContent) {
                    this.lastKnownContent = content;
                    onChange(content);
                }
            } catch (error) {
                this.logger.error('Error reading file changes:', error);
            }
        });

        watcher.onDidDelete(() => {
            this.logger.warn('IBM catalog JSON file was deleted');
        });

        return watcher;
    }

    /**
     * Creates a backup of the current file
     */
    public async createBackup(): Promise<string> {
        try {
            const sourceFilePath = this.getFilePath();
            const backupFilePath = sourceFilePath + '.backup';
            const content = await FileUtils.readFileContent(sourceFilePath);
            await FileUtils.writeFileContent(backupFilePath, content);
            this.logger.info('Created backup file');
            return backupFilePath;
        } catch (error) {
            this.logger.error('Error creating backup:', error);
            throw error;
        }
    }

    /**
     * Restores from a backup file
     */
    public async restoreFromBackup(backupFilePath: string): Promise<void> {
        try {
            const content = await FileUtils.readFileContent(backupFilePath);
            await this.saveJsonData(JsonUtils.parseJson(content));
            this.logger.info('Restored from backup successfully');
        } catch (error) {
            this.logger.error('Error restoring from backup:', error);
            throw error;
        }
    }
}