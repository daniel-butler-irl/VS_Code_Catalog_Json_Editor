// src/models/CatalogTreeItem.ts
import * as vscode from 'vscode';
import { IBMCloudService } from '../services/IBMCloudService';
import { AuthService } from '../services/AuthService';

/**
 * Validation status for tree items
 */
export enum ValidationStatus {
    Unknown = 'unknown',
    Valid = 'valid',
    Invalid = 'invalid',
    Validating = 'validating',
    LoginRequired = 'loginRequired', 
}

/**
 * Validation metadata for a tree item
 */
export interface ValidationMetadata {
    status: ValidationStatus;
    message?: string;
    lastChecked?: Date;
    details?: Record<string, unknown>;
}

/**
 * Schema metadata for a tree item
 */
export interface SchemaMetadata {
    readonly type: string;
    readonly required: boolean;
    readonly enum?: unknown[];
    readonly description?: string;
}

/**
 * Represents a node in the IBM Catalog JSON tree view
 */
export class CatalogTreeItem extends vscode.TreeItem {
    private readonly _validationMetadata: ValidationMetadata;
    private readonly _schemaMetadata?: SchemaMetadata;
    private context: vscode.ExtensionContext;

    
    /**
     * Creates a new CatalogTreeItem
     */
    constructor(
        context: vscode.ExtensionContext,
        public readonly label: string,
        public readonly value: unknown,
        public readonly jsonPath: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        schemaMetadata?: SchemaMetadata,
    ) {
        super(label, collapsibleState);
        this.context = context;
        this._validationMetadata = {
            status: ValidationStatus.Unknown
        };

        this._schemaMetadata = schemaMetadata;

        // Set the display properties
        this.tooltip = this.createTooltip();
        this.description = this.createDescription();
        this.iconPath = this.getIconPath();

        // Set command for editable items
        if (this.isEditable()) {
            this.command = {
                command: 'ibmCatalog.editElement',
                title: 'Edit Value',
                arguments: [this]
            };
        }
    }

    /**
     * Gets the current validation metadata
     */
    get validationMetadata(): Readonly<ValidationMetadata> {
        return this._validationMetadata;
    }

    /**
     * Gets the schema metadata if available
     */
    get schemaMetadata(): Readonly<SchemaMetadata> | undefined {
        return this._schemaMetadata;
    }

    /**
     * Checks if this item is editable
     */
    public isEditable(): boolean {
        return this.contextValue === 'editable';
    }

    /**
     * Checks if this item is validatable
     */
    public isValidatable(): boolean {
        return this.label === 'catalog_id' || 
               (this._schemaMetadata?.type === 'string' && this._schemaMetadata?.enum !== undefined);
    }

    /**
     * Creates a new instance with an updated collapsible state
     */
    public withCollapsibleState(newState: vscode.TreeItemCollapsibleState): CatalogTreeItem {
        return new CatalogTreeItem(
            this.context,
            this.label,
            this.value,
            this.jsonPath,
            newState,
            this.contextValue,
            this._schemaMetadata
        );
    }

    /**
     * Updates the validation metadata
     */
    public updateValidation(metadata: Partial<ValidationMetadata>): void {
        Object.assign(this._validationMetadata, {
            ...metadata,
            lastChecked: new Date()
        });
        
        this.tooltip = this.createTooltip();
        this.iconPath = this.getIconPath();
    }

    /**
     * Updates the display properties of the tree item.
     */
    public updateDisplayProperties(): void {
        this.tooltip = this.createTooltip();
        this.description = this.createDescription();
        this.iconPath = this.getIconPath();
    }


    public updateValidationStatus(status: ValidationStatus, message?: string): void {
    this._validationMetadata.status = status;
    this._validationMetadata.message = message;
    this._validationMetadata.lastChecked = new Date();

    this.tooltip = this.createTooltip();
    this.iconPath = this.getIconPath();
    }


    /**
     * Creates a tooltip for the item
     */
    private createTooltip(): string {
  const parts: string[] = [
    `Path: ${this.jsonPath}`,
    `Type: ${this.getValueType()}`,
  ];

  if (this._schemaMetadata?.description) {
    parts.push(`Description: ${this._schemaMetadata.description}`);
  }

  if (this.label === 'catalog_id' && typeof this.value === 'string') {
    parts.push(`Fetching offering details...`);
    this.updateTooltipWithOfferingDetails(this.value as string);
  } else if (this.isEditable()) {
    parts.push(`Value: ${this.formatValue(this.value)}`);
  }

  return parts.join('\n');
}

    /**
     * Updates the tooltip with offering details from IBM Cloud.
     * @param catalogId The catalog ID.
     */
    private async updateTooltipWithOfferingDetails(catalogId: string): Promise<void> {
  const apiKey = await AuthService.getApiKey(this.context);
  if (!apiKey) {
    return;
  }

  const ibmCloudService = new IBMCloudService(apiKey);

  try {
    const details = await ibmCloudService.getOfferingDetails(catalogId);
    const offeringName = details.name || 'Unknown Offering';
    this.tooltip = `Catalog ID: ${catalogId}\nOffering Name: ${offeringName}`;
  } catch (error) {
    this.tooltip = `Catalog ID: ${catalogId}\nOffering details not found.`;
  }
}

    /**
     * Gets the validation message
     */
    private getValidationMessage(): string {
        const { status, message, lastChecked } = this._validationMetadata;
        const timestamp = lastChecked ? ` (Last checked: ${lastChecked.toLocaleTimeString()})` : '';

        switch (status) {
            case ValidationStatus.Valid:
            return `Validation: ✓ Valid${timestamp}`;
            case ValidationStatus.Invalid:
            return `Validation: ✗ Invalid${message ? `: ${message}` : ''}${timestamp}`;
            case ValidationStatus.Validating:
            return 'Validation: ⟳ In progress...';
            case ValidationStatus.LoginRequired:
            return 'Validation: Login required for validation';
            default:
            return 'Validation: Pending';
        }
    }

    /**
     * Creates the description text
     */
    private createDescription(): string {
        if (this.isEditable()) {
            return this.formatValue(this.value);
        }

        if (this.contextValue === 'array') {
            return `Array[${Array.isArray(this.value) ? this.value.length : 0}]`;
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
     * Gets the appropriate icon
     */
    private getIconPath(): vscode.ThemeIcon {
        if (this.isValidatable()) {
            return this.getValidationIcon();
        }

        return this.getTypeIcon();
    }

    /**
     * Gets the validation status icon
     */
private getValidationIcon(): vscode.ThemeIcon {
  switch (this._validationMetadata.status) {
    case ValidationStatus.Valid:
      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('ibmCatalog.ValidationSuccess'));
    case ValidationStatus.Invalid:
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('ibmCatalog.ValidationFail'));
    case ValidationStatus.Validating:
      return new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.foreground'));
    case ValidationStatus.LoginRequired:
      return new vscode.ThemeIcon('key', new vscode.ThemeColor('charts.foreground'));
    default:
      return new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.foreground'));
  }
}

    /**
     * Gets the type-based icon
     */
    private getTypeIcon(): vscode.ThemeIcon {
        switch (this.contextValue) {
            case 'array':
                return new vscode.ThemeIcon('list-ordered', 
                    new vscode.ThemeColor('ibmCatalog.arrayColor'));
            case 'container':
                return new vscode.ThemeIcon('json', 
                    new vscode.ThemeColor('ibmCatalog.objectColor'));
            case 'editable':
                return this.getValueTypeIcon();
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    /**
     * Gets an icon based on the value type
     */
    private getValueTypeIcon(): vscode.ThemeIcon {
    switch (typeof this.value) {
        case 'boolean':
            return new vscode.ThemeIcon('symbol-boolean', new vscode.ThemeColor('ibmCatalog.booleanColor'));
        case 'number':
            return new vscode.ThemeIcon('symbol-number', new vscode.ThemeColor('ibmCatalog.numberColor'));
        case 'string':
            return new vscode.ThemeIcon('symbol-string', new vscode.ThemeColor('ibmCatalog.stringColor'));
        case 'object':
            return new vscode.ThemeIcon('symbol-object', new vscode.ThemeColor('ibmCatalog.objectColor'));
        case 'undefined':
            return new vscode.ThemeIcon('symbol-null', new vscode.ThemeColor('ibmCatalog.nullColor'));
        case 'symbol':
            return new vscode.ThemeIcon('symbol-enum', new vscode.ThemeColor('ibmCatalog.enumColor'));
        default:
            return new vscode.ThemeIcon('symbol-string', new vscode.ThemeColor('ibmCatalog.stringColor'));
    }
}


    /**
     * Gets the type of the value
     */
    private getValueType(): string {
        if (this.value === null) return 'null';
        if (Array.isArray(this.value)) return 'array';
        return typeof this.value;
    }

    /**
     * Formats a value for display
     */
    private formatValue(value: unknown): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') {
            return value.length > 50 ? `${value.substring(0, 47)}...` : value;
        }
        return String(value);
    }
}