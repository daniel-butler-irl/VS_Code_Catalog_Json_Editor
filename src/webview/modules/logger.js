/**
 * Logger module for handling all webview logging functionality
 */
export class Logger {
    constructor(vscode) {
        this.vscode = vscode;
    }

    /**
     * Sends log messages from the webview to the extension's output channel
     * @param {string} level - The log level ('log', 'warn', 'error')
     * @param {...any} args - The log messages or data
     */
    logToExtension(level, ...args) {
        this.vscode.postMessage({
            type: 'log',
            level: level,
            message: args.map(String).join(' '),
        });
    }

    log(...args) { this.logToExtension('log', ...args); }
    warn(...args) { this.logToExtension('warn', ...args); }
    error(...args) { this.logToExtension('error', ...args); }
}
