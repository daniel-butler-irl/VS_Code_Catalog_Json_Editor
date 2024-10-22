// src/viewProviders/ui/statusBar.ts
import * as vscode from 'vscode';

export interface StatusBarConfig {
    position?: vscode.StatusBarAlignment;
    priority?: number;
    tooltipPrefix?: string;
    baseCommand?: string;
}

export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private readonly defaultConfig: StatusBarConfig = {
        position: vscode.StatusBarAlignment.Left,
        priority: 100,
        tooltipPrefix: 'IBM Catalog Editor: ',
        baseCommand: 'catalogEditor'
    };

    constructor(config: StatusBarConfig = {}) {
        const mergedConfig = { ...this.defaultConfig, ...config };

        this.statusBarItem = vscode.window.createStatusBarItem(
            mergedConfig.position!,
            mergedConfig.priority
        );

        // Initialize with default state
        this.updateStatus(false);
    }

    /**
     * Updates the status bar state
     */
    public updateStatus(isLoggedIn: boolean): void {
        if (isLoggedIn) {
            this.setLoggedInState();
        } else {
            this.setLoggedOutState();
        }
        this.statusBarItem.show();
    }

    /**
     * Sets the logged in state
     */
    private setLoggedInState(): void {
        this.statusBarItem.text = `$(unlock) IBM Catalog: Logged In`;
        this.statusBarItem.tooltip = `${this.defaultConfig.tooltipPrefix}Click to logout`;
        this.statusBarItem.command = `${this.defaultConfig.baseCommand}.logout`;
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.foreground');
    }

    /**
     * Sets the logged out state
     */
    private setLoggedOutState(): void {
        this.statusBarItem.text = `$(lock) IBM Catalog: Not Logged In`;
        this.statusBarItem.tooltip = `${this.defaultConfig.tooltipPrefix}Click to login`;
        this.statusBarItem.command = `${this.defaultConfig.baseCommand}.login`;
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    }

    /**
     * Shows a loading state
     */
    public showLoading(message: string = 'Processing...'): void {
        this.statusBarItem.text = `$(sync~spin) IBM Catalog: ${message}`;
        this.statusBarItem.tooltip = `${this.defaultConfig.tooltipPrefix}${message}`;
        this.statusBarItem.command = undefined; // Disable clicking while loading
    }

    /**
     * Shows an error state
     */
    public showError(message: string = 'Error'): void {
        this.statusBarItem.text = `$(error) IBM Catalog: ${message}`;
        this.statusBarItem.tooltip = `${this.defaultConfig.tooltipPrefix}${message}`;
        this.statusBarItem.command = `${this.defaultConfig.baseCommand}.showError`;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    }

    /**
     * Shows a success state temporarily
     */
    public async showTemporarySuccess(
        message: string,
        durationMs: number = 3000
    ): Promise<void> {
        const originalText = this.statusBarItem.text;
        const originalTooltip = this.statusBarItem.tooltip;
        const originalCommand = this.statusBarItem.command;
        const originalColor = this.statusBarItem.color;

        this.statusBarItem.text = `$(check) IBM Catalog: ${message}`;
        this.statusBarItem.tooltip = `${this.defaultConfig.tooltipPrefix}${message}`;
        this.statusBarItem.command = undefined;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.foreground');

        // Restore original state after duration
        await new Promise(resolve => setTimeout(resolve, durationMs));
        
        // Only restore if the item hasn't been disposed
        if (!this.isDisposed()) {
            this.statusBarItem.text = originalText;
            this.statusBarItem.tooltip = originalTooltip;
            this.statusBarItem.command = originalCommand;
            this.statusBarItem.color = originalColor;
        }
    }

    /**
     * Checks if the status bar item has been disposed
     */
    private isDisposed(): boolean {
        // Use internal VS Code API to check if disposed
        // This is a bit hacky but works for now
        return !(this.statusBarItem as any)._proxy;
    }

    /**
     * Shows the status bar item
     */
    public show(): void {
        this.statusBarItem.show();
    }

    /**
     * Hides the status bar item
     */
    public hide(): void {
        this.statusBarItem.hide();
    }

    /**
     * Updates the priority of the status bar item
     */
    public setPriority(priority: number): void {
        // VS Code doesn't support changing priority after creation
        // So we need to create a new status bar item
        const oldItem = this.statusBarItem;
        this.statusBarItem = vscode.window.createStatusBarItem(
            oldItem.alignment,
            priority
        );
        
        // Copy over the state
        this.statusBarItem.text = oldItem.text;
        this.statusBarItem.tooltip = oldItem.tooltip;
        this.statusBarItem.command = oldItem.command;
        this.statusBarItem.color = oldItem.color;
        this.statusBarItem.backgroundColor = oldItem.backgroundColor;
        
        // Show if the old item was visible
        if (!(oldItem as any)._proxy.isHidden) {
            this.statusBarItem.show();
        }
        
        // Dispose the old item
        oldItem.dispose();
    }

    /**
     * Disposes of the status bar item
     */
    public dispose(): void {
        this.statusBarItem.dispose();
    }
}