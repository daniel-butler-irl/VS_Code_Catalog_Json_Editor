// src/viewProviders/handlers/messageHandler.ts
import * as vscode from 'vscode';
import { ApiService } from '../../services/apiService';
import { FileHandler } from './fileHandler';
import { OfferingsHandler } from './offeringsHandler';
import { StatusBarManager } from '../ui/statusBar';
import { TemplateManager } from '../templates/templateManager';
import { FileUtils } from '../../utils/fileUtils';
import { WorkspaceRequiredError } from '../../utils/errors';
import { createLoggerFor } from '../../utils/outputManager';

export interface WebviewMessage {
    type: string;
    [key: string]: any;
}

export class MessageHandler {
    private readonly logger = createLoggerFor('MESSAGE_HANDLER');
    private webview?: vscode.WebviewView;
    private fileHandler: FileHandler;
    private offeringsHandler: OfferingsHandler;
    private templateManager: TemplateManager;
    public readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly apiService: ApiService,
        private readonly statusBar: StatusBarManager,
        private readonly extensionUri: vscode.Uri
    ) {
        
        this.fileHandler = new FileHandler();
        this.offeringsHandler = new OfferingsHandler(apiService);
        this.templateManager = new TemplateManager(extensionUri);
       
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

                case 'fetchOfferings':
                    await this.handleFetchOfferings(message.catalog_id, message.path);
                    break;

                case 'clearCache':
                    await this.handleClearCache();
                    break;

                case 'log':
                    this.handleLogMessage(message.level, message.message);
                    break;

                default:
                    this.logger.warn(`Unknown message type received: ${message.type}`);
            }
        } catch (error) {
            await this.handleError(error);
        }
    }

    public async handleFileChange(fileName: string): Promise<void> {
        if (!this.webview) return;

        if (!FileUtils.isWorkspaceAvailable()) {
            this.webview.webview.html = await this.templateManager.getNoWorkspaceContent(this.webview.webview);
            return;
        }

        if (fileName.endsWith('ibm_catalog.json')) {
            await this.sendJsonData();
        } else {
            await this.webview.webview.postMessage({
                type: 'noFileSelected'
            });
        }
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

    public sendLoginStatus(isLoggedIn: boolean): void {
        if (!this.webview) return;

        this.webview.webview.postMessage({
            type: 'loginStatus',
            isLoggedIn
        });
    }

    public async clearCache(): Promise<void> {
        await this.offeringsHandler.clearCache();
    }

    private async handleSaveJson(json: any): Promise<void> {
        if (!this.webview) return;

        try {
            await this.fileHandler.saveJsonData(json);
            await this.webview.webview.postMessage({
                type: 'saveSuccess'
            });
            await this.sendJsonData();
        } catch (error) {
            await this.handleError(error);
        }
    }

    private async handleOpenIbmCatalog(): Promise<void> {
        try {
            const filePath = FileUtils.getWorkspaceFilePath('ibm_catalog.json');
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            if (!(error instanceof WorkspaceRequiredError)) {
                vscode.window.showErrorMessage('Failed to open ibm_catalog.json');
            }
        }
    }

    private async handleHighlightKey(key: string): Promise<void> {
        // Implementation would be moved from catalogEditorViewProvider
        // This would handle the highlighting of keys in the editor
    }

    private async handleFetchOfferings(catalogId: string, path: string): Promise<void> {
        if (!this.webview) return;

        if (!this.apiService.isAuthenticated()) {
            vscode.window.showWarningMessage('Please login to fetch offerings.');
            return;
        }

        try {
            const offerings = await this.offeringsHandler.fetchOfferings(catalogId);
            await this.webview.webview.postMessage({
                type: 'offeringsData',
                path: path,
                offerings: offerings
            });
        } catch (error) {
            this.logger.error('Error fetching offerings:', error);
            if (this.webview) {
                await this.webview.webview.postMessage({
                    type: 'fetchOfferingsError',
                    path: path,
                    message: 'Failed to fetch offerings'
                });
            }
        }
    }

    private async handleClearCache(): Promise<void> {
        if (!this.webview) return;

        try {
            await this.offeringsHandler.clearCache();
            await this.webview.webview.postMessage({
                type: 'cacheCleared'
            });
        } catch (error) {
            this.logger.error('Error clearing cache:', error);
            await this.webview.webview.postMessage({
                type: 'clearCacheError',
                message: 'Failed to clear cache'
            });
        }
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

    private async handleError(error: unknown): Promise<void> {
        if (error instanceof WorkspaceRequiredError && this.webview) {
            this.webview.webview.html = await this.templateManager.getNoWorkspaceContent(this.webview.webview);
        } else {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            this.logger.error(errorMessage);
            vscode.window.showErrorMessage(errorMessage);
        }
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}