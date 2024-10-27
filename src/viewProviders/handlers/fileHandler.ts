// src/viewProviders/handlers/fileHandler.ts
import * as vscode from 'vscode';
import { FileUtils } from '../../utils/fileUtils';
import { ApiService } from '../../services/apiService';
import { OutputManager } from '../../utils/outputManager';
import { CatalogCacheService } from '../../services/catalogCacheService';
import { JsonUtils, JsonValidationResult } from '../../utils/jsonUtils';
import { Components, LogLevel } from '../../utils/outputManager';

/**
 * Handles operations related to ibm_catalog.json file.
 */
export class FileHandler {
    constructor(
        private readonly apiService: ApiService,
        private readonly catalogCacheService: CatalogCacheService,
        private readonly outputManager: OutputManager,
        private readonly context: vscode.ExtensionContext 
    ) {}

    /**
     * Logs messages using the OutputManager.
     * @param component The component enum.
     * @param message The message to log.
     * @param level The severity level.
     */
    private log(component: Components, message: string, level: LogLevel = LogLevel.INFO): void {
        this.outputManager.log(component, message, level);
    }

    /**
     * Logs errors.
     * @param message The error message.
     * @param error The error object.
     */
    public logError(message: string, error: unknown): void {
        this.log(Components.FILE_HANDLER, `${message} - ${error instanceof Error ? error.message : String(error)}`, LogLevel.ERROR);
    }

    /**
     * Reads and parses the ibm_catalog.json file.
     * @returns Parsed JSON data.
     */
    public async readJsonData(): Promise<any> {
        try {
            const filePath = FileUtils.getWorkspaceFilePath('ibm_catalog.json');
            const content = await FileUtils.readFileContent(filePath);
            this.log(Components.FILE_HANDLER, 'Successfully read ibm_catalog.json');
            return JsonUtils.parseJson(content);
        } catch (error) {
            this.logError('Failed to read ibm_catalog.json', error);
            throw error;
        }
    }

    /**
     * Saves the JSON data back to ibm_catalog.json.
     * @param jsonData The JSON data to save.
     */
    public async saveJsonData(jsonData: any): Promise<void> {
        try {
            const filePath = FileUtils.getWorkspaceFilePath('ibm_catalog.json');
            const content = JsonUtils.stringifyJson(jsonData, 4);
            await FileUtils.writeFileContent(filePath, content);
            this.log(Components.FILE_HANDLER, 'Successfully saved ibm_catalog.json');
        } catch (error) {
            this.logError('Failed to save ibm_catalog.json', error);
            throw error;
        }
    }

    /**
     * Validates JSON data against the schema.
     * @param jsonData The JSON data to validate.
     * @returns Validation result.
     */
    public async validateJson(jsonData: any): Promise<JsonValidationResult> {
        try {
            const schema = await this.getSchema();
            const validation = JsonUtils.validateJson(jsonData, schema);
            if (validation.isValid) {
                this.log(Components.FILE_HANDLER, 'JSON validation successful');
            } else {
                this.log(Components.FILE_HANDLER, `JSON validation failed: ${validation.errors?.join('; ') || 'Unknown validation error'}`, LogLevel.WARN);
            }
            return validation;
        } catch (error) {
            this.logError('Failed to validate JSON data', error);
            throw error;
        }
    }

    /**
     * Fetches the JSON schema for ibm_catalog.json.
     * @returns JSON schema object.
     */
    public async getSchema(): Promise<any> {
        try {
            const schemaPath = FileUtils.getExtensionPathWithContext(this.context, 'src', 'schemas', 'ibm_catalog.schema.json');
            const schemaContent = await FileUtils.readFileContent(schemaPath);
            this.log(Components.FILE_HANDLER, 'Successfully loaded JSON schema');
            return JsonUtils.parseJson(schemaContent);
        } catch (error) {
            this.logError('Failed to load JSON schema', error);
            throw error;
        }
    }

    /**
     * Creates a new ibm_catalog.json file with default content.
     */
    public async createNewFile(): Promise<void> {
        try {
            const filePath = FileUtils.getWorkspaceFilePath('ibm_catalog.json');
            const defaultContent = JsonUtils.stringifyJson({ products: [] }, 4);
            await FileUtils.writeFileContent(filePath, defaultContent);
            this.log(Components.FILE_HANDLER, 'Successfully created new ibm_catalog.json');
        } catch (error) {
            this.logError('Failed to create ibm_catalog.json', error);
            throw error;
        }
    }

    /**
     * Gets the full file path for ibm_catalog.json.
     * @returns The file path as a string.
     */
    public getFilePath(): string {
        return FileUtils.getWorkspaceFilePath('ibm_catalog.json');
    }
}
