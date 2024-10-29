// src/models/CatalogTreeItem.ts

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Validation status for tree items
 */
export enum ValidationStatus {
    Unknown = 'unknown',
    Valid = 'valid',
    Invalid = 'invalid'
}

/**
 * Represents a node in the IBM Catalog JSON tree view
 * Extends VS Code's TreeItem class with additional properties for JSON handling
 */
export class CatalogTreeItem extends vscode.TreeItem {
    private validationStatus: ValidationStatus = ValidationStatus.Unknown;

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
        collapsibleState: vscode.TreeItemCollapsibleState,
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
     * Creates a new instance with an updated collapsible state
     * @param newState The new collapsible state
     * @returns A new CatalogTreeItem with the updated state
     */
    public withCollapsibleState(newState: vscode.TreeItemCollapsibleState): CatalogTreeItem {
        return new CatalogTreeItem(
            this.label,
            this.value,
            this.path,
            newState,
            this.contextValue
        );
    }

    /**
     * Sets the validation status of the item
     * @param status The validation status
     */
    public setValidationStatus(status: ValidationStatus): void {
        this.validationStatus = status;
        this.iconPath = this.getIconPath(); // Refresh icon
    }

    /**
     * Creates a tooltip for the item showing both key and value
     * Includes validation status for validatable fields
     */
    private createTooltip(): string {
        const baseTooltip = `${this.label}: ${this.formatValue(this.value)}`;
        
        if (this.label === 'catalog_id') {
            const validationMsg = this.getValidationMessage();
            return `${baseTooltip}\n${validationMsg}`;
        }

        return this.contextValue === 'editable' ? baseTooltip : this.label;
    }

    /**
     * Gets the validation message based on current status
     */
    private getValidationMessage(): string {
        switch (this.validationStatus) {
            case ValidationStatus.Valid:
                return 'Validation: ✓ Valid catalog ID';
            case ValidationStatus.Invalid:
                return 'Validation: ✗ Invalid catalog ID';
            default:
                return 'Click to validate with IBM Cloud';
        }
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
            return `(${length} items)`;
        }

        if (this.contextValue === 'container') {
            const size = typeof this.value === 'object' && this.value 
                ? Object.keys(this.value).length 
                : 0;
            return `(${size} fields)`;
        }

        return '';
    }

    /**
     * Gets the appropriate icon for the tree item based on its type and validation status
     */
    private getIconPath(): vscode.ThemeIcon {
        // Special handling for catalog_id
        if (this.label === 'catalog_id') {
            switch (this.validationStatus) {
                case ValidationStatus.Valid:
                    return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
                case ValidationStatus.Invalid:
                    return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
                default:
                    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
            }
        }

        // Color coding for different types
        switch (this.contextValue) {
            case 'array':
                return new vscode.ThemeIcon('list-ordered', new vscode.ThemeColor('charts.blue'));
            case 'container':
                return new vscode.ThemeIcon('json', new vscode.ThemeColor('charts.purple'));
            case 'editable':
                if (typeof this.value === 'boolean') {
                    return new vscode.ThemeIcon('symbol-boolean', new vscode.ThemeColor('charts.blue'));
                }
                if (typeof this.value === 'number') {
                    return new vscode.ThemeIcon('symbol-number', new vscode.ThemeColor('charts.purple'));
                }
                return new vscode.ThemeIcon('symbol-string', new vscode.ThemeColor('charts.yellow'));
            default:
                return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.foreground'));
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
            return value.length > 50 ? `${value.substring(0, 47)}...` : value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return value.toString();
        }
        return '';
    }
}