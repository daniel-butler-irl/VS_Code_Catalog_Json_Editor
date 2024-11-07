// src/types/prompt/index.ts
import type * as vscode from 'vscode';

/**
 * Options for decorating input controls with visual enhancements
 */
export interface PromptDecoratorOptions {
    /** Loading indicator state */
    busy?: boolean;
    /** Enabled/disabled state */
    enabled?: boolean;
    /** Custom validation message */
    validationMessage?: string;
    /** Timeout in milliseconds */
    timeout?: number;
}

/**
 * Extended button type with handler function
 */
export interface QuickInputButtons extends vscode.QuickInputButton {
    handler?: (value: string) => Promise<string | undefined>;
}

/**
 * Base options for all prompt types
 */
export interface BasePromptOptions {
    /** Title displayed at the top of the prompt */
    title: string;
    /** Placeholder text when no value is entered */
    placeholder?: string;
    /** Visual decorations and enhancements */
    decorator?: PromptDecoratorOptions;
    /** Custom buttons with handlers */
    buttons?: QuickInputButtons[];
}

/**
 * Options for input box prompts
 */
export interface InputBoxOptions<T> extends BasePromptOptions {
    /** Initial value to display */
    initialValue?: string;
    /** Whether to mask the input (for passwords) */
    password?: boolean;
    /** Validation function */
    validate?: (value: string) => string | null | Promise<string | null>;
    /** Transform function to convert string input to final type */
    transform?: (value: string) => T | Promise<T>;
}

/**
 * Extended QuickPickItem with value and icon support
 */
export interface QuickPickItemEx<T> extends vscode.QuickPickItem {
    /** The value associated with this item */
    value: T;
    /** Optional icon to display */
    iconPath?: vscode.ThemeIcon | vscode.Uri;
    /** Whether to always show this item regardless of filter */
    alwaysShow?: boolean;
}

/**
 * Options for quick pick prompts
 */
export interface QuickPickOptions<T> extends BasePromptOptions {
    /** Available items to pick from */
    items: Array<QuickPickItemEx<T>>;
    /** Whether to match on description text */
    matchOnDescription?: boolean;
    /** Whether to match on detail text */
    matchOnDetail?: boolean;
    /** Allow selecting multiple items */
    canPickMany?: boolean;
    /** Initially active items */
    activeItems?: T[];
}

/**
 * Group definition for grouped quick picks
 */
export interface QuickPickGroup<T> {
    /** Group label displayed as separator */
    label: string;
    /** Items in this group */
    items: Array<QuickPickItemEx<T>>;
    /** Optional sort priority (higher numbers first) */
    priority?: number;
}

/**
 * Options for grouped quick pick prompts
 */
export interface GroupedQuickPickOptions<T> extends Omit<QuickPickOptions<T>, 'items'> {
    /** Groups of items */
    groups: Array<QuickPickGroup<T>>;
}

/**
 * Options for boolean selection prompts
 */
export interface BooleanPickOptions extends BasePromptOptions {
    /** Current boolean value */
    currentValue?: boolean;
    /** Label for true option */
    trueLabel?: string;
    /** Label for false option */
    falseLabel?: string;
}

/**
 * Options for quick picks with custom input option
 */
export interface CustomQuickPickOptions<T> extends QuickPickOptions<T> {
    /** Label for custom input option */
    customOptionLabel?: string;
    /** Handler for custom input */
    customOptionHandler: () => Promise<T | undefined>;
}