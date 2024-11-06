import * as vscode from 'vscode';
import { CatalogTreeItem } from '../models/CatalogTreeItem';
import { AddElementDialog } from '../ui/AddElementDialog';
import { IBMCloudService } from './IBMCloudService';
import { SchemaService } from './SchemaService';
import { AuthService } from './AuthService';
import { LoggingService } from './core/LoggingService';
import { FileSystemService } from './core/FileSystemService';
import { InputMappingService } from './InputMappingService';
import type { Configuration, OfferingFlavor } from '../types/ibmCloud';
import type { ICatalogFileInfo, MappingOption } from '../types/catalog';
import { ValueQuickPickItem } from '../types/common';

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

    public getCatalogFilePath(): string | undefined {
        const currentFile = this.fileSystemService.getCurrentCatalogFile();
        return currentFile?.uri.fsPath;
    }

    public async getCatalogData(): Promise<unknown> {
        await this.ensureInitialized();
        return this.fileSystemService.getCatalogData();
    }

    public getCatalogDisplayPath(): string {
        return this.fileSystemService.getCatalogDisplayPath();
    }

    public getCurrentCatalogFile(): ICatalogFileInfo | undefined {
        return this.fileSystemService.getCurrentCatalogFile();
    }

    public isInitialized(): boolean {
        return this.fileSystemService.isInitialized();
    }

    public async initialize(): Promise<boolean> {
        this.logger.debug('Initializing CatalogService');
        try {
            const initialized = await this.fileSystemService.initialize();
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

    private async ensureInitialized(): Promise<void> {
        if (!this.fileSystemService.isInitialized()) {
            const success = await this.initialize();
            if (!success) {
                throw new Error('Catalog file not initialized');
            }
        }
    }

    public async updateJsonValue(jsonPath: string, newValue: unknown): Promise<void> {
        await this.ensureInitialized();
        await this.fileSystemService.updateJsonValue(jsonPath, newValue);
    }
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
     * Reloads the catalog data from disk
     */
    public async reloadCatalogData(): Promise<void> {
        this.logger.debug('Reloading catalog data');

        try {
            await this.ensureInitialized();
            await this.fileSystemService.reloadCatalogData();
            this._onDidChangeContent.fire();
        } catch (error) {
            this.logger.error('Failed to reload catalog data', error);
            throw new Error(`Failed to update catalog view: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

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

    private async promptForMappingType(): Promise<string | undefined> {
        this.logger.debug('Prompting for mapping type');
        const items: ValueQuickPickItem[] = [
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
            }
        ];

        const selection = await vscode.window.showQuickPick(items, {
            title: 'Select Input Mapping Type',
            placeHolder: 'Choose the type of mapping to add',
            canPickMany: false
        });

        return selection?.value;
    }
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
            return this.promptForInputMapping(node, currentValue as string);
        }

        const value = await vscode.window.showInputBox({
            prompt: `Enter value for ${node.label}`,
            value: currentValue?.toString() ?? '',
            validateInput: (value) => {
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

    private async promptForBoolean(fieldLabel: string, currentValue?: boolean): Promise<boolean | undefined> {
        this.logger.debug('Showing boolean pick', {
            fieldLabel,
            currentValue
        });
        const items: vscode.QuickPickItem[] = [
            {
                label: `${currentValue === true ? '$(check) ' : ''}true`,
                description: 'Set value to true',
                picked: currentValue === true
            },
            {
                label: `${currentValue === false ? '$(check) ' : ''}false`,
                description: 'Set value to false',
                picked: currentValue === false
            }
        ];

        const selection = await vscode.window.showQuickPick(items, {
            title: `Set value for ${fieldLabel}`,
            placeHolder: 'Select true or false',
            canPickMany: false
        });

        if (!selection) {
            return undefined;
        }

        return selection.label.includes('true');
    }

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

            const items: vscode.QuickPickItem[] = [
                {
                    label: "$(edit) Enter Custom Catalog ID",
                    description: "Manually enter a catalog ID",
                    alwaysShow: true
                },
                {
                    label: "Available Catalogs",
                    kind: vscode.QuickPickItemKind.Separator
                },
                {
                    label: "Public Catalogs",
                    kind: vscode.QuickPickItemKind.Separator
                },
                ...publicCatalogs.map(catalog => ({
                    label: `${catalog.id === currentValue ? '$(check) ' : ''}${catalog.label}`,
                    description: catalog.id,
                    detail: catalog.shortDescription
                })),
                {
                    label: "Private Catalogs",
                    kind: vscode.QuickPickItemKind.Separator
                },
                ...privateCatalogs.map(catalog => ({
                    label: `${catalog.id === currentValue ? '$(check) ' : ''}${catalog.label}`,
                    description: catalog.id,
                    detail: catalog.shortDescription
                }))
            ];

            const selection = await vscode.window.showQuickPick(items, {
                title: 'Select Catalog',
                placeHolder: currentValue || 'Select a catalog or enter a custom ID',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selection) {
                return undefined;
            }

            if (selection.label === "$(edit) Enter Custom Catalog ID") {
                return this.promptForManualCatalogId(currentValue);
            }

            return selection.description;

        } catch (error) {
            this.logger.error('Failed to fetch catalogs', error);
            return this.promptForManualCatalogId(currentValue);
        }
    }

    private async promptForManualCatalogId(currentValue?: string): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt: 'Enter the catalog ID',
            value: currentValue,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Catalog ID cannot be empty';
                }
                return null;
            }
        });
    }
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

            const items: vscode.QuickPickItem[] = [
                {
                    label: "$(edit) Enter Custom Offering ID",
                    description: "Manually enter an offering ID",
                    alwaysShow: true
                },
                {
                    label: "Available Offerings",
                    kind: vscode.QuickPickItemKind.Separator
                },
                ...offerings.map(offering => ({
                    label: `${offering.id === currentValue ? '$(check) ' : ''}${offering.name}`,
                    description: offering.id,
                    detail: offering.shortDescription
                }))
            ];

            const selection = await vscode.window.showQuickPick(items, {
                title: 'Select Offering',
                placeHolder: currentValue || 'Select an offering or enter a custom ID',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selection) {
                return undefined;
            }

            if (selection.label === "$(edit) Enter Custom Offering ID") {
                const customId = await this.promptForManualOfferingId(currentValue);
                if (customId) {
                    await this.updateDependencyName(node, customId);
                }
                return customId;
            }

            if (selection.description) {
                await this.updateDependencyName(node, selection.description, selection.label);
            }

            return selection.description;

        } catch (error) {
            this.logger.error('Failed to fetch offerings', error);
            const manualId = await this.promptForManualOfferingId(currentValue);
            if (manualId) {
                await this.updateDependencyName(node, manualId);
            }
            return manualId;
        }
    }

    private async promptForManualOfferingId(currentValue?: string): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt: 'Enter the offering ID',
            value: currentValue,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Offering ID cannot be empty';
                }
                return null;
            }
        });
    }

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

            const items: vscode.QuickPickItem[] = [
                {
                    label: "$(edit) Enter Custom Flavor",
                    description: "Manually enter a flavor name",
                    alwaysShow: true
                },
                {
                    label: "Available Flavors",
                    kind: vscode.QuickPickItemKind.Separator
                }
            ];

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
                        detail: this.createFlavorDetail(flavorName, details, currentValue)
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
                    });
                }
            }

            const selection = await vscode.window.showQuickPick(items, {
                title: 'Select Flavor',
                placeHolder: currentValue || 'Select a flavor or enter a custom name',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selection) {
                return undefined;
            }

            if (selection.label === "$(edit) Enter Custom Flavor") {
                return this.promptForManualFlavorInput(currentValue);
            }

            return selection.description;
        } catch (error) {
            logger.error('Failed to fetch flavors', error);
            return this.promptForManualFlavorInput(currentValue);
        }
    }

    private async promptForManualFlavorInput(currentValue?: string): Promise<string | undefined> {
        const result = await vscode.window.showInputBox({
            prompt: 'Enter the flavor name',
            value: currentValue,
            validateInput: (value) => {
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
    private async promptForInputMapping(node: CatalogTreeItem, currentValue?: string): Promise<string | undefined> {
        await this.ensureInitialized();

        this.logger.debug('Prompting for input mapping', {
            node: node.jsonPath,
            currentValue
        });

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

        const fieldType = this.getInputMappingFieldType(node);

        if (fieldType === 'version_input') {
            const configurations = await this.getLocalConfigurationItems(node);
            if (!configurations.length) {
                vscode.window.showWarningMessage('No configuration keys found in the local catalog data.');
                return undefined;
            }

            const configGroups = this.groupConfigurationItems(configurations, node);
            const items: ValueQuickPickItem[] = [];

            if (configGroups.required.length > 0) {
                items.push({
                    label: "Required",
                    kind: vscode.QuickPickItemKind.Separator
                } as ValueQuickPickItem);
                items.push(...this.createConfigKeyItems(configGroups.required, currentValue));
            }

            if (configGroups.optional.length > 0) {
                items.push({
                    label: "Optional",
                    kind: vscode.QuickPickItemKind.Separator
                } as ValueQuickPickItem);
                items.push(...this.createConfigKeyItems(configGroups.optional, currentValue));
            }

            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: currentValue || 'Select version input',
                title: 'Version Input Keys'
            });

            return selection?.value;
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
            const items: ValueQuickPickItem[] = [];

            if (groups.required.length > 0) {
                items.push({
                    label: "Required",
                    kind: vscode.QuickPickItemKind.Separator
                } as ValueQuickPickItem);
                items.push(...this.createMappingQuickPickItems(groups.required, currentValue));
            }

            if (groups.optional.length > 0) {
                items.push({
                    label: "Optional",
                    kind: vscode.QuickPickItemKind.Separator
                } as ValueQuickPickItem);
                items.push(...this.createMappingQuickPickItems(groups.optional, currentValue));
            }

            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: currentValue || `Select ${fieldType.replace('_', ' ')}`,
                title: fieldType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
            });

            return selection?.value;
        }

        return undefined;
    }

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

    private createConfigKeyItems(configurations: Configuration[], currentValue?: string): ValueQuickPickItem[] {
        return configurations.map(config => ({
            label: `${config.key === currentValue ? '$(check) ' : ''}${config.key} (${config.type || 'string'})`,
            description: '',
            detail: `Default: ${config.default_value !== undefined ? `"${config.default_value}"` : 'Not Set'} • ${config.description || 'No description specified'}`,
            picked: currentValue === config.key,
            value: config.key
        }));
    }

    private groupMappingOptions(options: MappingOption[]): {
        required: MappingOption[];
        optional: MappingOption[];
    } {
        return {
            required: options.filter(opt => opt.required),
            optional: options.filter(opt => !opt.required)
        };
    }

    private createMappingQuickPickItems(
        options: MappingOption[],
        currentValue?: string
    ): ValueQuickPickItem[] {
        return options.map(opt => ({
            label: `${opt.value === currentValue ? '$(check) ' : ''}${opt.label} (${opt.type || 'string'})`,
            description: '',
            detail: this.formatMappingDetail(opt),
            picked: currentValue === opt.value,
            value: opt.value
        }));
    }

    private formatMappingDetail(option: MappingOption): string {
        return `Default: "${option.defaultValue}" • ${option.description || 'No description specified'}`;
    }

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

    private isFlavorSelection(node: CatalogTreeItem): boolean {
        const flavorPattern = /\.dependencies\[\d+\]\.flavors\[\d+\]$/;
        return flavorPattern.test(node.jsonPath);
    }

    private getInputMappingFieldType(node: CatalogTreeItem): 'dependency_input' | 'dependency_output' | 'version_input' {
        const match = node.jsonPath.match(/\.input_mapping\[\d+\]\.([^.]+)$/);
        return (match?.[1] || 'version_input') as any;
    }

    public async handleFileDeletion(uri: vscode.Uri): Promise<void> {
        await this.fileSystemService.handleFileDeletion(uri);
    }

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
}