import * as vscode from 'vscode';
import { CatalogEditorViewProvider } from './viewProviders/catalogEditorViewProvider';
import { WorkspaceRequiredError } from './utils/errors';

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
        // Register the webview view provider
        const provider = new CatalogEditorViewProvider(
            context.extensionUri,
            context.secrets,
            context.globalState
        );
        
        disposables.push(
            vscode.window.registerWebviewViewProvider(
                CatalogEditorViewProvider.viewType,
                provider
            )
        );

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
                        await context.secrets.store('catalogEditor.apiKey', apiKey);
                        await provider.initializeApiService();
                        // MessageHandler will handle showing success message and updating status
                        if (provider.currentView) {
                            await provider.currentView.webview.postMessage({
                                type: 'login',
                                apiKey: apiKey
                            });
                        }
                    }
                } catch (error) {
                    console.error('Error during login:', error);
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
                    await context.secrets.delete('catalogEditor.apiKey');
                    // MessageHandler will handle the cache clearing and status updates
                    if (provider.currentView) {
                        await provider.currentView.webview.postMessage({
                            type: 'logout'
                        });
                    }
                } catch (error) {
                    console.error('Error during logout:', error);
                    vscode.window.showErrorMessage(
                        error instanceof Error ? error.message : 'Failed to logout. Please try again.'
                    );
                }
            })
        );

        // Initialize Status Bar
        provider.initializeStatusBar();

        // Listen to workspace folder changes
        disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                    vscode.window.showInformationMessage(
                        'IBM Catalog JSON Editor requires a workspace. Please open a folder or workspace.',
                        'Open Folder'
                    ).then(selection => {
                        if (selection === 'Open Folder') {
                            vscode.commands.executeCommand('vscode.openFolder');
                        }
                    });
                }
            })
        );

        // Listen to changes in the active editor
        disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                // Only update if this is a real text editor (not output/debug console)
                if (editor && editor.document && editor.document.uri.scheme === 'file') {
                    provider.updateWebviewContent(editor.document.fileName).catch(error => {
                        if (!(error instanceof WorkspaceRequiredError)) {
                            vscode.window.showErrorMessage(`Error updating webview: ${error.message}`);
                        }
                    });
                }
            })
        );

        // Listen to file save events
        disposables.push(
            vscode.workspace.onDidSaveTextDocument((document) => {
                if (document.fileName.endsWith('ibm_catalog.json')) {
                    console.log(`Detected save on "ibm_catalog.json". Updating webview...`);
                    provider.updateWebviewContent(document.fileName).catch(error => {
                        if (!(error instanceof WorkspaceRequiredError)) {
                            vscode.window.showErrorMessage(`Error updating JSON data: ${error.message}`);
                        }
                    });
                }
            })
        );

        // Add all disposables to the extension's subscriptions
        context.subscriptions.push(...disposables);

        console.log('IBM Catalog JSON Editor Extension is active.');
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