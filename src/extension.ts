import * as vscode from 'vscode';
import { CatalogTreeProvider } from './providers/CatalogTreeProvider';
import { CatalogFileSystemWatcher } from './services/CatalogFileSystemWatcher';
import { CatalogService } from './services/CatalogService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Create status bar item
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarItem.text = "$(search) Looking for IBM Catalog files...";
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        // Initialize core services
        const catalogService = new CatalogService(context);
        
        // Initialize tree view provider
        const treeProvider = new CatalogTreeProvider(catalogService);
        const treeView = vscode.window.createTreeView('ibmCatalogTree', {
            treeDataProvider: treeProvider,
            showCollapseAll: true,
            canSelectMany: false
        });

        // Initialize file system watcher
        const fileWatcher = new CatalogFileSystemWatcher(catalogService, treeProvider);

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('ibmCatalog.refresh', () => {
                treeProvider.refresh();
            }),

            vscode.commands.registerCommand('ibmCatalog.addElement', async (node) => {
                await catalogService.addElement(node);
                treeProvider.refresh();
            }),

            vscode.commands.registerCommand('ibmCatalog.editElement', async (node) => {
                await catalogService.editElement(node);
                treeProvider.refresh();
            }),

            // Clean up resources
            treeView,
            fileWatcher
        );

		context.subscriptions.push(
    vscode.commands.registerCommand('ibmCatalog.locateCatalogFile', async () => {
        const files = await vscode.workspace.findFiles('**/ibm_catalog.json', '**/node_modules/**');
        if (files.length > 0) {
            await catalogService.initialize();
            treeProvider.refresh();
            vscode.window.showInformationMessage('IBM Catalog file found and loaded');
        } else {
            vscode.window.showInformationMessage('No ibm_catalog.json file found in workspace');
        }
    })
);
        // Load initial catalog data
        await catalogService.initialize();
        
        // Update status bar
        const catalogFile = await catalogService.getCatalogData();
        if (catalogFile) {
            statusBarItem.text = "$(file-code) IBM Catalog file found";
            treeProvider.refresh();
        } else {
            statusBarItem.text = "$(warning) No IBM Catalog file found";
        }

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to activate IBM Catalog Editor: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

export function deactivate(): void {
    // Clean up will be handled by the disposables in context.subscriptions
}