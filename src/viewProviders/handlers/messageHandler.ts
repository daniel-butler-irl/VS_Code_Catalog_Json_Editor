// src/viewProviders/handlers/messageHandler.ts

import * as vscode from 'vscode';
import { ApiService } from '../../services/apiService';
import { CatalogCacheService } from '../../services/catalogCacheService';
import { FileHandler } from './fileHandler';
import { StatusBarManager } from '../ui/statusBar';
import { TemplateManager } from '../templates/templateManager';
import { OutputManager, Components, LogLevel } from '../../utils/outputManager';
import { FunctionResult } from '../../utils/jsonPathFunctionRegistry';
import { JsonPathProcessor } from '../../services/jsonPathProcessor';

/**
 * Interface definitions for different message types.
 */
export interface LoginMessage {
    type: 'login';
    apiKey: string;
}

export interface LogoutMessage {
    type: 'logout';
}

export interface LoginStatusMessage {
    type: 'loginStatus';
    isLoggedIn: boolean;
}

export type WebviewMessage = 
    | LoginMessage 
    | LogoutMessage 
    | LoginStatusMessage 
    | { type: string; [key: string]: any };

/**
 * Handles communication between the webview and the extension backend.
 */
export class MessageHandler {
    private readonly logger: OutputManager;
    private webview?: vscode.WebviewView;
    private fileHandler: FileHandler;
    private templateManager: TemplateManager;
    private catalogCache: CatalogCacheService;
    private jsonPathProcessor: JsonPathProcessor;
    public readonly disposables: vscode.Disposable[] = [];
    private enhancementResults: FunctionResult[] = []; // Added to fix 'Property does not exist' error

    constructor(
        private readonly apiService: ApiService,
        private readonly statusBar: StatusBarManager,
        private readonly extensionUri: vscode.Uri,
        private readonly outputManager: OutputManager,
        private readonly context: vscode.ExtensionContext
    ) {
        this.catalogCache = new CatalogCacheService(apiService, outputManager);
        this.fileHandler = new FileHandler(apiService, this.catalogCache, outputManager, context);
        this.templateManager = new TemplateManager(extensionUri, outputManager);
        this.jsonPathProcessor = new JsonPathProcessor(this.catalogCache, apiService);
        this.logger = outputManager;
    }

    /**
     * Sets the webview view.
     * @param webview The webview view instance.
     */
    public setWebview(webview: vscode.WebviewView) {
        this.webview = webview;
    }

    /**
     * Handles incoming messages from the webview.
     * @param message The message object.
     */
    public async handleMessage(message: WebviewMessage): Promise<void> {
        if (!this.webview) {
            this.logger.log(Components.MESSAGE_HANDLER, 'No webview available for handling messages', LogLevel.ERROR);
            return;
        }

        try {
            switch (message.type) {
                case 'ready':
                    await this.sendJsonData();
                    break;

                case 'saveJson':
                    await this.handleSaveJson(message.json);
                    break;

                case 'openIbmCatalog':
                    await this.handleOpenIbmCatalog();
                    break;

                case 'openFolder':
                    await vscode.commands.executeCommand('vscode.openFolder');
                    break;

                case 'highlightKey':
                    await this.handleHighlightKey(message.key);
                    break;

                case 'fetchCatalogData':
                    await this.handleFetchCatalogData(message.catalogId);
                    break;

                case 'clearCatalogCache':
                    await this.handleClearCatalogCache();
                    break;

                case 'refreshAllCatalogs':
                    await this.handleRefreshAllCatalogs();
                    break;

                case 'getVersionDetails':
                    await this.handleGetVersionDetails(message.versionLocator);
                    break;

                case 'log':
                    this.handleLogMessage(message.level, message.message);
                    break;

                case 'login':
                    await this.handleLogin(message.apiKey);
                    break;

                case 'createIbmCatalog':
                    await this.handleCreateIbmCatalog();
                    break;

                case 'logout':
                    await this.handleLogout();
                    break;

                case 'promptLogin':
                    // Trigger the login command
                    await vscode.commands.executeCommand('catalogEditor.login');
                    break;

                default:
                    this.logger.log(Components.MESSAGE_HANDLER, `Unknown message type received: ${message.type}`, LogLevel.WARN);
            }
        } catch (error) {
            await this.handleError(error);
        }
    }

    /**
     * Handles creating a new ibm_catalog.json file.
     */
    private async handleCreateIbmCatalog(): Promise<void> {
    try {
        await this.fileHandler.createNewFile();
        vscode.window.showInformationMessage('Created new ibm_catalog.json file');
        await this.handleOpenIbmCatalog();
        this.logger.log(Components.MESSAGE_HANDLER, 'Created new ibm_catalog.json', LogLevel.INFO);
    } catch (error) {
        this.logger.log(Components.MESSAGE_HANDLER, `Error creating ibm_catalog.json: ${error}`, LogLevel.ERROR);
        vscode.window.showErrorMessage('Failed to create ibm_catalog.json');
    }
}
    /**
     * Handles fetching catalog data.
     * @param catalogId The catalog ID to fetch data for.
     */
    private async handleFetchCatalogData(catalogId: string): Promise<void> {
        if (!this.webview) return;

        try {
            // Get current status first
            const status = this.catalogCache.getCatalogStatus(catalogId);
            
            // Send immediate status update to UI
            await this.webview.webview.postMessage({
                type: 'catalogStatus',
                catalogId,
                status: status.status,
                error: status.error
            });

            // Fetch offerings
            const offerings = await this.catalogCache.getOfferings(catalogId);
            
            // Send data to webview
            await this.webview.webview.postMessage({
                type: 'catalogData',
                catalogId,
                data: { resources: offerings },
                status: 'ready'
            });
        } catch (error) {
            this.logger.log(Components.MESSAGE_HANDLER, `Error fetching catalog data: ${error}`, LogLevel.ERROR);
            if (this.webview) {
                await this.webview.webview.postMessage({
                    type: 'catalogDataError',
                    catalogId,
                    message: error instanceof Error ? error.message : 'Failed to fetch catalog data'
                });
            }
        }
    }

    /**
     * Handles clearing the catalog cache.
     */
    private async handleClearCatalogCache(): Promise<void> {
        try {
            this.catalogCache.clearCache();
            if (this.webview) {
                await this.webview.webview.postMessage({
                    type: 'catalogCacheCleared'
                });
            }
            vscode.window.showInformationMessage('Catalog cache cleared successfully.');
            this.logger.log(Components.MESSAGE_HANDLER, 'Catalog cache cleared', LogLevel.INFO);
        } catch (error) {
            this.logger.log(Components.MESSAGE_HANDLER, `Error clearing catalog cache: ${error}`, LogLevel.ERROR);
            vscode.window.showErrorMessage('Failed to clear catalog cache.');
        }
    }

    /**
     * Handles refreshing all catalogs.
     */
    private async handleRefreshAllCatalogs(): Promise<void> {
        try {
            await this.catalogCache.refreshAllCatalogs();
            if (this.webview) {
                const catalogs = this.catalogCache.getActiveCatalogs();
                for (const catalogId of catalogs) {
                    const offerings = await this.catalogCache.getOfferings(catalogId);
                    await this.webview.webview.postMessage({
                        type: 'catalogData',
                        catalogId,
                        data: { resources: offerings },
                        status: 'ready'
                    });
                }
            }
            this.logger.log(Components.MESSAGE_HANDLER, 'All catalogs refreshed', LogLevel.INFO);
        } catch (error) {
            this.logger.log(Components.MESSAGE_HANDLER, `Error refreshing catalogs: ${error}`, LogLevel.ERROR);
            vscode.window.showErrorMessage('Failed to refresh catalogs.');
        }
    }

    /**
     * Handles fetching version details.
     * @param versionLocator The version locator to fetch details for.
     */
    private async handleGetVersionDetails(versionLocator: string): Promise<void> {
        if (!this.webview) return;

        try {
            const details = await this.apiService.getVersionDetails(versionLocator);
            await this.webview.webview.postMessage({
                type: 'versionDetails',
                versionLocator,
                data: details
            });
            this.logger.log(Components.MESSAGE_HANDLER, `Fetched version details for locator: ${versionLocator}`, LogLevel.INFO);
        } catch (error) {
            this.logger.log(Components.MESSAGE_HANDLER, `Error fetching version details: ${error}`, LogLevel.ERROR);
            if (this.webview) {
                await this.webview.webview.postMessage({
                    type: 'versionDetailsError',
                    versionLocator,
                    message: error instanceof Error ? error.message : 'Failed to fetch version details'
                });
            }
        }
    }

    /**
     * Handles saving JSON data.
     * @param json The JSON data to save.
     */
    private async handleSaveJson(json: any): Promise<void> {
        try {
            await this.fileHandler.saveJsonData(json);
            if (this.webview) {
                await this.webview.webview.postMessage({
                    type: 'saveSuccess'
                });
            }
            await this.sendJsonData();
            this.logger.log(Components.MESSAGE_HANDLER, 'JSON data saved successfully', LogLevel.INFO);
        } catch (error) {
            await this.handleError(error);
        }
    }

    /**
     * Handles opening the ibm_catalog.json file.
     */
    private async handleOpenIbmCatalog(): Promise<void> {
        try {
            const filePath = this.fileHandler.getFilePath();
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
            this.logger.log(Components.MESSAGE_HANDLER, 'Opened ibm_catalog.json', LogLevel.INFO);
        } catch (error) {
            this.logger.log(Components.MESSAGE_HANDLER, `Error opening ibm_catalog.json: ${error}`, LogLevel.ERROR);
            vscode.window.showErrorMessage('Failed to open ibm_catalog.json');
        }
    }

    /**
     * Handles highlighting a specific key in the editor.
     * @param key The key to highlight.
     */
    private async handleHighlightKey(key: string): Promise<void> {
        // Implementation would handle highlighting keys in the editor
        // This could involve using VS Code's decoration API
        this.logger.log(Components.MESSAGE_HANDLER, `Highlight requested for key: ${key}`, LogLevel.INFO);
    }

    /**
     * Handles user login.
     * @param apiKey The API key.
     */
    private async handleLogin(apiKey: string): Promise<void> {
        try {
            await this.apiService.login(apiKey);
            this.sendLoginStatus(true);
            vscode.window.showInformationMessage('Successfully logged in to IBM Cloud.');
            this.logger.log(Components.MESSAGE_HANDLER, 'User logged in successfully', LogLevel.INFO);
            // Optionally, refresh the JSON data to apply enhancements
            await this.sendJsonData();
        } catch (error) {
            this.logger.log(Components.MESSAGE_HANDLER, `Login failed: ${error}`, LogLevel.ERROR);
            this.sendLoginStatus(false);
            vscode.window.showErrorMessage('Login failed. Please check your API key.');
        }
    }

    /**
     * Handles user logout.
     */
    private async handleLogout(): Promise<void> {
        try {
            await this.apiService.logout();
            this.catalogCache.clearCache();
            this.sendLoginStatus(false);
            vscode.window.showInformationMessage('Successfully logged out from IBM Cloud.');
            this.logger.log(Components.MESSAGE_HANDLER, 'User logged out successfully', LogLevel.INFO);
            // Optionally, revert UI enhancements to basic textboxes
            await this.sendJsonData();
        } catch (error) {
            this.logger.log(Components.MESSAGE_HANDLER, `Logout failed: ${error}`, LogLevel.ERROR);
            vscode.window.showErrorMessage('Logout failed.');
        }
    }

    /**
     * Sends the current JSON data and enhancements to the webview.
     */
    public async sendJsonData(): Promise<void> {
        if (!this.webview) return;

        try {
            const jsonData = await this.fileHandler.readJsonData();
            const schema = await this.fileHandler.getSchema();

            // Validate JSON
            const validation = await this.fileHandler.validateJson(jsonData);
            if (!validation.isValid) {
                // Handle validation errors (e.g., send error messages to webview)
                this.webview.webview.postMessage({
                    type: 'jsonValidationError',
                    errors: validation.errors
                });
                this.logger.log(Components.MESSAGE_HANDLER, `JSON validation failed: ${validation.errors?.join('; ') || 'Unknown validation error'}`, LogLevel.WARN);
                return;
            }

            // Process JSONPaths for enhancements
            this.enhancementResults = await this.jsonPathProcessor.processJsonPaths(jsonData);

            // Send JSON data and enhancements to the webview
            await this.webview.webview.postMessage({
                type: 'loadJson',
                json: jsonData,
                schema: schema,
                enhancements: this.enhancementResults
            });
            this.logger.log(Components.MESSAGE_HANDLER, 'Sent JSON data and enhancements to webview', LogLevel.INFO);
        } catch (error) {
            await this.handleError(error);
        }
    }

    /**
     * Sends the login status to the webview.
     * @param isLoggedIn Whether the user is logged in.
     */
    public sendLoginStatus(isLoggedIn: boolean): void {
        if (!this.webview) {
            this.logger.log(Components.MESSAGE_HANDLER, 'No webview available for sending login status', LogLevel.WARN);
            return;
        }

        this.webview.webview.postMessage({
            type: 'loginStatus',
            isLoggedIn
        });

        this.statusBar.updateStatus(isLoggedIn);
        this.logger.log(Components.MESSAGE_HANDLER, `Sent login status: ${isLoggedIn}`, LogLevel.INFO);
    }

    /**
     * Handles generic errors by logging and notifying the user.
     * @param error The error object.
     */
    private async handleError(error: unknown): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        this.logger.log(Components.MESSAGE_HANDLER, `Error: ${errorMessage}`, LogLevel.ERROR);
        vscode.window.showErrorMessage(errorMessage);

        if (this.webview) {
            await this.webview.webview.postMessage({
                type: 'error',
                message: errorMessage
            });
        }
    }

    /**
     * Handles log messages from the webview.
     * @param level The log level.
     * @param message The log message.
     */
    private handleLogMessage(level: string, message: string): void {
        switch (level) {
            case 'log':
                this.logger.log(Components.MESSAGE_HANDLER, message, LogLevel.INFO);
                break;
            case 'warn':
                this.logger.log(Components.MESSAGE_HANDLER, message, LogLevel.WARN);
                break;
            case 'error':
                this.logger.log(Components.MESSAGE_HANDLER, message, LogLevel.ERROR);
                break;
            default:
                this.logger.log(Components.MESSAGE_HANDLER, `[UNKNOWN LEVEL] ${message}`, LogLevel.INFO);
        }
    }

    /**
     * Disposes of resources.
     */
    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
