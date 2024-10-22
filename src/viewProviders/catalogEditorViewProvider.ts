// src/viewProviders/catalogEditorViewProvider.ts
import * as vscode from 'vscode';
import { readSchema } from '../services/schemaFetcher';
import { ApiService } from '../services/apiService';
import { FileUtils } from '../utils/fileUtils';
import { MessageHandler } from './handlers/messageHandler';
import { StatusBarManager } from './ui/statusBar';
import { DecorationManager } from './ui/decorations';
import { TemplateManager } from './templates/templateManager';
import { WorkspaceRequiredError } from '../utils/errors';
import { createLoggerFor } from '../utils/outputManager';

export class CatalogEditorViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'catalogEditor.view';
    private readonly logger = createLoggerFor('MAIN');
    private _currentView?: vscode.WebviewView;
    private readonly messageHandler: MessageHandler;
    private readonly statusBar: StatusBarManager;
    private readonly decorationManager: DecorationManager;
    private readonly templateManager: TemplateManager;
    private readonly apiService: ApiService;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private secrets: vscode.SecretStorage,
        private globalState: vscode.Memento
    ) {
        this.logger.info('Initializing CatalogEditorViewProvider');
        
        // Initialize services and managers
        this.apiService = new ApiService(secrets, globalState);
        this.statusBar = new StatusBarManager();
        this.decorationManager = new DecorationManager();
        this.templateManager = new TemplateManager(extensionUri);
        this.messageHandler = new MessageHandler(
            this.apiService, 
            this.statusBar,
            extensionUri
        );

        // Add disposables
        this.disposables.push(
            this.statusBar,
            this.decorationManager,
            ...this.messageHandler.disposables
        );

        // Initialize the extension
        this.initialize().catch(error => {
            this.logger.error('Initialization failed', error);
        });
    }

    private async initialize(): Promise<void> {
        try {
            this.logger.info('Starting initialization');
            await this.apiService.initialize();
            const isLoggedIn = this.apiService.isAuthenticated();
            this.statusBar.updateStatus(isLoggedIn);
            this.logger.info('Extension initialized successfully');
        } catch (error) {
            this.logger.error('Initialization error', error);
            throw error;
        }
    }

    public dispose(): void {
        this.logger.info('Disposing CatalogEditorViewProvider');
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
): Promise<void> {
    try {
        this.logger.info('Resolving webview view');
        this._currentView = webviewView;
        this.messageHandler.setWebview(webviewView);

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
            ]
        };

        if (!FileUtils.isWorkspaceAvailable()) {
            this.logger.info('No workspace available, showing workspace required message');
            webviewView.webview.html = await this.templateManager.getNoWorkspaceContent(
                webviewView.webview
            );
            return;
        }

        webviewView.webview.html = await this.templateManager.getWebviewContent(
            webviewView.webview,
            {
                isLoggedIn: this.apiService.isAuthenticated(),
                showRefreshButton: true
            }
        );

            // Setup message handler
            const messageHandler = webviewView.webview.onDidReceiveMessage(
                async message => {
                    try {
                        await this.messageHandler.handleMessage(message);
                    } catch (error) {
                        this.logger.error('Error handling message', error);
                    }
                }
            );

            // Setup document change handlers
            const changeHandler = vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document === vscode.window.activeTextEditor?.document) {
                    this.decorationManager.updateDecorations(
                        vscode.window.activeTextEditor,
                        event.contentChanges
                    );
                }
            });

            this.disposables.push(messageHandler, changeHandler);
            this.logger.info('Webview view resolved successfully');

        } catch (error) {
            this.logger.error('Error resolving webview', error);
            if (this._currentView) {
                this._currentView.webview.html = await this.templateManager.getErrorContent(
                    this._currentView.webview,
                    'Failed to initialize the editor view.'
                );
            }
        }
    }

    public get currentView(): vscode.WebviewView | undefined {
        return this._currentView;
    }

    public async initializeStatusBar(): Promise<void> {
        try {
            this.logger.info('Initializing status bar');
            const apiKey = await this.secrets.get('catalogEditor.apiKey');
            this.statusBar.updateStatus(!!apiKey);
        } catch (error) {
            this.logger.error('Error initializing status bar', error);
        }
    }

    public updateStatusBar(isLoggedIn: boolean): void {
        this.logger.info('Updating status bar, logged in: ${isLoggedIn}');
        this.statusBar.updateStatus(isLoggedIn);
    }

   public async updateWebviewContent(fileName: string): Promise<void> {
    if (!this._currentView) {
        this.logger.info('No current view, skipping content update');
        return;
    }

    try {
        this.logger.info(`Updating webview content for file: ${fileName}`);
        if (!FileUtils.isWorkspaceAvailable()) {
            this._currentView.webview.html = await this.templateManager.getNoWorkspaceContent(
                this._currentView.webview
            );
            return;
        }

        if (fileName.endsWith('ibm_catalog.json')) {
            // Reset the webview's HTML to webview.html
            this._currentView.webview.html = await this.templateManager.getWebviewContent(
                this._currentView.webview,
                {
                    isLoggedIn: this.apiService.isAuthenticated(),
                    showRefreshButton: true
                }
            );
            await this.sendJsonData();
        } else {
            this._currentView.webview.html = await this.templateManager.getNoFileContent(
                this._currentView.webview
            );
        }
    } catch (error) {
        this.logger.error('Error updating webview content', error);
        throw error;
    }
}


    public async sendJsonData(): Promise<void> {
        if (!this._currentView) {
            this.logger.info('No current view, skipping JSON data send');
            return;
        }

        try {
            this.logger.info('Sending JSON data');
            const data = await this.messageHandler.sendJsonData();
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.fileName.endsWith('ibm_catalog.json')) {
                this.decorationManager.removeAllDecorations(editor);
            }
        } catch (error) {
            if (error instanceof WorkspaceRequiredError) {
                this.logger.info('Workspace required error caught during JSON data send');
            } else {
                this.logger.error('Error sending JSON data', error);
                throw error;
            }
        }
    }

    public sendLoginStatus(isLoggedIn: boolean): void {
        this.logger.info(`Sending login status: ${isLoggedIn}`);
        this.messageHandler.sendLoginStatus(isLoggedIn);
    }

    public async clearAllOfferingsCache(): Promise<void> {
        try {
            this.logger.info('Clearing all offerings cache');
            await this.messageHandler.clearCache();
        } catch (error) {
            this.logger.error('Error clearing offerings cache', error);
        }
    }

    public async initializeApiService(): Promise<void> {
        try {
            this.logger.info('Initializing API service');
            await this.initialize();
        } catch (error) {
            this.logger.error('Error initializing API service', error);
            throw error;
        }
    }

}