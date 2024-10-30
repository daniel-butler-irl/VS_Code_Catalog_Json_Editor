import * as vscode from 'vscode';
import { CatalogTreeProvider } from './providers/CatalogTreeProvider';
import { CatalogFileSystemWatcher } from './services/CatalogFileSystemWatcher';
import { CatalogService } from './services/CatalogService';
import { EditorHighlightService } from './services/EditorHighlightService';
import { SchemaService } from './services/SchemaService';
import { CatalogTreeItem } from './models/CatalogTreeItem';
import { AuthService } from './services/AuthService';
import { LoggingService, LogLevel } from './services/LoggingService';
import { CacheService } from './services/CacheService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Initialize and configure logging
    const logger = LoggingService.getInstance();

    // Set log level based on configuration or environment
    const config = vscode.workspace.getConfiguration('ibmCatalog');
    const debugMode = config.get<boolean>('enableDebugLogging', false);
    logger.setLogLevel(debugMode ? LogLevel.DEBUG : LogLevel.INFO);

    logger.info('Activating IBM Catalog Extension');

    try {
        // Initialize services
        logger.debug('Initializing SchemaService');
        const schemaService = new SchemaService();
        await schemaService.initialize();

        logger.debug('Initializing CatalogService');
        const catalogService = new CatalogService(context);
        const treeProvider = new CatalogTreeProvider(catalogService, context, schemaService);
        const fileWatcher = new CatalogFileSystemWatcher(catalogService, treeProvider);
        const highlightService = new EditorHighlightService();

        // Create status bar item
        logger.debug('Creating status bar items');
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarItem.command = 'ibmCatalog.login'; // Default command
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        // Function to update the status bar based on login status
        async function updateStatusBar() {
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

        // Call the function to set the initial status
        updateStatusBar();

        // Initialize catalog service
        await catalogService.initialize();

        // Create tree view
        const treeView = vscode.window.createTreeView('ibmCatalogTree', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });

        // Pass the treeView to the treeProvider
        treeProvider.setTreeView(treeView);

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('ibmCatalog.refresh', () => treeProvider.refresh()),
            vscode.commands.registerCommand('ibmCatalog.showLogs', () => {
                logger.show();
            }),
            vscode.commands.registerCommand('ibmCatalog.editElement', async (node) => {
                await catalogService.editElement(node);
                // Re-highlight the element after editing
                // Add a small delay to ensure symbol provider updates
                setTimeout(async () => {
                    await highlightService.highlightJsonPath(node.jsonPath);
                }, 100); // Delay in milliseconds
            }),
            vscode.commands.registerCommand('ibmCatalog.clearCache', () => {
                const cacheService = CacheService.getInstance();
                cacheService.clearAll();
                vscode.window.showInformationMessage('IBM Catalog cache cleared');
                treeProvider.refresh(); // Refresh the tree view to reflect changes
            }),
            vscode.commands.registerCommand('ibmCatalog.clearCatalogCache', () => {
                const cacheService = CacheService.getInstance();
                const cleared = cacheService.clearPrefix('catalog');
                vscode.window.showInformationMessage(`Cleared ${cleared} catalog cache entries`);
                treeProvider.refresh(); // Refresh the tree view to reflect changes
            }),
            vscode.commands.registerCommand('ibmCatalog.addElement', async (parentNode: CatalogTreeItem) => {
                await catalogService.addElement(parentNode, schemaService);
                treeProvider.refresh();
            }), vscode.commands.registerCommand('ibmCatalog.login', async () => {
                await AuthService.promptForApiKey(context);
                await updateStatusBar();
                treeProvider.refresh();
            }),

            vscode.commands.registerCommand('ibmCatalog.logout', async () => {
                await AuthService.clearApiKey(context);
                vscode.window.showInformationMessage('Logged out of IBM Cloud.');
                await updateStatusBar();
                treeProvider.refresh();
            }),
            vscode.commands.registerCommand('ibmCatalog.locateCatalogFile', async () => {
                const files = await vscode.workspace.findFiles('**/ibm_catalog.json', '**/node_modules/**');
                if (files.length > 0) {
                    await catalogService.initialize();
                    treeProvider.refresh();
                    vscode.window.showInformationMessage('IBM Catalog file found and loaded');
                } else {
                    vscode.window.showInformationMessage('No ibm_catalog.json file found in workspace');
                }
            }),
            fileWatcher,
            highlightService,
            treeView
        );

        // Use treeView for selection handling
        treeView.onDidChangeSelection(async (e) => {
            if (e.selection.length > 0) {
                const selectedItem = e.selection[0];
                await highlightService.highlightJsonPath(selectedItem.jsonPath);
            } else {
                highlightService.clearHighlight();
            }
        });

        context.subscriptions.push(treeView);
        logger.info('IBM Catalog Extension activated successfully');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to activate IBM Catalog Editor: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

export function deactivate(): void {
    LoggingService.getInstance().info('Deactivating IBM Catalog Extension');
}