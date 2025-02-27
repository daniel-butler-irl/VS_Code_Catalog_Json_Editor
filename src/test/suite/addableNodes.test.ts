// src/tests/suite/addableNodes.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import sinon from 'sinon';
import { CatalogService } from '../../services/CatalogService';
import { CatalogTreeItem } from '../../models/CatalogTreeItem';
import { CatalogTreeProvider } from '../../providers/CatalogTreeProvider';
import { LoggingService } from '../../services/core/LoggingService';
import { SchemaService } from '../../services/SchemaService';
import { UIStateService } from '../../services/core/UIStateService';
import { SchemaMetadata } from '../../types/schema';
import { mockCatalogData } from './fixtures/mockData';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';

// Helper class for mocking VS Code Memento
class MockMemento implements vscode.Memento {
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

    setKeysForSync(keys: readonly string[]): void {
        // No-op for tests
    }
}

describe('Addable Nodes Functionality', () => {
    let sandbox: sinon.SinonSandbox;
    let catalogService: CatalogService;
    let context: vscode.ExtensionContext;
    let loggerStub: sinon.SinonStubbedInstance<LoggingService>;
    let treeProvider: CatalogTreeProvider;
    let schemaService: SchemaService;
    let uiStateStub: sinon.SinonStubbedInstance<UIStateService>;
    let disposables: vscode.Disposable[] = [];
    let executeCommandStub: sinon.SinonStub;
    let secretsChangeEmitter: vscode.EventEmitter<vscode.SecretStorageChangeEvent>;
    let mockSecrets: { [key: string]: string };

    beforeEach(async () => {
        sandbox = sinon.createSandbox();

        // Create logger stub
        loggerStub = sandbox.createStubInstance(LoggingService);
        sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

        // Create UI state stub
        uiStateStub = sandbox.createStubInstance(UIStateService);
        uiStateStub.getTreeState.returns({ expandedNodes: [] });
        sandbox.stub(UIStateService, 'getInstance').returns(uiStateStub);

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
        secretsChangeEmitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
        mockSecrets = {};
        context = {
            subscriptions: [],
            workspaceState: new MockMemento(),
            globalState: new MockMemento(),
            secrets: {
                store: async (key: string, value: string) => {
                    mockSecrets[key] = value;
                    return Promise.resolve();
                },
                get: async (key: string) => mockSecrets[key],
                delete: async (key: string) => {
                    delete mockSecrets[key];
                    return Promise.resolve();
                },
                onDidChange: secretsChangeEmitter.event
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

        // Initialize services
        catalogService = new CatalogService(context);

        // Initialize tree provider with minimal schema service stub
        const schemaServiceStub = {
            getSchemaForPath: () => Promise.resolve(undefined),
            initialize: () => Promise.resolve(),
            isSchemaAvailable: () => true,
            onDidUpdateSchema: new vscode.EventEmitter<void>().event
        } as unknown as SchemaService;

        treeProvider = new CatalogTreeProvider(catalogService, context, schemaServiceStub);
    });

    afterEach(() => {
        sandbox.restore();
        disposables.forEach(d => d.dispose());
        disposables = [];
    });

    describe('Node Context Handling', () => {
        it('should properly handle regular array context', () => {
            const mockSchema: SchemaMetadata = {
                type: 'array',
                required: false
            };

            const regularArrayNode = new CatalogTreeItem(
                context,
                'array',
                [],
                '$.products[0].array',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema
            );

            assert.strictEqual(regularArrayNode.contextValue, 'array');
            assert.strictEqual(regularArrayNode.jsonPath.endsWith('.dependencies'), false);
            assert.strictEqual(regularArrayNode.isInSwappableDependency(), false);
        });

        it('should properly handle dependency context', () => {
            const mockSchema: SchemaMetadata = {
                type: 'array',
                required: false
            };

            const flavorNode = new CatalogTreeItem(
                context,
                'flavor',
                mockCatalogData.products[0].flavors[0],
                '$.products[0].flavors[0]',
                vscode.TreeItemCollapsibleState.None,
                'container',
                mockSchema
            );

            // Create parent swappable group node
            const swappableGroupNode = new CatalogTreeItem(
                context,
                'group1',
                { name: 'group1', dependencies: [] },
                '$.products[0].flavors[0].swappable_dependencies[0]',
                vscode.TreeItemCollapsibleState.None,
                'container',
                mockSchema,
                flavorNode
            );

            // Test dependencies array within swappable group
            const dependenciesNode = new CatalogTreeItem(
                context,
                'dependencies',
                [],
                '$.products[0].flavors[0].swappable_dependencies[0].dependencies',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema,
                swappableGroupNode
            );

            assert.ok(dependenciesNode.isInSwappableDependency());
            assert.strictEqual(dependenciesNode.contextValue, 'array');
            assert.strictEqual(dependenciesNode.jsonPath.endsWith('.dependencies'), true);
        });

        it('should properly handle regular dependency array', () => {
            const mockSchema: SchemaMetadata = {
                type: 'array',
                required: false
            };

            const flavorNode = new CatalogTreeItem(
                context,
                'flavor',
                mockCatalogData.products[0].flavors[0],
                '$.products[0].flavors[0]',
                vscode.TreeItemCollapsibleState.None,
                'container',
                mockSchema
            );

            const dependenciesNode = new CatalogTreeItem(
                context,
                'dependencies',
                [],
                '$.products[0].flavors[0].dependencies',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema,
                flavorNode
            );

            assert.strictEqual(dependenciesNode.contextValue, 'array');
            assert.strictEqual(dependenciesNode.jsonPath.endsWith('.dependencies'), true);
            assert.strictEqual(dependenciesNode.isInSwappableDependency(), false);
        });

        it('should handle path matching for all dependency types', () => {
            const mockSchema: SchemaMetadata = {
                type: 'array',
                required: false
            };

            // Regular dependencies array
            const dependenciesNode = new CatalogTreeItem(
                context,
                'dependencies',
                [],
                '$.products[0].flavors[0].dependencies',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema
            );

            assert.strictEqual(dependenciesNode.contextValue, 'array');
            assert.strictEqual(dependenciesNode.jsonPath.endsWith('.dependencies'), true);
            assert.strictEqual(dependenciesNode.jsonPath.includes('swappable_dependencies'), false);

            // Swappable dependencies array
            const swappableDepsNode = new CatalogTreeItem(
                context,
                'swappable_dependencies',
                [],
                '$.products[0].flavors[0].swappable_dependencies',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema
            );

            assert.strictEqual(swappableDepsNode.contextValue, 'array');
            assert.strictEqual(swappableDepsNode.jsonPath.endsWith('.swappable_dependencies'), true);

            // Dependencies within swappable group
            const swappableGroupNode = new CatalogTreeItem(
                context,
                'group1',
                { name: 'group1', dependencies: [] },
                '$.products[0].flavors[0].swappable_dependencies[0]',
                vscode.TreeItemCollapsibleState.None,
                'container',
                mockSchema
            );

            const swappableDependenciesNode = new CatalogTreeItem(
                context,
                'dependencies',
                [],
                '$.products[0].flavors[0].swappable_dependencies[0].dependencies',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema,
                swappableGroupNode
            );

            assert.strictEqual(swappableDependenciesNode.contextValue, 'array');
            assert.ok(swappableDependenciesNode.isInSwappableDependency());

            // Regular array (non-dependency)
            const regularArrayNode = new CatalogTreeItem(
                context,
                'someArray',
                [],
                '$.products[0].someArray',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema
            );

            assert.strictEqual(regularArrayNode.contextValue, 'array');
            assert.strictEqual(regularArrayNode.jsonPath.endsWith('.dependencies'), false);
            assert.strictEqual(regularArrayNode.jsonPath.includes('swappable_dependencies'), false);
        });
    });

    describe('Tree Node Identification', () => {
        it('should correctly identify addable dependency nodes', () => {
            const mockSchema: SchemaMetadata = {
                type: 'array',
                required: false,
                description: 'Dependencies array'
            };

            // Regular dependencies array
            const dependenciesNode = new CatalogTreeItem(
                context,
                'dependencies',
                [],
                '$.products[0].flavors[0].dependencies',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema
            );

            assert.strictEqual(dependenciesNode.contextValue, 'array');
            assert.strictEqual(dependenciesNode.jsonPath.endsWith('.dependencies'), true);
            assert.strictEqual(dependenciesNode.jsonPath.includes('swappable_dependencies'), false);

            // Swappable dependencies array
            const swappableDepsNode = new CatalogTreeItem(
                context,
                'swappable_dependencies',
                [],
                '$.products[0].flavors[0].swappable_dependencies',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema
            );

            assert.strictEqual(swappableDepsNode.contextValue, 'array');
            assert.strictEqual(swappableDepsNode.jsonPath.endsWith('.swappable_dependencies'), true);

            // Dependencies within swappable group
            const swappableGroupNode = new CatalogTreeItem(
                context,
                'group1',
                { name: 'group1', dependencies: [] },
                '$.products[0].flavors[0].swappable_dependencies[0]',
                vscode.TreeItemCollapsibleState.None,
                'container',
                mockSchema
            );

            const swappableDependenciesNode = new CatalogTreeItem(
                context,
                'dependencies',
                [],
                '$.products[0].flavors[0].swappable_dependencies[0].dependencies',
                vscode.TreeItemCollapsibleState.None,
                'array',
                mockSchema,
                swappableGroupNode
            );

            assert.strictEqual(swappableDependenciesNode.contextValue, 'array');
            assert.ok(swappableDependenciesNode.isInSwappableDependency());
        });

        it('should properly identify flavor context', () => {
            const mockSchema: SchemaMetadata = {
                type: 'object',
                required: false,
                description: 'Flavor object'
            };

            const flavorNode = new CatalogTreeItem(
                context,
                'flavor',
                mockCatalogData.products[0].flavors[0],
                '$.products[0].flavors[0]',
                vscode.TreeItemCollapsibleState.None,
                'container',
                mockSchema
            );

            assert.strictEqual(flavorNode.contextValue, 'container');
            assert.ok(flavorNode.jsonPath.includes('.flavors['));
            assert.ok(!flavorNode.isInSwappableDependency());
        });
    });
});