// src/services/LoggingService.ts

import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

/**
 * Service for handling application logging with channel output and optional console logging
 */
export class LoggingService {
    private static instance: LoggingService;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.INFO;
    
    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('IBM Catalog Extension');
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
        this.info(`Log level set to ${LogLevel[level]}`);
    }

    /**
     * Logs a debug message
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    public debug(message: string, data?: unknown): void {
        if (this.logLevel <= LogLevel.DEBUG) {
            this.log('DEBUG', message, data);
        }
    }

    /**
     * Logs an info message
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    public info(message: string, data?: unknown): void {
        if (this.logLevel <= LogLevel.INFO) {
            this.log('INFO', message, data);
        }
    }

    /**
     * Logs a warning message
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    public warn(message: string, data?: unknown): void {
        if (this.logLevel <= LogLevel.WARN) {
            this.log('WARN', message, data);
        }
    }

    /**
     * Logs an error message
     * @param message The message to log
     * @param error The error object or message
     * @param data Optional additional data
     */
    public error(message: string, error?: unknown, data?: unknown): void {
        if (this.logLevel <= LogLevel.ERROR) {
            let errorMessage = message;
            if (error instanceof Error) {
                errorMessage += `\nError: ${error.message}\nStack: ${error.stack}`;
            } else if (error) {
                errorMessage += `\nError: ${String(error)}`;
            }
            this.log('ERROR', errorMessage, data);
        }
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
     * Formats a log entry
     */
    private formatLogEntry(level: string, message: string, data?: unknown): string {
        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] [${level}] ${message}`;
        
        if (data !== undefined) {
            try {
                const dataString = JSON.stringify(data, null, 2);
                logMessage += `\nData: ${dataString}`;
            } catch (error) {
                logMessage += `\nData: [Unable to stringify data: ${error instanceof Error ? error.message : String(error)}]`;
            }
        }
        
        return logMessage;
    }

    /**
     * Internal logging function
     */
    private log(level: string, message: string, data?: unknown): void {
        const logEntry = this.formatLogEntry(level, message, data);
        this.outputChannel.appendLine(logEntry);
        
        // Also log to console in debug mode
        if (this.logLevel === LogLevel.DEBUG) {
            console.log(logEntry);
        }
    }

    /**
     * Shows the output channel
     */
    public show(): void {
        this.outputChannel.show();
    }

    /**
     * Disposes of the output channel
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }
}