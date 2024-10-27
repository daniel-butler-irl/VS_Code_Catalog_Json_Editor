// src/webview/modules/logger.js

/**
 * Handles logging from the webview frontend.
 */
export class Logger {
    constructor() {
        this.vscode = acquireVsCodeApi();
    }

    /**
     * Logs a standard message.
     * @param {string} message The message to log.
     */
    log(message) {
        this.vscode.postMessage({ type: 'log', level: 'log', message });
    }

    /**
     * Logs a warning message.
     * @param {string} message The warning message to log.
     */
    warn(message) {
        this.vscode.postMessage({ type: 'log', level: 'warn', message });
    }

    /**
     * Logs an error message.
     * @param {string} message The error message to log.
     */
    error(message) {
        this.vscode.postMessage({ type: 'log', level: 'error', message });
    }
}
