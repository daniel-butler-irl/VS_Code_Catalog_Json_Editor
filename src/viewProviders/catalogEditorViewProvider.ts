// src/viewProviders/catalogEditorViewProvider.ts

import * as vscode from 'vscode';
import { FileHandler } from './handlers/fileHandler';
import { ApiService } from '../services/apiService';
import { CatalogCacheService } from '../services/catalogCacheService';
import { JsonPathProcessor } from '../services/jsonPathProcessor';
import { FunctionResult } from '../utils/jsonPathFunctionRegistry';
import { OutputManager, Components, LogLevel } from '../utils/outputManager';
import { TemplateManager } from './templates/templateManager';
import { StatusBarManager } from './ui/statusBar';
import { DecorationManager } from './ui/decorations';
import { MessageHandler } from './handlers/messageHandler';
import { WorkspaceRequiredError } from '../utils/errors';

/**
 * Provides the catalog editor webview.
 */
export class CatalogEditorViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'catalogEditor.view';
    private _view?: vscode.WebviewView;
    private readonly outputManager: OutputManager;
    private readonly statusBar: StatusBarManager;
    private readonly decorationManager: DecorationManager;
    private readonly templateManager: TemplateManager;
    private readonly catalogCache: CatalogCacheService;
    private readonly fileHandler: FileHandler;
    private readonly jsonPathProcessor: JsonPathProcessor;
    private readonly messageHandler: MessageHandler;
    private enhancementResults: FunctionResult[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly apiService: ApiService,
        private readonly logger: OutputManager,
         private readonly context: vscode.ExtensionContext
    ) {
        this.outputManager = logger;
        this.statusBar = new StatusBarManager();
        this.decorationManager = new DecorationManager(logger);
        this.templateManager = new TemplateManager(extensionUri, logger);
        this.catalogCache = new CatalogCacheService(apiService, logger);
        this.fileHandler = new FileHandler(apiService, this.catalogCache, logger, context);
        this.jsonPathProcessor = new JsonPathProcessor(this.catalogCache, apiService);
        this.messageHandler = new MessageHandler(apiService, this.statusBar, extensionUri, logger, context);

        this.log('CatalogEditorViewProvider initialized');
    }

    /**
     * Resolves the webview view.
     */
    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): Promise<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        // Set initial HTML content
        webviewView.webview.html = await this.getWebviewContent(webviewView.webview);

        // Set up message handling
        this.messageHandler.setWebview(webviewView);
        webviewView.webview.onDidReceiveMessage(
            message => this.messageHandler.handleMessage(message),
            undefined,
            []
        );

        // Initialize with current authentication state
        this.log('Checking authentication state');
        const isAuthenticated = await this.apiService.isAuthenticated();
        this.log(`Authentication state: ${isAuthenticated ? 'authenticated' : 'not authenticated'}`);

        this.statusBar.updateStatus(isAuthenticated);

        // Initialize view with JSON data if authenticated
        await this.sendJsonData();

        this.log('Webview view resolved successfully');
    }

    /**
     * Gets the webview content from the template manager.
     */
    private async getWebviewContent(webview: vscode.Webview): Promise<string> {
        const isAuthenticated = await this.apiService.isAuthenticated();
        return this.templateManager.getWebviewContent(webview, { isLoggedIn: isAuthenticated });
    }

    /**
     * Sends JSON data to the webview.
     */
    private async sendJsonData(): Promise<void> {
        if (!this._view) {
            this.log('No webview available for sending JSON data', LogLevel.WARN);
            return;
        }

        try {
            const jsonData = await this.fileHandler.readJsonData();
            const schema = await this.fileHandler.getSchema();

            // Validate JSON
            const validation = await this.fileHandler.validateJson(jsonData);
            if (!validation.isValid && validation.errors) {
                await this._view.webview.postMessage({
                    type: 'jsonValidationError',
                    errors: validation.errors
                });
                this.log(`JSON validation failed: ${validation.errors.join('; ')}`, LogLevel.WARN);
                return;
            }

            // Process JSONPaths for enhancements
            this.enhancementResults = await this.jsonPathProcessor.processJsonPaths(jsonData);

            // Send data to webview
            await this._view.webview.postMessage({
                type: 'loadJson',
                json: jsonData,
                schema: schema,
                enhancements: this.enhancementResults
            });

            this.log('JSON data sent to webview successfully');
        } catch (error) {
            this.handleError('Error sending JSON data', error);
        }
    }

    /**
     * Updates the webview content based on file changes.
     */
    public async updateContent(fileName: string): Promise<void> {
        if (!this._view) return;

        try {
            if (fileName.endsWith('ibm_catalog.json')) {
                await this.sendJsonData();
                this.log('Webview content updated successfully');
            }
        } catch (error) {
            this.handleError('Error updating webview content', error);
        }
    }

    /**
     * Refreshes the view after login/logout.
     */
    public async refreshView(): Promise<void> {
        if (!this._view) return;

        try {
            const isAuthenticated = await this.apiService.isAuthenticated();
            this.statusBar.updateStatus(isAuthenticated);
            await this.sendJsonData();
            this.log('View refreshed successfully');
        } catch (error) {
            this.handleError('Error refreshing view', error);
        }
    }

    /**
     * Applies decorations to the editor.
     */
    public applyDecorations(editor: vscode.TextEditor): void {
        this.decorationManager.removeAllDecorations(editor);
        
        this.enhancementResults.forEach(result => {
            if (result.highlightColor) {
                this.decorationManager.highlight(
                    editor,
                    `highlight-${result.path}`,
                    [{
                        range: new vscode.Range(
                            new vscode.Position(0, 0),
                            new vscode.Position(0, 0)
                        ),
                        hoverMessage: `Path: ${result.path}`
                    }],
                    { backgroundColor: result.highlightColor === 'green' ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 0, 0, 0.2)' }
                );
            }
        });
    }

    /**
     * Handles errors by logging and showing messages.
     */
    private handleError(message: string, error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log(`${message}: ${errorMessage}`, LogLevel.ERROR);
        
        if (this._view) {
            this._view.webview.postMessage({
                type: 'error',
                message: errorMessage
            });
        }

        vscode.window.showErrorMessage(errorMessage);
    }

    /**
     * Logs messages using the output manager.
     */
    private log(message: string, level: LogLevel = LogLevel.INFO): void {
        this.outputManager.log(Components.CATALOG_EDITOR_VIEW_PROVIDER, message, level);
    }

    /**
     * Disposes of resources.
     */
    public dispose(): void {
        this.statusBar.dispose();
        this.decorationManager.dispose();
        this.messageHandler.dispose();
    }
}