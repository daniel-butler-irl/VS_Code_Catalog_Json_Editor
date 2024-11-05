// src/services/core/PromptService.ts
import * as vscode from 'vscode';
import { LoggingService } from './LoggingService';
import type {
    InputBoxOptions,
    QuickPickOptions,
    GroupedQuickPickOptions,
    BooleanPickOptions,
    CustomQuickPickOptions,
    QuickPickItemEx
} from '../../types/prompt';

export class PromptService {
    private static readonly logger = LoggingService.getInstance();

    /**
     * Shows an input box with validation and transformation
     */
    public static async showInputBox<T = string>(
        options: InputBoxOptions<T>
    ): Promise<T | undefined> {
        this.logger.debug('Showing input box', { title: options.title });

        try {
            const input = await vscode.window.showInputBox({
                prompt: options.title,
                placeHolder: options.placeholder,
                value: options.initialValue,
                password: options.password,
                ignoreFocusOut: options.ignoreFocusOut,
                validateInput: options.validate
            });

            if (input === undefined) {
                return undefined;
            }

            return options.transform ? await options.transform(input) : input as unknown as T;
        } catch (error) {
            this.logger.error('Error in input box', error);
            throw error;
        }
    }

    /**
     * Shows a quick pick with optional grouping
     */
    public static async showQuickPick<T>(
        options: QuickPickOptions<T>
    ): Promise<T | undefined> {
        this.logger.debug('Showing quick pick', {
            title: options.title,
            itemCount: options.items.length
        });

        const selection = await vscode.window.showQuickPick(options.items, {
            title: options.title,
            placeHolder: options.placeholder,
            matchOnDescription: options.matchOnDescription,
            matchOnDetail: options.matchOnDetail,
            canPickMany: options.canPickMany,
            ignoreFocusOut: options.ignoreFocusOut
        });

        return selection?.value;
    }

    /**
     * Shows a quick pick with items organized into groups
     */
    public static async showGroupedQuickPick<T>(
        options: GroupedQuickPickOptions<T>
    ): Promise<T | undefined> {
        const allItems: Array<QuickPickItemEx<T> | vscode.QuickPickItem> = [];

        // Sort groups by priority if specified
        const sortedGroups = [...options.groups].sort((a, b) =>
            (b.priority ?? 0) - (a.priority ?? 0)
        );

        for (const group of sortedGroups) {
            if (group.items.length > 0) {
                allItems.push({
                    label: group.label,
                    kind: vscode.QuickPickItemKind.Separator
                });
                allItems.push(...group.items);
            }
        }

        const selection = await vscode.window.showQuickPick(allItems, {
            title: options.title,
            placeHolder: options.placeholder,
            matchOnDescription: options.matchOnDescription,
            matchOnDetail: options.matchOnDetail,
            ignoreFocusOut: options.ignoreFocusOut
        });

        return (selection as QuickPickItemEx<T>)?.value;
    }

    /**
     * Shows a boolean selection quick pick
     */
    public static async showBooleanPick(
        options: BooleanPickOptions & {
            currentValue?: boolean;
            trueLabel?: string;
            falseLabel?: string;
        }
    ): Promise<boolean | undefined> {
        const items: QuickPickItemEx<boolean>[] = [
            {
                label: options.trueLabel ?? 'true',
                description: 'Set value to true',
                value: true,
                iconPath: new vscode.ThemeIcon(
                    options.currentValue === true ? 'check' : 'circle-outline'
                )
            },
            {
                label: options.falseLabel ?? 'false',
                description: 'Set value to false',
                value: false,
                iconPath: new vscode.ThemeIcon(
                    options.currentValue === false ? 'check' : 'circle-outline'
                )
            }
        ];

        return this.showQuickPick({
            ...options,
            items
        });
    }

    /**
     * Shows a selection with "Add Custom" option
     */
    public static async showQuickPickWithCustom<T>(
        options: QuickPickOptions<T> & {
            customOptionLabel?: string;
            customOptionHandler: () => Promise<T | undefined>;
        }
    ): Promise<T | undefined> {
        const customOption: QuickPickItemEx<string> = {
            label: options.customOptionLabel ?? '$(edit) Enter Custom Value',
            description: 'Manually enter a value',
            value: '__custom__',
            iconPath: new vscode.ThemeIcon('edit'),
            alwaysShow: true
        };

        const allItems = [
            customOption,
            { label: 'Available Options', kind: vscode.QuickPickItemKind.Separator },
            ...options.items
        ];

        const selection = await vscode.window.showQuickPick(allItems, {
            title: options.title,
            placeHolder: options.placeholder,
            matchOnDescription: options.matchOnDescription,
            matchOnDetail: options.matchOnDetail,
            ignoreFocusOut: options.ignoreFocusOut
        });

        if ((selection as QuickPickItemEx<string>)?.value === '__custom__') {
            return options.customOptionHandler();
        }

        return (selection as QuickPickItemEx<T>)?.value;
    }
}