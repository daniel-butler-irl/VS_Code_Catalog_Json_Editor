// src/types/prompt/index.ts
import type * as vscode from 'vscode';
import type { ValueQuickPickItem } from '../common';

export interface BasePromptOptions {
    title: string;
    placeholder?: string;
    ignoreFocusOut?: boolean;
}

export interface InputBoxOptions<T> extends BasePromptOptions {
    initialValue?: string;
    password?: boolean;
    validate?: (value: string) => string | null | Promise<string | null>;
    transform?: (value: string) => T | Promise<T>;
}

export interface QuickPickItemEx<T> extends ValueQuickPickItem<T> {
    iconPath?: vscode.ThemeIcon;
}

export interface QuickPickOptions<T> extends BasePromptOptions {
    items: QuickPickItemEx<T>[];
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    canPickMany?: boolean;
}

export interface GroupedQuickPickOptions<T> extends QuickPickOptions<T> {
    groups: {
        label: string;
        items: QuickPickItemEx<T>[];
        priority?: number;
    }[];
}

export interface BooleanPickOptions extends BasePromptOptions {
    currentValue?: boolean;
    trueLabel?: string;
    falseLabel?: string;
}

export interface CustomQuickPickOptions<T> extends QuickPickOptions<T> {
    customOptionLabel?: string;
    customOptionHandler: () => Promise<T | undefined>;
}
