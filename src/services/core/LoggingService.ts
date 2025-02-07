// src/services/LoggingService.ts

import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG,
    INFO,
    WARN,
    ERROR
}

/**
 * Service for handling application logging with channel output and optional console logging
 */
export class LoggingService {
    private static instance: LoggingService;
    private mainChannel: vscode.OutputChannel;
    private preReleaseChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.INFO;

    private constructor() {
        this.mainChannel = vscode.window.createOutputChannel('IBM Catalog');
        this.preReleaseChannel = vscode.window.createOutputChannel('IBM Catalog Pre-release');
    }

    /**
     * Gets the singleton instance of the logging service
     */
    public static getInstance(): LoggingService {
        if (!LoggingService.instance) {
            LoggingService.instance = new LoggingService();
        }
        return LoggingService.instance;
    }

    /**
     * Sets the logging level
     * @param level The minimum level to log
     */
    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    /**
     * Shows the output channel
     */
    public show(channel: 'main' | 'preRelease' = 'main'): void {
        if (channel === 'preRelease') {
            this.preReleaseChannel.show();
        } else {
            this.mainChannel.show();
        }
    }

    /**
     * Formats a log entry
     */
    private formatMessage(level: string, message: string, data?: Record<string, unknown>): string {
        const timestamp = new Date().toISOString();
        let formattedMessage = `[${timestamp}] [${level}] ${message}`;

        if (data) {
            try {
                formattedMessage += '\n' + JSON.stringify(data, null, 2);
            } catch (error) {
                formattedMessage += '\nError formatting data: ' + String(error);
            }
        }

        return formattedMessage;
    }

    /**
     * Logs a debug message
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    public debug(message: string, data?: Record<string, unknown>, channel: 'main' | 'preRelease' = 'main'): void {
        if (this.logLevel <= LogLevel.DEBUG) {
            const formattedMessage = this.formatMessage('DEBUG', message, data);
            if (channel === 'preRelease') {
                this.preReleaseChannel.appendLine(formattedMessage);
            } else {
                this.mainChannel.appendLine(formattedMessage);
            }
        }
    }

    /**
     * Logs an info message
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    public info(message: string, data?: Record<string, unknown>, channel: 'main' | 'preRelease' = 'main'): void {
        if (this.logLevel <= LogLevel.INFO) {
            const formattedMessage = this.formatMessage('INFO', message, data);
            if (channel === 'preRelease') {
                this.preReleaseChannel.appendLine(formattedMessage);
            } else {
                this.mainChannel.appendLine(formattedMessage);
            }
        }
    }

    /**
     * Logs a warning message
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    public warn(message: string, data?: Record<string, unknown> | unknown, channel: 'main' | 'preRelease' = 'main'): void {
        if (this.logLevel <= LogLevel.WARN) {
            const formattedData = data instanceof Error || (data && typeof data !== 'object')
                ? this.formatError(data)
                : data as Record<string, unknown>;
            const formattedMessage = this.formatMessage('WARN', message, formattedData);
            if (channel === 'preRelease') {
                this.preReleaseChannel.appendLine(formattedMessage);
            } else {
                this.mainChannel.appendLine(formattedMessage);
            }
        }
    }

    /**
     * Logs an error message
     * @param message The message to log
     * @param error The error object or message
     * @param data Optional additional data
     */
    public error(message: string, data?: Record<string, unknown> | unknown, channel: 'main' | 'preRelease' = 'main'): void {
        const formattedData = data instanceof Error || (data && typeof data !== 'object')
            ? this.formatError(data)
            : data as Record<string, unknown>;
        const formattedMessage = this.formatMessage('ERROR', message, formattedData);
        if (channel === 'preRelease') {
            this.preReleaseChannel.appendLine(formattedMessage);
        } else {
            this.mainChannel.appendLine(formattedMessage);
        }
    }

    private formatError(error: unknown): Record<string, unknown> {
        if (error instanceof Error) {
            return {
                message: error.message,
                stack: error.stack,
                name: error.name
            };
        }
        return { error: String(error) };
    }

    /**
     * Shows an error message to the user and logs it
     * @param message The error message
     * @param error The error object
     */
    public async showErrorMessage(message: string, error?: unknown): Promise<void> {
        this.error(message, error);
        await vscode.window.showErrorMessage(`${message}${error instanceof Error ? `: ${error.message}` : ''}`);
    }

    /**
     * Disposes of the output channel
     */
    public dispose(): void {
        this.mainChannel.dispose();
        this.preReleaseChannel.dispose();
    }
}