// src/services/CatalogService.ts
import * as vscode from 'vscode';
import { CatalogTreeItem } from '../models/CatalogTreeItem';
import { AddElementDialog } from '../ui/AddElementDialog';
import { IBMCloudService } from './IBMCloudService';
import { SchemaService } from './SchemaService';
import { AuthService } from './AuthService';
import { LoggingService } from './core/LoggingService';
import { FileSystemService } from './core/FileSystemService';
import { InputMappingService } from './InputMappingService';
import { PromptService } from './core/PromptService';
import type { Configuration, OfferingFlavor } from '../types/ibmCloud';
import type { ICatalogFileInfo, MappingOption } from '../types/catalog';
import { QuickPickItemEx } from '../types/prompt';
import { LookupItem } from '../types/cache';
import { CachePrefetchService } from './core/CachePrefetchService';
import { JsonPathService } from './core/JsonPathService';

/**
 * Service responsible for managing catalog data within the extension.
 * Provides methods to interact with the catalog file, prompt for user input,
 * and update catalog elements.
 */
export class CatalogService {
    private _onDidChangeContent = new vscode.EventEmitter<void>();
    public readonly onDidChangeContent = this._onDidChangeContent.event;
    private logger = LoggingService.getInstance();
    private readonly fileSystemService: FileSystemService;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.logger.debug('Constructing CatalogService');
        this.fileSystemService = FileSystemService.getInstance(context);

        this.fileSystemService.onDidChangeContent(() => {
            this._onDidChangeContent.fire();
        });
    }

    /**
     * Retrieves the file system path of the current catalog file.
     * @returns The file path as a string, or undefined if not initialized.
     */
    public getCatalogFilePath(): string | undefined {
        const currentFile = this.fileSystemService.getCurrentCatalogFile();
        return currentFile?.uri.fsPath;
    }

    /**
     * Retrieves the catalog data from the file system.
     * @returns A promise that resolves with the catalog data.
     */
    public async getCatalogData(): Promise<unknown> {
        await this.ensureInitialized();
        return this.fileSystemService.getCatalogData();
    }

    /**
     * Retrieves the display path of the catalog file.
     * @returns The display path as a string.
     */
    public getCatalogDisplayPath(): string {
        return this.fileSystemService.getCatalogDisplayPath();
    }

    /**
     * Retrieves the current catalog file information.
     * @returns An object containing catalog file information, or undefined if not initialized.
     */
    public getCurrentCatalogFile(): ICatalogFileInfo | undefined {
        return this.fileSystemService.getCurrentCatalogFile();
    }

    /**
     * Checks if the catalog service has been initialized.
     * @returns True if initialized, false otherwise.
     */
    public isInitialized(): boolean {
        return this.fileSystemService.isInitialized();
    }

    /**
     * Initializes the catalog service by loading the catalog file.
     * @returns A promise that resolves to true if initialized successfully.
     */
    public async initialize(): Promise<boolean> {
        this.logger.debug('Initializing CatalogService');
        try {
            const initialized = await this.fileSystemService.initialize();
            await this.queueBackgroundLookups();
            if (initialized) {
                this.logger.debug('CatalogService initialized successfully');
            } else {
                this.logger.debug('CatalogService initialization failed - no catalog file found');
            }
            return initialized;
        } catch (error) {
            this.logger.error('Failed to initialize CatalogService', error);
            return false;
        }
    }

    /**
     * Ensures that the catalog service is initialized.
     * @throws An error if initialization fails.
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.fileSystemService.isInitialized()) {
            const success = await this.initialize();
            if (!success) {
                throw new Error('Catalog file not initialized');
            }
        }
    }

    /**
     * Updates a value in the catalog JSON data at the specified JSON path.
     * @param jsonPath The JSON path where the value should be updated.
     * @param newValue The new value to set.
     */
    public async updateJsonValue(jsonPath: string, newValue: unknown): Promise<void> {
        await this.ensureInitialized();
        await this.fileSystemService.updateJsonValue(jsonPath, newValue);
    }

    /**
     * Adds a new element to the catalog at the specified parent node.
     * @param parentNode The parent node where the element should be added.
     * @param schemaService The schema service for validation.
     */
    public async addElement(parentNode: CatalogTreeItem, schemaService: SchemaService): Promise<void> {
        await this.ensureInitialized();

        try {
            // Handle input_mapping additions
            if (parentNode.jsonPath.endsWith('.input_mapping')) {
                await this.handleInputMappingAddition(parentNode);
                return;
            }

            // Get schema validation before proceeding
            if (!schemaService.isSchemaAvailable()) {
                const result = await vscode.window.showErrorMessage(
                    'Schema is not available. Would you like to retry loading the schema?',
                    'Retry',
                    'Cancel'
                );

                if (result === 'Retry') {
                    await schemaService.refreshSchema();
                } else {
                    return;
                }
            }

            const schema = schemaService.getSchemaForPath(parentNode.jsonPath);
            if (!schema) {
                this.logger.error('No schema available for path', { path: parentNode.jsonPath });
                vscode.window.showErrorMessage('Cannot add element: No schema available for this location');
                return;
            }

            // Show dialog and get new element data
            const newElement = await AddElementDialog.show(parentNode, schemaService);
            if (newElement === undefined) {
                return; // User cancelled
            }

            // Handle array and object additions
            if (Array.isArray(parentNode.value)) {
                const currentArray = parentNode.value;
                await this.updateJsonValue(parentNode.jsonPath, [...currentArray, newElement]);
            } else if (typeof parentNode.value === 'object' && parentNode.value !== null) {
                const currentObject = parentNode.value as Record<string, unknown>;
                await this.updateJsonValue(parentNode.jsonPath, {
                    ...currentObject,
                    ...newElement
                });
            } else {
                throw new Error('Cannot add element to this location');
            }

        } catch (error) {
            this.logger.error('Failed to add element', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to add element: ${message}`);
            throw error;
        }
    }

    /**
     * Edits an existing element in the catalog.
     * @param node The catalog tree item representing the element to edit.
     */
    public async editElement(node: CatalogTreeItem): Promise<void> {
        await this.ensureInitialized();

        try {
            const newValue = await this.promptForValue(node, node.value);
            if (newValue === undefined) {
                return; // User cancelled
            }

            await this.updateJsonValue(node.jsonPath, newValue);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to edit element: ${message}`);
            throw error;
        }
    }

    /**
     * Reloads the catalog data from disk.
     */
    public async reloadCatalogData(): Promise<void> {
        this.logger.debug('Reloading catalog data');

        try {
            await this.ensureInitialized();
            await this.fileSystemService.reloadCatalogData();
            await this.queueBackgroundLookups();
            this._onDidChangeContent.fire();
        } catch (error) {
            this.logger.error('Failed to reload catalog data', error);
            throw new Error(`Failed to update catalog view: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handles the addition of a new input mapping.
     * @param parentNode The parent node representing the input mapping array.
     */
    private async handleInputMappingAddition(parentNode: CatalogTreeItem): Promise<void> {
        const mappingType = await this.promptForMappingType();
        if (!mappingType) {
            return; // User cancelled
        }

        const newMapping = {
            [mappingType]: "",
            "version_input": ""
        };

        const currentArray = (parentNode.value as any[]) || [];
        await this.updateJsonValue(parentNode.jsonPath, [...currentArray, newMapping]);
    }

    /**
     * Prompts the user to select a mapping type for input mapping addition.
     * @returns The selected mapping type, or undefined if cancelled.
     */
    private async promptForMappingType(): Promise<string | undefined> {
        this.logger.debug('Prompting for mapping type');
        const items: QuickPickItemEx<string>[] = [
            {
                label: "Dependency Input",
                description: "Map an input from this dependency",
                detail: "Creates a mapping with dependency_input field",
                value: "dependency_input"
            },
            {
                label: "Dependency Output",
                description: "Map an output from this dependency",
                detail: "Creates a mapping with dependency_output field",
                value: "dependency_output"
            },
            {
                label: "Value",
                description: "Set a static value",
                detail: "Creates a mapping with value field",
                value: "value"
            }
        ];

        const result = await PromptService.showQuickPick<string>({
            title: 'Select Input Mapping Type',
            placeholder: 'Choose the type of mapping to add',
            items: items,
            matchOnDescription: true,
            matchOnDetail: true
        });

        return result;
    }

    /**
     * Prompts the user for a new value for a given node.
     * Handles different types of nodes and delegates to specific prompt methods.
     * @param node The catalog tree item to update.
     * @param currentValue The current value of the node.
     * @returns The new value, or undefined if cancelled.
     */
    private async promptForValue(node: CatalogTreeItem, currentValue?: unknown): Promise<unknown> {
        this.logger.debug('Prompting for value', {
            node: node.jsonPath,
            currentValue
        });

        await this.ensureInitialized();

        if (node.label === 'catalog_id') {
            return this.promptForCatalogId(currentValue as string);
        }

        if (node.isOfferingIdInDependency()) {
            return this.promptForOfferingId(node, currentValue as string);
        }

        if (this.isFlavorSelection(node)) {
            return this.promptForFlavor(node, currentValue as string);
        }

        if (typeof currentValue === 'boolean' || node.schemaMetadata?.type === 'boolean') {
            return this.promptForBoolean(node.label, currentValue as boolean);
        }

        if (node.isInputMappingField()) {
            return this.promptForInputMapping(node, currentValue);
        }

        const value = await PromptService.showInputBox<string>({
            title: `Enter value for ${node.label}`,
            initialValue: currentValue?.toString() ?? '',
            validate: (value) => {
                if (!value.trim()) {
                    return 'Value cannot be empty';
                }
                return null;
            }
        });

        if (value === undefined) {
            return undefined;
        }

        // Parse value to appropriate type
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        if (!isNaN(Number(value))) return Number(value);
        return value;
    }

    /**
     * Prompts the user to select a boolean value.
     * @param fieldLabel The label of the field being edited.
     * @param currentValue The current boolean value.
     * @returns The selected boolean value, or undefined if cancelled.
     */
    private async promptForBoolean(fieldLabel: string, currentValue?: boolean): Promise<boolean | undefined> {
        this.logger.debug('Showing boolean pick', {
            fieldLabel,
            currentValue
        });

        return PromptService.showBooleanPick({
            title: `Set value for ${fieldLabel}`,
            placeholder: 'Select true or false',
            currentValue,
            trueLabel: 'true',
            falseLabel: 'false'
        });
    }

    /**
     * Prompts the user to select a catalog ID, fetching available catalogs if possible.
     * @param currentValue The current catalog ID.
     * @returns The selected or entered catalog ID, or undefined if cancelled.
     */
    private async promptForCatalogId(currentValue?: string): Promise<string | undefined> {
        this.logger.debug('Prompting for catalog ID', {
            currentValue
        });

        const apiKey = await AuthService.getApiKey(this.context);
        if (!apiKey) {
            this.logger.debug('No API key available for catalog lookup');
            return this.promptForManualCatalogId(currentValue);
        }

        try {
            const ibmCloudService = new IBMCloudService(apiKey);
            const catalogs = await ibmCloudService.getAvailableCatalogs();

            const publicCatalogs = catalogs.filter(catalog => catalog.isPublic);
            const privateCatalogs = catalogs.filter(catalog => !catalog.isPublic);

            const items: QuickPickItemEx<string>[] = [
                {
                    label: "Public Catalogs",
                    kind: vscode.QuickPickItemKind.Separator
                } as QuickPickItemEx<string>,
                ...publicCatalogs.map(catalog => ({
                    label: `${catalog.id === currentValue ? '$(check) ' : ''}${catalog.label}`,
                    description: catalog.id,
                    detail: catalog.shortDescription,
                    value: catalog.id
                })),
                {
                    label: "Private Catalogs",
                    kind: vscode.QuickPickItemKind.Separator
                } as QuickPickItemEx<string>,
                ...privateCatalogs.map(catalog => ({
                    label: `${catalog.id === currentValue ? '$(check) ' : ''}${catalog.label}`,
                    description: catalog.id,
                    detail: catalog.shortDescription,
                    value: catalog.id
                }))
            ];

            const result = await PromptService.showQuickPickWithCustom<string>({
                title: 'Select Catalog',
                placeholder: currentValue || 'Select a catalog or enter a custom ID',
                items: items,
                matchOnDescription: true,
                matchOnDetail: true,
                customOptionLabel: '$(edit) Enter Custom Catalog ID',
                customOptionHandler: async () => {
                    return await this.promptForManualCatalogId(currentValue);
                }
            });

            return result;

        } catch (error) {
            this.logger.error('Failed to fetch catalogs', error);
            return this.promptForManualCatalogId(currentValue);
        }
    }

    /**
     * Prompts the user to manually enter a catalog ID.
     * @param currentValue The current catalog ID.
     * @returns The entered catalog ID, or undefined if cancelled.
     */
    private async promptForManualCatalogId(currentValue?: string): Promise<string | undefined> {
        return PromptService.showInputBox<string>({
            title: 'Enter the catalog ID',
            initialValue: currentValue,
            validate: (value) => {
                if (!value.trim()) {
                    return 'Catalog ID cannot be empty';
                }
                return null;
            }
        });
    }

    /**
     * Prompts the user to select an offering ID, fetching available offerings if possible.
     * @param node The catalog tree item associated with the offering.
     * @param currentValue The current offering ID.
     * @returns The selected or entered offering ID, or undefined if cancelled.
     */
    private async promptForOfferingId(node: CatalogTreeItem, currentValue?: string): Promise<string | undefined> {
        this.logger.debug('Prompting for offering ID', {
            currentValue
        });

        const apiKey = await AuthService.getApiKey(this.context);
        if (!apiKey) {
            this.logger.debug('No API key available for offering lookup');
            return this.promptForManualOfferingId(currentValue);
        }

        const catalogId = await this.getCatalogIdForNode(node);
        if (!catalogId) {
            vscode.window.showErrorMessage('Cannot determine catalog_id for offering validation.');
            return undefined;
        }

        try {
            const ibmCloudService = new IBMCloudService(apiKey);
            const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);

            // Verify offerings is an array and has content
            if (!Array.isArray(offerings) || offerings.length === 0) {
                this.logger.debug('No offerings found or invalid offerings data', {
                    isArray: Array.isArray(offerings),
                    length: Array.isArray(offerings) ? offerings.length : 0
                });
                return this.promptForManualOfferingId(currentValue);
            }

            const items: QuickPickItemEx<string>[] = [
                {
                    label: "Available Offerings",
                    kind: vscode.QuickPickItemKind.Separator
                } as QuickPickItemEx<string>
            ];

            // Safe mapping of offerings with null checks
            const offeringItems = offerings
                .filter(offering => offering && offering.id) // Filter out invalid offerings
                .map(offering => ({
                    label: `${offering.id === currentValue ? '$(check) ' : ''}${offering.name || offering.id}`,
                    description: offering.id,
                    detail: offering.shortDescription || '',
                    value: offering.id
                }));

            items.push(...offeringItems);

            const result = await PromptService.showQuickPickWithCustom<string>({
                title: 'Select Offering',
                placeholder: currentValue || 'Select an offering or enter a custom ID',
                items: items,
                matchOnDescription: true,
                matchOnDetail: true,
                customOptionLabel: '$(edit) Enter Custom Offering ID',
                customOptionHandler: async () => {
                    const customId = await this.promptForManualOfferingId(currentValue);
                    if (customId) {
                        await this.updateDependencyName(node, customId);
                    }
                    return customId;
                }
            });

            if (result && result !== currentValue) {
                await this.updateDependencyName(node, result);
            }

            return result;

        } catch (error) {
            this.logger.error('Failed to fetch offerings', error);
            const manualId = await this.promptForManualOfferingId(currentValue);
            if (manualId) {
                await this.updateDependencyName(node, manualId);
            }
            return manualId;
        }
    }

    /**
     * Prompts the user to manually enter an offering ID.
     * @param currentValue The current offering ID.
     * @returns The entered offering ID, or undefined if cancelled.
     */
    private async promptForManualOfferingId(currentValue?: string): Promise<string | undefined> {
        return PromptService.showInputBox<string>({
            title: 'Enter the offering ID',
            initialValue: currentValue,
            validate: (value) => {
                if (!value.trim()) {
                    return 'Offering ID cannot be empty';
                }
                return null;
            }
        });
    }

    /**
     * Prompts the user to select a flavor, fetching available flavors if possible.
     * @param node The catalog tree item associated with the flavor.
     * @param currentValue The current flavor name.
     * @returns The selected or entered flavor name, or undefined if cancelled.
     */
    private async promptForFlavor(node: CatalogTreeItem, currentValue?: string): Promise<string | undefined> {
        const logger = this.logger;
        logger.debug('Prompting for flavor', {
            currentValue
        });

        const apiKey = await AuthService.getApiKey(this.context);
        if (!apiKey) {
            logger.debug('No API key available for flavor lookup');
            return this.promptForManualFlavorInput(currentValue);
        }

        const dependencyNode = node.getDependencyParent();
        logger.debug('Finding dependency context', {
            currentPath: node.jsonPath,
            dependencyNodeFound: !!dependencyNode,
            dependencyPath: dependencyNode?.jsonPath,
            dependencyValue: dependencyNode?.value
        });

        const context = node.getDependencyContext();
        logger.debug('Resolved dependency context', {
            context,
            currentNodePath: node.jsonPath,
            parentNodePath: dependencyNode?.jsonPath
        });

        if (!context.catalogId || !context.offeringId) {
            logger.error('Missing dependency context', {
                node: node.jsonPath,
                context,
                parentNode: dependencyNode?.jsonPath,
                parentValue: dependencyNode?.value
            });
            vscode.window.showErrorMessage('Cannot determine catalog ID or offering ID for flavor selection.');
            return this.promptForManualFlavorInput(currentValue);
        }

        try {
            const ibmCloudService = new IBMCloudService(apiKey);
            const flavors = await ibmCloudService.getAvailableFlavors(context.catalogId, context.offeringId);

            if (flavors.length === 0) {
                logger.debug('No flavors available for offering', {
                    catalogId: context.catalogId,
                    offeringId: context.offeringId
                });
                vscode.window.showWarningMessage('No flavors available for this offering.');
                return this.promptForManualFlavorInput(currentValue);
            }

            const items: QuickPickItemEx<string>[] = [];

            // Add available flavors with details
            for (const flavorName of flavors) {
                try {
                    const details = await ibmCloudService.getFlavorDetails(
                        context.catalogId,
                        context.offeringId,
                        flavorName
                    );

                    items.push({
                        label: `${flavorName === currentValue ? '$(check) ' : ''}${details?.label || flavorName}`,
                        description: flavorName,
                        detail: this.createFlavorDetail(flavorName, details, currentValue),
                        value: flavorName
                    });
                } catch (error) {
                    logger.error('Failed to get flavor details', {
                        flavorName,
                        error,
                        catalogId: context.catalogId,
                        offeringId: context.offeringId
                    });
                    items.push({
                        label: `${flavorName === currentValue ? '$(check) ' : ''}${flavorName}`,
                        description: flavorName,
                        value: flavorName
                    });
                }
            }

            const result = await PromptService.showQuickPickWithCustom<string>({
                title: 'Select Flavor',
                placeholder: currentValue || 'Select a flavor or enter a custom name',
                items: items,
                matchOnDescription: true,
                matchOnDetail: true,
                customOptionLabel: '$(edit) Enter Custom Flavor',
                customOptionHandler: async () => {
                    return this.promptForManualFlavorInput(currentValue);
                }
            });

            return result;
        } catch (error) {
            logger.error('Failed to fetch flavors', error);
            return this.promptForManualFlavorInput(currentValue);
        }
    }

    /**
     * Prompts the user to manually enter a flavor name.
     * @param currentValue The current flavor name.
     * @returns The entered flavor name, or undefined if cancelled.
     */
    private async promptForManualFlavorInput(currentValue?: string): Promise<string | undefined> {
        const result = await PromptService.showInputBox<string>({
            title: 'Enter the flavor name',
            initialValue: currentValue,
            validate: (value) => {
                if (!value.trim()) {
                    return 'Flavor name cannot be empty';
                }
                return null;
            }
        });

        this.logger.debug('Manual flavor input result', {
            result,
            currentValue,
            changed: result !== currentValue
        });

        return result;
    }

    /**
     * Prompts the user to select or enter a value for an input mapping field.
     * @param node The catalog tree item associated with the input mapping.
     * @param currentValue The current value of the field.
     * @returns The new value, or undefined if cancelled.
     */
    private async promptForInputMapping(node: CatalogTreeItem, currentValue?: any): Promise<any> {
        await this.ensureInitialized();

        this.logger.debug('Prompting for input mapping', {
            node: node.jsonPath,
            currentValue
        });

        const fieldType = this.getInputMappingFieldType(node);

        if (fieldType === 'value') {
            // For 'value', prompt the user for any arbitrary value
            const value = await this.promptForAnyValue(currentValue);
            return value;
        }

        const dependencyNode = node.getDependencyParent();
        if (!dependencyNode?.value || typeof dependencyNode.value !== 'object') {
            this.logger.error('Dependency node is invalid', dependencyNode);
            return undefined;
        }

        const depValue = dependencyNode.value as Record<string, any>;
        const apiKey = await AuthService.getApiKey(this.context);

        if (!apiKey) {
            vscode.window.showWarningMessage('IBM Cloud API Key required for mapping suggestions');
            return undefined;
        }

        const context = {
            catalogId: depValue.catalog_id,
            offeringId: depValue.id,
            flavorName: Array.isArray(depValue.flavors) ? depValue.flavors[0] : undefined,
            version: depValue.version
        };

        if (!context.catalogId || !context.offeringId || !context.version) {
            this.logger.error('Context missing required fields', context);
            return undefined;
        }

        const inputMappingService = new InputMappingService(
            new IBMCloudService(apiKey)
        );

        if (fieldType === 'version_input') {
            const configurations = await this.getLocalConfigurationItems(node);
            if (!configurations.length) {
                vscode.window.showWarningMessage('No configuration keys found in the local catalog data.');
                return undefined;
            }

            const configGroups = this.groupConfigurationItems(configurations, node);
            const items: QuickPickItemEx<string>[] = [];

            if (configGroups.required.length > 0) {
                items.push({
                    label: "Required",
                    kind: vscode.QuickPickItemKind.Separator
                } as QuickPickItemEx<string>);
                items.push(...this.createConfigKeyItems(configGroups.required, currentValue));
            }

            if (configGroups.optional.length > 0) {
                items.push({
                    label: "Optional",
                    kind: vscode.QuickPickItemKind.Separator
                } as QuickPickItemEx<string>);
                items.push(...this.createConfigKeyItems(configGroups.optional, currentValue));
            }

            const result = await PromptService.showQuickPick<string>({
                placeholder: currentValue || 'Select version input',
                title: 'Version Input Keys',
                items: items,
                matchOnDescription: true,
                matchOnDetail: true
            });

            return result;
        }

        if (fieldType === 'dependency_input' || fieldType === 'dependency_output') {
            const options = await inputMappingService.fetchMappingOptions(context);
            if (!options.length) {
                vscode.window.showWarningMessage('No mapping options available from the offering.');
                return undefined;
            }

            const filteredOptions = options.filter(opt =>
                fieldType === 'dependency_input' ? opt.mappingType === 'input' : opt.mappingType === 'output'
            );

            if (!filteredOptions.length) {
                vscode.window.showWarningMessage(`No ${fieldType.replace('_', ' ')} options available.`);
                return undefined;
            }

            const groups = this.groupMappingOptions(filteredOptions);
            const items: QuickPickItemEx<string>[] = [];

            if (groups.required.length > 0) {
                items.push({
                    label: "Required",
                    kind: vscode.QuickPickItemKind.Separator
                } as QuickPickItemEx<string>);
                items.push(...this.createMappingQuickPickItems(groups.required, currentValue));
            }

            if (groups.optional.length > 0) {
                items.push({
                    label: "Optional",
                    kind: vscode.QuickPickItemKind.Separator
                } as QuickPickItemEx<string>);
                items.push(...this.createMappingQuickPickItems(groups.optional, currentValue));
            }

            const result = await PromptService.showQuickPick<string>({
                placeholder: currentValue || `Select ${fieldType.replace('_', ' ')}`,
                title: fieldType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                items: items,
                matchOnDescription: true,
                matchOnDetail: true
            });

            return result;
        }

        return undefined;
    }

    /**
     * Prompts the user to enter any arbitrary value, supporting various data types.
     * @param currentValue The current value, if any.
     * @returns The entered value, parsed into the appropriate type.
     */
    private async promptForAnyValue(currentValue?: any): Promise<any> {
        const type = await PromptService.showQuickPick<string>({
            title: 'Select the type of value',
            placeholder: 'Choose the type of value',
            items: [
                { label: 'String', value: 'string' },
                { label: 'Number', value: 'number' },
                { label: 'Boolean', value: 'boolean' },
                { label: 'Array', value: 'array' },
                { label: 'Object', value: 'object' },
                { label: 'Null', value: 'null' }
            ]
        });

        if (!type) {
            return undefined;
        }

        switch (type) {
            case 'string':
                const strValue = await PromptService.showInputBox<string>({
                    title: 'Enter a string value',
                    initialValue: currentValue !== undefined ? String(currentValue) : '',
                    validate: undefined
                });
                return strValue;
            case 'number':
                const numValueStr = await PromptService.showInputBox<string>({
                    title: 'Enter a numeric value',
                    initialValue: currentValue !== undefined ? String(currentValue) : '',
                    validate: (input) => isNaN(Number(input)) ? 'Please enter a valid number' : null
                });
                if (numValueStr !== undefined) {
                    return Number(numValueStr);
                }
                return undefined;
            case 'boolean':
                const boolValue = await PromptService.showBooleanPick({
                    title: 'Select a boolean value',
                    placeholder: 'Choose true or false',
                    currentValue: currentValue === true,
                    trueLabel: 'true',
                    falseLabel: 'false'
                });
                return boolValue;
            case 'array':
                const arrayValueStr = await PromptService.showInputBox<string>({
                    title: 'Enter an array value (in JSON format)',
                    initialValue: currentValue !== undefined ? JSON.stringify(currentValue) : '',
                    validate: (input) => {
                        try {
                            const parsed = JSON.parse(input);
                            if (Array.isArray(parsed)) {
                                return null;
                            } else {
                                return 'Please enter a valid JSON array';
                            }
                        } catch (e) {
                            return 'Invalid JSON format';
                        }
                    }
                });
                if (arrayValueStr !== undefined) {
                    return JSON.parse(arrayValueStr);
                }
                return undefined;
            case 'object':
                const objectValueStr = await PromptService.showInputBox<string>({
                    title: 'Enter an object value (in JSON format)',
                    initialValue: currentValue !== undefined ? JSON.stringify(currentValue) : '',
                    validate: (input) => {
                        try {
                            const parsed = JSON.parse(input);
                            if (typeof parsed === 'object' && !Array.isArray(parsed)) {
                                return null;
                            } else {
                                return 'Please enter a valid JSON object';
                            }
                        } catch (e) {
                            return 'Invalid JSON format';
                        }
                    }
                });
                if (objectValueStr !== undefined) {
                    return JSON.parse(objectValueStr);
                }
                return undefined;
            case 'null':
                return null;
        }
    }

    /**
     * Retrieves local configuration items from the catalog data.
     * @param node The catalog tree item to search from.
     * @returns An array of configurations.
     */
    private async getLocalConfigurationItems(node: CatalogTreeItem): Promise<Configuration[]> {
        const flavorNode = node.findAncestorFlavorNode();
        if (!flavorNode) {
            this.logger.error('Could not find the flavor node containing this dependency.');
            return [];
        }

        const configuration = flavorNode.value.configuration as Configuration[];
        if (!Array.isArray(configuration)) {
            this.logger.error('No configuration array found in the flavor node.');
            return [];
        }

        return configuration;
    }

    /**
     * Creates quick pick items for configuration keys.
     * @param configurations The configurations to create items for.
     * @param currentValue The current value for selection.
     * @returns An array of quick pick items.
     */
    private createConfigKeyItems(configurations: Configuration[], currentValue?: string): QuickPickItemEx<string>[] {
        return configurations.map(config => ({
            label: `${config.key === currentValue ? '$(check) ' : ''}${config.key} (${config.type || 'string'})`,
            detail: `Default: ${config.default_value !== undefined ? `"${config.default_value}"` : 'Not Set'} • ${config.description || 'No description specified'}`,
            picked: currentValue === config.key,
            value: config.key
        }));
    }

    /**
     * Groups mapping options into required and optional categories.
     * @param options The mapping options to group.
     * @returns An object containing the grouped options.
     */
    private groupMappingOptions(options: MappingOption[]): {
        required: MappingOption[];
        optional: MappingOption[];
    } {
        return {
            required: options.filter(opt => opt.required),
            optional: options.filter(opt => !opt.required)
        };
    }

    /**
     * Creates quick pick items for mapping options.
     * @param options The mapping options to create items for.
     * @param currentValue The current value for selection.
     * @returns An array of quick pick items.
     */
    private createMappingQuickPickItems(
        options: MappingOption[],
        currentValue?: string
    ): QuickPickItemEx<string>[] {
        return options.map(opt => ({
            label: `${opt.value === currentValue ? '$(check) ' : ''}${opt.label} (${opt.type || 'string'})`,
            detail: this.formatMappingDetail(opt),
            picked: currentValue === opt.value,
            value: opt.value
        }));
    }

    /**
     * Formats the detail string for a mapping option.
     * @param option The mapping option.
     * @returns A formatted string.
     */
    private formatMappingDetail(option: MappingOption): string {
        return `Default: "${option.defaultValue}" • ${option.description || 'No description specified'}`;
    }

    /**
     * Groups configuration items into required and optional categories.
     * @param configurations The configurations to group.
     * @param node The current catalog tree item.
     * @returns An object containing the grouped configurations.
     */
    private groupConfigurationItems(configurations: Configuration[], node: CatalogTreeItem): {
        required: Configuration[];
        optional: Configuration[];
    } {
        const required: Configuration[] = [];
        const optional: Configuration[] = [];

        for (const config of configurations) {
            if (config.required) {
                required.push(config);
            } else {
                optional.push(config);
            }
        }

        return { required, optional };
    }

    /**
     * Retrieves the catalog ID associated with a given node.
     * @param node The catalog tree item.
     * @returns The catalog ID as a string, or undefined if not found.
     */
    private async getCatalogIdForNode(node: CatalogTreeItem): Promise<string | undefined> {
        const parentNode = node.parent;
        if (parentNode && typeof parentNode.value === 'object' && parentNode.value !== null) {
            const catalogId = (parentNode.value as Record<string, any>)['catalog_id'];
            if (typeof catalogId === 'string') {
                return catalogId;
            }
        }
        return undefined;
    }

    /**
     * Creates a detailed description string for a flavor.
     * @param flavorName The name of the flavor.
     * @param details The flavor details.
     * @param currentValue The current flavor name.
     * @returns A formatted string.
     */
    private createFlavorDetail(
        flavorName: string,
        details: OfferingFlavor | undefined,
        currentValue?: string
    ): string {
        const parts: string[] = [];

        if (details?.label_i18n?.['en']) {
            parts.push(details.label_i18n['en']);
        }

        if (details?.name && details.name !== details?.label) {
            parts.push(`Name: ${details.name}`);
        }

        if (details?.description) {
            parts.push(`Description: ${details.description}`);
        } else {
            parts.push(`Description: No description available`);
        }

        return parts.length > 0 ? parts.join(' • ') : 'No additional details available';
    }

    /**
     * Checks if the node represents a flavor selection.
     * @param node The catalog tree item.
     * @returns True if it's a flavor selection, false otherwise.
     */
    private isFlavorSelection(node: CatalogTreeItem): boolean {
        const flavorPattern = /\.dependencies\[\d+\]\.flavors\[\d+\]$/;
        return flavorPattern.test(node.jsonPath);
    }

    /**
     * Determines the type of input mapping field.
     * @param node The catalog tree item.
     * @returns The field type as a string.
     */
    private getInputMappingFieldType(node: CatalogTreeItem): 'dependency_input' | 'dependency_output' | 'version_input' | 'value' {
        const match = node.jsonPath.match(/\.input_mapping\[\d+\]\.([^.]+)$/);
        return (match?.[1] || 'version_input') as any;
    }

    /**
     * Handles file deletion events.
     * @param uri The URI of the deleted file.
     */
    public async handleFileDeletion(uri: vscode.Uri): Promise<void> {
        await this.fileSystemService.handleFileDeletion(uri);
    }

    /**
     * Updates the name of a dependency based on the offering ID.
     * @param node The catalog tree item representing the offering ID.
     * @param offeringId The offering ID.
     * @param knownName An optional known name of the offering.
     */
    private async updateDependencyName(node: CatalogTreeItem, offeringId: string, knownName?: string): Promise<void> {
        const dependencyNode = node.getDependencyParent();
        if (!dependencyNode) {
            return;
        }

        let name = knownName;
        if (!name) {
            const apiKey = await AuthService.getApiKey(this.context);
            const catalogId = await this.getCatalogIdForNode(node);
            if (apiKey && catalogId) {
                const ibmCloudService = new IBMCloudService(apiKey);
                const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);
                name = offerings.find(o => o.id === offeringId)?.name;
            }
        }

        if (name) {
            const currentValue = dependencyNode.value as Record<string, any>;
            await this.updateJsonValue(dependencyNode.jsonPath, {
                ...currentValue,
                name
            });
        }
    }

    /**
     * Retrieves the catalog data from the file system.
     * @returns The catalog data as an object.
     */
    private async queueBackgroundLookups(): Promise<void> {
        const data = await this.getCatalogData();
        if (!data || typeof data !== 'object') {
            return;
        }

        const jsonPathService = JsonPathService.getInstance();
        const items = jsonPathService.traverseJson<LookupItem>(data, (key, value, path): LookupItem | LookupItem[] | void => {
            if (key === 'catalog_id' && typeof value === 'string') {
                return [
                    {
                        type: 'catalog',
                        value: value,
                        priority: 1,
                        context: { isPublic: true }
                    } as LookupItem,
                    {
                        type: 'catalog',
                        value: value,
                        priority: 1,
                        context: { isPublic: false }
                    } as LookupItem,
                    {
                        type: 'offerings',
                        value: value,
                        context: { catalogId: value },
                        priority: 2
                    } as LookupItem
                ];
            }

            if (key === 'id' && typeof value === 'string' && path.includes('dependencies')) {
                const context = jsonPathService.findContextForPath(path, data);
                if (context.catalogId) {
                    return {
                        type: 'offerings',
                        value: value,
                        context: { catalogId: context.catalogId },
                        priority: 2
                    } as LookupItem;
                }
            }

            if (key === 'flavors' && Array.isArray(value)) {
                const context = jsonPathService.findContextForPath(path, data);
                if (context.catalogId && context.offeringId) {
                    return {
                        type: 'flavors',
                        value: value.join(','),
                        context: {
                            catalogId: context.catalogId,
                            offeringId: context.offeringId
                        },
                        priority: 3
                    } as LookupItem;
                }
            }

            return undefined;
        });

        if (items.length > 0) {
            const prefetchService = CachePrefetchService.getInstance();
            const apiKey = await AuthService.getApiKey(this.context);
            if (apiKey) {
                prefetchService.setIBMCloudService(new IBMCloudService(apiKey));
                prefetchService.enqueueLookups(items);
            }
        }
    }

    /**
     * Retrieves the catalog data from the file system.
     * @returns The catalog data as an object.
     */
    public async validateItem(item: CatalogTreeItem): Promise<void> {
        if (item.needsValidation()) {
            item.requestValidation();
        }
    }
}
