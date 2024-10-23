import * as vscode from 'vscode';
import { ApiService } from '../../services/apiService';
import { CatalogCacheService } from '../../services/catalogCacheService';
import { FileHandler } from './fileHandler';
import { StatusBarManager } from '../ui/statusBar';
import { TemplateManager } from '../templates/templateManager';
import { createLoggerFor } from '../../utils/outputManager';
import { ApiKeyRequiredError } from '../../utils/errors';

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

export class MessageHandler {
    private readonly logger = createLoggerFor('MESSAGE_HANDLER');
    private webview?: vscode.WebviewView;
    private fileHandler: FileHandler;
    private templateManager: TemplateManager;
    private catalogCache: CatalogCacheService;
    public readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly apiService: ApiService,
        private readonly statusBar: StatusBarManager,
        private readonly extensionUri: vscode.Uri
    ) {
        this.fileHandler = new FileHandler();
        this.templateManager = new TemplateManager(extensionUri);
        this.catalogCache = new CatalogCacheService(apiService);
    }

    public setWebview(webview: vscode.WebviewView) {
        this.webview = webview;
    }

    public async handleMessage(message: WebviewMessage): Promise<void> {
        if (!this.webview) {
            this.logger.error('No webview available for handling messages');
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
                default:
                    this.logger.warn(`Unknown message type received: ${message.type}`);
            }
        } catch (error) {
            await this.handleError(error);
        }
    }

    private async handleFetchCatalogData(catalogId: string): Promise<void> {
        if (!this.webview) return;

        try {
            if (!this.apiService.isAuthenticated()) {
                throw new ApiKeyRequiredError();
            }

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
            this.logger.error('Error fetching catalog data:', error);
            if (this.webview) {
                await this.webview.webview.postMessage({
                    type: 'catalogDataError',
                    catalogId,
                    message: error instanceof Error ? error.message : 'Failed to fetch catalog data'
                });
            }
        }
    }

    private async handleClearCatalogCache(): Promise<void> {
        try {
            this.catalogCache.clearCache();
            if (this.webview) {
                await this.webview.webview.postMessage({
                    type: 'catalogCacheCleared'
                });
            }
            vscode.window.showInformationMessage('Catalog cache cleared successfully.');
        } catch (error) {
            this.logger.error('Error clearing catalog cache:', error);
            vscode.window.showErrorMessage('Failed to clear catalog cache.');
        }
    }

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
        } catch (error) {
            this.logger.error('Error refreshing catalogs:', error);
            vscode.window.showErrorMessage('Failed to refresh catalogs.');
        }
    }

    private async handleGetVersionDetails(versionLocator: string): Promise<void> {
        if (!this.webview) return;

        try {
            const details = await this.apiService.getVersionDetails(versionLocator);
            await this.webview.webview.postMessage({
                type: 'versionDetails',
                versionLocator,
                data: details
            });
        } catch (error) {
            this.logger.error('Error fetching version details:', error);
            if (this.webview) {
                await this.webview.webview.postMessage({
                    type: 'versionDetailsError',
                    versionLocator,
                    message: error instanceof Error ? error.message : 'Failed to fetch version details'
                });
            }
        }
    }

    private async handleSaveJson(json: any): Promise<void> {
        try {
            await this.fileHandler.saveJsonData(json);
            if (this.webview) {
                await this.webview.webview.postMessage({
                    type: 'saveSuccess'
                });
            }
            await this.sendJsonData();
        } catch (error) {
            await this.handleError(error);
        }
    }

    private async handleOpenIbmCatalog(): Promise<void> {
        try {
            const filePath = this.fileHandler.getFilePath();
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            this.logger.error('Error opening IBM catalog:', error);
            vscode.window.showErrorMessage('Failed to open ibm_catalog.json');
        }
    }

    private async handleHighlightKey(key: string): Promise<void> {
        // Implementation would handle highlighting keys in the editor
    }

    private handleLogMessage(level: string, message: string): void {
        switch (level) {
            case 'log':
                this.logger.info(message);
                break;
            case 'warn':
                this.logger.warn(message);
                break;
            case 'error':
                this.logger.error(message);
                break;
            default:
                this.logger.info(`[UNKNOWN LEVEL] ${message}`);
        }
    }
 private async handleCreateIbmCatalog(): Promise<void> {
        try {
            await this.fileHandler.createNewFile();
            vscode.window.showInformationMessage('Created new ibm_catalog.json file');
            
            // Refresh the view
            await this.sendJsonData();
        } catch (error) {
            this.logger.error('Error creating ibm_catalog.json:', error);
            throw error;
        }
    }
    private async handleError(error: unknown): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        this.logger.error(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
    }

    public async sendJsonData(): Promise<void> {
        if (!this.webview) return;

        try {
            const jsonData = await this.fileHandler.readJsonData();
            const schema = await this.fileHandler.getSchema();

            await this.webview.webview.postMessage({
                type: 'loadJson',
                json: jsonData,
                schema: schema
            });
        } catch (error) {
            await this.handleError(error);
        }
    }

     /**
     * Handles login requests
     */
   private async handleLogin(apiKey: string): Promise<void> {
    try {
        await this.apiService.initialize();
        if (this.apiService.isAuthenticated()) {
            this.sendLoginStatus(true);
            vscode.window.showInformationMessage('Successfully logged in to IBM Cloud.');
        }
    } catch (error) {
        this.logger.error('Login failed:', error);
        this.sendLoginStatus(false);
        throw error;
    }
}

/**
 * Handles logout requests
 */
private async handleLogout(): Promise<void> {
    try {
        await this.catalogCache.clearCache();
        this.sendLoginStatus(false);
        vscode.window.showInformationMessage('Successfully logged out from IBM Cloud.');
    } catch (error) {
        this.logger.error('Logout failed:', error);
        throw error;
    }
}

/**
 * Sends the login status to the webview
 */
public sendLoginStatus(isLoggedIn: boolean): void {
    if (!this.webview) {
        this.logger.info('No webview available for sending login status');
        return;
    }

    this.webview.webview.postMessage({
        type: 'loginStatus',
        isLoggedIn
    });

    this.statusBar.updateStatus(isLoggedIn);
}

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}