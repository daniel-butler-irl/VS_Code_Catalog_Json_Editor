// src/services/core/FileSystemService.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { LoggingService } from './LoggingService';
import type { ICatalogFileInfo } from '../../types/catalog';
import type { CatalogTreeProvider } from '../../providers/CatalogTreeProvider';
import type { CatalogTreeItem } from '../../models/CatalogTreeItem';

export class FileSystemService {
    private static instance: FileSystemService;
    private readonly logger = LoggingService.getInstance();
    private readonly catalogFileName = 'ibm_catalog.json';

    private readonly _onDidChangeContent = new vscode.EventEmitter<void>();
    public readonly onDidChangeContent = this._onDidChangeContent.event;

    private currentCatalogFile?: ICatalogFileInfo;
    private catalogData: unknown = {};
    private initialized = false;
    private lastSelectedPath?: string;
    private treeView?: vscode.TreeView<CatalogTreeItem>;
    private treeDataProvider?: CatalogTreeProvider;

    private constructor(private readonly context: vscode.ExtensionContext) {
        this.logger.debug('Initializing FileSystemService');
        // Listen for active editor changes
        vscode.window.onDidChangeActiveTextEditor(() => {
            void this.checkAndUpdateRoot();
        });

        this.logger.debug('FileSystemService initialized');
    }

    public static getInstance(context: vscode.ExtensionContext): FileSystemService {
        if (!FileSystemService.instance) {
            FileSystemService.instance = new FileSystemService(context);
        }
        return FileSystemService.instance;
    }

    public setTreeProvider(provider: CatalogTreeProvider): void {
        this.treeDataProvider = provider;
        this.treeView = vscode.window.createTreeView<CatalogTreeItem>('ibmCatalogTree', {
            treeDataProvider: provider
        });

        // Track tree view selection changes
        this.treeView.onDidChangeSelection(e => {
            if (e.selection[0]) {
                this.lastSelectedPath = e.selection[0].jsonPath;
            }
        });
    }

    /**
     * Gets the current catalog file info
     */
    public getCurrentCatalogFile(): ICatalogFileInfo | undefined {
        return this.currentCatalogFile;
    }

    /**
     * Gets the display path for the current catalog file
     */
    public getCatalogDisplayPath(): string {
        if (!this.currentCatalogFile) {
            return 'No catalog file selected';
        }
        return this.currentCatalogFile.displayPath;
    }

    /**
     * Gets the current catalog data
     */
    public getCatalogData(): unknown {
        return this.catalogData;
    }

    /**
     * Checks if the service is initialized
     */
    public isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Initializes the service by finding and loading the catalog file
     */
    public async initialize(): Promise<boolean> {
        if (this.initialized) {
            return true;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            this.logger.debug('No workspace folders found');
            return false;
        }

        for (const folder of workspaceFolders) {
            const catalogFileUri = vscode.Uri.joinPath(folder.uri, this.catalogFileName);
            try {
                await vscode.workspace.fs.stat(catalogFileUri);
                await this.setCatalogFile(catalogFileUri, folder);
                this.logger.debug(`Catalog file found at ${catalogFileUri.fsPath}`);
                return true;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                this.logger.debug(`No ${this.catalogFileName} found in ${folder.name}: ${errorMessage}`);
                continue;
            }
        }

        this.logger.debug('No catalog file found in any workspace folder');
        return false;
    }

    /**
     * Reloads the catalog data from disk
     */
    public async reloadCatalogData(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
            return;
        }

        try {
            await this.loadCatalogData();
        } catch (error) {
            this.logger.error('Failed to reload catalog data', error);
            throw error;
        }
    }

    /**
     * Updates a value in the catalog JSON at the specified path
     */
    public async updateJsonValue(jsonPath: string, newValue: unknown): Promise<void> {
        if (!this.currentCatalogFile || !this.catalogData) {
            throw new Error('Catalog file not initialized');
        }

        try {
            const data = this.catalogData as Record<string, unknown>;
            const pathParts = this.parseJsonPath(jsonPath);

            // Navigate and update the value
            let current: any = data;
            for (let i = 0; i < pathParts.length - 1; i++) {
                const part = pathParts[i];
                if (!this.isValidPathPart(current, part)) {
                    throw new Error(`Invalid path at part '${part}'`);
                }
                current = current[part];
            }

            const lastPart = pathParts[pathParts.length - 1];
            if (!this.isValidPathPart(current, lastPart)) {
                throw new Error(`Invalid path at final part '${lastPart}'`);
            }

            current[lastPart] = newValue;

            // Write back to file
            await this.writeCatalogFile();

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to update JSON value: ${message}`);
        }
    }

    /**
     * Handles deletion of the catalog file
     */
    public async handleFileDeletion(uri: vscode.Uri): Promise<void> {
        if (this.currentCatalogFile?.uri.fsPath === uri.fsPath) {
            this.currentCatalogFile = undefined;
            this.catalogData = {};
            this.initialized = false;
            this._onDidChangeContent.fire();
        }
    }

    private async checkAndUpdateRoot(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!workspaceFolder) {
            return;
        }

        // Don't switch if we're already on this root
        if (this.currentCatalogFile?.workspaceFolder.uri.fsPath === workspaceFolder.uri.fsPath) {
            return;
        }

        const catalogFileUri = vscode.Uri.joinPath(workspaceFolder.uri, this.catalogFileName);
        try {
            await vscode.workspace.fs.stat(catalogFileUri);
            await this.setCatalogFile(catalogFileUri, workspaceFolder);
        } catch {
            this.logger.debug(`No ${this.catalogFileName} found in ${workspaceFolder.name}`);
        }
    }

    private async setCatalogFile(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        this.currentCatalogFile = {
            uri,
            workspaceFolder,
            displayPath: `${workspaceFolder.name}/${this.catalogFileName}`
        };
        await this.loadCatalogData();
        this.initialized = true;
        this._onDidChangeContent.fire();
        this.logger.debug(`Catalog file set to ${uri.fsPath}`);
    }

    private async loadCatalogData(): Promise<void> {
        if (!this.currentCatalogFile) {
            this.catalogData = {};
            return;
        }

        try {
            const content = await fs.readFile(this.currentCatalogFile.uri.fsPath, 'utf8');
            this.catalogData = JSON.parse(content);
            this._onDidChangeContent.fire();
        } catch (error) {
            this.catalogData = {};
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to load catalog data: ${message}`);
        }
    }

    private async writeCatalogFile(): Promise<void> {
        if (!this.currentCatalogFile) {
            throw new Error('No catalog file selected');
        }

        await fs.writeFile(
            this.currentCatalogFile.uri.fsPath,
            JSON.stringify(this.catalogData, null, 2) + '\n',
            'utf8'
        );

        // Store the current selection path before firing the event
        const currentPath = this.lastSelectedPath;
        this._onDidChangeContent.fire();

        // Restore selection after a short delay to ensure tree view has updated
        if (currentPath && this.treeView && this.treeDataProvider) {
            setTimeout(async () => {
                try {
                    const item = await this.treeDataProvider!.findTreeItemByPath(currentPath);
                    if (item) {
                        await this.treeView!.reveal(item, { select: true, focus: true });
                    }
                } catch (error) {
                    this.logger.error('Failed to restore selection', error);
                }
            }, 100);
        }
    }

    private parseJsonPath(jsonPath: string): (string | number)[] {
        const segments: (string | number)[] = [];
        const regex = /\[(\d+)\]|\.([^.\[\]]+)/g;
        let match;
        while ((match = regex.exec(jsonPath)) !== null) {
            if (match[1] !== undefined) {
                segments.push(parseInt(match[1], 10));
            } else if (match[2] !== undefined) {
                segments.push(match[2]);
            }
        }
        return segments;
    }

    private isValidPathPart(current: unknown, part: string | number): boolean {
        if (typeof part === 'string') {
            return current !== null && !Array.isArray(current) &&
                typeof current === 'object' && part in current;
        }
        if (typeof part === 'number') {
            return Array.isArray(current) && part >= 0 && part < current.length;
        }
        return false;
    }

    /**
    * Dispose of the event emitter
    */
    public dispose(): void {
        this._onDidChangeContent.dispose();
        this.treeView?.dispose();
    }
}