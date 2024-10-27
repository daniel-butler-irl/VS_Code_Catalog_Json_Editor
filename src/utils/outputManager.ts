// src/utils/outputManager.ts
import * as vscode from 'vscode';

export enum Components {
    API_SERVICE = 'API_SERVICE',
    CATALOG_CACHE_SERVICE = 'CATALOG_CACHE_SERVICE',
    MESSAGE_HANDLER = 'MESSAGE_HANDLER',
    TEMPLATE_LOADER = 'TEMPLATE_LOADER',
    CATALOG_EDITOR_VIEW_PROVIDER = 'CATALOG_EDITOR_VIEW_PROVIDER',
    FILE_HANDLER = 'FILE_HANDLER',
    JSON_PATH_PROCESSOR = 'JSON_PATH_PROCESSOR',
    // Add more components as needed
}

export enum LogLevel {
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

export class OutputManager {
    private channels: { [key in Components]: vscode.OutputChannel } = {
        [Components.API_SERVICE]: vscode.window.createOutputChannel('API Service'),
        [Components.CATALOG_CACHE_SERVICE]: vscode.window.createOutputChannel('Catalog Cache Service'),
        [Components.MESSAGE_HANDLER]: vscode.window.createOutputChannel('Message Handler'),
        [Components.TEMPLATE_LOADER]: vscode.window.createOutputChannel('Template Loader'),
        [Components.CATALOG_EDITOR_VIEW_PROVIDER]: vscode.window.createOutputChannel('Catalog Editor View Provider'),
        [Components.FILE_HANDLER]: vscode.window.createOutputChannel('File Handler'),
        [Components.JSON_PATH_PROCESSOR]: vscode.window.createOutputChannel('JSON Path Processor'),
        // Initialize more channels as needed
    };

    /**
     * Logs a message to the specified component's output channel.
     * @param component The component enum.
     * @param message The message to log.
     * @param level The severity level.
     */
    public log(
        component: Components,
        message: string,
        level: LogLevel = LogLevel.INFO
    ): void {
        const timestamp = new Date().toISOString();
        const channel = this.channels[component];
        const formattedMessage = `[${timestamp}] [${level}] ${message}`;
        channel.appendLine(formattedMessage);
        channel.show(true);
    }

    /**
     * Creates a detailed log entry with error information.
     * @param message The primary message.
     * @param error The error object.
     * @returns The formatted log entry.
     */
    public createLogEntry(
        message: string,
        error?: unknown,
        component?: Components
    ): string {
        let errorDetails = '';

        if (error instanceof Error) {
            errorDetails = `\nError: ${error.message}`;
            if (error.stack) {
                errorDetails += `\nStack: ${error.stack}`;
            }
            if (error.cause) {
                errorDetails += `\nCause: ${error.cause}`;
            }
        } else if (error !== undefined) {
            errorDetails = `\nError: ${String(error)}`;
        }

        const componentInfo = component ? `[${component}] ` : '';
        return `${componentInfo}${message}${errorDetails}`;
    }

    /**
     * Disposes all output channels when the extension is deactivated.
     */
    public dispose(): void {
        Object.values(this.channels).forEach(channel => channel.dispose());
    }
}
