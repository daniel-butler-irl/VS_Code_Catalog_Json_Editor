import * as vscode from 'vscode';
import { CatalogTreeProvider } from './providers/CatalogTreeProvider';
import { CatalogFileSystemWatcher } from './services/CatalogFileSystemWatcher';
import { CatalogService } from './services/CatalogService';
import { EditorHighlightService } from './services/EditorHighlightService';
import { SchemaService } from './services/SchemaService';
import { CatalogTreeItem } from './models/CatalogTreeItem';
import { AuthService } from './services/AuthService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Create and initialize services
    // Initialize SchemaService
     const schemaService = new SchemaService();
    await schemaService.initialize();
    // Initialize CatalogService
    const catalogService = new CatalogService(context);
    const treeProvider = new CatalogTreeProvider(catalogService, context, schemaService);
    const fileWatcher = new CatalogFileSystemWatcher(catalogService, treeProvider);
    const highlightService = new EditorHighlightService();

    try {
         // Create status bar item
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
             vscode.commands.registerCommand('ibmCatalog.editElement', async (node) => {
        await catalogService.editElement(node);
        // Re-highlight the element after editing
        // Add a small delay to ensure symbol provider updates
        setTimeout(async () => {
            await highlightService.highlightJsonPath(node.jsonPath);
        }, 100); // Delay in milliseconds
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

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to activate IBM Catalog Editor: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

export function deactivate(): void {
    // Clean up will be handled by the disposables in context.subscriptions
}