// src/models/CatalogTreeItem.ts

import * as vscode from 'vscode';
import { IBMCloudService } from '../services/IBMCloudService';
import { AuthService } from '../services/AuthService';
import { LoggingService } from '../services/LoggingService';

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
    private logger: LoggingService;
    private isUpdatingTooltip: boolean = false;

    public parent?: CatalogTreeItem; // Parent node reference
    public readonly catalogId?: string; // Associated catalog_id for offering_id nodes

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
        parent?: CatalogTreeItem, // Parent node
        catalogId?: string // Associated catalog_id
    ) {
        super(label, collapsibleState);

        this.logger = LoggingService.getInstance();

        this.context = context;
        this._validationMetadata = {
            status: ValidationStatus.Unknown,
        };

        this._schemaMetadata = schemaMetadata;
        this.parent = parent; // Set parent
        this.catalogId = catalogId; // Set catalog_id if provided

        // Set the display properties
        this.tooltip = this.createTooltip();
        this.description = this.createDescription();
        this.iconPath = this.getIconPath();

        // Set command for editable items
        if (this.isEditable()) {
            this.command = {
                command: 'ibmCatalog.editElement',
                title: 'Edit Value',
                arguments: [this],
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
            this._schemaMetadata,
            this.parent // Pass the parent
        );
    }
    /**
    * Gets the string representation of a validation status
    */
    private getStatusString(status: ValidationStatus): string {
        switch (status) {
            case ValidationStatus.Valid:
                return 'Valid';
            case ValidationStatus.Invalid:
                return 'Invalid';
            case ValidationStatus.Validating:
                return 'Validating';
            case ValidationStatus.LoginRequired:
                return 'LoginRequired';
            case ValidationStatus.Unknown:
            default:
                return 'Unknown';
        }
    }

    /**
     * Determines if this item is editable
     */
    public isEditable(): boolean {
        return this.contextValue === 'editable';
    }

    /**
     * Determines if this item is validatable
     */
    public isValidatable(): boolean {
        return (
            this.label === 'catalog_id' ||
            (this._schemaMetadata?.type === 'string' && this._schemaMetadata?.enum !== undefined)
        );
    }

    /**
     * Checks if this item is an offering ID within a dependency.
     */
    public isOfferingIdInDependency(): boolean {
        // Check if the jsonPath indicates this is an 'id' under 'dependencies'
        const dependencyIdPattern = /\$\.products\[\d+\]\.flavors\[\d+\]\.dependencies\[\d+\]\.id$/;
        return dependencyIdPattern.test(this.jsonPath) && this.label === 'id';
    }

    /**
     * Determines if a field needs validation.
     */
    public needsValidation(): boolean {
        return this.label === 'catalog_id' || this.isOfferingIdInDependency();
    }

    /**
     * Updates the validation metadata and refreshes UI
     */
    public updateValidationStatus(status: ValidationStatus, message?: string): void {
        const logger = LoggingService.getInstance();

        logger.debug(`Updating validation status for ${this.label}`, {
            oldStatus: this.getStatusString(this._validationMetadata.status),
            newStatus: this.getStatusString(status),
            message,
            path: this.jsonPath,
        });

        // Only update if there's an actual change in status or message
        if (status === this._validationMetadata.status && this._validationMetadata.message === message) {
            logger.debug(`Skipping validation update - no changes for ${this.label}`);
            return;
        }

        this._validationMetadata.status = status;
        this._validationMetadata.message = message;
        this._validationMetadata.lastChecked = new Date();

        // Update the icon and other UI elements
        this.iconPath = this.getValidationIcon();
        this.tooltip = this.createTooltip();
    }

    /**
     * Creates a tooltip for the item
     */
    private createTooltip(): string {
        const parts: string[] = [`Path: ${this.jsonPath}`, `Type: ${this.getValueType()}`];

        if (this._schemaMetadata?.description) {
            parts.push(`Description: ${this._schemaMetadata.description}`);
        }

        if (this.label === 'catalog_id' && typeof this.value === 'string' && !this.isUpdatingTooltip) {
            this.logger.debug(`Initializing tooltip update for catalog_id: ${this.value}`);
            // Use void to explicitly ignore the promise
            void this.updateTooltipWithOfferingDetails(this.value as string);
            parts.push('Validating catalog ID...');
        } else if (this.isOfferingIdInDependency() && typeof this.value === 'string' && !this.isUpdatingTooltip) {
            if (!this.catalogId) {
                parts.push('Cannot determine catalog_id for offering validation.');
            } else {
                this.logger.debug(`Initializing tooltip update for offering ID: ${this.value}`);
                void this.updateTooltipWithOfferingDetails(this.catalogId, this.value as string);
                parts.push('Validating offering ID...');
            }
        } else if (this.isEditable()) {
            parts.push(`Value: ${this.formatValue(this.value)}`);
        }

        // Add validation status message
        parts.push(this.getValidationMessage());

        return parts.join('\n');
    }

    /**
     * Retrieves the associated catalog_id by traversing up the tree.
     * Used for both direct catalog lookups and dependency validation.
     * @returns Promise<string | undefined> The associated catalog ID or undefined if not found
     */
    private async findAssociatedCatalogId(): Promise<string | undefined> {
        const logger = LoggingService.getInstance();
        let currentNode: CatalogTreeItem | undefined = this;

        // For direct catalog_id fields, return their own value
        if (this.label === 'catalog_id' && typeof this.value === 'string') {
            return this.value;
        }

        // Traverse up the tree looking for a catalog_id
        while (currentNode) {
            if (currentNode.value && typeof currentNode.value === 'object') {
                const values = currentNode.value as Record<string, unknown>;
                if ('catalog_id' in values && typeof values.catalog_id === 'string') {
                    logger.debug('Found catalog_id in parent node', {
                        catalogId: values.catalog_id,
                        path: currentNode.jsonPath
                    });
                    return values.catalog_id;
                }
            }
            currentNode = currentNode.parent;
        }

        logger.debug('No catalog_id found in parent nodes', {
            currentPath: this.jsonPath
        });
        return undefined;
    }

    /**
     * Validates the tree item.
     * For catalog_ids, validates against IBM Cloud.
     * For offering IDs within dependencies, validates against the parent catalog.
     */
    public async validateItem(): Promise<void> {
        const logger = LoggingService.getInstance();

        try {
            const apiKey = await AuthService.getApiKey(this.context);
            if (!apiKey) {
                this.updateValidationStatus(ValidationStatus.LoginRequired);
                return;
            }

            const ibmCloudService = new IBMCloudService(apiKey);

            if (this.label === 'catalog_id' && typeof this.value === 'string') {
                try {
                    const isValid = await ibmCloudService.validateCatalogId(this.value);
                    this.updateValidationStatus(
                        isValid ? ValidationStatus.Valid : ValidationStatus.Invalid,
                        isValid ? undefined : 'Invalid catalog ID'
                    );
                } catch (error) {
                    if (error instanceof Error) {
                        if (error.message.includes('not found in account')) {
                            this.updateValidationStatus(ValidationStatus.Invalid, 'Catalog ID not found');
                        } else {
                            logger.error('Catalog validation error', error);
                            this.updateValidationStatus(ValidationStatus.Invalid, 'Validation error occurred');
                        }
                    }
                }
            } else if (this.isOfferingIdInDependency() && typeof this.value === 'string') {
                try {
                    const catalogId = await this.findAssociatedCatalogId();
                    if (!catalogId) {
                        this.updateValidationStatus(
                            ValidationStatus.Invalid,
                            'Cannot determine catalog ID for offering validation'
                        );
                        return;
                    }

                    try {
                        const isValid = await ibmCloudService.validateOfferingId(catalogId, this.value);
                        this.updateValidationStatus(
                            isValid ? ValidationStatus.Valid : ValidationStatus.Invalid,
                            isValid ? undefined : 'Invalid offering ID for this catalog'
                        );
                    } catch (offeringError) {
                        if (offeringError instanceof Error && offeringError.message.includes('not found')) {
                            this.updateValidationStatus(ValidationStatus.Invalid, 'Invalid offering ID');
                        } else {
                            logger.error('Offering validation error', offeringError);
                            this.updateValidationStatus(ValidationStatus.Invalid, 'Validation error occurred');
                        }
                    }
                } catch (error) {
                    logger.error('Dependency validation error', error);
                    this.updateValidationStatus(ValidationStatus.Invalid, 'Validation error occurred');
                }
            }
        } catch (error) {
            logger.error('Validation error', error);
            this.updateValidationStatus(ValidationStatus.Invalid, 'Validation error occurred');
        }
    }

    /**
     * Updates the tooltip with offering details when appropriate.
     * @param catalogId The catalog ID
     * @param offeringId Optional offering ID for dependency validation
     */
    private async updateTooltipWithOfferingDetails(catalogId: string, offeringId?: string): Promise<void> {
        const logger = LoggingService.getInstance();

        if (this.isUpdatingTooltip) {
            logger.debug(`Skipping tooltip update - already in progress for ${catalogId}`);
            return;
        }

        this.isUpdatingTooltip = true;
        logger.debug(`Starting tooltip update process for catalog ID: ${catalogId}`);

        try {
            const apiKey = await AuthService.getApiKey(this.context);
            if (!apiKey) {
                logger.debug(`No API key found for catalog ID: ${catalogId}`);
                this.updateValidationStatus(ValidationStatus.LoginRequired);
                this.tooltip = 'Login required to validate.';
                return;
            }

            const ibmCloudService = new IBMCloudService(apiKey);
            const isValid = await ibmCloudService.validateCatalogId(catalogId);

            if (!isValid) {
                this.updateValidationStatus(ValidationStatus.Invalid, 'Invalid catalog ID');
                this.tooltip = `Catalog ID: ${catalogId}\nStatus: Invalid`;
                return;
            }

            // If we have an offering ID, get offering details
            if (offeringId) {
                try {
                    const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);
                    const offering = offerings.find(o => o.id === offeringId);

                    if (offering) {
                        this.tooltip = `Offering: ${offering.name}\nID: ${offeringId}`;
                        this.updateValidationStatus(ValidationStatus.Valid);
                    } else {
                        this.tooltip = `Offering ID: ${offeringId}\nStatus: Invalid (not found in catalog)`;
                        this.updateValidationStatus(
                            ValidationStatus.Invalid,
                            'Invalid offering ID for this catalog'
                        );
                    }
                } catch (error) {
                    logger.error('Failed to fetch offering details', error);
                    this.updateValidationStatus(ValidationStatus.Invalid, 'Error fetching offering details');
                }
            } else {
                // Just updating catalog details
                try {
                    const details = await ibmCloudService.getOfferingDetails(catalogId);
                    this.tooltip = `Catalog: ${details.label}\nID: ${catalogId}`;
                    this.updateValidationStatus(ValidationStatus.Valid);
                } catch (error) {
                    logger.error('Failed to fetch catalog details', error);
                    this.tooltip = `Catalog ID: ${catalogId}\nStatus: Error fetching details`;
                    this.updateValidationStatus(ValidationStatus.Invalid, 'Error fetching catalog details');
                }
            }
        } catch (error) {
            logger.error(`Error during tooltip update for catalog ID: ${catalogId}`, error);
            const errorMessage = error instanceof Error ? error.message : 'Error validating';
            this.tooltip = `Catalog ID: ${catalogId}\nStatus: Error - ${errorMessage}`;
            this.updateValidationStatus(ValidationStatus.Invalid, errorMessage);
        } finally {
            this.isUpdatingTooltip = false;
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
            const size =
                typeof this.value === 'object' && this.value ? Object.keys(this.value).length : 0;
            return `Object{${size}}`;
        }

        return '';
    }

    /**
     * Gets the appropriate icon
     */
    private getIconPath(): vscode.ThemeIcon {
        // For catalog_id fields, always use validation icon
        if (this.label === 'catalog_id') {
            return this.getValidationIcon();
        }

        // For other fields, use type-based icon
        return this.getTypeIcon();
    }

    /**
     * Gets the validation status icon
     */
    private getValidationIcon(): vscode.ThemeIcon {
        const logger = LoggingService.getInstance();

        logger.debug(`Getting validation icon for ${this.label}`, {
            status: this.getStatusString(this._validationMetadata.status),
            path: this.jsonPath,
        });

        switch (this._validationMetadata.status) {
            case ValidationStatus.Valid:
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            case ValidationStatus.Invalid:
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case ValidationStatus.Validating:
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.foreground'));
            case ValidationStatus.LoginRequired:
                return new vscode.ThemeIcon(
                    'key',
                    new vscode.ThemeColor('notificationsInfoIcon.foreground')
                );
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
                return new vscode.ThemeIcon(
                    'list-ordered',
                    new vscode.ThemeColor('ibmCatalog.arrayColor')
                );
            case 'container':
                return new vscode.ThemeIcon('json', new vscode.ThemeColor('ibmCatalog.objectColor'));
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
                return new vscode.ThemeIcon(
                    'symbol-boolean',
                    new vscode.ThemeColor('ibmCatalog.booleanColor')
                );
            case 'number':
                return new vscode.ThemeIcon(
                    'symbol-number',
                    new vscode.ThemeColor('ibmCatalog.numberColor')
                );
            case 'string':
                return new vscode.ThemeIcon(
                    'symbol-string',
                    new vscode.ThemeColor('ibmCatalog.stringColor')
                );
            case 'object':
                return new vscode.ThemeIcon(
                    'symbol-object',
                    new vscode.ThemeColor('ibmCatalog.objectColor')
                );
            case 'undefined':
                return new vscode.ThemeIcon(
                    'symbol-null',
                    new vscode.ThemeColor('ibmCatalog.nullColor')
                );
            case 'symbol':
                return new vscode.ThemeIcon(
                    'symbol-enum',
                    new vscode.ThemeColor('ibmCatalog.enumColor')
                );
            default:
                return new vscode.ThemeIcon(
                    'symbol-string',
                    new vscode.ThemeColor('ibmCatalog.stringColor')
                );
        }
    }

    /**
     * Gets the type of the value
     */
    private getValueType(): string {
        if (this.value === null) { return 'null'; }
        if (Array.isArray(this.value)) { return 'array'; }
        return typeof this.value;
    }


    /**
     * Formats a value for display
     */
    private formatValue(value: unknown): string {
        if (value === null) { return 'null'; }
        if (value === undefined) { return 'undefined'; }
        if (typeof value === 'string') {
            return value.length > 50 ? `${value.substring(0, 47)}...` : value;
        }
        return String(value);
    }
}


