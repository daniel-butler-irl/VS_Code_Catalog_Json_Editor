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
import { FileHandler } from './handlers/fileHandler';

export class CatalogEditorViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'catalogEditor.view';
    private readonly logger = createLoggerFor('MAIN');
    private _currentView?: vscode.WebviewView;
    private readonly messageHandler: MessageHandler;
    private readonly statusBar: StatusBarManager;
    private readonly decorationManager: DecorationManager;
    private readonly templateManager: TemplateManager;
    private readonly apiService: ApiService;
    private readonly fileHandler = new FileHandler();
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
        this.fileHandler = new FileHandler();
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

            webviewView.webview.options = this.getWebviewOptions();

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
            this.disposables.push(messageHandler);

            if (!FileUtils.isWorkspaceAvailable()) {
                this.logger.info('No workspace available, showing workspace required message');
                webviewView.webview.html = await this.templateManager.getNoWorkspaceContent(
                    webviewView.webview
                );
                return;
            }

            // Check if ibm_catalog.json exists
            const fileExists = await this.fileHandler.checkIbmCatalogExists();
            if (!fileExists) {
                this.logger.info('ibm_catalog.json not found, showing not found message');
                webviewView.webview.html = await this.templateManager.getNoIbmCatalogContent(
                    webviewView.webview
                );
                return;
            }

            // Check active editor
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor || !activeEditor.document.fileName.endsWith('ibm_catalog.json')) {
                this.logger.info('Active editor is not ibm_catalog.json, showing no file selected message');
                webviewView.webview.html = await this.templateManager.getNoFileContent(
                    webviewView.webview
                );
                return;
            }

            // Set webview HTML for ibm_catalog.json view
            const isLoggedIn = this.apiService.isAuthenticated();
            webviewView.webview.html = await this.templateManager.getWebviewContent(
                webviewView.webview,
                {
                    isLoggedIn: isLoggedIn,
                    showRefreshButton: isLoggedIn
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
            this.disposables.push(changeHandler);

            // Send initial login status
            this.messageHandler.sendLoginStatus(isLoggedIn);

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
        this.logger.info(`Updating status bar, logged in: ${isLoggedIn}`);
        this.statusBar.updateStatus(isLoggedIn);
    }

    public async updateWebviewContent(fileName: string): Promise<void> {
        if (!this._currentView) {
            this.logger.info('No current view, skipping content update');
            return;
        }

        try {
            this.logger.info(`Updating webview content for file: ${fileName}`);
            
            // Check if workspace is available
            if (!FileUtils.isWorkspaceAvailable()) {
                this._currentView.webview.html = await this.templateManager.getNoWorkspaceContent(
                    this._currentView.webview
                );
                return;
            }

            // Check if ibm_catalog.json exists
            const fileExists = await this.fileHandler.checkIbmCatalogExists();
            if (!fileExists) {
                this._currentView.webview.html = await this.templateManager.getNoIbmCatalogContent(
                    this._currentView.webview
                );
                return;
            }

            if (fileName.endsWith('ibm_catalog.json')) {
                this._currentView.webview.html = await this.templateManager.getWebviewContent(
                    this._currentView.webview,
                    {
                        isLoggedIn: this.apiService.isAuthenticated(),
                        showRefreshButton: true
                    }
                );
                await this.messageHandler.sendJsonData();
            } else {
                // Only show "no file selected" if we're looking at a real file that isn't ibm_catalog.json
                const isRealFile = fileName.includes('/') && !fileName.includes('extension-output');
                if (isRealFile) {
                    this._currentView.webview.html = await this.templateManager.getNoFileContent(
                        this._currentView.webview
                    );
                }
            }
        } catch (error) {
            this.logger.error('Error updating webview content', error);
            throw error;
        }
    }

    private async handleCreateIbmCatalog(): Promise<void> {
        try {
            await this.fileHandler.createNewFile();
            vscode.window.showInformationMessage('Created new ibm_catalog.json file');
            
            // Open the newly created file
            const filePath = this.fileHandler.getFilePath();
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            this.logger.error('Error creating ibm_catalog.json:', error);
            vscode.window.showErrorMessage('Failed to create ibm_catalog.json');
        }
    }
      private getWebviewOptions(): vscode.WebviewOptions {
        return {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'modules')
            ]
        };
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