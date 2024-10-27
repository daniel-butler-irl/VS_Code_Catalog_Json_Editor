// src/viewProviders/templates/templateLoader.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { OutputManager, Components, LogLevel } from '../../utils/outputManager';
import { TemplateResources } from './templateManager';

/**
 * Handles loading and processing of HTML templates for the webview
 */
export class TemplateLoader {
    private templateCache: Map<string, string> = new Map();

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly outputManager: OutputManager
    ) {}

    /**
     * Gets resources needed for template rendering
     * @param webview The webview instance
     */
    public getTemplateResources(webview: vscode.Webview): TemplateResources {
        return {
            styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'webview.css')),
            scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'webview.js')),
            cspSource: webview.cspSource,
            nonce: this.getNonce()
        };
    }

    /**
     * Process a template with replacements
     * @param templateName Name of the template file (without extension)
     * @param resources Template resources
     * @param replacements Key-value pairs for template replacements
     */
    public async processTemplate(
        templateName: string,
        resources: TemplateResources,
        replacements: Record<string, string>
    ): Promise<string> {
        try {
            let content = await this.loadTemplate(templateName);
            
            // Replace all placeholders
            Object.entries(replacements).forEach(([key, value]) => {
                content = content.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
            });
            
            return content;
        } catch (error) {
            this.outputManager.log(
                Components.TEMPLATE_LOADER,
                `Error processing template ${templateName}: ${error}`,
                LogLevel.ERROR
            );
            throw error;
        }
    }

    /**
     * Loads a template file from disk or cache
     * @param templateName Name of the template file (without extension)
     */
    private async loadTemplate(templateName: string): Promise<string> {
        // Check cache first
        if (this.templateCache.has(templateName)) {
            return this.templateCache.get(templateName)!;
        }

        try {
            const templatePath = path.join(
                this.extensionUri.fsPath,
                'src',
                'viewProviders',
                'templates',
                'html',
                `${templateName}.html`
            );

            const templateUri = vscode.Uri.file(templatePath);
            const templateContent = await vscode.workspace.fs.readFile(templateUri);
            const content = templateContent.toString();

            // Cache the template
            this.templateCache.set(templateName, content);

            return content;
        } catch (error) {
            this.outputManager.log(
                Components.TEMPLATE_LOADER,
                `Error loading template ${templateName}: ${error}`,
                LogLevel.ERROR
            );
            throw error;
        }
    }

    /**
     * Generates a nonce for Content Security Policy
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Clears the template cache
     */
    public clearCache(): void {
        this.templateCache.clear();
        this.outputManager.log(Components.TEMPLATE_LOADER, 'Template cache cleared', LogLevel.INFO);
    }

    /**
     * Validates a template exists
     * @param templateName Name of the template to validate
     */
    public async validateTemplate(templateName: string): Promise<boolean> {
        try {
            const templatePath = path.join(
                this.extensionUri.fsPath,
                'src',
                'viewProviders',
                'templates',
                'html',
                `${templateName}.html`
            );
            const templateUri = vscode.Uri.file(templatePath);
            await vscode.workspace.fs.stat(templateUri);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Gets the full path to a template file
     * @param templateName Name of the template file
     */
    public getTemplatePath(templateName: string): string {
        return path.join(
            this.extensionUri.fsPath,
            'src',
            'viewProviders',
            'templates',
            'html',
            `${templateName}.html`
        );
    }
}