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
import { ValidationUIService } from './services/ValidationUIService';
import { ValidationRuleRegistry, SchemaValidationIgnoreService } from './services/validation';

// Define a type for the API we're exposing
interface ExtensionExports {
    getCatalogService: () => CatalogService;
    getSchemaService: () => SchemaService;
    getValidationUIService: () => ValidationUIService;
    getPreReleaseService: () => PreReleaseService;
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionExports> {
    const logger = LoggingService.getInstance();
    logger.setLogLevel(LogLevel.DEBUG); // Set to debug level during activation
    logger.info('Starting IBM Catalog Extension activation');

    try {
        logger.debug('Creating status bar item', undefined, 'main');
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        context.subscriptions.push(statusBarItem);
        statusBarItem.text = '$(sync~spin) Activating IBM Catalog Extension...';
        statusBarItem.show();

        logger.debug('Storing status bar item properties in workspace state', undefined, 'main');
        await context.workspaceState.update('ibmCatalog.statusBarItem.text', statusBarItem.text);
        await context.workspaceState.update('ibmCatalog.statusBarItem.alignment', vscode.StatusBarAlignment.Left);
        context.subscriptions.push(statusBarItem);
        statusBarItem.text = '$(sync~spin) Activating IBM Catalog Extension...';
        statusBarItem.show();

        logger.debug('Registering essential commands', undefined, 'main');
        registerEssentialCommands(context);

        logger.debug('Setting initial loading state', undefined, 'main');
        await Promise.all([
            vscode.commands.executeCommand('setContext', 'ibmCatalog.hasWorkspace', false),
            vscode.commands.executeCommand('setContext', 'ibmCatalog.catalogFileExists', false),
            vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', false),
            vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', false)
        ]);

        logger.debug('Initializing core services', undefined, 'main');
        const cacheService = CacheService.getInstance();
        cacheService.setContext(context);

        const uiStateService = UIStateService.getInstance(context);
        context.subscriptions.push(uiStateService);

        // Initialize validation services early
        logger.debug('Initializing validation services', undefined, 'main');
        const validationRuleRegistry = ValidationRuleRegistry.getInstance();
        const schemaValidationIgnoreService = SchemaValidationIgnoreService.getInstance();

        // Log the current validation configuration
        logger.debug('Validation configuration', {
            rules: validationRuleRegistry.getAllRules().map(rule => ({
                id: rule.id,
                description: rule.description,
                enabled: validationRuleRegistry.getRuleConfig(rule.id)?.enabled
            })),
            ignorePatterns: schemaValidationIgnoreService.getIgnoredErrorsSummary()
        }, 'schemaValidation');

        logger.debug('Initializing PreReleaseService', undefined, 'main');
        await PreReleaseService.initialize(context);

        logger.debug('Checking IBM Cloud authentication status', undefined, 'main');
        const isLoggedIn = await AuthService.isLoggedIn(context);
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', isLoggedIn);

        logger.debug('Initializing schema and catalog services', undefined, 'main');
        const schemaService = new SchemaService(context);

        try {
            await schemaService.ensureInitialized();
            logger.info('Schema service initialized successfully');
        } catch (error) {
            // Log the error but continue without schema
            logger.warn('Failed to initialize schema service, continuing without schema validation', {
                error: error instanceof Error ? error.message : String(error)
            });
            // No need to show error to user here, the ValidationUIService will handle that
        }

        const catalogService = new CatalogService(context);
        const catalogInitPromise = catalogService.initialize();

        logger.debug('Initializing PreReleaseWebview', undefined, 'main');
        const preReleaseService = PreReleaseService.getInstance(context);
        const preReleaseWebview = PreReleaseWebview.initialize(context, logger, preReleaseService);

        try {
            logger.debug('Registering PreReleaseWebview provider', undefined, 'main');
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider('ibmCatalogPreRelease', preReleaseWebview, {
                    webviewOptions: {
                        retainContextWhenHidden: true
                    }
                })
            );
        } catch (error) {
            logger.error('Failed to register PreReleaseWebview provider', { error }, 'main');
        }

        logger.debug('Creating tree provider', undefined, 'main');
        const treeProvider = new CatalogTreeProvider(catalogService, context, schemaService);
        const treeView = vscode.window.createTreeView('ibmCatalogTree', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });

        logger.debug('Connecting tree provider to FileSystemService', undefined, 'main');
        const fileSystemService = FileSystemService.getInstance(context, schemaService);
        fileSystemService.setTreeProvider(treeProvider);

        logger.debug('Waiting for critical services to initialize', undefined, 'main');
        const [catalogInitialized] = await Promise.all([
            catalogInitPromise
        ]);

        if (!catalogInitialized) {
            logger.warn('CatalogService initialization incomplete', undefined, 'main');
        }

        logger.debug('Initializing remaining features', undefined, 'main');
        await initializeRemainingFeatures(context, catalogService, treeProvider, treeView, statusBarItem);

        logger.info('IBM Catalog Extension activated successfully', undefined, 'main');
        statusBarItem.text = '$(check) IBM Catalog Extension Ready';
        await updateStatusBar(statusBarItem, context);

        // Reset log level to INFO after activation
        logger.setLogLevel(LogLevel.INFO);

        // Initialize validation UI service
        logger.debug('Initializing validation UI service', undefined, 'main');
        const validationUIService = ValidationUIService.getInstance();
        context.subscriptions.push(validationUIService);

        // Register document validation event handlers
        logger.debug('Registering document validation event handlers', undefined, 'main');
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(async (document) => {
                if (document.languageId === 'json' || document.languageId === 'jsonc') {
                    await validationUIService.validateDocument(document);
                }
            }),
            vscode.workspace.onDidChangeTextDocument(async (event) => {
                if (event.document.languageId === 'json' || event.document.languageId === 'jsonc') {
                    await validationUIService.validateDocument(event.document);
                }
            }),
            vscode.workspace.onDidSaveTextDocument(async (document) => {
                if (document.languageId === 'json' || document.languageId === 'jsonc') {
                    await validationUIService.validateDocument(document);
                }
            })
        );

        // Validate any already open JSON documents
        logger.debug('Validating open JSON documents', undefined, 'main');
        vscode.workspace.textDocuments.forEach(async (document) => {
            if (document.languageId === 'json' || document.languageId === 'jsonc') {
                await validationUIService.validateDocument(document);
            }
        });

        // Show validation error patterns for creating ignore rules
        const showValidationPatternsSummaryCommand = vscode.commands.registerCommand(
            'catalog-json-editor.showValidationPatterns',
            async () => {
                try {
                    // Get the active text editor
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showErrorMessage('No active editor found. Please open a file first.');
                        return;
                    }

                    const document = editor.document;
                    if (!document || document.languageId !== 'json') {
                        vscode.window.showErrorMessage('Please open a JSON file to validate.');
                        return;
                    }

                    // Get schema service
                    const schemaService = SchemaService.getInstance();
                    if (!schemaService) {
                        vscode.window.showErrorMessage('Schema service not available.');
                        return;
                    }

                    // Validate document
                    const schema = await schemaService.getSchema();
                    if (schema === null) {
                        vscode.window.showWarningMessage('Schema is not available. Running validation without schema.');
                        // Continue with validation without schema
                        const errors = await schemaService.validateDocument(document, null);

                        if (errors.length === 0) {
                            vscode.window.showInformationMessage('No validation errors found with non-schema rules.');
                            return;
                        }

                        // Generate error summary even without schema
                        const summary = schemaService.generateErrorSummary(errors);
                        showValidationSummary(summary);
                        return;
                    }

                    const errors = await schemaService.validateDocument(document, schema);

                    if (errors.length === 0) {
                        vscode.window.showInformationMessage('No validation errors found.');
                        return;
                    }

                    // Generate error summary
                    const summary = schemaService.generateErrorSummary(errors);
                    showValidationSummary(summary);

                    // Function to display the validation summary
                    function showValidationSummary(summary: any) {
                        // Create output channel for display
                        const channel = vscode.window.createOutputChannel('IBM Catalog Validation Patterns');
                        channel.clear();
                        channel.appendLine(`# Validation Pattern Summary`);
                        channel.appendLine(`Total errors: ${summary.totalErrors}`);
                        channel.appendLine(``);

                        channel.appendLine(`## Error Groups`);
                        summary.errorGroups.forEach((group: any, index: number) => {
                            channel.appendLine(`### Group ${index + 1}: ${group.pattern} (${group.count} occurrences)`);

                            channel.appendLine(`Example paths:`);
                            group.paths.forEach((path: string) => {
                                channel.appendLine(`  - ${path}`);
                            });
                            if (group.hasMorePaths) {
                                channel.appendLine(`  - (and more...)`);
                            }

                            channel.appendLine(`\nSuggested ignore pattern:`);
                            channel.appendLine(`{`);
                            channel.appendLine(`  messagePattern: /${group.suggestedIgnorePattern.messagePattern}/,`);
                            if (group.suggestedIgnorePattern.pathPattern) {
                                channel.appendLine(`  pathPattern: /${group.suggestedIgnorePattern.pathPattern}/,`);
                            }
                            channel.appendLine(`  description: "Auto-generated ignore pattern for ${group.pattern}"`);
                            channel.appendLine(`}`);
                            channel.appendLine(``);
                        });

                        channel.appendLine(`## How to Use These Patterns`);
                        channel.appendLine(`To ignore specific validation errors, add the suggested patterns to the SchemaValidationIgnoreService.`);
                        channel.appendLine(`See the existing patterns in src/services/validation/SchemaValidationIgnoreService.ts for examples.`);

                        channel.show();
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Error generating validation pattern summary: ${errorMessage}`);
                    console.error('Error in showValidationPatterns command:', error);
                }
            }
        );

        context.subscriptions.push(showValidationPatternsSummaryCommand);

        // Expose services for other extensions to use
        return {
            getCatalogService: () => catalogService,
            getSchemaService: () => schemaService,
            getValidationUIService: () => ValidationUIService.getInstance(),
            getPreReleaseService: () => preReleaseService
        };
    } catch (error) {
        logger.error('Failed to activate extension', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        }, 'main');
        void vscode.window.showErrorMessage(`Failed to activate extension: ${error instanceof Error ? error.message : String(error)}`);
        throw error; // Re-throw to show error to user and prevent extension from activating partially
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
                const catalogService = new CatalogService(context);
                await catalogService.initialize();
                await catalogService.addElement(node);
                await vscode.commands.executeCommand('setContext', 'ibmCatalog.refresh', Date.now());
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                LoggingService.getInstance().error('Failed to add element', { error }, 'main');
                vscode.window.showErrorMessage(`Failed to add element: ${message}`);
            }
        }),
        // Register schema validation ignore pattern commands
        vscode.commands.registerCommand('ibmCatalog.addSchemaValidationIgnorePattern', async () => {
            const logger = LoggingService.getInstance();
            logger.debug('Adding schema validation ignore pattern');

            try {
                const ignoreService = SchemaValidationIgnoreService.getInstance();

                // Prompt for pattern
                const pattern = await vscode.window.showInputBox({
                    prompt: 'Enter a regular expression pattern to ignore schema validation errors',
                    placeHolder: 'e.g. .*install_type.*'
                });

                if (!pattern) {
                    return;
                }

                // Add the pattern
                try {
                    ignoreService.addIgnorePattern({
                        messagePattern: new RegExp(pattern),
                        description: 'User-added ignore pattern'
                    });
                    vscode.window.showInformationMessage(`Added schema validation ignore pattern: ${pattern}`);

                    // Trigger revalidation of open documents
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor) {
                        const document = activeEditor.document;
                        if (document.languageId === 'json' || document.languageId === 'jsonc') {
                            // Trigger revalidation by making a small edit and undoing it
                            const edit = new vscode.WorkspaceEdit();
                            edit.insert(document.uri, new vscode.Position(0, 0), ' ');
                            await vscode.workspace.applyEdit(edit);
                            await vscode.commands.executeCommand('undo');
                        }
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Invalid regular expression: ${pattern}`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                logger.error('Failed to add schema validation ignore pattern', { error }, 'main');
                vscode.window.showErrorMessage(`Failed to add schema validation ignore pattern: ${message}`);
            }
        }),
        // Register view schema validation ignore patterns command
        vscode.commands.registerCommand('ibmCatalog.viewSchemaIgnorePatterns', async () => {
            const logger = LoggingService.getInstance();
            logger.debug('Viewing schema validation ignore patterns');

            try {
                const ignoreService = SchemaValidationIgnoreService.getInstance();

                // Get the patterns from the service
                // We need to access the private field, so we'll use a workaround
                const patterns = (ignoreService as any).ignorePatterns || [];

                if (patterns.length === 0) {
                    vscode.window.showInformationMessage('No schema validation ignore patterns defined');
                    return;
                }

                // Define a type for our QuickPick items
                interface PatternQuickPickItem extends vscode.QuickPickItem {
                    patternObj: RegExp;
                }

                // Create a quick pick for each pattern
                const items: PatternQuickPickItem[] = patterns.map((pattern: RegExp, index: number) => ({
                    label: `${index + 1}. ${pattern.toString()}`,
                    description: '',
                    patternObj: pattern
                }));

                // Show the patterns in a quick pick
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a pattern to remove',
                    title: 'Schema Validation Ignore Patterns'
                });

                if (selected) {
                    // Ask if the user wants to remove the pattern
                    const remove = await vscode.window.showQuickPick(['Yes', 'No'], {
                        placeHolder: 'Remove this pattern?',
                        title: `Remove pattern: ${selected.patternObj.toString()}`
                    });

                    if (remove === 'Yes') {
                        // Remove the pattern
                        const newPatterns = patterns.filter((p: RegExp) => p !== selected.patternObj);
                        ignoreService.setIgnorePatterns(newPatterns);

                        vscode.window.showInformationMessage(`Removed schema validation ignore pattern: ${selected.patternObj.toString()}`);

                        // Trigger revalidation of open documents
                        const activeEditor = vscode.window.activeTextEditor;
                        if (activeEditor) {
                            const document = activeEditor.document;
                            if (document.languageId === 'json' || document.languageId === 'jsonc') {
                                // Trigger revalidation by making a small edit and undoing it
                                const edit = new vscode.WorkspaceEdit();
                                edit.insert(document.uri, new vscode.Position(0, 0), ' ');
                                await vscode.workspace.applyEdit(edit);
                                await vscode.commands.executeCommand('undo');
                            }
                        }
                    }
                }
            } catch (error: unknown) {
                logger.error('Error viewing schema validation ignore patterns', error instanceof Error ? error : new Error(String(error)));
                vscode.window.showErrorMessage(`Error viewing schema validation ignore patterns: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        // New command to view ignored validation errors
        vscode.commands.registerCommand('ibmCatalog.viewIgnoredValidationErrors', async () => {
            const logger = LoggingService.getInstance();
            logger.debug('Viewing ignored validation errors');

            try {
                const ignoreService = SchemaValidationIgnoreService.getInstance();
                const ignoredErrors = ignoreService.getIgnoredErrorsSummary();

                if (ignoredErrors.size === 0) {
                    vscode.window.showInformationMessage('No validation errors have been ignored yet.');
                    return;
                }

                // Convert the map to an array of items for the quick pick
                const items = Array.from(ignoredErrors.entries()).map(([message, count]) => ({
                    label: `(${count}) ${message.length > 80 ? message.substring(0, 80) + '...' : message}`,
                    description: '',
                    detail: message.length > 80 ? message : undefined,
                    count
                }));

                // Sort by count (descending)
                items.sort((a, b) => b.count - a.count);

                // Show the ignored errors in a quick pick
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select an error to see details',
                    title: 'Ignored Validation Errors'
                });

                if (selected) {
                    // Show the full error message
                    const fullMessage = selected.detail || selected.label;

                    // Create a temporary output channel to show the full error
                    const channel = vscode.window.createOutputChannel('IBM Catalog - Ignored Validation Errors');
                    channel.appendLine(`Error message: ${fullMessage}`);
                    channel.appendLine(`Occurrences: ${selected.count}`);
                    channel.appendLine('\nThis error is currently being ignored by the validation system.');
                    channel.appendLine('To stop ignoring this error, remove the corresponding ignore pattern.');
                    channel.show();
                }
            } catch (error: unknown) {
                logger.error('Error viewing ignored validation errors', error instanceof Error ? error : new Error(String(error)));
                vscode.window.showErrorMessage(`Error viewing ignored validation errors: ${error instanceof Error ? error.message : String(error)}`);
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
    const schemaService = new SchemaService(context);

    try {
        await schemaService.ensureInitialized();
        logger.info('Schema service initialized successfully');
    } catch (error) {
        // Log the error but continue without schema
        logger.warn('Failed to initialize schema service, continuing without schema validation', {
            error: error instanceof Error ? error.message : String(error)
        });
        // No need to show error to user here, the ValidationUIService will handle that
    }

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

    // Track tree view selection using a type-safe state object
    interface ClickState {
        lastClickTime: number | null;
        lastClickedItemId: string | null;
        clickTimeout: NodeJS.Timeout | null;
        clearClickState: () => void;
    }

    const clickState: ClickState = {
        lastClickTime: null,
        lastClickedItemId: null,
        clickTimeout: null,
        clearClickState: function () {
            logger.debug('Clearing click state', {
                hadTimer: this.clickTimeout !== null,
                lastClickedItemId: this.lastClickedItemId
            }, 'main');
            if (this.clickTimeout !== null) {
                clearTimeout(this.clickTimeout);
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
            }, 'main');
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
        }, 'main');

        if (clickState.lastClickTime && clickState.lastClickedItemId === clickedItemId &&
            now - clickState.lastClickTime < DOUBLE_CLICK_THRESHOLD) {
            logger.debug('Double click detected', {
                itemId: clickedItemId,
                timeBetweenClicks: now - clickState.lastClickTime
            }, 'main');
            clickState.clearClickState();
            if (item.isEditable()) {
                void vscode.commands.executeCommand('ibmCatalog.editElement', item);
            } else {
                logger.debug('Single click detected, setting up timer', {
                    itemId: clickedItemId,
                    threshold: DOUBLE_CLICK_THRESHOLD
                }, 'main');
                clickState.clearClickState();
                // Create a new timer but don't store it in context
                clickState.clickTimeout = setTimeout(() => {
                    logger.debug('Single click timer expired, executing command', {
                        itemId: clickedItemId
                    }, 'main');
                    void vscode.commands.executeCommand('ibmCatalog.selectElement', item);
                    clickState.clickTimeout = null;
                }, DOUBLE_CLICK_THRESHOLD);
                clickState.lastClickTime = now;
                clickState.lastClickedItemId = clickedItemId;
            }
        } else {
            logger.debug('Single click detected, setting up timer', {
                itemId: clickedItemId,
                threshold: DOUBLE_CLICK_THRESHOLD
            }, 'main');
            clickState.clearClickState();
            // Create a new timer but don't store it in context
            clickState.clickTimeout = setTimeout(() => {
                logger.debug('Single click timer expired, executing command', {
                    itemId: clickedItemId
                }, 'main');
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
                logger.debug('Keyboard edit triggered', { itemPath: item.jsonPath }, 'main');
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
        vscode.commands.registerCommand('ibmCatalog.setLogLevel', async () => {
            const logger = LoggingService.getInstance();
            const currentLevel = logger.getLogLevel();
            const currentChannel = logger.getCurrentChannel();

            // Define available log levels with visual indicators
            const levels = [
                {
                    label: `Debug${currentLevel === LogLevel.DEBUG ? ' ✓' : ''}`,
                    description: 'All messages including detailed debugging information',
                    level: LogLevel.DEBUG,
                    detail: 'Includes all log messages'
                },
                {
                    label: `Info${currentLevel === LogLevel.INFO ? ' ✓' : ''}`,
                    description: 'Normal operation messages',
                    level: LogLevel.INFO,
                    detail: 'Standard operational logging'
                },
                {
                    label: `Warning${currentLevel === LogLevel.WARN ? ' ✓' : ''}`,
                    description: 'Warning messages that don\'t affect operation',
                    level: LogLevel.WARN,
                    detail: 'Potential issues and warnings'
                },
                {
                    label: `Error${currentLevel === LogLevel.ERROR ? ' ✓' : ''}`,
                    description: 'Error messages only',
                    level: LogLevel.ERROR,
                    detail: 'Critical errors and failures'
                }
            ];

            // Define available channels with visual indicators
            const channels = [
                {
                    label: `IBM Catalog${currentChannel === 'main' ? ' ✓' : ''}`,
                    description: 'Main extension logs',
                    value: 'main',
                    detail: 'General extension operations and catalog management'
                },
                {
                    label: `IBM Catalog Pre-release${currentChannel === 'preRelease' ? ' ✓' : ''}`,
                    description: 'Pre-release specific logs',
                    value: 'preRelease',
                    detail: 'Version management and release operations'
                },
                {
                    label: `IBM Catalog Schema Validation${currentChannel === 'schemaValidation' ? ' ✓' : ''}`,
                    description: 'Schema validation logs',
                    value: 'schemaValidation',
                    detail: 'JSON schema validation operations and results'
                }
            ];

            // Create QuickPick for log levels
            const levelQuickPick = vscode.window.createQuickPick();
            levelQuickPick.title = `Set Log Level (Current: ${LogLevel[currentLevel]})`;
            levelQuickPick.placeholder = 'Select log level';
            levelQuickPick.items = levels;
            levelQuickPick.activeItems = [levels.find(l => l.level === currentLevel)!];

            let selectedLevel: typeof levels[0] | undefined;
            let selectedChannel: typeof channels[0] | undefined;

            return new Promise<void>((resolve) => {
                levelQuickPick.onDidAccept(async () => {
                    selectedLevel = levelQuickPick.selectedItems[0] as typeof levels[0];
                    levelQuickPick.hide();

                    if (selectedLevel) {
                        // Set the new log level
                        logger.setLogLevel(selectedLevel.level);

                        // Show confirmation with the new level
                        void vscode.window.showInformationMessage(
                            `Log level set to: ${selectedLevel.label.replace(' ✓', '')}`
                        );

                        // Log test messages at different levels
                        logger.debug('Debug level test message', {
                            previousLevel: LogLevel[currentLevel],
                            newLevel: LogLevel[selectedLevel.level]
                        }, currentChannel);
                        logger.info('Info level test message', {
                            logLevel: selectedLevel.label
                        }, currentChannel);
                        logger.warn('Warning level test message', {
                            logLevel: selectedLevel.label
                        }, currentChannel);
                        logger.error('Error level test message', {
                            logLevel: selectedLevel.label
                        }, currentChannel);

                        // Create QuickPick for channels
                        const channelQuickPick = vscode.window.createQuickPick();
                        channelQuickPick.title = 'Select Log Channel to Show';
                        channelQuickPick.placeholder = 'Choose which log channel to display';
                        channelQuickPick.items = channels;
                        channelQuickPick.activeItems = [channels.find(c => c.value === currentChannel)!];

                        channelQuickPick.onDidAccept(() => {
                            selectedChannel = channelQuickPick.selectedItems[0] as typeof channels[0];
                            channelQuickPick.hide();

                            if (selectedChannel) {
                                // Show the selected channel
                                logger.show(selectedChannel.value as 'main' | 'preRelease');

                                // Log channel switch
                                logger.info('Switched log channel', {
                                    channel: selectedChannel.value,
                                    logLevel: LogLevel[selectedLevel!.level]
                                }, selectedChannel.value as 'main' | 'preRelease');
                            }
                            resolve();
                        });

                        channelQuickPick.onDidHide(() => {
                            channelQuickPick.dispose();
                            if (!selectedChannel) {
                                resolve();
                            }
                        });

                        channelQuickPick.show();
                    }
                });

                levelQuickPick.onDidHide(() => {
                    levelQuickPick.dispose();
                    if (!selectedLevel) {
                        resolve();
                    }
                });

                levelQuickPick.show();
            });
        }),
        vscode.commands.registerCommand('ibmCatalog.deleteElement', async (node: CatalogTreeItem) => {
            try {
                await catalogService.deleteElement(node);
                treeProvider.refresh();
                void vscode.window.showInformationMessage('Element deleted successfully');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                logger.error('Failed to delete element', { error }, 'main');
                void vscode.window.showErrorMessage(`Failed to delete element: ${message}`);
            }
        }),
        vscode.commands.registerCommand('ibmCatalog.treeItemClicked', handleTreeItemClick),
        ...(fileWatcher ? [fileWatcher] : [])
    );
}

export function deactivate(): void {
    LoggingService.getInstance().info('Deactivating IBM Catalog Extension');
}
