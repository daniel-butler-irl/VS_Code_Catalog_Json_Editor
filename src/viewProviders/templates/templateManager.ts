// src/viewProviders/templates/templateManager.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { TemplateLoader } from './templateLoader';
import { WorkspaceRequiredError } from '../../utils/errors';
import { OutputManager, Components, LogLevel } from '../../utils/outputManager';

interface TemplateOptions {
    isLoggedIn?: boolean;
    showRefreshButton?: boolean;
    customStyles?: string;
    customScripts?: string;
}

export interface TemplateResources {
    styleUri: vscode.Uri;
    scriptUri: vscode.Uri;
    cspSource: string;
    nonce: string;
}

export class TemplateManager {
    private readonly templateLoader: TemplateLoader;

    /**
     * Creates a new instance of TemplateManager
     * @param extensionUri The extension's URI for resource loading
     * @param outputManager The output manager for logging
     */
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly outputManager: OutputManager
    ) {
        this.templateLoader = new TemplateLoader(extensionUri, outputManager);
    }

    /**
     * Gets the main webview content
     */
    public async getWebviewContent(webview: vscode.Webview, options: TemplateOptions = {}): Promise<string> {
        try {
            const resources = this.templateLoader.getTemplateResources(webview);
            const scripts = this.getWebviewScripts(webview);
            
            const replacements = {
                ...this.getStandardReplacements(options),
                STYLE_URI: resources.styleUri.toString(),
                SCRIPT_URIS: scripts.map(uri => `<script type="module" src="${uri}"></script>`).join('\n'),
                CSP_SOURCE: resources.cspSource,
                NONCE: resources.nonce
            };

            return await this.templateLoader.processTemplate(
                'webview',
                resources,
                replacements
            );
        } catch (error) {
            this.outputManager.log(Components.TEMPLATE_LOADER, `Error getting webview content: ${error}`, LogLevel.ERROR);
            return this.getErrorContent(webview);
        }
    }

    /**
     * Gets the no workspace content
     */
    public async getNoWorkspaceContent(webview: vscode.Webview): Promise<string> {
        try {
            const resources = this.templateLoader.getTemplateResources(webview);
            
            return await this.templateLoader.processTemplate(
                'noWorkspace',
                resources,
                {
                    BUTTON_CLASS: 'workspace-button',
                    MESSAGE: 'A workspace is required to use the IBM Catalog JSON Editor.'
                }
            );
        } catch (error) {
            this.outputManager.log(Components.TEMPLATE_LOADER, `Error getting no workspace content: ${error}`, LogLevel.ERROR);
            return this.getErrorContent(webview);
        }
    }

    /**
     * Gets the error content
     */
    public async getErrorContent(webview: vscode.Webview, errorMessage?: string): Promise<string> {
        try {
            const resources = this.templateLoader.getTemplateResources(webview);
            
            return await this.templateLoader.processTemplate(
                'error',
                resources,
                {
                    ERROR_MESSAGE: errorMessage || 'An error occurred while loading the content.'
                }
            );
        } catch (error) {
            this.outputManager.log(Components.TEMPLATE_LOADER, `Error getting error content: ${error}`, LogLevel.ERROR);
            return this.getFallbackErrorContent(webview.cspSource);
        }
    }

    /**
     * Gets content for when no file is selected
     */
    public async getNoFileContent(webview: vscode.Webview): Promise<string> {
        try {
            const resources = this.templateLoader.getTemplateResources(webview);
            
            return await this.templateLoader.processTemplate(
                'noFileSelected',
                resources,
                {
                    FILE_NAME: 'ibm_catalog.json',
                    MESSAGE: 'Please open ibm_catalog.json to use this editor.'
                }
            );
        } catch (error) {
            this.outputManager.log(Components.TEMPLATE_LOADER, `Error getting no file content: ${error}`, LogLevel.ERROR);
            return this.getErrorContent(webview);
        }
    }

    /**
     * Gets content for when ibm_catalog.json doesn't exist
     */
    public async getNoIbmCatalogContent(webview: vscode.Webview): Promise<string> {
        try {
            const resources = this.templateLoader.getTemplateResources(webview);
            
            return await this.templateLoader.processTemplate(
                'noIbmCatalog',
                resources,
                {
                    MESSAGE: 'This repository does not contain an ibm_catalog.json file.'
                }
            );
        } catch (error) {
            this.outputManager.log(Components.TEMPLATE_LOADER, `Error getting no ibm_catalog content: ${error}`, LogLevel.ERROR);
            return this.getErrorContent(webview);
        }
    }
    
    /**
     * Updates the login status in an existing webview
     */
    public async updateLoginStatus(webview: vscode.Webview, isLoggedIn: boolean): Promise<string> {
        return this.getWebviewContent(webview, { isLoggedIn });
    }

    /**
     * Validates if a workspace is available and throws appropriate error if not
     */
    public validateWorkspace(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new WorkspaceRequiredError();
        }
    }

    /**
     * Gets standard replacements for templates based on options
     */
    private getStandardReplacements(options: TemplateOptions): Record<string, string> {
        return {
            LOGIN_STATUS: options.isLoggedIn ? 'Logged In' : 'Not Logged In',
            LOGIN_STATUS_CLASS: options.isLoggedIn ? 'logged-in' : 'logged-out',
            REFRESH_CATALOG_BUTTON_DISABLED: options.showRefreshButton ? 'disabled' : '',
            CUSTOM_STYLES: options.customStyles || '',
            CUSTOM_SCRIPTS: options.customScripts || '',
            EXTENSION_VERSION: '1.0.0', // Should be pulled from package.json
            CURRENT_YEAR: new Date().getFullYear().toString()
        };
    }

    /**
     * Gets a fallback error content when everything else fails
     */
    private getFallbackErrorContent(cspSource: string): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
                <style>
                    body {
                        padding: 20px;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                    }
                </style>
                <title>Error</title>
            </head>
            <body>
                <h1 class="error">Critical Error</h1>
                <p>Failed to load the template system. Please try reloading the window.</p>
                <button onclick="reload()">Reload Window</button>
                <script>
                    function reload() {
                        const vscode = acquireVsCodeApi();
                        vscode.postMessage({ command: 'reloadWindow' });
                    }
                </script>
            </body>
            </html>
        `;
    }

    /**
     * Clears the template cache
     */
    public clearCache(): void {
        this.templateLoader.clearCache();
        this.outputManager.log(Components.TEMPLATE_LOADER, 'Template cache cleared', LogLevel.INFO);
    }

    /**
     * Gets the webview scripts
     */
    private getWebviewScripts(webview: vscode.Webview): string[] {
        const modulesPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'modules');
        return [
            webview.asWebviewUri(vscode.Uri.joinPath(modulesPath, 'logger.js')),
            webview.asWebviewUri(vscode.Uri.joinPath(modulesPath, 'jsonRenderer.js')),
            webview.asWebviewUri(vscode.Uri.joinPath(modulesPath, 'stateManager.js')),
            webview.asWebviewUri(vscode.Uri.joinPath(modulesPath, 'modalManager.js')),
            webview.asWebviewUri(vscode.Uri.joinPath(modulesPath, 'messageHandler.js')),
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'webview.js'))
        ].map(uri => uri.toString());
    }

    /**
     * Disposes of resources
     */
    public dispose(): void {
        // Add any cleanup logic here if needed
    }
}