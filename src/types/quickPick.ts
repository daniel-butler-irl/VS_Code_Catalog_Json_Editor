import * as vscode from 'vscode';

export interface ValueQuickPickItem<T = string> extends vscode.QuickPickItem {
    value: T;
}