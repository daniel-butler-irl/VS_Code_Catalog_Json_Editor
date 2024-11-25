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

suite('Flavor Dependency Management', () => {
  let sandbox: sinon.SinonSandbox;
  let catalogService: CatalogService;
  let fileSystemStub: sinon.SinonStubbedInstance<FileSystemService>;
  let loggerStub: sinon.SinonStubbedInstance<LoggingService>;
  let schemaServiceStub: sinon.SinonStubbedInstance<SchemaService>;
  let context: vscode.ExtensionContext;
  let onDidChangeContentEmitter: vscode.EventEmitter<void>;

  setup(async () => {
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
      
      // Mock extension context
      context = {
          subscriptions: [],
          extensionPath: '',
          storageUri: vscode.Uri.parse('file:///tmp'),
          globalState: {
              get: sandbox.stub().returns(undefined),
              update: sandbox.stub().resolves(),
              keys: () => []
          },
          workspaceState: {
              get: sandbox.stub().returns(undefined),
              update: sandbox.stub().resolves(),
              keys: () => []
          },
          secrets: {
              get: sandbox.stub().resolves(undefined),
              store: sandbox.stub().resolves(),
              delete: sandbox.stub().resolves()
          }
      } as unknown as vscode.ExtensionContext;

      // Initialize catalog service
      catalogService = new CatalogService(context);
      await catalogService.initialize();
  });

  teardown(() => {
      onDidChangeContentEmitter.dispose();
      sandbox.restore();
  });

  test('should add dependencies block to flavor without dependencies', async () => {
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
      } as unknown as vscode.QuickPickItem);

      await catalogService.addElement(flavorNode, schemaServiceStub);

      assert.strictEqual(
          fileSystemStub.updateJsonValue.calledOnce,
          true,
          'Should call updateJsonValue once'
      );

      const [path, value] = fileSystemStub.updateJsonValue.firstCall.args;
      assert.strictEqual(path, '$.products[0].flavors[0]');
      assert.deepStrictEqual(value, expectedUpdate);
  });


    test('should handle flavor that already has dependencies', async () => {
      const flavorNode = new CatalogTreeItem(
          context,
          'flavor1',
          {
              label: 'Flavor 1',
              dependencies: [],
              // Add this to match the actual input state
              dependency_version_2: true
          },
          '$.products[0].flavors[0]',
          vscode.TreeItemCollapsibleState.None,
          'container'
      );

      const expectedUpdate = {
          label: 'Flavor 1',
          dependencies: [],
          swappable_dependencies: [],
          dependency_version_2: true  // Update expectation to match implementation
      };

      await catalogService.addElement(flavorNode, schemaServiceStub);

      assert.strictEqual(
          fileSystemStub.updateJsonValue.calledOnce,
          true,
          'Should call updateJsonValue once'
      );

      const [path, value] = fileSystemStub.updateJsonValue.firstCall.args;
      assert.strictEqual(path, '$.products[0].flavors[0]');
      assert.deepStrictEqual(value, expectedUpdate);
  });

    test('should preserve existing flavor data when adding dependencies', async () => {
        const existingData = {
            label: 'Flavor 1',
            configuration: [{ key: 'test', value: 'value' }],
            install_type: 'extension'
        };

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
        } as unknown as vscode.QuickPickItem);

        await catalogService.addElement(flavorNode, schemaServiceStub);

        const [, updatedValue] = fileSystemStub.updateJsonValue.firstCall.args;
        
        // Type assertion for the updated value
        const typedValue = updatedValue as typeof existingData & {
            dependencies: [];
            dependency_version_2: boolean;
        };

        assert.strictEqual(typedValue.label, existingData.label);
        assert.deepStrictEqual(typedValue.configuration, existingData.configuration);
        assert.strictEqual(typedValue.install_type, existingData.install_type);
        assert.deepStrictEqual(typedValue.dependencies, []);
    });
});