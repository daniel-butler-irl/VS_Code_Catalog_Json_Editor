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
    logger.info('Starting IBM Catalog Extension activation');

    try {
        // Set initial loading state
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.hasWorkspace', false);
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.catalogFileExists', false);
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', false);
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', false);

        // Initialize core services first
        const cacheService = CacheService.getInstance();
        cacheService.setContext(context);

        const uiStateService = UIStateService.getInstance(context);
        context.subscriptions.push(uiStateService);

        // Create status bar item early to show activation progress
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarItem.text = '$(sync~spin) Activating IBM Catalog Extension...';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        // Only check IBM Cloud authentication status on startup
        const isLoggedIn = await AuthService.isLoggedIn(context);
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', isLoggedIn);

        // Initialize schema service in the background
        const schemaService = new SchemaService();
        const schemaInitPromise = schemaService.initialize();

        // Initialize catalog service with basic setup
        logger.debug('Initializing CatalogService');
        const catalogService = new CatalogService(context);
        const catalogInitPromise = catalogService.initialize();

        // Initialize PreReleaseService and PreReleaseWebview
        const preReleaseService = PreReleaseService.getInstance(context);
        const preReleaseWebview = PreReleaseWebview.initialize(context, logger, preReleaseService);

        // Register the PreReleaseWebview provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('ibmCatalogPreRelease', preReleaseWebview, {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            })
        );

        // Create tree provider with minimal initial state
        const treeProvider = new CatalogTreeProvider(catalogService, context, schemaService);
        const treeView = vscode.window.createTreeView('ibmCatalogTree', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });

        // Connect the tree provider to the FileSystemService early
        const fileSystemService = FileSystemService.getInstance(context);
        fileSystemService.setTreeProvider(treeProvider);

        // Register essential commands immediately
        registerEssentialCommands(context, treeProvider, catalogService, statusBarItem);

        // Wait for critical services to initialize
        const [catalogInitialized] = await Promise.all([
            catalogInitPromise,
            schemaInitPromise
        ]);

        // Update workspace context after initialization
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.hasWorkspace', true);
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.catalogFileExists', Boolean(catalogService.getCatalogFilePath()));

        if (!catalogInitialized) {
            logger.warn('CatalogService initialization incomplete');
        }

        // Initialize remaining services and features asynchronously
        initializeRemainingFeatures(context, catalogService, treeProvider, treeView, statusBarItem);

        // Add authentication state change listener
        context.subscriptions.push(
            vscode.authentication.onDidChangeSessions(async e => {
                if (e.provider.id === 'github') {
                    // Check current GitHub auth state
                    const isGithubLoggedIn = await AuthService.isGitHubLoggedIn(context);
                    await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', isGithubLoggedIn);

                    // Update PreReleaseWebview auth status if it exists
                    const preReleaseView = PreReleaseWebview.getInstance();
                    if (preReleaseView) {
                        await preReleaseView.sendAuthenticationStatus();
                    }
                }
            })
        );

        // Register logout commands
        context.subscriptions.push(
            vscode.commands.registerCommand('ibmCatalog.logout', async () => {
                try {
                    // Clear IBM Cloud API key
                    await AuthService.logout(context);
                    await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', false);

                    // Get PreReleaseWebview instance and update auth status
                    const preReleaseView = PreReleaseWebview.getInstance();
                    if (preReleaseView) {
                        await preReleaseView.sendAuthenticationStatus();
                    }

                    vscode.window.showInformationMessage('Successfully logged out from IBM Cloud');
                } catch (error) {
                    logger.error('Failed to logout from IBM Cloud', { error });
                    vscode.window.showErrorMessage('Failed to logout from IBM Cloud');
                }
            })
        );

        // Register setLogLevel command
        context.subscriptions.push(
            vscode.commands.registerCommand('ibmCatalog.setLogLevel', async () => {
                const logger = LoggingService.getInstance();
                const currentLevel = logger.getLogLevel();

                const levels = [
                    { label: `DEBUG${currentLevel === LogLevel.DEBUG ? ' ✓' : ''}`, level: LogLevel.DEBUG },
                    { label: `INFO${currentLevel === LogLevel.INFO ? ' ✓' : ''}`, level: LogLevel.INFO },
                    { label: `WARN${currentLevel === LogLevel.WARN ? ' ✓' : ''}`, level: LogLevel.WARN },
                    { label: `ERROR${currentLevel === LogLevel.ERROR ? ' ✓' : ''}`, level: LogLevel.ERROR }
                ];

                const selectedItem = await vscode.window.showQuickPick(levels, {
                    placeHolder: 'Select log level',
                    title: `Set Log Level (Current: ${LogLevel[currentLevel]})`,
                });

                if (selectedItem) {
                    logger.setLogLevel(selectedItem.level);
                    vscode.window.showInformationMessage(`Log level set to: ${selectedItem.label.replace(' ✓', '')}`);

                    // Log a test message at the new level
                    logger.debug('Debug logging test message', {
                        previousLevel: LogLevel[currentLevel],
                        newLogLevel: LogLevel[selectedItem.level],
                        timestamp: new Date().toISOString()
                    }, 'preRelease');

                    // Show channel selection prompt
                    const channels = [
                        { label: 'IBM Catalog', value: 'main' },
                        { label: 'IBM Catalog Pre-release', value: 'preRelease' }
                    ];

                    const selectedChannel = await vscode.window.showQuickPick(channels, {
                        placeHolder: 'Select log channel to show',
                        title: 'Show Log Channel'
                    });

                    if (selectedChannel) {
                        logger.show(selectedChannel.value as 'main' | 'preRelease');
                    }
                }
            })
        );

        logger.info('IBM Catalog Extension activated successfully');
        statusBarItem.text = '$(check) IBM Catalog Extension Ready';
        setTimeout(() => updateStatusBar(statusBarItem, context), 2000);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to activate IBM Catalog Editor: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

function registerEssentialCommands(
    context: vscode.ExtensionContext,
    treeProvider: CatalogTreeProvider,
    catalogService: CatalogService,
    statusBarItem: vscode.StatusBarItem
): void {
    // Register only essential commands for initial activation
    context.subscriptions.push(
        vscode.commands.registerCommand('ibmCatalog.refresh', () => treeProvider.refresh()),
        vscode.commands.registerCommand('ibmCatalog.login', async () => {
            try {
                await AuthService.login(context);
                await updateStatusBar(statusBarItem, context);
                await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', true);
                vscode.window.showInformationMessage('Successfully logged in to IBM Cloud');
                treeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to login: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }),
        // Register GitHub login command
        vscode.commands.registerCommand('ibmCatalog.loginGithub', async () => {
            try {
                const preReleaseView = PreReleaseWebview.getInstance();
                if (preReleaseView) {
                    await preReleaseView.handleGitHubLogin();
                    await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', true);
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

                // Update context and UI after user acknowledges
                await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', false);
                const preReleaseView = PreReleaseWebview.getInstance();
                if (preReleaseView) {
                    await preReleaseView.sendAuthenticationStatus();
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to logout from GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

    // Track tree view selection
    let lastClickTime: number | null = null;
    let lastClickedItemId: string | null = null;
    let singleClickTimer: NodeJS.Timeout | null = null;

    function handleTreeItemClick(item: CatalogTreeItem): void {
        const now = Date.now();
        const DOUBLE_CLICK_THRESHOLD = 500;
        const clickedItemId = item.id || item.jsonPath;

        if (lastClickTime && lastClickedItemId === clickedItemId && now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
            if (singleClickTimer) {
                clearTimeout(singleClickTimer);
                singleClickTimer = null;
            }
            if (item.isEditable()) {
                void vscode.commands.executeCommand('ibmCatalog.editElement', item);
            }
            lastClickTime = null;
            lastClickedItemId = null;
        } else {
            if (singleClickTimer) {
                clearTimeout(singleClickTimer);
            }
            singleClickTimer = setTimeout(() => {
                void vscode.commands.executeCommand('ibmCatalog.selectElement', item);
                singleClickTimer = null;
            }, DOUBLE_CLICK_THRESHOLD);
            lastClickTime = now;
            lastClickedItemId = clickedItemId;
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
