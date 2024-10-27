import * as vscode from 'vscode';
import { CatalogEditorViewProvider } from './viewProviders/catalogEditorViewProvider';
import { WorkspaceRequiredError } from './utils/errors';
import { ApiService } from './services/apiService';
import { OutputManager,Components, LogLevel } from './utils/outputManager';


export function activate(context: vscode.ExtensionContext) {
    console.log('Activating IBM Catalog JSON Editor Extension...');

    // Check if workspace is available
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showInformationMessage(
            'IBM Catalog JSON Editor requires a workspace. Please open a folder or workspace.',
            'Open Folder'
        ).then(selection => {
            if (selection === 'Open Folder') {
                vscode.commands.executeCommand('vscode.openFolder');
            }
        });
        return;
    }

    let disposables: vscode.Disposable[] = [];

    try {
        // Initialize core services
        const outputManager = new OutputManager();
        outputManager.log(Components.API_SERVICE, 'Initializing ApiService...');
        
        const apiService = new ApiService(
            context.secrets,
            context.globalState,
            outputManager
        );

        // Initialize API Service and check authentication state
        const initializeServices = async () => {
            try {
                outputManager.log(Components.API_SERVICE, 'Checking authentication state...');
                const isAuthenticated = await apiService.isAuthenticated();
                outputManager.log(Components.API_SERVICE, `Authentication state: ${isAuthenticated ? 'authenticated' : 'not authenticated'}`);
                
                // Register the webview view provider
                const provider = new CatalogEditorViewProvider(
                    context.extensionUri,
                    apiService,
                    outputManager,
                    context
                );
                
                // Register the provider
                disposables.push(
                    vscode.window.registerWebviewViewProvider(
                        CatalogEditorViewProvider.viewType,
                        provider
                    )
                );

                // Ensure status bar matches authentication state
                await provider.refreshView();
                
                outputManager.log(Components.API_SERVICE, 'Service initialization complete');
            } catch (error) {
                outputManager.log(Components.API_SERVICE, `Error during service initialization: ${error}`, LogLevel.ERROR);
                throw error;
            }
        };

        // Initialize services
        initializeServices().catch(error => {
            console.error('Error during extension activation:', error);
            vscode.window.showErrorMessage(`Failed to initialize: ${error.message}`);
        });

        // Register Login Command
        disposables.push(
            vscode.commands.registerCommand('catalogEditor.login', async () => {
                try {
                    const apiKey = await vscode.window.showInputBox({
                        prompt: 'Enter your IBM Cloud API Key',
                        placeHolder: 'API Key',
                        ignoreFocusOut: true,
                        password: true,
                        validateInput: (value) => {
                            return value && value.length > 0 ? null : 'API Key is required';
                        }
                    });

                    if (apiKey) {
                        outputManager.log(Components.API_SERVICE, 'Processing login...');
                        await apiService.login(apiKey);
                        const provider = await vscode.commands.executeCommand('catalogEditor.getProvider');
                        if (provider) {
                            await (provider as CatalogEditorViewProvider).refreshView();
                        }
                        vscode.window.showInformationMessage('Successfully logged in to IBM Cloud.');
                        outputManager.log(Components.API_SERVICE, 'Login successful');
                    }
                } catch (error) {
                    outputManager.log(Components.API_SERVICE, `Login failed: ${error}`, LogLevel.ERROR);
                    vscode.window.showErrorMessage(
                        error instanceof Error ? error.message : 'Failed to login. Please try again.'
                    );
                }
            })
        );

        // Register Logout Command
        disposables.push(
            vscode.commands.registerCommand('catalogEditor.logout', async () => {
                try {
                    outputManager.log(Components.API_SERVICE, 'Processing logout...');
                    await apiService.logout();
                    const provider = await vscode.commands.executeCommand('catalogEditor.getProvider');
                    if (provider) {
                        await (provider as CatalogEditorViewProvider).refreshView();
                    }
                    vscode.window.showInformationMessage('Successfully logged out from IBM Cloud.');
                    outputManager.log(Components.API_SERVICE, 'Logout successful');
                } catch (error) {
                    outputManager.log(Components.API_SERVICE, `Logout failed: ${error}`, LogLevel.ERROR);
                    vscode.window.showErrorMessage(
                        error instanceof Error ? error.message : 'Failed to logout. Please try again.'
                    );
                }
            })
        );

        // Add all disposables to the extension's subscriptions
        context.subscriptions.push(...disposables);

        outputManager.log(Components.API_SERVICE, 'Extension activation complete');
    } catch (error) {
        console.error('Error during extension activation:', error);
        // Clean up any registered disposables in case of error
        disposables.forEach(d => d.dispose());
        throw error;
    }
}

export function deactivate() {
    console.log('IBM Catalog JSON Editor Extension is deactivating...');
}