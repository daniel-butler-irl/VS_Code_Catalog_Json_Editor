// src/viewProviders/templates/templateLoader.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from '../../utils/fileUtils';
import { createLoggerFor } from '../../utils/outputManager';

export interface TemplateResources {
    scriptUri: vscode.Uri;
    styleUri: vscode.Uri;
    codiconsUri?: vscode.Uri;
    cspSource: string;
    nonce: string;
}

export interface TemplateCache {
    content: string;
    timestamp: number;
}

export class TemplateLoader {
    private readonly logger = createLoggerFor('TEMPLATE_LOADER');
    private static readonly CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    private templateCache: Map<string, TemplateCache> = new Map();

    constructor(
        private readonly extensionUri: vscode.Uri,
    ) {}

    /**
     * Loads a template from the specified path with caching
     */
    public async loadTemplate(templateName: string): Promise<string> {
        const templatePath = this.getTemplatePath(templateName);
        
        try {
            // Check cache first
            const cachedTemplate = this.templateCache.get(templatePath);
            if (cachedTemplate && this.isCacheValid(cachedTemplate)) {
                this.logger.info(`Using cached template: ${templateName}`);
                return cachedTemplate.content;
            }

            // Load template from file
            const content = await FileUtils.readFileContent(templatePath);
            
            // Update cache
            this.templateCache.set(templatePath, {
                content,
                timestamp: Date.now()
            });

            this.logger.info(`Successfully loaded template: ${templateName}`);
            return content;
        } catch (error) {
            this.logger.error(`Error loading template ${templateName}:`, error);
            return this.getFallbackTemplate(templateName);
        }
    }


    /**
     * Processes a template by replacing placeholders with actual values
     */
    public async processTemplate(
        templateName: string,
        resources: TemplateResources,
        additionalReplacements: Record<string, string> = {}
    ): Promise<string> {
        try {
            let content = await this.loadTemplate(templateName);

            // Replace standard resources
            content = this.replaceStandardPlaceholders(content, resources);

            // Replace additional custom placeholders
            content = this.replaceCustomPlaceholders(content, additionalReplacements);

            return content;
        } catch (error) {
            this.logger.error(`Error processing template ${templateName}:`, error);
            throw error;
        }
    }

    /**
     * Gets the URIs for webview resources
     */
    public getTemplateResources(webview: vscode.Webview): TemplateResources {
        return {
            scriptUri: webview.asWebviewUri(
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview','webview.js')
            ),
            styleUri: webview.asWebviewUri(
                vscode.Uri.joinPath(this.extensionUri, 'dist','webview', 'webview.css')
            ),
            cspSource: webview.cspSource,
            nonce: this.generateNonce()
        };
    }

    /**
     * Clears the template cache
     */
    public clearCache(): void {
        this.templateCache.clear();
        this.logger.info('Template cache cleared');
    }

    /**
     * Gets the path to a template file
     */
    private getTemplatePath(templateName: string): string {
    return path.join(
        this.extensionUri.fsPath,
        'src',
        'viewProviders',
        'templates',
        'html',
        `${templateName}.html`
    );
}
    /**
     * Checks if cached template is still valid
     */
    private isCacheValid(cache?: TemplateCache): boolean {
        if (!cache) return false;
        
        const age = Date.now() - cache.timestamp;
        return age < TemplateLoader.CACHE_TIMEOUT;
    }

    /**
     * Replaces standard resource placeholders in template
     */
    private replaceStandardPlaceholders(content: string, resources: TemplateResources): string {
        return content
            .replace(/{{SCRIPT_URI}}/g, resources.scriptUri.toString())
            .replace(/{{STYLE_URI}}/g, resources.styleUri.toString())
            .replace(/{{CODICON_URI}}/g, resources.codiconsUri?.toString() || '')
            .replace(/{{CSP_SOURCE}}/g, resources.cspSource)
            .replace(/{{NONCE}}/g, resources.nonce);
    }

    /**
     * Replaces custom placeholders in template
     */
    private replaceCustomPlaceholders(
        content: string,
        replacements: Record<string, string>
    ): string {
        Object.entries(replacements).forEach(([key, value]) => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            content = content.replace(regex, value);
        });
        return content;
    }

    /**
     * Generates a secure nonce for CSP
     */
    private generateNonce(): string {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        for (let i = 0; i < 32; i++) {
            nonce += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return nonce;
    }

    /**
     * Provides fallback templates for different template types
     */
    private getFallbackTemplate(templateName: string): string {
        switch (templateName) {
            case 'webview':
                return this.getFallbackWebviewTemplate();
            case 'noWorkspace':
                return this.getFallbackNoWorkspaceTemplate();
            case 'error':
                return this.getFallbackErrorTemplate();
            default:
                return this.getFallbackErrorTemplate();
        }
    }

    /**
     * Fallback templates for different scenarios
     */
    private getFallbackWebviewTemplate(): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src {{CSP_SOURCE}} 'unsafe-inline'; script-src {{CSP_SOURCE}};">
                <title>IBM Catalog JSON Editor</title>
            </head>
            <body>
                <div class="container">
                    <h1>IBM Catalog JSON Editor</h1>
                    <p>Failed to load the main template. Please try refreshing.</p>
                </div>
            </body>
            </html>`;
    }

    private getFallbackNoWorkspaceTemplate(): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src {{CSP_SOURCE}} 'unsafe-inline'; script-src {{CSP_SOURCE}};">
                <title>Workspace Required</title>
            </head>
            <body>
                <div class="container">
                    <h1>Workspace Required</h1>
                    <p>Please open a workspace to use the IBM Catalog JSON Editor.</p>
                </div>
            </body>
            </html>`;
    }

    private getFallbackErrorTemplate(): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src {{CSP_SOURCE}} 'unsafe-inline';">
                <title>Error</title>
            </head>
            <body>
                <div class="container">
                    <h1>Error</h1>
                    <p>An error occurred while loading the template.</p>
                </div>
            </body>
            </html>`;
    }

}