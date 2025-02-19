// src/services/CatalogFileSystemWatcher.ts

import * as vscode from 'vscode';
import { CatalogService } from './CatalogService';
import { CatalogTreeProvider } from '../providers/CatalogTreeProvider';

/**
 * Watches for changes to the ibm_catalog.json file and updates the tree view accordingly
 * Implements VS Code's Disposable interface for proper cleanup
 */
export class CatalogFileSystemWatcher implements vscode.Disposable {
    private readonly fileWatcher: vscode.FileSystemWatcher;
    private readonly singleFileWatcher: vscode.FileSystemWatcher | null = null;
    private debounceTimer: NodeJS.Timeout | null = null;
    private readonly debounceDelay = 300; // milliseconds
    private isDisposed = false;
    private readonly isSingleFileMode: boolean;

    constructor(
        private readonly catalogService: CatalogService,
        private readonly treeProvider: CatalogTreeProvider,
        singleFilePath?: string
    ) {
        this.isSingleFileMode = !!singleFilePath;

        if (this.isSingleFileMode && singleFilePath) {
            // Create a file watcher for a specific ibm_catalog.json file
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(singleFilePath), '*'),
                false, // Don't ignore creates
                false, // Don't ignore changes
                false  // Don't ignore deletes
            );
        } else {
            // Create a file system watcher for ibm_catalog.json in the workspace root
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                throw new Error('No workspace root found');
            }
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(workspaceRoot, 'ibm_catalog.json'),
                false, // Don't ignore creates
                false, // Don't ignore changes
                false  // Don't ignore deletes
            );
        }

        this.initializeWatcher();
    }

    /**
     * Initializes the file watcher event handlers
     */
    private initializeWatcher(): void {
        // Handle file changes
        this.fileWatcher.onDidChange(
            this.debounceFileChange.bind(this),
            this,
            []
        );

        // Handle file creation
        this.fileWatcher.onDidCreate(
            this.debounceFileChange.bind(this),
            this,
            []
        );

        // Handle file deletion
        this.fileWatcher.onDidDelete(
            this.handleFileDelete.bind(this),
            this,
            []
        );
    }

    /**
     * Debounces file change events to prevent multiple rapid updates
     * @param uri The URI of the changed file
     */
    private debounceFileChange(uri: vscode.Uri): void {
        if (this.isDisposed) {
            return;
        }

        // Clear any existing timer
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }

        // Set new timer
        this.debounceTimer = setTimeout(() => {
            this.handleFileChange(uri).catch(error => {
                vscode.window.showErrorMessage(
                    `Error handling file change: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            });
        }, this.debounceDelay);
    }

    /**
     * Handles file change events
     * @param uri The URI of the changed file
     */
    private async handleFileChange(uri: vscode.Uri): Promise<void> {
        if (this.isDisposed) {
            return;
        }

        // In single file mode, only process changes to the target file
        if (this.isSingleFileMode && !this.isCatalogFile(uri)) {
            return;
        }

        try {
            // Reload the catalog data
            await this.catalogService.reloadCatalogData();

            // Show success message only for manual saves
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && activeEditor.document.uri.fsPath === uri.fsPath) {
                vscode.window.setStatusBarMessage('IBM Catalog file updated', 3000);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to update catalog view: ${message}`);
        }
    }

    /**
     * Handles file deletion events
     * @param uri The URI of the deleted file
     */
    private handleFileDelete(uri: vscode.Uri): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(async () => {
            this.debounceTimer = null;
            await this.catalogService.handleFileDeletion(uri);
            this.treeProvider.refresh();
            // Update the context variable
            vscode.commands.executeCommand('setContext', 'ibmCatalog.catalogFileExists', false);
        }, this.debounceDelay);
    }

    /**
     * Checks if a URI matches our target file pattern
     * @param uri The URI to check
     * @returns True if the URI matches our pattern
     */
    private isCatalogFile(uri: vscode.Uri): boolean {
        return uri.fsPath.endsWith('ibm_catalog.json');
    }

    /**
     * Disposes of the file watcher and cleans up resources
     */
    public dispose(): void {
        this.isDisposed = true;

        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        this.fileWatcher.dispose();
    }
}