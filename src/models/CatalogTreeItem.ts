// src/models/CatalogTreeItem.ts
import * as vscode from 'vscode';
import { IBMCloudService } from '../services/IBMCloudService';
import { AuthService } from '../services/AuthService';
import { LoggingService } from '../services/LoggingService';

/**
 * Represents the various states a validation process can be in.
 * - Unknown: Initial state, no validation needed or not started
 * - Pending: Validation needed and queued for processing
 * - Validating: Currently being validated
 * - Valid: Validation passed successfully
 * - Invalid: Validation failed
 * - LoginRequired: Authentication needed before validation
 */
export enum ValidationStatus {
    Unknown = 'unknown',
    Pending = 'pending',
    Validating = 'validating',
    Valid = 'valid',
    Invalid = 'invalid',
    LoginRequired = 'loginRequired',
}

/**
 * Metadata about a tree item's validation state
 */
export interface ValidationMetadata {
    status: ValidationStatus;
    message?: string;
    lastChecked?: Date;
    details?: Record<string, unknown>;
}

/**
 * Metadata about a tree item's schema definition
 */
export interface SchemaMetadata {
    readonly type: string;
    readonly required: boolean;
    readonly enum?: unknown[];
    readonly description?: string;
}

/**
 * Represents a node in the IBM Catalog JSON tree view with background validation support.
 * Handles the display, validation, and state management of individual tree nodes.
 */
export class CatalogTreeItem extends vscode.TreeItem {
    private readonly _validationMetadata: ValidationMetadata;
    private readonly _schemaMetadata?: SchemaMetadata;
    private readonly context: vscode.ExtensionContext;
    private readonly logger: LoggingService;
    private isUpdatingTooltip: boolean = false;

    // Queue management properties
    private static validationQueue: Set<CatalogTreeItem> = new Set();
    private static isProcessingQueue: boolean = false;
    private static queueProcessor?: NodeJS.Timeout;
    private static readonly QUEUE_PROCESS_DELAY = 100; // ms between validations

    public readonly parent?: CatalogTreeItem;
    public readonly catalogId?: string;

    constructor(
        context: vscode.ExtensionContext,
        public readonly label: string,
        public readonly value: unknown,
        public readonly jsonPath: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        schemaMetadata?: SchemaMetadata,
        parent?: CatalogTreeItem,
        catalogId?: string,
        initialStatus: ValidationStatus = ValidationStatus.Unknown
    ) {
        super(label, collapsibleState);

        this.context = context;
        this.logger = LoggingService.getInstance();
        this._schemaMetadata = schemaMetadata;
        this.parent = parent;
        this.catalogId = catalogId;

        // Initialize validation metadata with provided status
        this._validationMetadata = { status: initialStatus };

        this.updateDisplayProperties();

        // Queue validation if needed
        if (this.needsValidation()) {
            void this.queueForValidation();
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
     * Creates a new instance with an updated collapsible state while preserving other properties
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
            this.parent,
            this.catalogId,
            this._validationMetadata.status
        );
    }
    /**
     * Gets the parent dependency node that contains this item
     * @returns The dependency node or undefined if not in a dependency
     */
    public getDependencyParent(): CatalogTreeItem | undefined {
        let current: CatalogTreeItem | undefined = this;
        const dependencyPattern = /\.dependencies\[\d+\]$/;

        while (current && !dependencyPattern.test(current.jsonPath)) {
            current = current.parent;
        }

        return current;
    }

    /**
     * Gets the dependency context for this node
     * @returns Object containing catalogId and offeringId if available
     */
    public getDependencyContext(): { catalogId?: string; offeringId?: string } {
        const dependencyNode = this.getDependencyParent();
        if (!dependencyNode || typeof dependencyNode.value !== 'object' || !dependencyNode.value) {
            return {};
        }

        const value = dependencyNode.value as Record<string, unknown>;
        return {
            catalogId: typeof value.catalog_id === 'string' ? value.catalog_id : undefined,
            offeringId: typeof value.id === 'string' ? value.id : undefined
        };
    }
    /**
     * Updates the item's display properties based on current state.
     * This includes tooltip, description, icon, and edit command if applicable.
     */
    private updateDisplayProperties(): void {
        this.tooltip = this.createTooltip();
        this.description = this.createDescription();
        this.iconPath = this.getIconPath();

        if (this.isEditable()) {
            this.command = {
                command: 'ibmCatalog.editElement',
                title: 'Edit Value',
                arguments: [this],
            };
        }
    }

    /**
 * Checks if this item represents a flavor within a dependency structure
 */
    public isDependencyFlavor(): boolean {
        const flavorPattern = /\$\.products\[\d+\]\.flavors\[\d+\]\.dependencies\[\d+\]\.flavors\[\d+\]$/;
        return flavorPattern.test(this.jsonPath);
    }

    /**
     * Validates a dependency flavor against its offering
     */
    private async validateDependencyFlavor(): Promise<void> {
        try {
            const dependencyNode = this.parent?.parent; // Navigate up to the dependency node
            if (!dependencyNode) {
                return;
            }

            const catalogId = (dependencyNode.value as Record<string, any>)['catalog_id'];
            const offeringId = (dependencyNode.value as Record<string, any>)['id'];

            if (!catalogId || !offeringId || typeof this.value !== 'string') {
                return;
            }

            const apiKey = await AuthService.getApiKey(this.context);
            if (!apiKey) {
                this.updateValidationStatus(ValidationStatus.LoginRequired);
                return;
            }

            const ibmCloudService = new IBMCloudService(apiKey);
            const isValid = await ibmCloudService.validateFlavor(catalogId, offeringId, this.value);

            this.updateValidationStatus(
                isValid ? ValidationStatus.Valid : ValidationStatus.Invalid,
                isValid ? undefined : 'Invalid flavor for this offering'
            );

        } catch (error) {
            this.logger.error('Failed to validate dependency flavor', error);
            this.updateValidationStatus(ValidationStatus.Invalid, 'Failed to validate flavor');
        }
    }

    /**
     * Checks if this item represents a flavor within a dependency
     */
    public isFlavorInDependency(): boolean {
        // Updated pattern to match individual flavor items in a dependency
        const flavorPattern = /\.dependencies\[\d+\]\.flavors\[\d+\]$/;
        return flavorPattern.test(this.jsonPath);
    }
    /**
     * Queues this item for background validation if needed.
     * Starts the validation processor if not already running.
     */
    public queueForValidation(): void {
        if (this._validationMetadata.status === ValidationStatus.Pending) {
            CatalogTreeItem.validationQueue.add(this);
            this.startQueueProcessor();
        }
    }

    /**
     * Starts the background validation processor if not already running.
     * The processor checks the queue periodically for items needing validation.
     */
    private startQueueProcessor(): void {
        if (!CatalogTreeItem.queueProcessor) {
            CatalogTreeItem.queueProcessor = setInterval(() => {
                void CatalogTreeItem.processValidationQueue();
            }, CatalogTreeItem.QUEUE_PROCESS_DELAY);
        }
    }


    /**
     * Process validation queue safely
     */
    private static async processValidationQueue(): Promise<void> {
        if (this.isProcessingQueue || this.validationQueue.size === 0) {
            if (this.queueProcessor && this.validationQueue.size === 0) {
                clearInterval(this.queueProcessor);
                this.queueProcessor = undefined;
            }
            return;
        }

        this.isProcessingQueue = true;
        const logger = LoggingService.getInstance();

        try {
            const nextItem = this.validationQueue.values().next().value;
            if (nextItem) {
                logger.debug(`Processing validation for ${nextItem.jsonPath}`);
                await nextItem.validateItem();
                this.validationQueue.delete(nextItem);
            }
        } catch (error) {
            logger.error('Error processing validation', error);
        } finally {
            this.isProcessingQueue = false;
        }
    }
    /**
         * Performs the actual validation of the item.
         * For catalog_ids, validates against IBM Cloud.
         * For offering IDs within dependencies, validates against the parent catalog.
         */
    public async validateItem(): Promise<void> {
        const logger = LoggingService.getInstance();
        this.updateValidationStatus(ValidationStatus.Validating);

        try {
            const apiKey = await AuthService.getApiKey(this.context);
            if (!apiKey) {
                this.updateValidationStatus(ValidationStatus.LoginRequired);
                return;
            }

            const ibmCloudService = new IBMCloudService(apiKey);

            if (this.label === 'catalog_id' && typeof this.value === 'string') {
                await this.validateCatalogId(ibmCloudService);
            } else if (this.isOfferingIdInDependency() && typeof this.value === 'string') {
                await this.validateOfferingId(ibmCloudService);
            }
        } catch (error) {
            logger.error('Validation error', error);
            this.updateValidationStatus(ValidationStatus.Invalid, 'Validation error occurred');
        }
    }

    /**
     * Validates a catalog ID against IBM Cloud
     * @param ibmCloudService The IBM Cloud service instance to use
     */
    private async validateCatalogId(ibmCloudService: IBMCloudService): Promise<void> {
        try {
            const isValid = await ibmCloudService.validateCatalogId(this.value as string);
            this.updateValidationStatus(
                isValid ? ValidationStatus.Valid : ValidationStatus.Invalid,
                isValid ? undefined : 'Invalid catalog ID'
            );
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('not found in account')) {
                    this.updateValidationStatus(ValidationStatus.Invalid, 'Catalog ID not found');
                } else {
                    this.logger.error('Catalog validation error', error);
                    this.updateValidationStatus(ValidationStatus.Invalid, 'Validation error occurred');
                }
            }
        }
    }

    /**
     * Validates an offering ID within a dependency against its parent catalog
     * @param ibmCloudService The IBM Cloud service instance to use
     */
    private async validateOfferingId(ibmCloudService: IBMCloudService): Promise<void> {
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
                const isValid = await ibmCloudService.validateOfferingId(catalogId, this.value as string);
                this.updateValidationStatus(
                    isValid ? ValidationStatus.Valid : ValidationStatus.Invalid,
                    isValid ? undefined : 'Invalid offering ID for this catalog'
                );
            } catch (offeringError) {
                if (offeringError instanceof Error && offeringError.message.includes('not found')) {
                    this.updateValidationStatus(ValidationStatus.Invalid, 'Invalid offering ID');
                } else {
                    this.logger.error('Offering validation error', offeringError);
                    this.updateValidationStatus(ValidationStatus.Invalid, 'Validation error occurred');
                }
            }
        } catch (error) {
            this.logger.error('Dependency validation error', error);
            this.updateValidationStatus(ValidationStatus.Invalid, 'Validation error occurred');
        }
    }

    /**
     * Updates the item's validation status and refreshes the UI
     * @param status The new validation status
     * @param message Optional message describing the status
     */
    public updateValidationStatus(status: ValidationStatus, message?: string): void {
        const logger = LoggingService.getInstance();

        logger.debug(`Updating validation status for ${this.label}`, {
            oldStatus: this._validationMetadata.status.toString(),
            newStatus: status.toString(),
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

        // Update the UI elements
        this.updateDisplayProperties();
    }

    /**
     * Creates a tooltip for the item including validation status and item details
     */
    private createTooltip(): string {
        const parts: string[] = [`Path: ${this.jsonPath}`, `Type: ${this.getValueType()}`];

        if (this._schemaMetadata?.description) {
            parts.push(`Description: ${this._schemaMetadata.description}`);
        }

        // Add catalog specific information
        if (this.label === 'catalog_id' && typeof this.value === 'string' && !this.isUpdatingTooltip) {
            this.logger.debug(`Initializing tooltip update for catalog_id: ${this.value}`);
            void this.updateTooltipWithOfferingDetails(this.value);
            parts.push('Loading catalog details...');
        } else if (this.isOfferingIdInDependency() && typeof this.value === 'string' && !this.isUpdatingTooltip) {
            if (!this.catalogId) {
                parts.push('Cannot determine catalog_id for offering validation.');
            } else {
                this.logger.debug(`Initializing tooltip update for offering ID: ${this.value}`);
                void this.updateTooltipWithOfferingDetails(this.catalogId, this.value);
                parts.push('Loading offering details...');
            }
        } else if (this.isEditable()) {
            parts.push(`Value: ${this.formatValue(this.value)}`);
        }

        // Add validation status
        parts.push(this.getValidationMessage());

        return parts.join('\n');
    }

    /**
     * Creates the status message for the current validation state
     */
    private getValidationMessage(): string {
        const { status, message, lastChecked } = this._validationMetadata;
        const timestamp = lastChecked ? ` (Last checked: ${lastChecked.toLocaleTimeString()})` : '';

        switch (status) {
            case ValidationStatus.Valid:
                return `✓ Valid${timestamp}`;
            case ValidationStatus.Invalid:
                return `✗ Invalid${message ? `: ${message}` : ''}${timestamp}`;
            case ValidationStatus.Validating:
                return '⟳ Validating...';
            case ValidationStatus.Pending:
                return '⏱ Queued for validation...';
            case ValidationStatus.LoginRequired:
                return '🔑 Login required for validation';
            default:
                return '';
        }
    }

    /**
     * Gets the appropriate icon based on the item's type and validation status
     */
    private getIconPath(): vscode.ThemeIcon {
        // For validatable fields, use validation status icon
        if (this.needsValidation()) {
            return this.getValidationIcon();
        }

        // For other fields, use type-based icon
        return this.getTypeIcon();
    }

    /**
     * Gets the validation status icon
     */
    private getValidationIcon(): vscode.ThemeIcon {
        switch (this._validationMetadata.status) {
            case ValidationStatus.Valid:
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            case ValidationStatus.Invalid:
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case ValidationStatus.Validating:
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.foreground'));
            case ValidationStatus.Pending:
                return new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.yellow'));
            case ValidationStatus.LoginRequired:
                return new vscode.ThemeIcon('key', new vscode.ThemeColor('notificationsInfoIcon.foreground'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    /**
     * Gets an icon based on the item's type
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
     * Gets an icon based on the value's type (string, number, boolean, etc.)
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
 * Checks if this item needs validation
 */
    public needsValidation(): boolean {
        return this.label === 'catalog_id' ||
            this.isOfferingIdInDependency() ||
            this.isDependencyFlavor();
    }

    /**
     * Gets the type of the value for display purposes
     */
    private getValueType(): string {
        if (this.value === null) { return 'null'; }
        if (Array.isArray(this.value)) { return 'array'; }
        return typeof this.value;
    }

    /**
     * Updates validation status in logs using enum values
     */
    private logValidationUpdate(status: ValidationStatus, message?: string): void {
        this.logger.debug(`Updating validation status for ${this.label}`, {
            oldStatus: this._validationMetadata.status.toString(),
            newStatus: status.toString(),
            message,
            path: this.jsonPath,
        });
    }

    /**
     * Creates a description string for the tree item
     */
    private createDescription(): string {
        if (this.isEditable()) {
            return this.formatValue(this.value);
        }

        if (Array.isArray(this.value)) {
            return `Array[${this.value.length}]`;
        }

        if (typeof this.value === 'object' && this.value !== null) {
            return `Object{${Object.keys(this.value).length}}`;
        }

        return '';
    }

    /**
     * Formats a value for display, truncating long strings
     * @param value The value to format
     * @returns Formatted string representation of the value
     */
    private formatValue(value: unknown): string {
        if (value === null) { return 'null'; }
        if (value === undefined) { return 'undefined'; }
        if (typeof value === 'string') {
            return value.length > 50 ? `${value.substring(0, 47)}...` : value;
        }
        return String(value);
    }

    /**
     * Updates the tooltip with offering details from IBM Cloud
     * @param catalogId The catalog ID
     * @param offeringId Optional offering ID for dependency validation
     */
    private async updateTooltipWithOfferingDetails(catalogId: string, offeringId?: string): Promise<void> {
        if (this.isUpdatingTooltip) {
            this.logger.debug(`Skipping tooltip update - already in progress for ${catalogId}`);
            return;
        }

        this.isUpdatingTooltip = true;
        this.logger.debug(`Starting tooltip update for catalog ID: ${catalogId}${offeringId ? `, offering: ${offeringId}` : ''}`);

        try {
            const apiKey = await AuthService.getApiKey(this.context);
            if (!apiKey) {
                this.updateValidationStatus(ValidationStatus.LoginRequired);
                this.tooltip = 'Login required to load details.';
                return;
            }

            const ibmCloudService = new IBMCloudService(apiKey);

            if (offeringId) {
                await this.updateOfferingTooltip(ibmCloudService, catalogId, offeringId);
            } else {
                await this.updateCatalogTooltip(ibmCloudService, catalogId);
            }
        } catch (error) {
            this.logger.error(`Error updating tooltip for catalog ID: ${catalogId}`, error);
            this.tooltip = `Error loading details: ${error instanceof Error ? error.message : 'Unknown error'}`;
        } finally {
            this.isUpdatingTooltip = false;
        }
    }

    /**
     * Updates tooltip with catalog details
     */
    private async updateCatalogTooltip(ibmCloudService: IBMCloudService, catalogId: string): Promise<void> {
        try {
            const details = await ibmCloudService.getOfferingDetails(catalogId);
            this.tooltip = `Catalog: ${details.label}\nID: ${catalogId}`;
            this.updateValidationStatus(ValidationStatus.Valid);
        } catch (error) {
            this.logger.error('Failed to fetch catalog details', error);
            this.updateValidationStatus(ValidationStatus.Invalid, 'Error fetching catalog details');
        }
    }

    /**
     * Updates tooltip with offering details
     */
    private async updateOfferingTooltip(ibmCloudService: IBMCloudService, catalogId: string, offeringId: string): Promise<void> {
        try {
            const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);
            const offering = offerings.find(o => o.id === offeringId);

            if (offering) {
                this.tooltip = `Offering: ${offering.name}\nID: ${offeringId}\nCatalog: ${catalogId}`;
                this.updateValidationStatus(ValidationStatus.Valid);
            } else {
                this.tooltip = `Offering ID: ${offeringId}\nStatus: Not found in catalog ${catalogId}`;
                this.updateValidationStatus(ValidationStatus.Invalid, 'Invalid offering ID for this catalog');
            }
        } catch (error) {
            this.logger.error('Failed to fetch offering details', error);
            this.updateValidationStatus(ValidationStatus.Invalid, 'Error fetching offering details');
        }
    }

    /**
     * Checks if this item represents a field that needs validation
     */
    public isValidatable(): boolean {
        return this.label === 'catalog_id' || this.isOfferingIdInDependency();
    }

    /**
     * Checks if this item represents an offering ID within a dependency structure
     */
    public isOfferingIdInDependency(): boolean {
        const dependencyIdPattern = /\$\.products\[\d+\]\.flavors\[\d+\]\.dependencies\[\d+\]\.id$/;
        return dependencyIdPattern.test(this.jsonPath) && this.label === 'id';
    }

    /**
     * Checks if this item is editable in the tree view
     */
    public isEditable(): boolean {
        return this.contextValue === 'editable';
    }

    /**
     * Retrieves the associated catalog_id by traversing up the tree
     */
    private async findAssociatedCatalogId(): Promise<string | undefined> {
        if (this.label === 'catalog_id' && typeof this.value === 'string') {
            return this.value;
        }

        let currentNode: CatalogTreeItem | undefined = this;
        while (currentNode) {
            if (currentNode.value && typeof currentNode.value === 'object') {
                const values = currentNode.value as Record<string, unknown>;
                const catalogId = values.catalog_id;
                if (typeof catalogId === 'string') {
                    this.logger.debug('Found catalog_id in parent node', {
                        catalogId,
                        path: currentNode.jsonPath
                    });
                    return catalogId;
                }
            }
            currentNode = currentNode.parent;
        }

        this.logger.debug('No catalog_id found in parent nodes', {
            currentPath: this.jsonPath
        });
        return undefined;
    }
}