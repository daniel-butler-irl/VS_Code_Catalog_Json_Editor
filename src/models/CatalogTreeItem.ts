// src/models/CatalogTreeItem.ts

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Represents a node in the IBM Catalog JSON tree view
 * Extends VS Code's TreeItem class with additional properties for JSON handling
 */
export class CatalogTreeItem extends vscode.TreeItem {
    /**
     * Creates a new CatalogTreeItem
     * @param label The display label for the tree item
     * @param value The actual JSON value this item represents
     * @param path The JSON path to this item
     * @param collapsibleState Whether and how this item can be collapsed
     * @param contextValue The context value for menu contributions
     */
    constructor(
        public readonly label: string,
        public readonly value: unknown,
        public readonly path: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);

        // Set the display properties
        this.tooltip = this.createTooltip();
        this.description = this.createDescription();
        this.iconPath = this.getIconPath();

        // Set command for editable items
        if (this.contextValue === 'editable') {
            this.command = {
                command: 'ibmCatalog.editElement',
                title: 'Edit Value',
                arguments: [this]
            };
        }
    }

    /**
     * Creates a tooltip for the item showing both key and value
     * Will be enhanced in Phase 2 to show additional IBM Cloud information
     */
    private createTooltip(): string {
        if (this.contextValue === 'editable') {
            return `${this.label}: ${this.formatValue(this.value)}`;
        }
        
        if (this.label === 'catalog_id') {
            return `${this.label}: ${this.formatValue(this.value)}\nClick to validate with IBM Cloud`;
        }

        return this.label;
    }

    /**
     * Creates the description text shown after the label
     */
    private createDescription(): string {
        if (this.contextValue === 'editable') {
            return this.formatValue(this.value);
        }

        if (this.contextValue === 'array') {
            const length = Array.isArray(this.value) ? this.value.length : 0;
            return `Array[${length}]`;
        }

        if (this.contextValue === 'container') {
            const size = typeof this.value === 'object' && this.value 
                ? Object.keys(this.value).length 
                : 0;
            return `Object{${size}}`;
        }

        return '';
    }

    /**
     * Gets the appropriate icon for the tree item based on its type
     */
    private getIconPath(): { light: string; dark: string } | vscode.ThemeIcon {
        const iconName = this.getIconName();
        
        if (iconName.startsWith('$(')) {
            return new vscode.ThemeIcon(iconName.slice(2, -1));
        }

        return {
            light: path.join(__filename, '..', '..', '..', 'resources', 'light', `${iconName}.svg`),
            dark: path.join(__filename, '..', '..', '..', 'resources', 'dark', `${iconName}.svg`)
        };
    }

    /**
     * Determines the appropriate icon name based on the item type and value
     */
    private getIconName(): string {
        switch (this.contextValue) {
            case 'array':
                return '$(list-ordered)';
            case 'container':
                return '$(json)';
            case 'editable':
                if (this.label === 'catalog_id') {
                    return '$(link)';
                }
                if (typeof this.value === 'boolean') {
                    return '$(toggle-left)';
                }
                if (typeof this.value === 'number') {
                    return '$(symbol-number)';
                }
                return '$(symbol-string)';
            default:
                return '$(circle-outline)';
        }
    }

    /**
     * Formats a value for display in the tree view
     * @param value The value to format
     */
    private formatValue(value: unknown): string {
        if (value === null) {
            return 'null';
        }
        if (value === undefined) {
            return 'undefined';
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return value.toString();
        }
        return '';
    }
}