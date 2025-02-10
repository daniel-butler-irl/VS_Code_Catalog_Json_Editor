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
        this.logger.debug('Starting dependency flavor array addition');

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
                offeringId,
                isSwappable: parentNode.isInSwappableDependency()
            });

            if (!catalogId || !offeringId) {
                throw new Error('Missing catalog_id or offering_id for flavor selection');
            }

            // Fetch available flavors
            const availableFlavors = await ibmCloudService.getAvailableFlavors(catalogId, offeringId);
            this.logger.debug('Fetched available flavors', {
                count: availableFlavors.length,
                flavors: availableFlavors
            });

            if (!availableFlavors.length) {
                void vscode.window.showWarningMessage('No flavors available for this offering.');
                return;
            }

            // Get current flavors to filter out already selected ones
            const currentFlavors = new Set(parentNode.value as string[]);
            this.logger.debug('Current flavors', {
                currentFlavors: Array.from(currentFlavors),
                totalCount: currentFlavors.size
            });

            const newFlavorOptions = availableFlavors.filter(flavor => !currentFlavors.has(flavor));
            this.logger.debug('Available new flavors', {
                count: newFlavorOptions.length,
                flavors: newFlavorOptions
            });

            if (!newFlavorOptions.length) {
                const message = `All available flavors (${Array.from(currentFlavors).join(', ')}) are already selected for this offering.`;
                void vscode.window.showInformationMessage(message);
                return;
            }

            // Prepare flavor details for selection
            const flavorDetails = await Promise.all(
                newFlavorOptions.map(async (flavorName) => {
                    try {
                        const details = await ibmCloudService.getFlavorDetails(catalogId, offeringId, flavorName);
                        return {
                            name: flavorName,
                            label: details?.label || flavorName,
                            description: details?.description || 'No description available'
                        };
                    } catch (error: unknown) {
                        const errorData: Record<string, unknown> = {
                            flavorName,
                            error: error instanceof Error ? error.message : String(error),
                            catalogId,
                            offeringId
                        };
                        this.logger.warn('Failed to fetch details for flavor', errorData);
                        return {
                            name: flavorName,
                            label: flavorName,
                            description: 'No description available'
                        };
                    }
                })
            );

            // Ensure focus for quick pick
            await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

            try {
                const selectedFlavor = await PromptService.showQuickPick<string>({
                    title: 'Select Flavor',
                    placeholder: 'Choose a flavor to add',
                    items: flavorDetails.map(flavor => ({
                        label: flavor.label,
                        description: `(${flavor.name})`,
                        detail: flavor.description,
                        value: flavor.name,
                        picked: false
                    })),
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                this.logger.debug('Quick pick result', { selectedFlavor });

                if (!selectedFlavor) {
                    this.logger.debug('No flavor selected');
                    return;
                }

                // Add the selected flavor
                const updatedFlavors = [...currentFlavors, selectedFlavor];
                await this.updateJsonValue(parentNode.jsonPath, updatedFlavors);

                // If this is in a swappable dependency and it's the first flavor,
                // ask if it should be the default
                const swappableDependencyNode = parentNode.getSwappableDependencyParent();
                if (swappableDependencyNode && currentFlavors.size === 0) {
                    const swappableValue = swappableDependencyNode.value as SwappableDependency;
                    if (!swappableValue.default_dependency) {
                        const makeDefault = await vscode.window.showQuickPick(
                            ['Yes', 'No'],
                            {
                                placeHolder: 'Set this as the default dependency?'
                            }
                        );

                        if (makeDefault === 'Yes') {
                            await this.updateJsonValue(
                                `${swappableDependencyNode.jsonPath}.default_dependency`,
                                depValue.name
                            );
                        }
                    }
                }

                void vscode.window.showInformationMessage(`Successfully added flavor: ${selectedFlavor}`);
            } catch (error) {
                this.logger.error('Error showing quick pick or updating flavors', error);
                throw error;
            }

        } catch (error) {
            this.logger.error('Failed to add dependency flavor', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to add flavor: ${message}`);
            throw error;
        }
    }

    /**
   * Handles guided creation of a swappable dependency group.
   * @param parentNode The parent node representing the swappable_dependencies array
   */
    private async handleSwappableDependencyAddition(parentNode: CatalogTreeItem): Promise<void> {
        try {
            // 1. First prompt for the swappable group name
            const swappableName = await PromptService.showInputBox<string>({
                title: 'Enter Swappable Dependency Group Name',
                placeholder: 'Enter a unique identifier for this swappable group',
                validate: (value) => {
                    if (!value.trim()) {
                        return 'Name cannot be empty';
                    }
                    // Check if name already exists in current swappable dependencies
                    const currentDeps = parentNode.value as SwappableDependency[];
                    if (currentDeps?.some(dep => dep.name === value.trim())) {
                        return 'A swappable dependency group with this name already exists';
                    }
                    return null;
                }
            });

            if (!swappableName) { return; }

            // 2. Prompt for optional flag
            const isOptional = await PromptService.showBooleanPick({
                title: 'Is this swappable dependency group optional?',
                placeholder: 'Select whether this group is required',
                trueLabel: 'Optional',
                falseLabel: 'Required',
                decorator: {
                    validationMessage: 'Optional groups can be excluded from deployment'
                }
            });

            if (isOptional === undefined) { return; }

            // 3. Create the swappable dependency structure
            const newSwappableGroup: SwappableDependency = {
                name: swappableName,
                default_dependency: '',  // Will be set after adding first dependency
                optional: isOptional,
                dependencies: []
            };

            // 4. Add the swappable group to the array
            const currentGroups = (parentNode.value as SwappableDependency[]) || [];
            await this.updateJsonValue(
                parentNode.jsonPath,
                [...currentGroups, newSwappableGroup]
            );

            // 5. Show success message and prompt to add first dependency
            const addFirstDep = await vscode.window.showInformationMessage(
                `Successfully created swappable dependency group: ${swappableName}. Would you like to add the first dependency now?`,
                'Yes',
                'No'
            );

            if (addFirstDep === 'Yes') {
                // Get the path for the dependencies array of the newly added group
                const newGroupIndex = currentGroups.length;
                const dependenciesNode = new CatalogTreeItem(
                    this.context,
                    'dependencies',
                    [],
                    `${parentNode.jsonPath}[${newGroupIndex}].dependencies`,
                    vscode.TreeItemCollapsibleState.None,
                    'array',
                    undefined,
                    parentNode
                );

                // Add the first dependency
                await this.handleDependencyAddition(dependenciesNode);
            }

        } catch (error) {
            this.logger.error('Failed to add swappable dependency group', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to add swappable dependency group: ${message}`);
            throw error;
        }
    }

    /**
     * Determines whether to add a regular dependency or create a new swappable group
     * @param parentNode The parent node where the addition should occur
     */
    private async handleDependencyAddition(parentNode: CatalogTreeItem): Promise<void> {
        this.logger.debug('Starting dependency addition', {
            path: parentNode.jsonPath
        });

        // If we're directly on a dependency object and the path ends with ignore_auto_referencing
        if (parentNode.jsonPath.match(/\.dependencies\[\d+\]$/)) {
            const dependencyValue = parentNode.value as Required<Dependency>;
            if (!dependencyValue.ignore_auto_referencing) {
                // Create the array with "*" as first element
                await this.updateJsonValue(
                    `${parentNode.jsonPath}.ignore_auto_referencing`,
                    ["*"]
                );
                void vscode.window.showInformationMessage('Created ignore_auto_referencing array with "*" as initial value');
            } else {
                // If array exists, prompt to add more items
                await this.handleIgnoreAutoReferencingAddition(parentNode);
            }
            return;
        }

        // If we're directly on the ignore_auto_referencing array
        if (parentNode.jsonPath.endsWith('.ignore_auto_referencing')) {
            await this.handleIgnoreAutoReferencingAddition(parentNode.parent!);
            return;
        }

        // Check if we're dealing with a swappable_dependencies array directly
        if (parentNode.jsonPath.endsWith('.swappable_dependencies')) {
            this.logger.debug('Handling swappable group addition');
            await this.handleSwappableDependencyAddition(parentNode);
            return;
        }

        // Check if we're inside a swappable dependency's dependencies array
        // or in a regular dependencies array
        const isInSwappableDep = /\.swappable_dependencies\[\d+\]\.dependencies$/.test(parentNode.jsonPath);
        const isRegularDepsArray = parentNode.jsonPath.endsWith('.dependencies') && !isInSwappableDep;

        if (isInSwappableDep || isRegularDepsArray) {
            this.logger.debug('Adding regular dependency', {
                path: parentNode.jsonPath,
                isInSwappableDep
            });
            await this.handleRegularDependencyAddition(parentNode);
        } else {
            this.logger.error('Invalid location for dependency addition', {
                path: parentNode.jsonPath
            });
            void vscode.window.showErrorMessage('Cannot add dependency at this location');
        }
    }

    /**
     * Handles adding items to the ignore_auto_referencing array
     * @param dependencyNode The dependency node containing the array
     */
    private async handleIgnoreAutoReferencingAddition(dependencyNode: CatalogTreeItem): Promise<void> {
        try {
            const dependencyValue = dependencyNode.value as Required<Dependency>;
            const currentIgnoreList = dependencyValue.ignore_auto_referencing || [];

            // Get available inputs from the dependency
            const context = {
                catalogId: dependencyValue.catalog_id,
                offeringId: dependencyValue.id,
                version: dependencyValue.version,
                flavorName: dependencyValue.flavors[0]
            };

            let availableInputs: string[] = [];
            const ibmCloudService = await this.getIBMCloudService();

            if (ibmCloudService) {
                const inputMappingService = new InputMappingService(ibmCloudService);
                const options = await inputMappingService.fetchMappingOptions(context);
                availableInputs = options
                    .filter(opt => opt.mappingType === 'input')
                    .map(opt => opt.value);
            }

            // Create quick pick items
            const items: QuickPickItemEx<string>[] = [
                {
                    label: "Wildcard (*)",
                    description: "Ignore all automatic referencing",
                    value: "*",
                    picked: currentIgnoreList.includes("*")
                },
                {
                    label: "Available Inputs",
                    kind: vscode.QuickPickItemKind.Separator
                } as QuickPickItemEx<string>,
                ...availableInputs.map(input => ({
                    label: input,
                    value: input,
                    picked: currentIgnoreList.includes(input)
                }))
            ];

            const result = await PromptService.showQuickPick<string>({
                title: 'Select Inputs to Ignore Auto-Referencing',
                placeholder: 'Select inputs to ignore (Space to select/deselect, Enter to confirm)',
                items,
                canPickMany: true,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (result && result.length > 0) {
                // If "*" is selected, it should be the only item
                const newIgnoreList = result.includes("*") ? ["*"] : result;

                // Update the entire dependency object
                await this.updateJsonValue(
                    dependencyNode.jsonPath,
                    {
                        ...dependencyValue,
                        ignore_auto_referencing: newIgnoreList
                    }
                );

                void vscode.window.showInformationMessage(
                    `Successfully updated ignore_auto_referencing list`
                );
            }

        } catch (error) {
            this.logger.error('Failed to handle ignore_auto_referencing addition', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to update ignore_auto_referencing: ${message}`);
            throw error;
        }
    }

    /**
     * Handles adding a new regular dependency to either a dependencies array 
     * or a swappable dependency group's dependencies array.
     * @param parentNode The parent node representing the dependencies array
     */
    private async handleRegularDependencyAddition(parentNode: CatalogTreeItem): Promise<void> {
        const ibmCloudService = await this.getIBMCloudService();
        if (!ibmCloudService) {
            const result = await vscode.window.showWarningMessage(
                'IBM Cloud API key required to browse catalogs and offerings. Would you like to add one now?',
                'Yes', 'No'
            );

            if (result === 'Yes') {
                await vscode.commands.executeCommand('ibmCatalog.login');
                return this.handleRegularDependencyAddition(parentNode);
            }
            return;
        }

        try {
            // Check if we're inside a swappable dependency for context
            const swappableNode = parentNode.getSwappableDependencyParent();
            const isInSwappable = Boolean(swappableNode);

            this.logger.debug('Adding regular dependency', {
                path: parentNode.jsonPath,
                isInSwappable,
                swappableName: isInSwappable ? (swappableNode?.value as SwappableDependency).name : undefined
            });

            // 1. Select Catalog
            const catalogId = await this.promptForCatalogId();
            if (!catalogId) { return; }

            // 2. Select Offering
            const offeringDetails = await this.promptForOfferingWithDetails(catalogId);
            if (!offeringDetails) { return; }

            // 3. Get version using promptForVersion
            const tempVersionNode = new CatalogTreeItem(
                this.context,
                'version',
                '',
                `${parentNode.jsonPath}[${(parentNode.value as any[]).length}].version`,
                vscode.TreeItemCollapsibleState.None,
                'editable',
                undefined,
                new CatalogTreeItem(
                    this.context,
                    'dependency',
                    {
                        catalog_id: catalogId,
                        id: offeringDetails.id,
                        name: offeringDetails.name
                    },
                    `${parentNode.jsonPath}[${(parentNode.value as any[]).length}]`,
                    vscode.TreeItemCollapsibleState.None,
                    'container',
                    undefined,
                    parentNode
                )
            );

            const versionConstraint = await this.promptForVersion(tempVersionNode);
            if (!versionConstraint) {
                this.logger.debug('Version selection cancelled');
                return;
            }

            // 4. Select Flavors
            const flavors = await ibmCloudService.getAvailableFlavors(
                catalogId,
                offeringDetails.id
            );

            if (!flavors.length) {
                void vscode.window.showWarningMessage('No flavors available for this offering.');
                return;
            }

            const flavorDetails = await Promise.all(
                flavors.map(async (flavorName) => {
                    try {
                        const details = await ibmCloudService.getFlavorDetails(
                            catalogId,
                            offeringDetails.id,
                            flavorName
                        );
                        return {
                            name: flavorName,
                            label: details?.label || flavorName,
                            description: details?.description || 'No description available'
                        };
                    } catch (error) {
                        this.logger.warn(`Failed to fetch details for flavor ${flavorName}`, error);
                        return {
                            name: flavorName,
                            label: flavorName,
                            description: 'No description available'
                        };
                    }
                })
            );

            const selectedFlavors = await PromptService.showQuickPick<string>({
                title: 'Select Flavors',
                placeholder: 'Choose one or more flavors (Space to select, Enter to confirm)',
                items: flavorDetails.map(flavor => ({
                    label: `${flavor.label}`,
                    description: `(${flavor.name})`,
                    detail: flavor.description,
                    value: flavor.name,
                    picked: false,
                    iconPath: new vscode.ThemeIcon('circle-outline')
                })),
                canPickMany: true,
                matchOnDescription: true,
                matchOnDetail: true
            }) as unknown as string[];

            if (!selectedFlavors?.length) {
                void vscode.window.showWarningMessage('At least one flavor must be selected');
                return;
            }

            // 5. Prompt for optional flag
            const isOptional = await PromptService.showBooleanPick({
                title: 'Is this dependency optional?',
                placeholder: 'Select whether this dependency is required',
                trueLabel: 'Optional',
                falseLabel: 'Required'
            });

            if (isOptional === undefined) { return; }

            // 6. Prompt for on_by_default (only if optional is true)
            let onByDefault = false;
            if (isOptional) {
                const onByDefaultResponse = await PromptService.showBooleanPick({
                    title: 'Enable by default?',
                    placeholder: 'Should this optional dependency be enabled by default?',
                    trueLabel: 'Yes, enable by default',
                    falseLabel: 'No, disabled by default'
                });

                if (onByDefaultResponse === undefined) { return; }
                onByDefault = onByDefaultResponse;
            }

            // 7. Create the dependency object
            const newDependency: Dependency = {
                name: offeringDetails.name,
                id: offeringDetails.id,
                version: versionConstraint,
                flavors: selectedFlavors,
                catalog_id: catalogId,
                optional: isOptional,
                on_by_default: onByDefault,
                input_mapping: []
            };

            // 8. Add to the dependencies array
            const currentDependencies = (parentNode.value as Dependency[]) || [];
            await this.updateJsonValue(
                parentNode.jsonPath,
                [...currentDependencies, newDependency]
            );

            // 9. If this is in a swappable dependency and it's the first dependency,
            // ask if it should be the default
            if (isInSwappable && swappableNode && currentDependencies.length === 0) {
                const swappableValue = swappableNode.value as SwappableDependency;
                if (!swappableValue.default_dependency) {
                    const makeDefault = await vscode.window.showQuickPick(
                        ['Yes', 'No'],
                        {
                            title: 'Set as Default',
                            placeHolder: 'Set this as the default dependency?'
                        }
                    );

                    if (makeDefault === 'Yes') {
                        await this.updateJsonValue(
                            `${swappableNode.jsonPath}.default_dependency`,
                            newDependency.name
                        );
                    }
                }
            }

            void vscode.window.showInformationMessage(
                `Successfully added dependency: ${offeringDetails.name}`
            );

        } catch (error) {
            this.logger.error('Failed to add dependency', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to add dependency: ${message}`);
            throw error;
        }
    }

    private async handleConfigurationFieldsEdit(node: CatalogTreeItem): Promise<void> {
        const currentConfig = node.value as CatalogConfiguration[];
        this.logger.debug('Current configuration', { currentConfig });

        // Collect all unique field properties across all configurations
        const fieldProperties = new Set<ConfigurationFieldProperty>();
        currentConfig.forEach(config => {
            Object.keys(config).forEach(key => {
                if (key !== 'key' && config.hasOwnProperty(key)) {
                    fieldProperties.add(key as ConfigurationFieldProperty);
                }
            });
        });
        this.logger.debug('Collected field properties', { fieldProperties: Array.from(fieldProperties) });

        // Create quick pick items for each field property
        const items: QuickPickItemEx<ConfigurationFieldProperty>[] = Array.from(fieldProperties).map(prop => ({
            label: prop,
            description: this.getPropertyDescription(prop),
            picked: false, // Default to unselected
            value: prop
        }));
        this.logger.debug('Quick pick items', { items });

        const selectedProperties = await PromptService.showQuickPick<ConfigurationFieldProperty>({
            title: 'Select Field Properties to Delete',
            placeholder: 'Select properties to delete (key field cannot be removed)',
            canPickMany: true,
            items,
            matchOnDescription: true
        });
        this.logger.debug('Selected properties to delete', { selectedProperties });

        if (!selectedProperties) {
            this.logger.debug('No properties selected, exiting');
            return; // User cancelled or no selection
        }

        // Create new configuration array without the selected properties
        const updatedConfig = currentConfig.map(config => {
            const newConfig: Partial<CatalogConfiguration> = { ...config }; // Start with a copy of the config

            // Remove the selected properties
            selectedProperties.forEach((prop: ConfigurationFieldProperty) => {
                if (prop in newConfig) {
                    delete newConfig[prop];
                    this.logger.debug('Removed property from config', { key: config.key, prop });
                }
            });
            this.logger.debug('New config for key', { key: config.key, newConfig });
            return newConfig as CatalogConfiguration;
        });
        this.logger.debug('Updated configuration', { updatedConfig });

        await this.updateJsonValue(node.jsonPath, updatedConfig);
    }



    private getPropertyDescription(property: ConfigurationFieldProperty): string {
        const descriptions: Record<ConfigurationFieldProperty, string> = {
            'type': 'Data type of the configuration field',
            'default_value': 'Default value if not specified',
            'description': 'Description of the configuration field',
            'required': 'Whether the field is required',
            'display_name': 'Display name for the field',
            'custom_config': 'Custom configuration options'
        };
        return descriptions[property];
    }

    private async getAvailableVersions(catalogId: string, offeringId: string): Promise<string[]> {
        const logger = this.logger;
        const ibmCloudService = await this.getIBMCloudService();
        if (!ibmCloudService) {
            return [];
        }

        try {
            const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);
            const offering = offerings?.find(o => o.id === offeringId);

            if (!offering?.kinds?.[0]?.versions) {
                return [];
            }

            const versions = offering.kinds[0].versions
                .map(v => v.version)
                .filter((v): v is string => !!v)
                .sort((a, b) => -1 * this.compareSemVer(a, b)); // Sort descending

            logger.debug('Available versions', { offeringId, versions });
            return versions;

        } catch (error) {
            logger.error('Failed to fetch versions', error);
            return [];
        }
    }

    private compareSemVer(a: string, b: string): number {
        const cleanA = a.replace(/^[v=\^~<>]*/, '');
        const cleanB = b.replace(/^[v=\^~<>]*/, '');

        const partsA = cleanA.split('.').map(Number);
        const partsB = cleanB.split('.').map(Number);

        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;
            if (numA !== numB) {
                return numA - numB;
            }
        }
        return 0;
    }

    private validateVersionConstraint(value: string): string | null {
        if (!value.trim()) {
            return 'Version constraint cannot be empty';
        }

        // Valid operators and their regex pattern
        const operatorPattern = '(>=|<=|>|<|~|\\^|=|v)?';

        // Version number pattern that allows:
        // - Optional 'v' prefix after operator
        // - Multiple digits in each segment
        // - Optional additional segments (like 1.2.3.4)
        const versionPattern = 'v?\\d+(\\.\\d+)*';

        // Complete regex pattern
        const fullPattern = new RegExp(`^${operatorPattern}${versionPattern}$`);

        if (!fullPattern.test(value)) {
            return 'Invalid version format. Examples: >=1.0.0, v8.14.0, ^2.0.0, >=v8.14.0';
        }

        return null;
    }


    /**
 * Creates a new dependency object with default values.
 * @returns A new Dependency object with default values
 */
    private createDefaultDependency(): Dependency {
        return {
            catalog_id: '',
            id: '',
            name: '',
            version: '',
            flavors: [],
            optional: false,
            on_by_default: false,
            input_mapping: [],
            ignore_auto_referencing: [] // Add this line
        };
    }

    /**
     * Creates a new swappable dependency group.
     * @param name Name for the swappable dependency group
     * @returns A new SwappableDependency object with default values
     */
    private createDefaultSwappableDependency(name: string): SwappableDependency {
        return {
            name,
            default_dependency: '',
            optional: false,
            dependencies: []
        };
    }

    private async promptForOfferingWithDetails(catalogId: string): Promise<{
        id: string;
        name: string;
    } | undefined> {
        const apiKey = await AuthService.getApiKey(this.context);
        if (!apiKey) { return undefined; }

        const ibmCloudService = new IBMCloudService(apiKey);
        const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);

        const result = await PromptService.showQuickPick<{ id: string; name: string; }>({
            title: 'Select Offering',
            placeholder: 'Choose an offering for this dependency',
            items: offerings.map(offering => ({
                label: offering.name || offering.id,
                description: offering.id,
                detail: offering.shortDescription,
                value: {
                    id: offering.id,
                    name: offering.name || offering.id
                }
            }))
        });

        return result;
    }

    /**
     * Handles the addition of a new input mapping with a guided experience.
     * @param parentNode The parent node representing the input mapping array.
     */
    private async handleInputMappingAddition(parentNode: CatalogTreeItem): Promise<void> {
        try {
            // Get existing mappings to filter out already mapped destinations
            const currentMappings = (parentNode.value as any[]) || [];
            const existingVersionInputs = new Set(
                currentMappings.map((mapping: any) => mapping.version_input)
            );
            const existingDependencyInputs = new Set(
                currentMappings
                    .filter((mapping: any) => mapping.value !== undefined)
                    .map((mapping: any) => mapping.dependency_input)
            );

            // 1. Get mapping type (now including version_input as an option)
            const mappingType = await this.promptForMappingType();
            if (!mappingType) {
                return; // User cancelled
            }

            let sourceType: string | undefined;
            let sourceValue: string | undefined;
            let versionInput: string | undefined;
            let referenceVersion: boolean | undefined;
            // Initialize newMapping early since we might need to add to it during the flow
            const newMapping: Record<string, string | boolean | undefined> = {};

            // Only prompt for direction if using version_input or dependency_input as source type
            // and not when using them as targets for value mapping
            if ((mappingType === 'version_input' || mappingType === 'dependency_input') && sourceType !== 'value') {
                // Prompt for reference_version first to determine mapping direction
                const items: QuickPickItemEx<boolean | undefined>[] = [
                    {
                        label: "Use default (false)",
                        description: "Dependency up to parent (↑)",
                        detail: "Maps an input from the dependency up into the parent architecture (default behavior)",
                        value: undefined,
                        iconPath: new vscode.ThemeIcon('arrow-up')
                    },
                    {
                        label: "Parent down to dependency (true)",
                        description: "Parent down to dependency (↓)",
                        detail: "Maps the parent architecture's input down into the dependency input (reference_version: true)",
                        value: true,
                        iconPath: new vscode.ThemeIcon('arrow-down')
                    },
                    {
                        label: "Dependency up to parent (false)",
                        description: "Dependency up to parent (↑)",
                        detail: "Maps an input from the dependency up into the parent architecture (reference_version: false)",
                        value: false,
                        iconPath: new vscode.ThemeIcon('arrow-up')
                    }
                ];

                const directionResult = await PromptService.showQuickPick<boolean | undefined>({
                    title: 'Reference Direction',
                    placeholder: 'Controls the direction of references between the architecture and its dependency',
                    items: items,
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                // Check if user cancelled (no selection made)
                if (directionResult === null) {
                    return;
                }

                referenceVersion = directionResult;
            }

            const promptForVersionInput = async (node: CatalogTreeItem): Promise<string | undefined> => {
                const result = await this.promptForInputMapping(node, existingVersionInputs);
                if (result === undefined) {
                    return undefined;
                }
                // If this is an edit of an existing mapping, allow the current value
                const currentIndex = Number(node.jsonPath.match(/\[(\d+)\]/)?.[1]);
                if (!isNaN(currentIndex) && currentMappings[currentIndex]?.version_input === result) {
                    return result;
                }
                // Otherwise check if it's already mapped
                if (existingVersionInputs.has(result)) {
                    void vscode.window.showErrorMessage(`The destination "${result}" is already mapped. Each destination can only be mapped once.`);
                    return undefined;
                }
                return result;
            };

            const promptForDependencyInput = async (node: CatalogTreeItem): Promise<string | undefined> => {
                const result = await this.promptForInputMapping(node, existingDependencyInputs);
                if (result === undefined) {
                    return undefined;
                }
                // If this is an edit of an existing mapping, allow the current value
                const currentIndex = Number(node.jsonPath.match(/\[(\d+)\]/)?.[1]);
                if (!isNaN(currentIndex) && currentMappings[currentIndex]?.dependency_input === result) {
                    return result;
                }
                // Otherwise check if it's already mapped
                if (existingDependencyInputs.has(result)) {
                    void vscode.window.showErrorMessage(`The destination "${result}" is already mapped with a static value. Each destination can only be mapped once.`);
                    return undefined;
                }
                return result;
            };

            if (mappingType === 'version_input') {
                // Starting with version_input flow
                const tempVersionInputNode = new CatalogTreeItem(
                    this.context,
                    'version_input',
                    '',
                    `${parentNode.jsonPath}[${(parentNode.value as any[]).length}].version_input`,
                    vscode.TreeItemCollapsibleState.None,
                    'editable',
                    undefined,
                    parentNode
                );

                versionInput = await promptForVersionInput(tempVersionInputNode);
                if (versionInput === undefined) {
                    return;
                }

                // Now prompt for the source type, excluding version_input and dependency_output if mapping down
                const excludeTypes = ['version_input'];
                if (referenceVersion === true) {
                    excludeTypes.push('dependency_output');
                }

                sourceType = await this.promptForMappingType({
                    title: `Select source type for mapping to "${versionInput}"`,
                    excludeTypes
                });
                if (!sourceType) {
                    return;
                }

                // Get the source value based on type
                if (sourceType === 'value') {
                    sourceValue = await this.promptForAnyValue();
                } else {
                    const tempSourceNode = new CatalogTreeItem(
                        this.context,
                        sourceType,
                        '',
                        `${parentNode.jsonPath}[${(parentNode.value as any[]).length}].${sourceType}`,
                        vscode.TreeItemCollapsibleState.None,
                        'editable',
                        undefined,
                        parentNode
                    );

                    sourceValue = await this.promptForInputMapping(tempSourceNode);
                }
                if (sourceValue === undefined) {
                    return;
                }

            } else {
                // Original flow - starting with source type
                // If mapping down, don't allow dependency_output
                if (referenceVersion === true && mappingType === 'dependency_output') {
                    void vscode.window.showErrorMessage(
                        'Cannot use dependency_output when mapping parent input to dependency. Please use dependency_input instead.'
                    );
                    return;
                }

                sourceType = mappingType;

                // For value type, first prompt for where to map it (version_input or dependency_input)
                if (mappingType === 'value') {
                    const targetType = await this.promptForMappingType({
                        title: 'Select where to map the value',
                        excludeTypes: ['value', 'dependency_output']
                    });
                    if (!targetType) {
                        return;
                    }
                    // Create temporary node for the target
                    const tempTargetNode = new CatalogTreeItem(
                        this.context,
                        targetType,
                        '',
                        `${parentNode.jsonPath}[${(parentNode.value as any[]).length}].${targetType}`,
                        vscode.TreeItemCollapsibleState.None,
                        'editable',
                        undefined,
                        parentNode
                    );

                    // Use appropriate prompt based on target type
                    const mappingTarget = targetType === 'version_input'
                        ? await promptForVersionInput(tempTargetNode)
                        : await promptForDependencyInput(tempTargetNode);

                    if (mappingTarget === undefined) {
                        return;
                    }

                    // Get the static value to use
                    const staticValue = await this.promptForAnyValue();
                    if (staticValue === undefined) {
                        return;
                    }

                    // Set up the mapping based on target type
                    if (targetType === 'version_input') {
                        sourceType = 'value';
                        sourceValue = staticValue;
                        versionInput = mappingTarget;
                    } else { // dependency_input
                        sourceType = 'dependency_input';
                        sourceValue = mappingTarget;
                        newMapping.value = staticValue;
                    }
                } else {
                    const tempMappingNode = new CatalogTreeItem(
                        this.context,
                        sourceType,
                        '',
                        `${parentNode.jsonPath}[${(parentNode.value as any[]).length}].${sourceType}`,
                        vscode.TreeItemCollapsibleState.None,
                        'editable',
                        undefined,
                        parentNode
                    );

                    sourceValue = await this.promptForInputMapping(tempMappingNode);
                    if (sourceValue === undefined) {
                        return;
                    }

                    // Create temporary node for version_input
                    const tempVersionInputNode = new CatalogTreeItem(
                        this.context,
                        'version_input',
                        '',
                        `${parentNode.jsonPath}[${(parentNode.value as any[]).length}].version_input`,
                        vscode.TreeItemCollapsibleState.None,
                        'editable',
                        undefined,
                        parentNode
                    );

                    versionInput = await promptForVersionInput(tempVersionInputNode);
                    if (versionInput === undefined) {
                        return;
                    }
                }
            }

            // Only create mapping if we have both source type and values
            if (!sourceType || !sourceValue) {
                return;
            }

            // Add the basic mapping properties
            if (sourceType === 'value') {
                // For value type mappings
                newMapping.value = sourceValue;
                if (versionInput !== undefined) {
                    newMapping.version_input = versionInput;
                }
            } else {
                // For all other mapping types
                newMapping[sourceType] = sourceValue;
                if (versionInput !== undefined) {
                    newMapping.version_input = versionInput;
                }
                // If we have a static value to add (from value mapping to dependency_input)
                if (newMapping.value !== undefined) {
                    delete newMapping.version_input;
                }
            }

            // Only include reference_version if using version_input or dependency_input
            if ((mappingType === 'version_input' || mappingType === 'dependency_input') && !newMapping.value) {
                newMapping.reference_version = referenceVersion;
            }

            const currentArray = (parentNode.value as any[]) || [];
            await this.updateJsonValue(parentNode.jsonPath, [...currentArray, newMapping]);

            void vscode.window.showInformationMessage('Successfully added input mapping');

        } catch (error) {
            this.logger.error('Failed to add input mapping', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to add input mapping: ${message}`);
        }
    }

    /**
     * Prompts for reference_version if it's missing from an input mapping
     * @param node The input mapping node
     * @returns True if the user completed the prompt, false if cancelled
     */
    private async promptForMissingReferenceVersion(node: CatalogTreeItem): Promise<boolean> {
        try {
            const mappingValue = node.value as Record<string, any>;

            // Only prompt if reference_version is missing and we have both a version_input and another mapping field
            if (mappingValue.reference_version === undefined &&
                mappingValue.version_input &&
                (mappingValue.dependency_input || mappingValue.dependency_output || mappingValue.value)) {

                const items: QuickPickItemEx<boolean | undefined>[] = [
                    {
                        label: "Use default (false)",
                        description: "Dependency up to parent (↑)",
                        detail: "Maps an input from the dependency up into the parent architecture (default behavior)",
                        value: undefined,
                        iconPath: new vscode.ThemeIcon('arrow-up')
                    },
                    {
                        label: "Parent down to dependency (true)",
                        description: "Parent down to dependency (↓)",
                        detail: "Maps the parent architecture's input down into the dependency input (reference_version: true)",
                        value: true,
                        iconPath: new vscode.ThemeIcon('arrow-down')
                    },
                    {
                        label: "Dependency up to parent (false)",
                        description: "Dependency up to parent (↑)",
                        detail: "Maps an input from the dependency up into the parent architecture (reference_version: false)",
                        value: false,
                        iconPath: new vscode.ThemeIcon('arrow-up')
                    }
                ];

                const result = await PromptService.showQuickPick<boolean | undefined>({
                    title: 'Reference Direction',
                    placeholder: 'Controls the direction of references between the architecture and its dependency',
                    items: items,
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (result === undefined) {
                    return false; // User cancelled
                }

                // Only update if user chose to explicitly set the value
                if (result !== undefined) {
                    // If setting to true (version_input → dependency_input), ensure no dependency_output is present
                    if (result === true && mappingValue.dependency_output) {
                        void vscode.window.showErrorMessage(
                            'Cannot use dependency_output when mapping parent input to dependency. Please use dependency_input instead.'
                        );
                        return false;
                    }

                    await this.updateJsonValue(node.jsonPath, {
                        ...mappingValue,
                        reference_version: result
                    });
                }

                return true;
            }
            return true;
        } catch (error) {
            this.logger.error('Failed to add reference_version', error);
            return false;
        }
    }

    /**
     * Prompts the user to select a mapping type for input mapping addition.
     * @returns The selected mapping type, or undefined if cancelled.
     */
    private async promptForMappingType(options: {
        title?: string;
        excludeTypes?: string[];
    } = {}): Promise<string | undefined> {
        this.logger.debug('Prompting for mapping type', options);

        const baseItems: QuickPickItemEx<string>[] = [
            {
                label: "Version Input",
                description: "Start by selecting the input to map into",
                detail: "Choose a configuration input that will receive the mapped value",
                value: "version_input",
                iconPath: new vscode.ThemeIcon('arrow-right')
            },
            {
                label: "Dependency Input",
                description: "Map an input from this dependency",
                detail: "Creates a mapping with dependency_input field",
                value: "dependency_input",
                iconPath: new vscode.ThemeIcon('symbol-property')
            },
            {
                label: "Dependency Output",
                description: "Map an output from this dependency",
                detail: "Creates a mapping with dependency_output field",
                value: "dependency_output",
                iconPath: new vscode.ThemeIcon('symbol-event')
            },
            {
                label: "Value",
                description: "Set a static value",
                detail: "Creates a mapping with value field",
                value: "value",
                iconPath: new vscode.ThemeIcon('symbol-constant')
            }
        ];

        const items = options.excludeTypes
            ? baseItems.filter(item => !options.excludeTypes?.includes(item.value))
            : baseItems;

        const result = await PromptService.showQuickPick<string>({
            title: options.title || 'Select Input Mapping Type',
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

        if (node.label === 'install_type') {
            return this.promptForInstallType(currentValue as string);
        }

        if (node.label === 'version' && node.getDependencyParent()) {
            return this.promptForVersion(node, currentValue as string);
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
        if (value.toLowerCase() === 'true') { return true; }
        if (value.toLowerCase() === 'false') { return false; }
        if (!isNaN(Number(value))) { return Number(value); }
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
     * Prompts the user to select an install type.
     * @param currentValue The current install type value.
     * @returns The selected install type, or undefined if cancelled.
     */
    private async promptForInstallType(currentValue?: string): Promise<string | undefined> {
        this.logger.debug('Prompting for install type', {
            currentValue
        });

        const installTypes = [
            {
                label: 'Extension',
                description: 'Extends an existing architecture',
                value: 'extension'
            },
            {
                label: 'Fullstack',
                description: 'Complete deployable architecture',
                value: 'fullstack'
            }
        ];

        return PromptService.showQuickPick<string>({
            title: 'Select Install Type',
            placeholder: currentValue || 'Choose an install type',
            items: installTypes.map(type => ({
                label: `${type.value === currentValue ? '$(check) ' : ''}${type.label}`,
                description: type.description,
                value: type.value
            })),
            matchOnDescription: true
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
     * Prompts the user to select a version for a dependency.
     * @param node The catalog tree item representing the version field.
     * @param currentValue The current version value.
     * @returns The selected version, or undefined if cancelled.
     */
    private async promptForVersion(node: CatalogTreeItem, currentValue?: string): Promise<string | undefined> {
        const logger = this.logger;
        const dependencyNode = node.getDependencyParent();
        if (!dependencyNode?.value || typeof dependencyNode.value !== 'object') {
            logger.error('Cannot find dependency context for version selection');
            return undefined;
        }

        // Get dependency details
        const depValue = dependencyNode.value as Record<string, any>;
        const catalogId = depValue.catalog_id;
        const offeringId = depValue.id;

        if (!catalogId || !offeringId) {
            logger.error('Missing catalog_id or offering_id for version selection', { catalogId, offeringId });
            void vscode.window.showErrorMessage('Cannot determine catalog or offering for version selection');
            return undefined;
        }

        // Get IBM Cloud Service instance
        const ibmCloudService = await this.getIBMCloudService();
        if (!ibmCloudService) {
            const result = await vscode.window.showWarningMessage(
                'IBM Cloud API key required to fetch available versions. Would you like to add one now?',
                'Yes', 'No'
            );

            if (result === 'Yes') {
                await vscode.commands.executeCommand('ibmCatalog.login');
                return this.promptForVersion(node, currentValue);
            }
            return this.promptForCustomVersionOnly(currentValue);
        }

        // Fetch available versions
        const versions = await this.getAvailableVersions(catalogId, offeringId);
        if (versions.length === 0) {
            const message = 'No versions found for this offering. Would you like to enter a version constraint manually?';
            const result = await vscode.window.showWarningMessage(message, 'Yes', 'No');
            if (result !== 'Yes') {
                return undefined;
            }
            return this.promptForCustomVersionOnly(currentValue);
        }

        // Set default version constraints
        const latestVersion = versions[0];
        const greaterThanConstraint = `>=${latestVersion}`;
        const caretConstraint = `^${latestVersion}`;
        const tildeConstraint = `~${latestVersion}`;

        // Show version selection dialog with enhanced descriptions
        const selectedVersion = await PromptService.showQuickPick<string>({
            title: 'Select Version Constraint',
            placeholder: 'Choose a version constraint',
            items: [
                {
                    label: `Latest Compatible (${caretConstraint})`,
                    value: caretConstraint,
                    description: 'Updates within major version (^)',
                    detail: 'Example: ^1.2.3 allows updates to 1.x.x but not 2.0.0'
                },
                {
                    label: `Patch Updates Only (${tildeConstraint})`,
                    value: tildeConstraint,
                    description: 'Updates patch version only (~)',
                    detail: 'Example: ~1.2.3 allows updates to 1.2.x but not 1.3.0'
                },
                {
                    label: `Greater Than or Equal (${greaterThanConstraint})`,
                    value: greaterThanConstraint,
                    description: 'Always use newer versions (>=)',
                    detail: 'Example: >=1.2.3 allows updates to any newer version'
                },
                {
                    label: 'Version Range',
                    value: 'range',
                    description: 'Specify a version range',
                    detail: 'Examples: >=1.2.3 <2.0.0, 1.2.3 - 2.0.0'
                },
                {
                    label: 'Custom',
                    value: 'custom',
                    description: 'Enter a custom version constraint',
                    detail: 'Supports: =, >, <, >=, <=, ~, ^, ranges (e.g., ^1.2.3, >=2.0.0 <3.0.0)'
                },
                ...versions.map(version => ({
                    label: `Exact: ${version}`,
                    value: version,
                    description: 'Lock to specific version (=)',
                    detail: `Sets a fixed version: ${version}`
                }))
            ],
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!selectedVersion) {
            return undefined;
        }

        if (selectedVersion === 'custom') {
            return this.promptForCustomVersionOnly(currentValue || caretConstraint);
        }

        if (selectedVersion === 'range') {
            return this.promptForVersionRange(versions);
        }

        return selectedVersion;
    }

    private async promptForVersionRange(availableVersions: string[]): Promise<string | undefined> {
        // First, prompt for range type
        const rangeType = await PromptService.showQuickPick<string>({
            title: 'Select Range Type',
            placeholder: 'Choose how to specify the range',
            items: [
                {
                    label: 'Greater/Less Than Range',
                    value: 'comparison',
                    description: 'Use >= and < operators',
                    detail: 'Example: >=1.2.3 <2.0.0'
                },
                {
                    label: 'Hyphen Range',
                    value: 'hyphen',
                    description: 'Specify inclusive range with hyphen',
                    detail: 'Example: 1.2.3 - 2.0.0'
                }
            ]
        });

        if (!rangeType) {
            return undefined;
        }

        // Prompt for lower bound
        const lowerBound = await PromptService.showQuickPick<string>({
            title: 'Select Lower Bound',
            placeholder: 'Choose the minimum version',
            items: availableVersions.map(version => ({
                label: version,
                value: version,
                description: 'Minimum version (inclusive)'
            }))
        });

        if (!lowerBound) {
            return undefined;
        }

        // Prompt for upper bound
        const upperBound = await PromptService.showQuickPick<string>({
            title: 'Select Upper Bound',
            placeholder: 'Choose the maximum version',
            items: availableVersions
                .filter(v => this.compareSemVer(v, lowerBound) > 0)
                .map(version => ({
                    label: version,
                    value: version,
                    description: 'Maximum version'
                }))
        });

        if (!upperBound) {
            return undefined;
        }

        // Format the range based on type
        if (rangeType === 'hyphen') {
            return `${lowerBound} - ${upperBound}`;
        } else {
            return `>=${lowerBound} <${upperBound}`;
        }
    }

    private async promptForCustomVersionOnly(initialValue?: string): Promise<string | undefined> {
        return PromptService.showInputBox<string>({
            title: 'Enter Version Constraint',
            placeholder: 'e.g., >=1.0.0, ^2.0.0, ~1.2.3, >=1.2.3 <2.0.0, 1.2.3 - 2.0.0',
            initialValue,
            validate: (value) => {
                if (!value.trim()) {
                    return 'Version constraint cannot be empty';
                }

                // Enhanced validation regex to support all formats
                const patterns = [
                    // Basic version with optional v prefix
                    /^v?\d+(\.\d+)*$/,
                    // Operators with version
                    /^([<>]=?|=)\s*v?\d+(\.\d+)*$/,
                    // Caret and tilde ranges
                    /^[~^]v?\d+(\.\d+)*$/,
                    // Hyphen ranges
                    /^v?\d+(\.\d+)*\s*-\s*v?\d+(\.\d+)*$/,
                    // Complex ranges with spaces
                    /^([<>]=?|=)\s*v?\d+(\.\d+)*(\s+([<>]=?|=)\s*v?\d+(\.\d+)*)*$/
                ];

                const isValid = patterns.some(pattern => pattern.test(value));
                if (!isValid) {
                    return 'Invalid version format. Examples: >=1.0.0, ^2.0.0, ~1.2.3, 1.2.3 - 2.0.0, >=1.2.3 <2.0.0';
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
                    this.logger.warn('Failed to fetch details for flavor', {
                        flavorName,
                        error: error instanceof Error ? error.message : String(error),
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
            this.logger.error('Failed to fetch flavors', { error: error instanceof Error ? error.message : String(error) });
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
     * Validates a node in the catalog tree.
     * @param node The node to validate.
     * @returns A promise that resolves to true if the validation was successful, false otherwise.
     */
    public async validateNode(node: CatalogTreeItem): Promise<boolean> {
        try {
            await this.ensureInitialized();

            if (node.label === 'catalog_id' && typeof node.value === 'string') {
                const apiKey = await AuthService.getApiKey(this.context);
                if (!apiKey) {
                    return false;
                }
                const ibmCloudService = new IBMCloudService(apiKey);
                return await ibmCloudService.validateCatalogId(node.value);
            }

            if (node.isOfferingIdInDependency() && typeof node.value === 'string') {
                const apiKey = await AuthService.getApiKey(this.context);
                if (!apiKey) {
                    return false;
                }
                const ibmCloudService = new IBMCloudService(apiKey);
                const catalogId = await this.getCatalogIdForNode(node);
                if (!catalogId) {
                    return false;
                }
                return await ibmCloudService.validateOfferingId(catalogId, node.value);
            }

            if (node.isDependencyFlavor() && typeof node.value === 'string') {
                const apiKey = await AuthService.getApiKey(this.context);
                if (!apiKey) {
                    return false;
                }
                const ibmCloudService = new IBMCloudService(apiKey);
                const dependencyNode = node.parent?.parent;
                if (!dependencyNode) {
                    return false;
                }
                const catalogId = (dependencyNode.value as Record<string, any>)['catalog_id'];
                const offeringId = (dependencyNode.value as Record<string, any>)['id'];
                if (!catalogId || !offeringId) {
                    return false;
                }
                return await ibmCloudService.validateFlavor(catalogId, offeringId, node.value);
            }

            return true;
        } catch (error) {
            this.logger.error('Error validating node', error);
            return false;
        }
    }
}
