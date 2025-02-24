// src/tests/suite/flavorDependency.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import sinon from 'sinon';
import { CatalogService } from '../../services/CatalogService';
import { CatalogTreeItem } from '../../models/CatalogTreeItem';
import { FileSystemService } from '../../services/core/FileSystemService';
import { LoggingService } from '../../services/core/LoggingService';
import { SchemaService } from '../../services/SchemaService';
import { mockCatalogData } from './fixtures/mockData';
import { QuickPickItemEx } from '../../types/prompt';

// Helper function to create mock context
function createMockContext(sandbox: sinon.SinonSandbox): vscode.ExtensionContext {
    return {
        subscriptions: [],
        workspaceState: new class implements vscode.Memento {
            private storage = new Map<string, any>();
            get<T>(key: string): T | undefined;
            get<T>(key: string, defaultValue: T): T;
            get(key: string, defaultValue?: any) {
                return this.storage.get(key) ?? defaultValue;
            }
            update(key: string, value: any): Thenable<void> {
                this.storage.set(key, value);
                return Promise.resolve();
            }
            keys(): readonly string[] {
                return Array.from(this.storage.keys());
            }
        },
        globalState: new class implements vscode.Memento {
            private storage = new Map<string, any>();
            get<T>(key: string): T | undefined;
            get<T>(key: string, defaultValue: T): T;
            get(key: string, defaultValue?: any) {
                return this.storage.get(key) ?? defaultValue;
            }
            update(key: string, value: any): Thenable<void> {
                this.storage.set(key, value);
                return Promise.resolve();
            }
            keys(): readonly string[] {
                return Array.from(this.storage.keys());
            }
            setKeysForSync(keys: readonly string[]): void { }
        },
        secrets: {
            store: async (key: string, value: string) => Promise.resolve(),
            get: async (key: string) => undefined,
            delete: async (key: string) => Promise.resolve(),
            onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
        },
        extensionUri: vscode.Uri.file(''),
        extensionPath: '',
        asAbsolutePath: (relativePath: string) => '',
        storageUri: null,
        globalStorageUri: vscode.Uri.file(''),
        logUri: vscode.Uri.file(''),
        extensionMode: vscode.ExtensionMode.Test,
        environmentVariableCollection: {} as vscode.EnvironmentVariableCollection,
        storagePath: '',
        globalStoragePath: '',
        logPath: ''
    } as unknown as vscode.ExtensionContext;
}

describe('Flavor Dependency Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let context: vscode.ExtensionContext;
    let catalogService: CatalogService;
    let fileSystemStub: sinon.SinonStubbedInstance<FileSystemService>;
    let loggerStub: sinon.SinonStubbedInstance<LoggingService>;
    let schemaServiceStub: sinon.SinonStubbedInstance<SchemaService>;
    let onDidChangeContentEmitter: vscode.EventEmitter<void>;
    let disposables: vscode.Disposable[] = [];
    let executeCommandStub: sinon.SinonStub;

    beforeEach(async () => {
        try {
            sandbox = sinon.createSandbox();

            // Set up event emitter for FileSystemService
            onDidChangeContentEmitter = new vscode.EventEmitter<void>();

            // Set up stubs
            loggerStub = sandbox.createStubInstance(LoggingService);
            sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

            // Create FileSystemService stub with event emitter
            fileSystemStub = sandbox.createStubInstance(FileSystemService);
            Object.defineProperty(fileSystemStub, 'onDidChangeContent', {
                get: () => onDidChangeContentEmitter.event
            });
            sandbox.stub(FileSystemService, 'getInstance').returns(fileSystemStub);

            // Initialize SchemaService stub
            schemaServiceStub = sandbox.createStubInstance(SchemaService);
            schemaServiceStub.isSchemaAvailable.returns(true);

            // Initialize file system state
            fileSystemStub.isInitialized.returns(true);
            fileSystemStub.getCatalogData.resolves(mockCatalogData);
            fileSystemStub.updateJsonValue.resolves();

            // Create command stubs
            executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
            executeCommandStub.callsFake(async (command: string, ...args: any[]) => {
                switch (command) {
                    case 'setContext':
                        return Promise.resolve();
                    default:
                        throw new Error(`Command not found: ${command}`);
                }
            });

            // Prevent duplicate command registration
            sandbox.stub(vscode.commands, 'registerCommand').callsFake((command: string, callback: (...args: any[]) => any) => {
                const disposable = {
                    dispose: () => { }
                };
                disposables.push(disposable);
                return disposable;
            });

            // Create mock context
            context = createMockContext(sandbox);

            // Initialize CatalogService with proper dependencies
            catalogService = new CatalogService(context);
            await catalogService.initialize();
        } catch (error) {
            console.error('Error in beforeEach:', error);
            throw error;
        }
    });

    afterEach(() => {
        onDidChangeContentEmitter.dispose();
        sandbox.restore();
        disposables.forEach(d => d.dispose());
        disposables = [];
    });

    it('should add dependencies to a flavor without existing dependencies', async () => {
        const flavorNode = new CatalogTreeItem(
            context,
            'flavor1',
            { label: 'Flavor 1' },
            '$.products[0].flavors[0]',
            vscode.TreeItemCollapsibleState.None,
            'container'
        );

        const expectedUpdate = {
            label: 'Flavor 1',
            dependencies: [],
            dependency_version_2: true
        };

        // Mock window.showQuickPick to return a properly typed result
        const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
        quickPickStub.resolves({
            label: 'Regular Dependencies',
            description: 'Add a regular dependencies block',
            value: 'dependencies'
        } as QuickPickItemEx<string>);

        await catalogService.addElement(flavorNode);

        // Verify the stub was called with correct arguments
        assert.ok(
            quickPickStub.calledOnce,
            'showQuickPick should be called exactly once'
        );

        // Verify updateJsonValue was called correctly
        assert.ok(
            fileSystemStub.updateJsonValue.calledOnce,
            'updateJsonValue should be called exactly once'
        );

        const [path, value] = fileSystemStub.updateJsonValue.firstCall.args;
        assert.strictEqual(
            path,
            '$.products[0].flavors[0]',
            'JSON path should match the flavor node path'
        );

        // Type check the value before comparison
        const typedValue = value as typeof expectedUpdate;
        assert.strictEqual(
            typedValue.label,
            expectedUpdate.label,
            'Label should match the original flavor'
        );
        assert.deepStrictEqual(
            typedValue.dependencies,
            expectedUpdate.dependencies,
            'Dependencies should be initialized as an empty array'
        );
        assert.strictEqual(
            typedValue.dependency_version_2,
            expectedUpdate.dependency_version_2,
            'dependency_version_2 flag should be set to true'
        );
    });

    it('should handle flavor that already has dependencies', async () => {
        const existingData = {
            label: 'Flavor 1',
            dependencies: [],
            dependency_version_2: true
        };

        const flavorNode = new CatalogTreeItem(
            context,
            'flavor1',
            existingData,
            '$.products[0].flavors[0]',
            vscode.TreeItemCollapsibleState.None,
            'container'
        );

        const expectedUpdate = {
            ...existingData,
            swappable_dependencies: []
        };

        await catalogService.addElement(flavorNode);

        // Verify updateJsonValue was called correctly
        assert.ok(
            fileSystemStub.updateJsonValue.calledOnce,
            'updateJsonValue should be called exactly once'
        );

        const [path, value] = fileSystemStub.updateJsonValue.firstCall.args;
        assert.strictEqual(
            path,
            '$.products[0].flavors[0]',
            'JSON path should match the flavor node path'
        );

        // Type check the value before comparison
        const typedValue = value as typeof expectedUpdate;
        assert.strictEqual(
            typedValue.label,
            expectedUpdate.label,
            'Label should match the original flavor'
        );
        assert.deepStrictEqual(
            typedValue.dependencies,
            expectedUpdate.dependencies,
            'Dependencies array should remain unchanged'
        );
        assert.strictEqual(
            typedValue.dependency_version_2,
            expectedUpdate.dependency_version_2,
            'dependency_version_2 flag should remain true'
        );
        assert.deepStrictEqual(
            typedValue.swappable_dependencies,
            expectedUpdate.swappable_dependencies,
            'swappable_dependencies should be initialized as an empty array'
        );
    });

    it('should preserve existing flavor data when adding dependencies', async () => {
        const existingData = {
            label: 'Flavor 1',
            configuration: [{ key: 'test', value: 'value' }],
            install_type: 'extension'
        } as const;

        const flavorNode = new CatalogTreeItem(
            context,
            'flavor1',
            existingData,
            '$.products[0].flavors[0]',
            vscode.TreeItemCollapsibleState.None,
            'container'
        );

        const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
        quickPickStub.resolves({
            label: 'Regular Dependencies',
            description: 'Add a regular dependencies block',
            value: 'dependencies'
        } as QuickPickItemEx<string>);

        await catalogService.addElement(flavorNode);

        // Verify updateJsonValue was called correctly
        assert.ok(
            fileSystemStub.updateJsonValue.calledOnce,
            'updateJsonValue should be called exactly once'
        );

        const [path, value] = fileSystemStub.updateJsonValue.firstCall.args;
        assert.strictEqual(
            path,
            '$.products[0].flavors[0]',
            'JSON path should match the flavor node path'
        );

        // Type check the value before comparison
        type ExpectedType = typeof existingData & {
            dependencies: [];
            dependency_version_2: boolean;
        };
        const typedValue = value as ExpectedType;

        // Verify all existing properties are preserved
        assert.strictEqual(
            typedValue.label,
            existingData.label,
            'Label should be preserved'
        );
        assert.deepStrictEqual(
            typedValue.configuration,
            existingData.configuration,
            'Configuration should be preserved'
        );
        assert.strictEqual(
            typedValue.install_type,
            existingData.install_type,
            'Install type should be preserved'
        );

        // Verify new properties are added correctly
        assert.deepStrictEqual(
            typedValue.dependencies,
            [],
            'Dependencies should be initialized as an empty array'
        );
        assert.strictEqual(
            typedValue.dependency_version_2,
            true,
            'dependency_version_2 flag should be set to true'
        );
    });

    it('should add dependencies to the flavor', async () => {
        // Define the flavor type that matches both FlavorNodeValue and FlavorObject
        interface FlavorType {
            label: string;
            configuration: Array<{
                key: string;
                type: string;
                default_value?: string | number | boolean;
                required: boolean;
            }>;
            dependencies?: Array<{
                name: string;
                catalog_id?: string;
                offering_id?: string;
                version?: string;
            }>;
            dependency_version_2?: boolean;
        }

        // Set up mock catalog data with a properly structured flavor
        const mockFlavorData: FlavorType = {
            label: 'Flavor 1',
            configuration: [] // Required by FlavorNodeValue
            // No dependencies array initially
        };

        // Update the mock to return our catalog data
        fileSystemStub.getCatalogData.resolves({
            products: [{
                flavors: [mockFlavorData]
            }]
        });

        // Create a flavor node with the correct path pattern and contextValue
        const flavorNode = new CatalogTreeItem(
            context,
            'flavor1',
            mockFlavorData,
            '$.products[0].flavors[0]', // Matches isFlavorNode path pattern
            vscode.TreeItemCollapsibleState.None,
            'flavor_node' // Correct contextValue for flavor nodes
        );

        // Mock the quick pick to simulate user selecting regular dependencies
        const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
        quickPickStub.resolves({
            label: 'Regular Dependencies',
            description: 'Add a regular dependencies block',
            value: 'dependencies'
        } as QuickPickItemEx<string>);

        // Mock the input box for dependency name
        const inputBoxStub = sandbox.stub(vscode.window, 'showInputBox');
        inputBoxStub.resolves('test-dependency');

        await catalogService.addElement(flavorNode);

        // Verify the quick pick was shown for dependency type selection
        assert.ok(
            quickPickStub.calledOnce,
            'showQuickPick should be called once for dependency type selection'
        );

        // Verify updateJsonValue was called with correct arguments
        assert.ok(
            fileSystemStub.updateJsonValue.calledOnce,
            'updateJsonValue should be called once'
        );

        const [path, value] = fileSystemStub.updateJsonValue.firstCall.args;
        assert.strictEqual(
            path,
            '$.products[0].flavors[0]',
            'JSON path should match the flavor node path'
        );

        // Type check and verify the updated value
        const updatedValue = value as FlavorType;
        assert.strictEqual(
            updatedValue.label,
            'Flavor 1',
            'Label should be preserved'
        );
        assert.ok(
            Array.isArray(updatedValue.configuration),
            'configuration should be an array'
        );
        assert.strictEqual(
            updatedValue.dependency_version_2,
            true,
            'dependency_version_2 should be true'
        );
        assert.ok(
            Array.isArray(updatedValue.dependencies),
            'dependencies should be an array'
        );
        assert.strictEqual(
            updatedValue.dependencies?.length,
            0,
            'dependencies should be an empty array'
        );
    });
});