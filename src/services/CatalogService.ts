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
import type { ConfigurationFieldProperty, ConfigurationFieldSelection, Dependency, FlavorObject, SwappableDependency } from '../types/catalog';
import { CatalogServiceMode, type CatalogServiceState, type ICatalogFileInfo, type MappingOption } from '../types/catalog';
import type { Configuration as IBMCloudConfiguration } from '../types/ibmCloud';
import type { Configuration as CatalogConfiguration } from '../types/catalog';
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
    private ibmCloudService: IBMCloudService | undefined;
    private serviceState: CatalogServiceState = {
        initialized: false,
        hasWorkspace: false,
        mode: CatalogServiceMode.NoWorkspace
    };
    private initializing: boolean = false; // Add initialization lock

    constructor(private readonly context: vscode.ExtensionContext) {
        this.logger.debug('Constructing CatalogService');
        this.fileSystemService = FileSystemService.getInstance(context);

        // Only set up workspace change handler after initial initialization
        void this.initialize().then(() => {
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                void this.handleWorkspaceChange();
            });
        });

        this.fileSystemService.onDidChangeContent(() => {
            this._onDidChangeContent.fire();
        });
    }

    /**
    * Handles changes to workspace folders
    */
    private async handleWorkspaceChange(): Promise<void> {
        const hasWorkspace = Boolean(vscode.workspace.workspaceFolders?.length);
        if (hasWorkspace === this.serviceState.hasWorkspace) {
            return; // No change in workspace state
        }

        this.serviceState.hasWorkspace = hasWorkspace;
        this.logger.debug('Workspace changed', { hasWorkspace });

        if (!hasWorkspace) {
            // Clear catalog state if we lose workspace
            this.serviceState.catalogFile = undefined;
            this.serviceState.mode = CatalogServiceMode.NoWorkspace;
            this._onDidChangeContent.fire();
        }
        // Don't automatically reinitialize - let the user trigger that if needed
    }

    /**
     * Retrieves the file system path of the current catalog file.
     * @returns The file path as a string, or undefined if not initialized.
     */
    public getCatalogFilePath(): string | undefined {
        return this.serviceState.catalogFile?.uri.fsPath;
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
      * Initializes the catalog service by loading the catalog file if available
      * @returns A promise that resolves to true if initialization is successful
      */
    public async initialize(): Promise<boolean> {
        // Prevent concurrent initialization
        if (this.initializing || this.serviceState.initialized) {
            return true;
        }

        this.initializing = true;
        this.logger.debug('Initializing CatalogService');

        try {
            // Check workspace state
            this.serviceState.hasWorkspace = Boolean(vscode.workspace.workspaceFolders?.length);

            if (!this.serviceState.hasWorkspace) {
                this.logger.debug('No workspace found - operating in limited mode');
                this.serviceState.mode = CatalogServiceMode.NoWorkspace;
                this.serviceState.initialized = true;
                return true;
            }

            const initialized = await this.fileSystemService.initialize();
            await this.queueBackgroundLookups();
            if (initialized) {
                this.serviceState.catalogFile = this.fileSystemService.getCurrentCatalogFile();
                this.serviceState.mode = CatalogServiceMode.Full;
                await this.queueBackgroundLookups();
                this.logger.debug('CatalogService initialized successfully with workspace');
            } else {
                this.serviceState.mode = CatalogServiceMode.WorkspaceOnly;
                this.logger.debug('CatalogService initialized without catalog file');
            }

            this.serviceState.initialized = true;
            return true;

        } catch (error) {
            this.serviceState.lastError = error instanceof Error ? error : new Error(String(error));
            this.logger.error('Failed to initialize CatalogService', error);
            return false;
        } finally {
            this.initializing = false;
        }
    }

    /**
     * Returns whether the service is initialized
     */
    public isInitialized(): boolean {
        return this.serviceState.initialized;
    }

    /**
     * Returns whether a workspace is available
     */
    public hasWorkspace(): boolean {
        return this.serviceState.hasWorkspace;
    }

    /**
 * Checks if full catalog functionality is available
 */
    public hasFullFunctionality(): boolean {
        return this.serviceState.mode === CatalogServiceMode.Full;
    }

    /**
     * Gets the current operating mode of the service
     */
    public getMode(): CatalogServiceMode {
        return this.serviceState.mode;
    }

    /**
     * Returns the current service state
     */
    public getState(): Readonly<CatalogServiceState> {
        return { ...this.serviceState };
    }

    /**
     * Ensures the service is initialized before proceeding
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.serviceState.initialized && !this.initializing) {
            const success = await this.initialize();
            if (!success) {
                throw new Error(this.serviceState.lastError?.message || 'Failed to initialize CatalogService');
            }
        }
    }


    /**
     * Gets the IBM Cloud service instance with an API key
     * @returns The IBM Cloud service instance, or undefined if no API key is available
     */
    private async getIBMCloudService(): Promise<IBMCloudService | undefined> {
        if (this.ibmCloudService) {
            return this.ibmCloudService;
        }

        const apiKey = await AuthService.getApiKey(this.context);
        if (!apiKey) {
            return undefined;
        }

        this.ibmCloudService = new IBMCloudService(apiKey);
        return this.ibmCloudService;
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
            // debug print the selected node with relevant properties only
            this.logger.debug('Selected node', {
                label: parentNode.label,
                jsonPath: parentNode.jsonPath,
                contextValue: parentNode.contextValue,
                value: parentNode.value
            });

            // Check if this is a dependency flavors array
            if (this.isDependencyFlavorsArrayNode(parentNode)) {
                this.logger.debug('Handling dependency flavors array addition');
                await this.handleDependencyFlavorArrayAddition(parentNode);
                return;
            }

            // Check if this is a dependency object
            if ((parentNode.contextValue === 'object' || parentNode.contextValue === 'container') &&
                parentNode.jsonPath.match(/\.dependencies\[\d+\]$/)) {
                const dependencyValue = parentNode.value as Required<Dependency>;
                if (!dependencyValue.ignore_auto_referencing) {
                    // Show prompt immediately instead of just creating the array
                    await this.handleIgnoreAutoReferencingAddition(parentNode);
                }
                return;
            }

            // Handle clicking add on the ignore_auto_referencing array itself
            if (parentNode.jsonPath.endsWith('.ignore_auto_referencing')) {
                await this.handleIgnoreAutoReferencingAddition(parentNode.parent!);
                return;
            }

            // Check if this is an input mapping object that needs reference_version
            if (parentNode.jsonPath.includes('.input_mapping') && !parentNode.jsonPath.endsWith('.input_mapping')) {
                await this.promptForMissingReferenceVersion(parentNode);
                return;
            }

            // Check for flavor node first to add dependencies
            if (this.isFlavorNode(parentNode)) {
                this.logger.debug('Handling dependencies addition to flavor');
                await this.handleFlavorDependenciesAddition(parentNode);
                return;
            }

            // Handle for dependencies array
            if (parentNode.jsonPath.endsWith('.dependencies')) {
                await this.handleDependencyAddition(parentNode);
                return;
            }

            // Handle for swappable dependencies array
            if (parentNode.jsonPath.endsWith('.swappable_dependencies')) {
                await this.handleSwappableDependencyAddition(parentNode);
                return;
            }

            // Handle input_mapping additions
            if (parentNode.jsonPath.endsWith('.input_mapping')) {
                await this.handleInputMappingAddition(parentNode);
                return;
            }

            // Check for dependency flavors array first
            if (this.isDependencyFlavorsArrayNode(parentNode)) {
                this.logger.debug('Handling dependency flavors array addition');
                await this.handleDependencyFlavorArrayAddition(parentNode);
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

            // Special handling for configuration arrays
            if (node.label === 'configuration' && Array.isArray(node.value)) {
                await this.handleConfigurationFieldsEdit(node);
                return;
            }
            // Handle regular element editing
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

    private isFlavorNode(node: CatalogTreeItem): boolean {
        // Match pattern like $.products[0].flavors[0]
        return /\$\.products\[\d+\]\.flavors\[\d+\]$/.test(node.jsonPath);
    }


    /**
    * Handles adding dependencies or swappable dependencies to a flavor.
    * Prompts for type selection when neither exists.
    * @param flavorNode The flavor node to add dependencies to
    */
    private async handleFlavorDependenciesAddition(flavorNode: CatalogTreeItem): Promise<void> {
        try {
            const flavorValue = flavorNode.value as FlavorObject;

            // Only check for existing blocks if we're at the flavor level
            // This ensures we don't trigger for child nodes
            if (flavorNode.jsonPath.match(/\$\.products\[\d+\]\.flavors\[\d+\]$/)) {
                const hasDependencies = Boolean(flavorValue.dependencies);
                const hasSwappableDependencies = Boolean(flavorValue.swappable_dependencies);

                // If both exist, show message and return
                if (hasDependencies && hasSwappableDependencies) {
                    void vscode.window.showInformationMessage(
                        'Both dependencies and swappable dependencies blocks already exist in this flavor'
                    );
                    return;
                }

                // If neither exists, prompt for type
                if (!hasDependencies && !hasSwappableDependencies) {
                    const selection = await vscode.window.showQuickPick(
                        [
                            {
                                label: 'Regular Dependencies',
                                description: 'Add a regular dependencies block',
                                value: 'dependencies'
                            },
                            {
                                label: 'Swappable Dependencies',
                                description: 'Add a swappable dependencies block',
                                value: 'swappable_dependencies'
                            }
                        ],
                        {
                            placeHolder: 'Select dependency type to add',
                            title: 'Add Dependencies'
                        }
                    );

                    if (!selection) {
                        return;
                    }

                    // If one exists, add the other
                    const updatedFlavor: FlavorObject = {
                        ...flavorValue,
                        [hasDependencies ? 'swappable_dependencies' : 'dependencies']: [],
                        dependency_version_2: flavorValue.hasOwnProperty('dependency_version_2')
                            ? flavorValue.dependency_version_2
                            : true
                    };

                    if (selection.value === 'dependencies') {
                        updatedFlavor.dependencies = [];
                    } else {
                        updatedFlavor.swappable_dependencies = [];
                    }

                    await this.updateJsonValue(flavorNode.jsonPath, updatedFlavor);
                    void vscode.window.showInformationMessage(
                        `Successfully added ${selection.value === 'dependencies' ? 'dependencies' : 'swappable dependencies'} to flavor`
                    );
                    return;
                }

                // If one exists, add the other
                const updatedFlavor: FlavorObject = {
                    ...flavorValue,
                    [hasDependencies ? 'swappable_dependencies' : 'dependencies']: []
                };

                await this.updateJsonValue(flavorNode.jsonPath, updatedFlavor);
                void vscode.window.showInformationMessage(
                    `Successfully added ${hasDependencies ? 'swappable dependencies' : 'dependencies'} to flavor`
                );
                return;
            }

            // Handle actual dependency additions here
            // This is where we'll handle adding to either dependencies or swappable_dependencies arrays
            await this.handleDependencyAddition(flavorNode);

        } catch (error) {
            this.logger.error('Failed to add dependencies to flavor', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to add dependencies: ${message}`);
            throw error;
        }
    }

    private isDependencyFlavorsArrayNode(node: CatalogTreeItem): boolean {
        // Match both the flavors array itself and elements within it
        const pattern = /\.dependencies\[\d+\]\.flavors(?:\[\d+\])?$/;
        const matches = pattern.test(node.jsonPath);
        this.logger.debug('Checking if node is dependency flavors array', {
            path: node.jsonPath,
            isDependencyFlavors: matches,
            contextValue: node.contextValue
        });
        return matches && node.contextValue === 'array';
    }

    /**
    * Handles adding a flavor to either a regular dependency or swappable dependency flavor array.
    * @param parentNode The parent node representing the flavors array
    */
    private async handleDependencyFlavorArrayAddition(parentNode: CatalogTreeItem): Promise<void> {
        this.logger.debug('Starting dependency flavor array addition', {
            parentNodePath: parentNode.jsonPath,
            parentNodeValue: parentNode.value
        });

        try {
            const ibmCloudService = await this.getIBMCloudService();
            if (!ibmCloudService) {
                const result = await vscode.window.showWarningMessage(
                    'IBM Cloud API key required to browse available flavors. Would you like to add one now?',
                    'Yes', 'No'
                );

                if (result === 'Yes') {
                    await vscode.commands.executeCommand('ibmCatalog.login');
                    return;
                }
                return;
            }

            // Get dependency context - could be regular or within swappable
            const dependencyNode = parentNode.getDependencyParent();
            if (!dependencyNode?.value || typeof dependencyNode.value !== 'object') {
                throw new Error('Cannot find dependency context for flavor selection');
            }

            const depValue = dependencyNode.value as Required<Dependency>;
            const catalogId = depValue.catalog_id;
            const offeringId = depValue.id;

            this.logger.debug('Dependency context found', {
                catalogId,
                offeringId
            });

            if (!catalogId || !offeringId) {
                throw new Error('Missing catalog_id or offering_id for flavor selection');
            }

            // Fetch available flavors
            const flavors = await ibmCloudService.getAvailableFlavors(catalogId, offeringId);
            this.logger.debug('Fetched available flavors', {
                count: flavors.length
            });

            if (!flavors.length) {
                void vscode.window.showWarningMessage('No flavors available for this offering.');
                return;
            }

            // Get current flavors from the dependency
            const currentFlavors = parentNode.value as string[] || [];

            // Prepare flavor details for selection
            const items: QuickPickItemEx<string>[] = [];

            // Add available flavors with details
            for (const flavorName of flavors) {
                const isPicked = currentFlavors.includes(flavorName);

                try {
                    const details = await ibmCloudService.getFlavorDetails(
                        catalogId,
                        offeringId,
                        flavorName
                    );

                    items.push({
                        label: details?.label || flavorName,
                        description: flavorName,
                        detail: this.createFlavorDetail(flavorName, details),
                        value: flavorName,
                        picked: isPicked
                    });
                } catch (error) {
                    this.logger.error('Failed to get flavor details', {
                        flavorName,
                        error,
                        catalogId,
                        offeringId
                    });
                    items.push({
                        label: flavorName,
                        description: flavorName,
                        value: flavorName,
                        picked: isPicked
                    });
                }
            }

            // Ensure focus for quick pick
            await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

            // Create a new QuickPick instance
            const quickPick = vscode.window.createQuickPick();
            quickPick.items = items;
            quickPick.title = 'Select Flavors';
            quickPick.placeholder = 'Select one or more flavors (Space to select/deselect, Enter to confirm)';
            quickPick.canSelectMany = true;
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;

            // Pre-select the current flavors
            quickPick.selectedItems = items.filter(item => currentFlavors.includes(item.value));

            // Show the QuickPick and wait for selection
            const result = await new Promise<string[] | undefined>((resolve) => {
                quickPick.onDidAccept(() => {
                    const selectedValues = quickPick.selectedItems.map(item => (item as QuickPickItemEx<string>).value);
                    resolve(selectedValues);
                    quickPick.hide();
                });
                quickPick.onDidHide(() => {
                    resolve(undefined);
                    quickPick.dispose();
                });
                quickPick.show();
            });

            if (result) {
                // Update the parent array with the selected flavors
                await this.updateJsonValue(parentNode.jsonPath, result);
            }

        } catch (error) {
            this.logger.error('Failed to fetch flavors', error);
            throw error;
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

            // Get existing mappings to filter out already mapped destinations
            const existingMappings = Array.isArray(depValue.input_mapping) ? depValue.input_mapping : [];
            const existingDestinations = new Set(existingMappings.map(mapping => mapping.version_input));

            // Filter out configurations that are already mapped
            const availableConfigurations = configurations.filter(config =>
                !existingDestinations.has(config.key) || config.key === currentValue
            );

            if (!availableConfigurations.length) {
                vscode.window.showWarningMessage('All available configuration keys are already mapped.');
                return undefined;
            }

            const configGroups = this.groupConfigurationItems(availableConfigurations, node);
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
            this.logger.debug('No valid catalog data found for prefetch analysis');
            return;
        }

        this.logger.debug('Starting background prefetch analysis of catalog data');
        const prefetchService = CachePrefetchService.getInstance();
        const apiKey = await AuthService.getApiKey(this.context);
        if (apiKey) {
            prefetchService.setIBMCloudService(new IBMCloudService(apiKey));
            prefetchService.analyzeCatalogAndPrefetch(data as Record<string, unknown>);
        } else {
            this.logger.debug('No API key available for prefetch');
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

    /**
     * Handles updating a dependency when catalog_id or id changes.
     * 
     * When catalog_id changes:
     * - Clears id, name, version, and flavors
     * - Preserves dependencies and other fields
     * 
     * When id changes:
     * - Updates name based on the new ID
     * - Clears version and flavors
     * - Preserves dependencies and other fields
     * 
     * @param node The catalog tree item being updated
     * @param newValue The new value being set
     * @param isId Whether this is an ID change (true) or catalog change (false)
     */
    private async handleDependencyIdentifierChange(
        node: CatalogTreeItem,
        newValue: string,
        isId: boolean
    ): Promise<void> {
        const dependencyNode = node.getDependencyParent();
        if (!dependencyNode?.value || typeof dependencyNode.value !== 'object') {
            return;
        }

        const currentValue = dependencyNode.value as Dependency;

        // Create updated dependency object, preserving all fields except those we want to clear
        const updatedDependency: Dependency = {
            ...currentValue,
            [isId ? 'id' : 'catalog_id']: newValue,
            version: '', // Clear version in both cases
            flavors: [], // Clear flavors in both cases
        };

        if (!isId) {
            // If catalog changed, also clear ID and name
            updatedDependency.id = '';
            updatedDependency.name = '';
        } else {
            // If ID changed, update the name
            const catalogId = currentValue.catalog_id;
            if (catalogId) {
                const ibmCloudService = await this.getIBMCloudService();
                if (ibmCloudService) {
                    const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);
                    const offering = offerings.find(o => o.id === newValue);
                    if (offering?.name) {
                        updatedDependency.name = offering.name;
                    }
                }
            }
        }

        await this.updateJsonValue(dependencyNode.jsonPath, updatedDependency);
    }

    private async handleIgnoreAutoReferencingAddition(parentNode: CatalogTreeItem): Promise<void> {
        // Implementation will be added later
        throw new Error('Method not implemented.');
    }

    private async promptForMissingReferenceVersion(node: CatalogTreeItem): Promise<void> {
        // Implementation will be added later
        throw new Error('Method not implemented.');
    }

    private async handleDependencyAddition(parentNode: CatalogTreeItem): Promise<void> {
        // Implementation will be added later
        throw new Error('Method not implemented.');
    }

    private async handleSwappableDependencyAddition(parentNode: CatalogTreeItem): Promise<void> {
        // Implementation will be added later
        throw new Error('Method not implemented.');
    }

    private async handleInputMappingAddition(parentNode: CatalogTreeItem): Promise<void> {
        // Implementation will be added later
        throw new Error('Method not implemented.');
    }

    private async handleConfigurationFieldsEdit(node: CatalogTreeItem): Promise<void> {
        // Implementation will be added later
        throw new Error('Method not implemented.');
    }

    private async promptForValue(node: CatalogTreeItem, currentValue?: unknown): Promise<unknown> {
        this.logger.debug('Prompting for value', {
            node: node.jsonPath
        });

        // Check if this is a flavor selection
        if (this.isFlavorSelection(node)) {
            // If this is a flavor array element, use the parent array node for selection
            const parentArrayNode = node.parent;
            if (parentArrayNode) {
                await this.handleDependencyFlavorArrayAddition(parentArrayNode);
            }
            return undefined;
        }

        // For other types of values, use the default prompt
        return this.promptForAnyValue(currentValue);
    }
}
