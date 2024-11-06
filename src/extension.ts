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
import { LoggingService, LogLevel } from './services/core/LoggingService';
import { CacheService } from './services/CacheService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const isDebugMode = process.env.VSCODE_DEBUG_MODE === 'true';

    if (isDebugMode) {
        const config = vscode.workspace.getConfiguration('ibmCatalog');
        config.update('enableDebugLogging', true, vscode.ConfigurationTarget.Global)
            .then(
                () => console.log('Debug logging enabled'),
                (error) => console.error('Error enabling debug logging:', error)
            );
    }

    // Initialize and configure logging
    const logger = LoggingService.getInstance();

    // Set log level based on configuration or environment
    const config = vscode.workspace.getConfiguration('ibmCatalog');
    const debugMode = config.get<boolean>('enableDebugLogging', false);
    logger.setLogLevel(debugMode ? LogLevel.DEBUG : LogLevel.INFO);

    logger.info('Activating IBM Catalog Extension');

    try {
        // Initialize services
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

        // Use custom command for tree item clicks
        let lastClickTime: number | null = null;
        let lastClickedItemId: string | null = null;
        let singleClickTimer: NodeJS.Timeout | null = null;

        function handleTreeItemClick(item: CatalogTreeItem): void {
            const now = Date.now();
            const DOUBLE_CLICK_THRESHOLD = 500; // milliseconds
            const clickedItemId = item.id || item.jsonPath;

            if (
                lastClickTime &&
                lastClickedItemId === clickedItemId &&
                now - lastClickTime < DOUBLE_CLICK_THRESHOLD
            ) {
                // Double-click detected
                logger.debug('Double-click detected');

                if (singleClickTimer) {
                    clearTimeout(singleClickTimer);
                    singleClickTimer = null;
                }

                if (item.isEditable()) {
                    vscode.commands.executeCommand('ibmCatalog.editElement', item);
                }

                // Reset after double-click
                lastClickTime = null;
                lastClickedItemId = null;
            } else {
                // Single-click detected
                logger.debug('Single-click detected');

                if (singleClickTimer) {
                    clearTimeout(singleClickTimer);
                }

                // Delay single-click action to distinguish from double-click
                singleClickTimer = setTimeout(() => {
                    vscode.commands.executeCommand('ibmCatalog.selectElement', item);
                    singleClickTimer = null;
                }, DOUBLE_CLICK_THRESHOLD);

                lastClickTime = now;
                lastClickedItemId = clickedItemId;
            }
        }

        // Pass the treeView to the treeProvider
        treeProvider.setTreeView(treeView);

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('ibmCatalog.refresh', () => treeProvider.refresh()),
            vscode.commands.registerCommand('ibmCatalog.showLogs', () => {
                logger.show();
            }),
            vscode.commands.registerCommand('ibmCatalog.editElement', async (node: CatalogTreeItem) => {
                const catalogFilePath = catalogService.getCatalogFilePath();
                if (catalogFilePath) {
                    const document = await vscode.workspace.openTextDocument(catalogFilePath);
                    const editor = await vscode.window.showTextDocument(document, { preview: false });
                    await catalogService.editElement(node);

                    // Re-highlight the element after editing
                    await highlightService.highlightJsonPath(node.jsonPath, editor);
                }
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
            }),
            vscode.commands.registerCommand('ibmCatalog.login', async () => {
                await AuthService.promptForApiKey(context);
                await updateStatusBar();
                treeProvider.refresh();
            }),
            vscode.commands.registerCommand('ibmCatalog.selectElement', async (selectedItem: CatalogTreeItem) => {
                logger.debug('selectElement command called');
                logger.debug('Selected item:', selectedItem.label);

                const catalogFilePath = catalogService.getCatalogFilePath();
                if (catalogFilePath) {
                    const document = await vscode.workspace.openTextDocument(catalogFilePath);
                    const editor = await vscode.window.showTextDocument(document, { preview: false });
                    logger.debug('Calling highlightJsonPath with path:', selectedItem.jsonPath);
                    await highlightService.highlightJsonPath(selectedItem.jsonPath, editor);
                } else {
                    logger.error('Catalog file path is undefined.');
                    vscode.window.showErrorMessage('Catalog file not found.');
                }
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
            // Register the custom tree item click command
            vscode.commands.registerCommand('ibmCatalog.treeItemClicked', handleTreeItemClick),
            fileWatcher,
            highlightService,
            treeView
        );

        // Remove the onDidChangeSelection handler since we're handling clicks via command
        // treeView.onDidChangeSelection(async (e) => {
        //     // ... existing code ...
        // });

        // Function to get the root path
        function getRootPath(): string | undefined {
            return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        }

        // Function to check if ibm_catalog.json exists
        async function updateCatalogFileContext() {
            const rootPath = getRootPath();
            if (!rootPath) {
                vscode.commands.executeCommand('setContext', 'ibmCatalog.catalogFileExists', false);
                return;
            }
            const catalogFilePath = path.join(rootPath, 'ibm_catalog.json');
            const fileExists = await fileExistsAsync(catalogFilePath);
            vscode.commands.executeCommand('setContext', 'ibmCatalog.catalogFileExists', fileExists);
        }

        // Utility function to check file existence
        function fileExistsAsync(filePath: string): Promise<boolean> {
            return new Promise((resolve) => {
                fs.access(filePath, fs.constants.F_OK, (err) => {
                    resolve(!err);
                });
            });
        }

        // Call the function initially and whenever the workspace changes
        await updateCatalogFileContext();

        // Implement the createCatalogFile command
        context.subscriptions.push(
            vscode.commands.registerCommand('ibmCatalog.createCatalogFile', async () => {
                const rootPath = getRootPath();
                if (!rootPath) {
                    vscode.window.showErrorMessage('No workspace folder is open.');
                    return;
                }

                const catalogFilePath = path.join(rootPath, 'ibm_catalog.json');
                const fileExists = await fileExistsAsync(catalogFilePath);
                if (fileExists) {
                    vscode.window.showInformationMessage('ibm_catalog.json already exists.');
                    return;
                }

                const emptyCatalog = {
                    products: [
                        {
                            label: '',
                            name: '',
                            product_kind: '',
                            tags: [],
                            offering_icon_url: '',
                            flavors: []
                        }
                    ]
                };

                fs.writeFile(catalogFilePath, JSON.stringify(emptyCatalog, null, 4), (err) => {
                    if (err) {
                        vscode.window.showErrorMessage(`Failed to create ibm_catalog.json: ${err.message}`);
                    } else {
                        vscode.window.showInformationMessage('Created ibm_catalog.json');
                        updateCatalogFileContext();

                        // Optionally open the file
                        const openPath = vscode.Uri.file(catalogFilePath);
                        vscode.workspace.openTextDocument(openPath).then((doc) => {
                            vscode.window.showTextDocument(doc);
                        });

                        // Refresh the tree view
                        treeProvider.refresh();
                    }
                });
            })
        );

        vscode.workspace.onDidDeleteFiles(() => {
            updateCatalogFileContext();
            treeProvider.refresh();
        }, null, context.subscriptions);

        // Also update the handlers for file creation and renaming
        vscode.workspace.onDidCreateFiles(() => {
            updateCatalogFileContext();
            treeProvider.refresh();
        }, null, context.subscriptions);

        vscode.workspace.onDidRenameFiles(() => {
            updateCatalogFileContext();
            treeProvider.refresh();
        }, null, context.subscriptions);

        logger.info('IBM Catalog Extension activated successfully');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to activate IBM Catalog Editor: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

export function deactivate(): void {
    LoggingService.getInstance().info('Deactivating IBM Catalog Extension');
}
