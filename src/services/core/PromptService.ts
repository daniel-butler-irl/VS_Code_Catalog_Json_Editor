// src/services/core/PromptService.ts
import * as vscode from 'vscode';
import { LoggingService } from './LoggingService';
import type {
    InputBoxOptions,
    QuickPickOptions,
    GroupedQuickPickOptions,
    BooleanPickOptions,
    CustomQuickPickOptions,
    QuickPickItemEx,
    PromptDecoratorOptions,
    QuickInputButtons
} from '../../types/prompt';

/**
 * Service for handling user prompts and input collection.
 * Provides a flexible, chainable API for complex prompts while
 * maintaining simplicity for basic use cases.
 */
export class PromptService {
    private static readonly logger = LoggingService.getInstance();
    private static readonly DEFAULT_TIMEOUT = 60000; // 1 minute

    /**
     * Shows an enhanced input box with optional validation, transformation, and decorations
     * @param options Configuration options for the input box
     * @returns Promise resolving to the transformed input value or undefined if cancelled
     */
    public static async showInputBox<T = string>(
        options: InputBoxOptions<T>
    ): Promise<T | undefined> {
        this.logger.debug('Showing input box', { title: options.title });

        const input = vscode.window.createInputBox();
        const decorator = this.createDecorator(options.decorator);

        try {
            return await new Promise<T | undefined>((resolve) => {
                input.title = options.title;
                input.placeholder = options.placeholder;
                input.password = options.password ?? false;
                input.value = options.initialValue ?? '';
                input.buttons = [...(options.buttons ?? [])];

                if (decorator) {
                    input.validationMessage = decorator.validationMessage;
                    void decorator.decorate(input);
                }

                // Set up validation
                if (options.validate) {
                    input.onDidChangeValue(async (value) => {
                        const validation = await options.validate!(value);
                        input.validationMessage = validation || '';
                    });
                }

                input.onDidAccept(async () => {
                    const value = input.value;
                    if (options.validate) {
                        const validation = await options.validate(value);
                        if (validation) {
                            input.validationMessage = validation;
                            return;
                        }
                    }

                    try {
                        const result = options.transform ?
                            await options.transform(value) :
                            value as unknown as T;
                        input.hide();
                        resolve(result);
                    } catch (error) {
                        input.validationMessage = error instanceof Error ?
                            error.message :
                            'Invalid input';
                    }
                });

                input.onDidHide(() => {
                    input.dispose();
                    resolve(undefined);
                });

                if (options.buttons?.length) {
                    input.onDidTriggerButton(async (button) => {
                        const handler = (button as QuickInputButtons).handler;
                        if (handler) {
                            try {
                                const result = await handler(input.value);
                                if (result !== undefined) {
                                    input.value = String(result);
                                }
                            } catch (error) {
                                this.logger.error('Button handler error', error);
                            }
                        }
                    });
                }

                input.show();
            });
        } finally {
            input.dispose();
        }
    }

    /**
     * Shows a quick pick with enhanced filtering and grouping capabilities
     * @param options Configuration options for the quick pick
     * @returns Promise resolving to the selected value(s) or undefined if cancelled
     */
    public static async showQuickPick<T>(
        options: QuickPickOptions<T>
    ): Promise<T | undefined> {
        this.logger.debug('Showing quick pick', {
            title: options.title,
            itemCount: options.items.length
        });

        const quickPick = vscode.window.createQuickPick<QuickPickItemEx<T>>();
        const decorator = this.createDecorator(options.decorator);

        try {
            return await new Promise<T | undefined>((resolve) => {
                quickPick.title = options.title;
                quickPick.placeholder = options.placeholder;
                quickPick.items = this.prepareQuickPickItems(options.items);
                quickPick.matchOnDescription = options.matchOnDescription ?? false;
                quickPick.matchOnDetail = options.matchOnDetail ?? false;
                quickPick.canSelectMany = options.canPickMany ?? false;
                quickPick.buttons = [...(options.buttons ?? [])];

                if (decorator) {
                    void decorator.decorate(quickPick);
                }

                if (options.activeItems?.length) {
                    quickPick.activeItems = options.activeItems
                        .map(item => this.findQuickPickItem(quickPick.items, item))
                        .filter((item): item is QuickPickItemEx<T> => item !== undefined);
                }

                quickPick.onDidAccept(() => {
                    const selection = quickPick.canSelectMany
                        ? quickPick.selectedItems.map(item => item.value)
                        : quickPick.selectedItems[0]?.value;
                    quickPick.hide();
                    resolve(selection as T);
                });

                quickPick.onDidHide(() => {
                    resolve(undefined);
                });

                if (options.buttons?.length) {
                    quickPick.onDidTriggerButton(async (button) => {
                        const handler = (button as QuickInputButtons).handler;
                        if (handler) {
                            try {
                                await handler(quickPick.value);
                            } catch (error) {
                                this.logger.error('Button handler error', error);
                            }
                        }
                    });
                }

                quickPick.show();
            });
        } finally {
            quickPick.dispose();
        }
    }

    /**
     * Shows a boolean selection with customizable labels and icons
     * @param options Configuration options for the boolean selection
     * @returns Promise resolving to the selected boolean value or undefined if cancelled
     */
    public static async showBooleanPick(
        options: BooleanPickOptions
    ): Promise<boolean | undefined> {
        const items: QuickPickItemEx<boolean>[] = [
            {
                label: options.trueLabel ?? 'True',
                description: 'Set value to true',
                value: true,
                iconPath: new vscode.ThemeIcon(
                    options.currentValue === true ? 'check' : 'circle-outline'
                )
            },
            {
                label: options.falseLabel ?? 'False',
                description: 'Set value to false',
                value: false,
                iconPath: new vscode.ThemeIcon(
                    options.currentValue === false ? 'check' : 'circle-outline'
                )
            }
        ];

        return this.showQuickPick({
            title: options.title,
            placeholder: options.placeholder,
            items,
            decorator: options.decorator
        });
    }

    /**
     * Shows a confirmation dialog with customizable buttons
     * @param message The message to display
     * @param options Optional configuration for the confirmation dialog
     * @returns Promise resolving to true if confirmed, false if cancelled
     */
    public static async confirm(
        message: string,
        options: {
            title?: string;
            confirmLabel?: string;
            cancelLabel?: string;
            decorator?: PromptDecoratorOptions;
        } = {}
    ): Promise<boolean> {
        return this.showQuickPick({
            title: options.title ?? 'Confirm',
            placeholder: message,
            items: [
                {
                    label: options.confirmLabel ?? 'Yes',
                    value: true,
                    iconPath: new vscode.ThemeIcon('check')
                },
                {
                    label: options.cancelLabel ?? 'No',
                    value: false,
                    iconPath: new vscode.ThemeIcon('x')
                }
            ],
            decorator: options.decorator
        }).then(result => result ?? false);
    }

    /**
     * Creates a custom decorator for input controls
     */
    private static createDecorator(options?: PromptDecoratorOptions) {
        if (!options) { return undefined; }

        return {
            validationMessage: options.validationMessage,
            decorate: async (input: vscode.QuickInput) => {
                if (options.busy) {
                    input.busy = true;
                }
                if (options.enabled === false) {
                    input.enabled = false;
                }
                if (options.timeout) {
                    setTimeout(() => {
                        input.hide();
                    }, options.timeout);
                }
            }
        };
    }

    

    /**
     * Prepares items for the quick pick by adding icons and formatting
     */
    private static prepareQuickPickItems<T>(
        items: Array<QuickPickItemEx<T>>
    ): Array<QuickPickItemEx<T>> {
        return items.map(item => ({
            ...item,
            iconPath: item.iconPath ?? this.getDefaultIcon(item)
        }));
    }

    /**
     * Gets a default icon for a quick pick item based on its type
     */
    private static getDefaultIcon(item: QuickPickItemEx<unknown>): vscode.ThemeIcon | undefined {
        if (item.kind === vscode.QuickPickItemKind.Separator) {
            return undefined;
        }
        if (typeof item.value === 'boolean') {
            return new vscode.ThemeIcon(item.value ? 'check' : 'x');
        }
        return undefined;
    }

    /**
 * Shows a quick pick with an additional custom input option.
 * Combines quick pick selection with custom input capability.
 * 
 * @param options Configuration options including custom input handling
 * @returns Promise resolving to selected value or custom input, undefined if cancelled
 */
    public static async showQuickPickWithCustom<T>(
        options: CustomQuickPickOptions<T>
    ): Promise<T | undefined> {
        this.logger.debug('Showing quick pick with custom option', {
            title: options.title,
            itemCount: options.items.length
        });

        const quickPick = vscode.window.createQuickPick<QuickPickItemEx<T>>();
        try {
            // Create combined items with custom option first
            const customItem: QuickPickItemEx<string> = {
                label: options.customOptionLabel ?? '$(edit) Enter Custom Value',
                description: 'Manually enter a value',
                value: '__custom__' as any,
                alwaysShow: true
            };

            // Set up quick pick
            quickPick.title = options.title;
            quickPick.placeholder = options.placeholder;
            quickPick.items = [customItem as QuickPickItemEx<T>, ...options.items];
            quickPick.matchOnDescription = options.matchOnDescription ?? false;
            quickPick.matchOnDetail = options.matchOnDetail ?? false;

            // Apply decorator if provided
            if (options.decorator) {
                quickPick.busy = options.decorator.busy ?? false;
                if (options.decorator.enabled !== undefined) {
                    quickPick.enabled = options.decorator.enabled;
                }
                if (options.decorator.validationMessage) {
                    // Create a description detail for the validation message
                    quickPick.buttons = [
                        {
                            iconPath: new vscode.ThemeIcon('info'),
                            tooltip: options.decorator.validationMessage
                        }
                    ];
                }
            }

            return await new Promise<T | undefined>((resolve) => {
                quickPick.onDidAccept(async () => {
                    const selection = quickPick.selectedItems[0];
                    if (!selection) {
                        resolve(undefined);
                        return;
                    }

                    if (selection.value === '__custom__') {
                        quickPick.hide();
                        const customValue = await options.customOptionHandler();
                        resolve(customValue);
                    } else {
                        resolve(selection.value);
                    }
                    quickPick.hide();
                });

                quickPick.onDidHide(() => {
                    quickPick.dispose();
                    resolve(undefined);
                });

                quickPick.show();
            });
        } finally {
            quickPick.dispose();
        }
    }

    /**
 * Shows a quick pick with items organized into logical groups.
 * Groups can be prioritized and items within groups maintain their original order.
 * 
 * @param options Configuration options including group definitions
 * @returns Promise resolving to the selected value or undefined if cancelled
 */
    public static async showGroupedQuickPick<T>(
        options: GroupedQuickPickOptions<T>
    ): Promise<T | undefined> {
        this.logger.debug('Showing grouped quick pick', {
            title: options.title,
            groupCount: options.groups.length,
            totalItems: options.groups.reduce((sum, g) => sum + g.items.length, 0)
        });

        const quickPick = vscode.window.createQuickPick<QuickPickItemEx<T>>();

        try {
            // Sort groups by priority (higher priority first) and create flat item list
            const sortedGroups = [...options.groups].sort((a, b) =>
                (b.priority ?? 0) - (a.priority ?? 0)
            );

            const allItems: Array<QuickPickItemEx<T>> = [];

            // Build items list with separators
            for (const group of sortedGroups) {
                if (group.items.length > 0) {
                    // Add group separator
                    allItems.push({
                        label: group.label,
                        kind: vscode.QuickPickItemKind.Separator,
                        value: undefined as any // Separators won't be selectable
                    });

                    // Add group items
                    allItems.push(...group.items);
                }
            }

            // Configure quick pick
            quickPick.title = options.title;
            quickPick.placeholder = options.placeholder;
            quickPick.items = allItems;
            quickPick.matchOnDescription = options.matchOnDescription ?? false;
            quickPick.matchOnDetail = options.matchOnDetail ?? false;
            quickPick.canSelectMany = options.canPickMany ?? false;

            // Set active items if specified
            if (options.activeItems?.length) {
                quickPick.activeItems = options.activeItems
                    .map(item => this.findQuickPickItem(allItems, item))
                    .filter((item): item is QuickPickItemEx<T> =>
                        item !== undefined && item.kind !== vscode.QuickPickItemKind.Separator
                    );
            }

            // Apply decorator if provided
            if (options.decorator) {
                quickPick.busy = options.decorator.busy ?? false;
                if (options.decorator.enabled !== undefined) {
                    quickPick.enabled = options.decorator.enabled;
                }
            }

            // Add buttons if provided
            if (options.buttons?.length) {
                quickPick.buttons = options.buttons;

                quickPick.onDidTriggerButton(async (button) => {
                    const handler = (button as QuickInputButtons).handler;
                    if (handler) {
                        try {
                            // Pass current value to handler
                            const result = await handler(quickPick.value);
                            if (result) {
                                quickPick.value = result;
                            }
                        } catch (error) {
                            this.logger.error('Button handler error', error);
                        }
                    }
                });
            }

            return await new Promise<T | undefined>((resolve) => {
                quickPick.onDidAccept(() => {
                    const selection = options.canPickMany
                        ? quickPick.selectedItems
                            .filter(item => item.kind !== vscode.QuickPickItemKind.Separator)
                            .map(item => item.value)
                        : quickPick.selectedItems[0]?.value;

                    quickPick.hide();
                    resolve(selection as T);
                });

                quickPick.onDidHide(() => {
                    quickPick.dispose();
                    resolve(undefined);
                });

                quickPick.show();
            });
        } finally {
            quickPick.dispose();
        }
    }

    /**
     * Helper method to find a quick pick item by its value
     * 
     * @param items Array of quick pick items to search
     * @param value The value to find
     * @returns Matching quick pick item or undefined
     */
    private static findQuickPickItem<T>(
        items: ReadonlyArray<QuickPickItemEx<T>>,
        value: T
    ): QuickPickItemEx<T> | undefined {
        return items.find(item =>
            item.kind !== vscode.QuickPickItemKind.Separator &&
            item.value === value
        );
    }
}