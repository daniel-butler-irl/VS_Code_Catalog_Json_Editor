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
import { UIStateService } from './services/core/UIStateService';
import { FileSystemService } from './services/core/FileSystemService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const isDebugMode = process.env.VSCODE_DEBUG_MODE === 'true';

    if (isDebugMode) {
        const config = vscode.workspace.getConfiguration('ibmCatalog');
        config.update('enableDebugLogging', true, vscode.ConfigurationTarget.Global)
            .then(
                () => {
                    console.log('Debug logging enabled');
                    // Get the existing output channel
                    const outputChannel = vscode.window.createOutputChannel('IBM Catalog Extension');
                    outputChannel.show();
                    outputChannel.appendLine('Debug logging enabled');
                },
                (error) => {
                    console.error('Error enabling debug logging:', error);
                    const outputChannel = vscode.window.createOutputChannel('IBM Catalog Extension');
                    outputChannel.show();
                    outputChannel.appendLine(`Error enabling debug logging: ${error}`);
                }
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
        // Set up CacheService early
        const cacheService = CacheService.getInstance();
        cacheService.setContext(context); // Set the context before any cache operations

        const uiStateService = UIStateService.getInstance(context);
        context.subscriptions.push(uiStateService);

        const schemaService = new SchemaService();
        await schemaService.initialize();

        logger.debug('Initializing CatalogService');
        const catalogService = new CatalogService(context);
        const initialized = await catalogService.initialize();

        if (!initialized) {
            throw new Error('Failed to initialize CatalogService');
        }

        // Create tree provider even if no workspace (will show welcome view)
        const treeProvider = new CatalogTreeProvider(catalogService, context, schemaService);

        // Register the tree view with title buttons
        const treeView = vscode.window.createTreeView('ibmCatalogTree', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });

        // Connect the tree provider to the FileSystemService
        const fileSystemService = FileSystemService.getInstance(context);
        fileSystemService.setTreeProvider(treeProvider);

        // Track tree view selection changes - simplified for performance
        let selectionDebounceTimer: NodeJS.Timeout | undefined;
        let lastSelection: string | undefined;

        treeView.onDidChangeSelection(async e => {
            if (selectionDebounceTimer) {
                clearTimeout(selectionDebounceTimer);
            }

            if (e.selection.length > 0) {
                const selectedItem = e.selection[0];
                // Skip if same item
                if (lastSelection === selectedItem.jsonPath) {
                    return;
                }
                lastSelection = selectedItem.jsonPath;

                // Queue the reveal operation
                selectionDebounceTimer = setTimeout(() => {
                    // Use setImmediate to yield to the event loop
                    setImmediate(async () => {
                        await treeView.reveal(selectedItem, {
                            select: true,
                            focus: false,
                            expand: true
                        });
                    });
                }, 150);
            }
        });

        // Set tree view title
        treeView.title = 'IBM Catalog';

        // Only create file watcher if we have a workspace
        let fileWatcher: CatalogFileSystemWatcher | undefined;
        if (catalogService.hasWorkspace()) {
            fileWatcher = new CatalogFileSystemWatcher(catalogService, treeProvider);
            context.subscriptions.push(fileWatcher);
        }
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

        // Pass the treeView to the highlight service
        highlightService.setTreeView(treeView);

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('ibmCatalog.refresh', () => treeProvider.refresh()),
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
            vscode.commands.registerCommand('ibmCatalog.collapseAll', async () => {
                // Ensure tree view has focus
                await treeView.reveal(treeView.selection[0], { focus: true });

                // Collapse all nodes
                treeProvider.collapseAll();
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
            vscode.commands.registerCommand('ibmCatalog.addElement', async (parentNode: CatalogTreeItem) => {
                try {
                    if (!catalogService.isInitialized()) {
                        const initialized = await catalogService.initialize();
                        if (!initialized) {
                            throw new Error('No IBM Catalog file found. Please create one first.');
                        }
                    }
                    await catalogService.addElement(parentNode, schemaService);
                    treeProvider.refresh();
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showErrorMessage(`Failed to add element: ${message}`);
                }
            }),
            vscode.commands.registerCommand('ibmCatalog.login', async () => {
                await AuthService.promptForApiKey(context);
                await updateStatusBar();
                treeProvider.refresh();
            }),
            vscode.commands.registerCommand('ibmCatalog.selectElement', async (item: CatalogTreeItem) => {
                const catalogFilePath = catalogService.getCatalogFilePath();
                if (!catalogFilePath) { return; }

                // Queue document operations
                const document = await vscode.workspace.openTextDocument(catalogFilePath);
                const editor = await vscode.window.showTextDocument(document, {
                    preview: false,
                    preserveFocus: true
                });

                // Use setImmediate for highlight operations
                setImmediate(async () => {
                    highlightService.clearHighlight();
                    await highlightService.highlightJsonPath(item.jsonPath, editor);

                    const range = highlightService.getCurrentHighlightRange();
                    if (range) {
                        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                    }
                });
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
            treeView,
            ...(fileWatcher ? [fileWatcher] : []),
            vscode.commands.registerCommand('ibmCatalogTree.revealJsonPath', async (jsonPath: string, options?: { select?: boolean; focus?: boolean }) => {
                // Skip if same path
                if (lastSelection === jsonPath) {
                    return;
                }
                lastSelection = jsonPath;

                // Use setImmediate to yield to the event loop for the search operation
                const items = await new Promise<CatalogTreeItem[]>(resolve => {
                    setImmediate(async () => {
                        const result = await treeProvider.findItemsByJsonPath(jsonPath);
                        resolve(result);
                    });
                });

                if (items.length > 0) {
                    const targetItem = items[0];

                    // Queue parent expansion
                    const parent = targetItem.parent;
                    if (parent) {
                        await new Promise<void>(resolve => {
                            setImmediate(async () => {
                                await treeView.reveal(parent, {
                                    select: false,
                                    focus: false,
                                    expand: true
                                });
                                resolve();
                            });
                        });
                    }

                    // Queue item reveal - always default to not taking focus
                    await new Promise<void>(resolve => {
                        setImmediate(async () => {
                            await treeView.reveal(targetItem, {
                                select: options?.select ?? true,
                                focus: options?.focus ?? false,
                                expand: true
                            });
                            resolve();
                        });
                    });

                    // Queue highlight update without taking focus
                    setImmediate(() => {
                        targetItem.setHighlighted(true);
                        setTimeout(() => targetItem.setHighlighted(false), 1000);
                    });
                }
            })
        );

        // Connect the tree view to the highlight service for reverse highlighting
        highlightService.setTreeView(treeView);

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

        await vscode.commands.executeCommand('setContext', 'ibmCatalog.hasWorkspace', catalogService.hasWorkspace());
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.catalogFileExists', Boolean(catalogService.getCatalogFilePath()));

        logger.info('IBM Catalog Extension activated successfully');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to activate IBM Catalog Editor: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

export function deactivate(): void {
    LoggingService.getInstance().info('Deactivating IBM Catalog Extension');
}