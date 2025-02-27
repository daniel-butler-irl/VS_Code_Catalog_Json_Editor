// src/services/LoggingService.ts

import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG,
    INFO,
    WARN,
    ERROR
}

export type LogChannel = 'main' | 'preRelease' | 'schemaValidation';

/**
 * Service for handling application logging with channel output and optional console logging
 */
export class LoggingService {
    private static instance: LoggingService;
    private mainChannel: vscode.OutputChannel;
    private preReleaseChannel: vscode.OutputChannel;
    private schemaValidationChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.INFO;
    private currentChannel: LogChannel = 'main';

    private constructor() {
        this.mainChannel = vscode.window.createOutputChannel('IBM Catalog');
        this.preReleaseChannel = vscode.window.createOutputChannel('IBM Catalog Pre-release');
        this.schemaValidationChannel = vscode.window.createOutputChannel('IBM Catalog Schema Validation');
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
     * Gets the current logging level
     * @returns The current LogLevel
     */
    public getLogLevel(): LogLevel {
        return this.logLevel;
    }

    /**
     * Sets the logging level
     * @param level The minimum level to log
     */
    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    /**
     * Gets the current output channel
     * @returns The current channel ('main' | 'preRelease' | 'schemaValidation')
     */
    public getCurrentChannel(): LogChannel {
        return this.currentChannel;
    }

    /**
     * Shows the output channel
     */
    public show(channel: LogChannel = 'main'): void {
        this.currentChannel = channel;
        if (channel === 'preRelease') {
            this.preReleaseChannel.show();
        } else if (channel === 'schemaValidation') {
            this.schemaValidationChannel.show();
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

    private logMessage(level: LogLevel, message: string, data?: Record<string, unknown> | unknown, channel: LogChannel = 'main'): void {
        if (this.logLevel <= level) {
            const formattedData = data instanceof Error || (data && typeof data !== 'object')
                ? this.formatError(data)
                : data as Record<string, unknown>;
            const formattedMessage = this.formatMessage(LogLevel[level], message, formattedData);

            switch (channel) {
                case 'preRelease':
                    this.preReleaseChannel.appendLine(formattedMessage);
                    break;
                case 'schemaValidation':
                    this.schemaValidationChannel.appendLine(formattedMessage);
                    break;
                default:
                    this.mainChannel.appendLine(formattedMessage);
            }
        }
    }

    public debug(message: string, data?: Record<string, unknown>, channel: LogChannel = 'main'): void {
        this.logMessage(LogLevel.DEBUG, message, data, channel);
    }

    public info(message: string, data?: Record<string, unknown>, channel: LogChannel = 'main'): void {
        this.logMessage(LogLevel.INFO, message, data, channel);
    }

    public warn(message: string, data?: Record<string, unknown> | unknown, channel: LogChannel = 'main'): void {
        this.logMessage(LogLevel.WARN, message, data, channel);
    }

    public error(message: string, data?: Record<string, unknown> | unknown, channel: LogChannel = 'main'): void {
        this.logMessage(LogLevel.ERROR, message, data, channel);
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
        this.schemaValidationChannel.dispose();
    }
}