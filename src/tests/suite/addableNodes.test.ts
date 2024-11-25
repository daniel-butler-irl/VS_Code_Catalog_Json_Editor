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

suite('Addable Nodes Functionality', () => {
    let sandbox: sinon.SinonSandbox;
    let catalogService: CatalogService;
    let context: vscode.ExtensionContext;
    let loggerStub: sinon.SinonStubbedInstance<LoggingService>;
    let treeProvider: CatalogTreeProvider;
    let schemaService: SchemaService;
    let uiStateStub: sinon.SinonStubbedInstance<UIStateService>;

    setup(() => {
        sandbox = sinon.createSandbox();
        loggerStub = sandbox.createStubInstance(LoggingService);
        sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

        // Mock UIStateService
        uiStateStub = sandbox.createStubInstance(UIStateService);
        uiStateStub.getTreeState.returns({ expandedNodes: [] });
        sandbox.stub(UIStateService, 'getInstance').returns(uiStateStub);

        context = {
            subscriptions: [],
            extensionPath: '',
            storageUri: vscode.Uri.parse('file:///tmp'),
            globalState: {
                get: sandbox.stub().returns('mock-api-key'),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([])
            },
            workspaceState: {
                get: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([])
            },
            secrets: {
                get: sandbox.stub().resolves(undefined),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves()
            }
        } as unknown as vscode.ExtensionContext;

        catalogService = new CatalogService(context);
        schemaService = new SchemaService();
        treeProvider = new CatalogTreeProvider(catalogService, context, schemaService);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Tree Node Identification Tests', () => {
        test('should correctly identify addable dependency nodes', () => {
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
            assert.strictEqual(regularArrayNode.isInSwappableDependency(), false);
        });

        test('should properly handle dependency context', () => {
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
            assert.strictEqual(dependenciesNode.getSwappableDependencyParent(), swappableGroupNode);
        });

        test('should handle path matching for all dependency types', () => {
            const mockSchema: SchemaMetadata = {
                type: 'array',
                required: false
            };

            const testPaths = [
                {
                    path: '$.products[0].flavors[0].dependencies',
                    expected: { isRegular: true, isSwappable: false }
                },
                {
                    path: '$.products[0].flavors[0].swappable_dependencies',
                    expected: { isRegular: false, isSwappable: false }
                },
                {
                    path: '$.products[0].flavors[0].swappable_dependencies[0].dependencies',
                    expected: { isRegular: false, isSwappable: true }
                }
            ];

            testPaths.forEach(({ path, expected }) => {
                const node = new CatalogTreeItem(
                    context,
                    'test',
                    [],
                    path,
                    vscode.TreeItemCollapsibleState.None,
                    'array',
                    mockSchema
                );

                const isRegular = path.endsWith('.dependencies') && 
                    !path.includes('swappable_dependencies');
                const isSwappable = node.isInSwappableDependency();

                assert.strictEqual(isRegular, expected.isRegular, 
                    `Regular dependency check failed for ${path}`);
                assert.strictEqual(isSwappable, expected.isSwappable, 
                    `Swappable dependency check failed for ${path}`);
            });
        });

        test('should properly identify flavor context', () => {
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

            assert.ok(flavorNode.isFlavorNode());

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

            assert.strictEqual(dependenciesNode.findAncestorFlavorNode(), flavorNode);
        });
    });
});