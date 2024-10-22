// src/utils/outputManager.ts
import * as vscode from 'vscode';

export class OutputManager {
    private static instance: OutputManager;
    private channels: Map<string, vscode.OutputChannel> = new Map();
    private readonly PREFIX = 'Catalog Editor';
    private useMultipleChannels: boolean = false;
    
    private constructor() {
        // Create main channel by default
        this.channels.set('main', vscode.window.createOutputChannel(this.PREFIX));
    }

    public static getInstance(): OutputManager {
        if (!OutputManager.instance) {
            OutputManager.instance = new OutputManager();
        }
        return OutputManager.instance;
    }

    /**
     * Configures whether to use multiple channels or a single channel
     */
    public setMultiChannelMode(useMultiple: boolean): void {
        if (this.useMultipleChannels === useMultiple) return;
        
        this.useMultipleChannels = useMultiple;
        
        if (!useMultiple) {
            // If switching to single channel, dispose of all except main
            for (const [key, channel] of this.channels.entries()) {
                if (key !== 'main') {
                    channel.dispose();
                    this.channels.delete(key);
                }
            }
        }
    }

    /**
     * Gets or creates a channel for a component
     */
    private getChannel(component: keyof typeof Components): vscode.OutputChannel {
        if (!this.useMultipleChannels) {
            return this.channels.get('main')!;
        }

        const channelName = `${this.PREFIX} - ${Components[component]}`;
        if (!this.channels.has(component)) {
            this.channels.set(component, vscode.window.createOutputChannel(channelName));
        }
        return this.channels.get(component)!;
    }

    /**
     * Logs a message to the appropriate output channel
     */
    public log(
        component: keyof typeof Components,
        message: string,
        level: LogLevel = 'INFO'
    ): void {
        const timestamp = new Date().toISOString();
        const channel = this.getChannel(component);
        const componentName = this.useMultipleChannels ? '' : `[${Components[component]}] `;
        const formattedMessage = `[${timestamp}] [${level}] ${componentName}${message}`;
        channel.appendLine(formattedMessage);
    }

    /**
     * Creates a detailed log entry with error information
     */
    public createLogEntry(
        message: string,
        error?: unknown,
        component?: string
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
     * Shows all output channels
     */
    public show(component?: keyof typeof Components): void {
        if (component && this.useMultipleChannels) {
            this.getChannel(component).show();
        } else {
            this.channels.get('main')?.show();
        }
    }

    /**
     * Clears specified or all output channels
     */
    public clear(component?: keyof typeof Components): void {
        if (component && this.useMultipleChannels) {
            this.getChannel(component).clear();
        } else if (!component) {
            this.channels.forEach(channel => channel.clear());
        }
    }

    /**
     * Gets all active channel names
     */
    public getActiveChannels(): string[] {
        return Array.from(this.channels.keys());
    }

    /**
     * Disposes all output channels
     */
    public dispose(): void {
        this.channels.forEach(channel => channel.dispose());
        this.channels.clear();
    }
}

export const Components = {
    MAIN: "Main",
    MESSAGES: "Messages",
    FILES: "Files",
    OFFERINGS: "Offerings",
    TEMPLATES: "Templates",
    DECORATIONS: "Decorations",
    TEMPLATE_LOADER: "Template Loader",
    TEMPLATE_MANAGER: "Template Manager",
    MESSAGE_HANDLER: "Message Handler",
    API: "API Service"
} as const;

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'TRACE';

// Helper function for components to create consistent log methods
export function createLoggerFor(component: keyof typeof Components) {
    const outputManager = OutputManager.getInstance();
    
    return {
        trace(message: string): void {
            outputManager.log(component, message, 'TRACE');
        },
        debug(message: string): void {
            outputManager.log(component, message, 'DEBUG');
        },
        info(message: string): void {
            outputManager.log(component, message, 'INFO');
        },
        warn(message: string): void {
            outputManager.log(component, message, 'WARN');
        },
        error(message: string, error?: unknown): void {
            const entry = outputManager.createLogEntry(message, error);
            outputManager.log(component, entry, 'ERROR');
        },
        /**
         * Shows the output channel for this component
         */
        show(): void {
            outputManager.show(component);
        },
        /**
         * Clears the output channel for this component
         */
        clear(): void {
            outputManager.clear(component);
        }
    };
}

// Export singleton instance
export const outputManager = OutputManager.getInstance();