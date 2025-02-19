// extension.ts is the entry point for the extension. It is responsible for activating the extension and setting up the necessary services and commands.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CatalogTreeProvider } from './providers/CatalogTreeProvider';
import { CatalogFileSystemWatcher } from './services/CatalogFileSystemWatcher';
import { CatalogService } from './services/CatalogService';
import { EditorHighlightService } from './services/EditorHighlightService';
import { SchemaService } from './services/SchemaService';
import { CatalogTreeItem } from './models/CatalogTreeItem';
import { AuthService } from './services/AuthService';
import { LoggingService } from './services/core/LoggingService';
import { LogLevel } from './services/core/LoggingService';
import { CacheService } from './services/CacheService';
import { UIStateService } from './services/core/UIStateService';
import { FileSystemService } from './services/core/FileSystemService';
import { PreReleaseWebview } from './webview/PreReleaseWebview';
import { AuthenticationSession } from 'vscode';
import { PreReleaseService } from './services/PreReleaseService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const logger = LoggingService.getInstance();
    logger.setLogLevel(LogLevel.DEBUG); // Set to debug level during activation
    logger.info('Starting IBM Catalog Extension activation');

    try {
        logger.debug('Creating status bar item');
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        context.subscriptions.push(statusBarItem);
        statusBarItem.text = '$(sync~spin) Activating IBM Catalog Extension...';
        statusBarItem.show();

        logger.debug('Storing status bar item in workspace state');
        await context.workspaceState.update('ibmCatalog.statusBarItem', statusBarItem);

        logger.debug('Registering essential commands');
        registerEssentialCommands(context);

        logger.debug('Setting initial loading state');
        await Promise.all([
            vscode.commands.executeCommand('setContext', 'ibmCatalog.hasWorkspace', false),
            vscode.commands.executeCommand('setContext', 'ibmCatalog.catalogFileExists', false),
            vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', false),
            vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', false)
        ]);

        logger.debug('Initializing core services');
        const cacheService = CacheService.getInstance();
        cacheService.setContext(context);

        const uiStateService = UIStateService.getInstance(context);
        context.subscriptions.push(uiStateService);

        logger.debug('Initializing PreReleaseService');
        await PreReleaseService.initialize(context);

        logger.debug('Checking IBM Cloud authentication status');
        const isLoggedIn = await AuthService.isLoggedIn(context);
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', isLoggedIn);

        logger.debug('Initializing schema and catalog services');
        const schemaService = new SchemaService();
        const schemaInitPromise = schemaService.initialize();
        const catalogService = new CatalogService(context);
        const catalogInitPromise = catalogService.initialize();

        logger.debug('Initializing PreReleaseWebview');
        const preReleaseService = PreReleaseService.getInstance(context);
        const preReleaseWebview = PreReleaseWebview.initialize(context, logger, preReleaseService);

        try {
            logger.debug('Registering PreReleaseWebview provider');
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider('ibmCatalogPreRelease', preReleaseWebview, {
                    webviewOptions: {
                        retainContextWhenHidden: true
                    }
                })
            );
        } catch (error) {
            logger.error('Failed to register PreReleaseWebview provider', { error });
        }

        logger.debug('Creating tree provider');
        const treeProvider = new CatalogTreeProvider(catalogService, context, schemaService);
        const treeView = vscode.window.createTreeView('ibmCatalogTree', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });

        logger.debug('Connecting tree provider to FileSystemService');
        const fileSystemService = FileSystemService.getInstance(context);
        fileSystemService.setTreeProvider(treeProvider);

        logger.debug('Waiting for critical services to initialize');
        const [catalogInitialized] = await Promise.all([
            catalogInitPromise,
            schemaInitPromise
        ]);

        if (!catalogInitialized) {
            logger.warn('CatalogService initialization incomplete');
        }

        logger.debug('Initializing remaining features');
        await initializeRemainingFeatures(context, catalogService, treeProvider, treeView, statusBarItem);

        logger.info('IBM Catalog Extension activated successfully');
        statusBarItem.text = '$(check) IBM Catalog Extension Ready';
        await updateStatusBar(statusBarItem, context);

        // Reset log level to INFO after activation
        logger.setLogLevel(LogLevel.INFO);
    } catch (error) {
        logger.error('Failed to activate extension', {
            error,
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            errorStack: error instanceof Error ? error.stack : undefined
        });
        vscode.window.showErrorMessage(`Failed to activate IBM Catalog Editor: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

function registerEssentialCommands(
    context: vscode.ExtensionContext
): void {
    // Register only essential commands for initial activation
    context.subscriptions.push(
        vscode.commands.registerCommand('ibmCatalog.login', async () => {
            try {
                await AuthService.login(context);

                // Update context and UI immediately
                await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', true);

                // Clear caches
                const cacheService = CacheService.getInstance();
                await cacheService.clearAll();

                // Update status bar
                const statusBarItem = context.workspaceState.get('ibmCatalog.statusBarItem') as vscode.StatusBarItem;
                if (statusBarItem) {
                    await updateStatusBar(statusBarItem, context);
                }

                // Force immediate refresh of PreReleaseWebview
                const preReleaseView = PreReleaseWebview.getInstance();
                if (preReleaseView) {
                    await preReleaseView.sendAuthenticationStatus(true);
                    await preReleaseView.refresh();
                }

                vscode.window.showInformationMessage('Successfully logged in to IBM Cloud');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to login: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),
        // Register logout command
        vscode.commands.registerCommand('ibmCatalog.logout', async () => {
            try {
                await AuthService.logout(context);

                // Update context and UI immediately
                await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', false);

                // Update status bar
                const statusBarItem = context.workspaceState.get('ibmCatalog.statusBarItem') as vscode.StatusBarItem;
                if (statusBarItem) {
                    await updateStatusBar(statusBarItem, context);
                }

                // Force immediate refresh of PreReleaseWebview
                const preReleaseView = PreReleaseWebview.getInstance();
                if (preReleaseView) {
                    await preReleaseView.sendAuthenticationStatus(true);
                    await preReleaseView.refresh();
                }

                vscode.window.showInformationMessage('Successfully logged out from IBM Cloud');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to logout: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),
        // Register GitHub login command
        vscode.commands.registerCommand('ibmCatalog.loginGithub', async () => {
            try {
                const preReleaseView = PreReleaseWebview.getInstance();
                if (preReleaseView) {
                    await preReleaseView.handleGitHubLogin();
                    await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', true);
                    await preReleaseView.sendAuthenticationStatus(true);
                    vscode.window.showInformationMessage('Successfully logged in to GitHub');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to login to GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),
        // Register GitHub logout command
        vscode.commands.registerCommand('ibmCatalog.logoutGithub', async () => {
            try {
                // Show instructions for built-in GitHub logout
                const signOutAction = 'How to Sign Out';
                const response = await vscode.window.showInformationMessage(
                    'To sign out of GitHub:',
                    signOutAction
                );

                if (response === signOutAction) {
                    await vscode.window.showInformationMessage(
                        'Click the account icon in the bottom left corner of VS Code, then click "Sign out" next to your GitHub account.',
                        { modal: true }
                    );
                }

                // Update context and UI immediately
                await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', false);
                const preReleaseView = PreReleaseWebview.getInstance();
                if (preReleaseView) {
                    await preReleaseView.sendAuthenticationStatus(true);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to logout from GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),
        // Register addElement command early to ensure it's available
        vscode.commands.registerCommand('ibmCatalog.addElement', async (node: CatalogTreeItem) => {
            try {
                const schemaService = new SchemaService();
                await schemaService.initialize();
                const catalogService = new CatalogService(context);
                await catalogService.initialize();

                await catalogService.addElement(node, schemaService);
                // Since we don't have the tree provider here, we'll need to refresh it through a context update
                await vscode.commands.executeCommand('setContext', 'ibmCatalog.refresh', Date.now());
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                LoggingService.getInstance().error('Failed to add element', { error });
                vscode.window.showErrorMessage(`Failed to add element: ${message}`);
            }
        })
    );
}

async function initializeRemainingFeatures(
    context: vscode.ExtensionContext,
    catalogService: CatalogService,
    treeProvider: CatalogTreeProvider,
    treeView: vscode.TreeView<CatalogTreeItem>,
    statusBarItem: vscode.StatusBarItem
): Promise<void> {
    const logger = LoggingService.getInstance();
    const schemaService = new SchemaService();
    await schemaService.initialize();

    // Initialize file watcher if workspace exists
    let fileWatcher: CatalogFileSystemWatcher | undefined;
    if (catalogService.hasWorkspace()) {
        fileWatcher = new CatalogFileSystemWatcher(catalogService, treeProvider);
        context.subscriptions.push(fileWatcher);
    }

    // Register remaining commands
    registerRemainingCommands(context, catalogService, treeProvider, treeView, schemaService, fileWatcher);

    // Set up workspace change handlers
    setupWorkspaceHandlers(context, catalogService, treeProvider);

    // Update status bar and contexts
    await updateStatusBar(statusBarItem, context);
    await vscode.commands.executeCommand('setContext', 'ibmCatalog.hasWorkspace', catalogService.hasWorkspace());
    await vscode.commands.executeCommand('setContext', 'ibmCatalog.catalogFileExists', Boolean(catalogService.getCatalogFilePath()));
}

async function updateStatusBar(statusBarItem: vscode.StatusBarItem, context: vscode.ExtensionContext): Promise<void> {
    const isLoggedIn = await AuthService.isLoggedIn(context);
    if (isLoggedIn) {
        statusBarItem.text = '$(account) Logged in to IBM Cloud';
        statusBarItem.tooltip = 'Click to logout';
        statusBarItem.command = 'ibmCatalog.logout';
    } else {
        statusBarItem.text = '$(account) Not logged in to IBM Cloud';
        statusBarItem.tooltip = 'Click to login';
        statusBarItem.command = 'ibmCatalog.login';
    }
}

function setupWorkspaceHandlers(
    context: vscode.ExtensionContext,
    catalogService: CatalogService,
    treeProvider: CatalogTreeProvider
): void {
    const workspaceHandlers = [
        vscode.workspace.onDidDeleteFiles,
        vscode.workspace.onDidCreateFiles,
        vscode.workspace.onDidRenameFiles
    ].map(event =>
        event(() => {
            void updateCatalogFileContext(catalogService);
            treeProvider.refresh();
        }, null, context.subscriptions)
    );

    context.subscriptions.push(...workspaceHandlers);
}

async function updateCatalogFileContext(catalogService: CatalogService): Promise<void> {
    await vscode.commands.executeCommand(
        'setContext',
        'ibmCatalog.catalogFileExists',
        Boolean(catalogService.getCatalogFilePath())
    );
}

function registerRemainingCommands(
    context: vscode.ExtensionContext,
    catalogService: CatalogService,
    treeProvider: CatalogTreeProvider,
    treeView: vscode.TreeView<CatalogTreeItem>,
    schemaService: SchemaService,
    fileWatcher?: CatalogFileSystemWatcher
): void {
    const logger = LoggingService.getInstance();
    const highlightService = new EditorHighlightService();
    highlightService.setTreeView(treeView);

    // Track tree view selection using a simple state object
    const clickState = {
        lastClickTime: null as number | null,
        lastClickedItemId: null as string | null,
        clickTimeout: null as number | null,
        clearClickState: function () {
            logger.debug('Clearing click state', {
                hadTimer: this.clickTimeout !== null,
                lastClickedItemId: this.lastClickedItemId
            });
            if (this.clickTimeout !== null) {
                window.clearTimeout(this.clickTimeout);
                this.clickTimeout = null;
            }
            this.lastClickTime = null;
            this.lastClickedItemId = null;
        }
    };

    // Ensure cleanup of timer on deactivation
    context.subscriptions.push({
        dispose: () => {
            logger.debug('Disposing click state handler', {
                hadTimer: clickState.clickTimeout !== null,
                lastClickedItemId: clickState.lastClickedItemId
            });
            clickState.clearClickState();
        }
    });

    function handleTreeItemClick(item: CatalogTreeItem): void {
        const now = Date.now();
        const DOUBLE_CLICK_THRESHOLD = 500;
        const clickedItemId = item.id || item.jsonPath;

        logger.debug('Tree item clicked', {
            itemId: clickedItemId,
            itemPath: item.jsonPath,
            lastClickTime: clickState.lastClickTime,
            timeSinceLastClick: clickState.lastClickTime ? now - clickState.lastClickTime : null,
            hasActiveTimer: clickState.clickTimeout !== null
        });

        if (clickState.lastClickTime && clickState.lastClickedItemId === clickedItemId &&
            now - clickState.lastClickTime < DOUBLE_CLICK_THRESHOLD) {
            logger.debug('Double click detected', {
                itemId: clickedItemId,
                timeBetweenClicks: now - clickState.lastClickTime
            });
            clickState.clearClickState();
            if (item.isEditable()) {
                void vscode.commands.executeCommand('ibmCatalog.editElement', item);
            }
        } else {
            logger.debug('Single click detected, setting up timer', {
                itemId: clickedItemId,
                threshold: DOUBLE_CLICK_THRESHOLD
            });
            clickState.clearClickState();
            // Create a new timer but don't store it in context
            clickState.clickTimeout = window.setTimeout(() => {
                logger.debug('Single click timer expired, executing command', {
                    itemId: clickedItemId
                });
                void vscode.commands.executeCommand('ibmCatalog.selectElement', item);
                clickState.clickTimeout = null;
            }, DOUBLE_CLICK_THRESHOLD);
            clickState.lastClickTime = now;
            clickState.lastClickedItemId = clickedItemId;
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('ibmCatalog.showLogs', () => {
            logger.show();
        }),
        vscode.commands.registerCommand('ibmCatalog.clearCache', () => {
            const cacheService = CacheService.getInstance();
            void cacheService.clearAll();
            void schemaService.refreshSchema();
            treeProvider.refresh();
            vscode.window.showInformationMessage('IBM Catalog cache cleared');
        }),
        vscode.commands.registerCommand('ibmCatalog.refresh', () => {
            treeProvider.refresh();
        }),
        vscode.commands.registerCommand('ibmCatalog.locateCatalogFile', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'JSON files': ['json']
                },
                title: 'Select IBM Catalog JSON File'
            });
            if (uris && uris.length > 0 && vscode.workspace.workspaceFolders?.[0]) {
                await catalogService.initialize();
                await catalogService.reloadCatalogData();
                treeProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('ibmCatalog.createCatalogFile', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                void vscode.window.showErrorMessage('No workspace folder open');
                return;
            }
            const defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'ibm_catalog.json');
            const uri = await vscode.window.showSaveDialog({
                defaultUri,
                filters: {
                    'JSON files': ['json']
                },
                title: 'Create IBM Catalog JSON File'
            });
            if (uri) {
                // Create an empty catalog file
                await vscode.workspace.fs.writeFile(uri, Buffer.from('{}', 'utf8'));
                await catalogService.initialize();
                await catalogService.reloadCatalogData();
                treeProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('ibmCatalog.openPreReleasePanel', () => {
            void vscode.commands.executeCommand('workbench.view.extension.ibm-catalog-explorer');
        }),
        vscode.commands.registerCommand('ibmCatalog.createPreRelease', async () => {
            const preReleaseService = PreReleaseService.getInstance(context);
            const details = {
                version: '0.0.0',
                postfix: 'beta.1',
                publishToCatalog: false,
                releaseGithub: true,
                description: 'Pre-release version',
                draft: true
            };
            await preReleaseService.createPreRelease(details);
        }),
        vscode.commands.registerCommand('ibmCatalog.showPreReleaseLogs', () => {
            logger.show('preRelease');
        }),
        vscode.commands.registerCommand('ibmCatalog.editElement', async (node: CatalogTreeItem) => {
            const catalogFilePath = catalogService.getCatalogFilePath();
            if (catalogFilePath) {
                const document = await vscode.workspace.openTextDocument(catalogFilePath);
                const editor = await vscode.window.showTextDocument(document, { preview: false });
                await catalogService.editElement(node);
                await highlightService.highlightJsonPath(node.jsonPath, editor);
            }
        }),
        vscode.commands.registerCommand('ibmCatalog.triggerEdit', async () => {
            const selection = treeView.selection;
            if (selection.length > 0) {
                const item = selection[0];
                logger.debug('Keyboard edit triggered', { itemPath: item.jsonPath });
                if (item.isEditable()) {
                    await vscode.commands.executeCommand('ibmCatalog.editElement', item);
                }
            }
        }),
        vscode.commands.registerCommand('ibmCatalog.selectElement', async (item: CatalogTreeItem) => {
            const catalogFilePath = catalogService.getCatalogFilePath();
            if (!catalogFilePath) { return; }

            const document = await vscode.workspace.openTextDocument(catalogFilePath);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: true
            });

            setImmediate(async () => {
                highlightService.clearHighlight();
                await highlightService.highlightJsonPath(item.jsonPath, editor);
                const range = highlightService.getCurrentHighlightRange();
                if (range) {
                    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                }
            });
        }),
        vscode.commands.registerCommand('ibmCatalog.treeItemClicked', handleTreeItemClick),
        ...(fileWatcher ? [fileWatcher] : [])
    );
}

export function deactivate(): void {
    LoggingService.getInstance().info('Deactivating IBM Catalog Extension');
}
