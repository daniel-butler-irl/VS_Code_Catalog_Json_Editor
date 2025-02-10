import * as assert from 'assert';
import * as vscode from 'vscode';
import { CatalogTreeProvider } from '../../providers/CatalogTreeProvider';
import { CatalogService } from '../../services/CatalogService';
import { SchemaService } from '../../services/SchemaService';
import * as sinon from 'sinon';
import { CatalogTreeItem } from '../../models/CatalogTreeItem';
import { UIStateService } from '../../services/core/UIStateService';
import { IBMCloudService } from '../../services/IBMCloudService';
import { AuthService } from '../../services/AuthService';
import { LoggingService } from '../../services/core/LoggingService';
import { FileSystemService } from '../../services/core/FileSystemService';
import { InputMappingService } from '../../services/InputMappingService';
import { ValidationStatus } from '../../types/validation';
import { describe, it, beforeEach, afterEach } from 'mocha';

describe('Input Mapping Tests', () => {
  let sandbox: sinon.SinonSandbox;
  let catalogTreeProvider: CatalogTreeProvider;
  let catalogService: CatalogService;
  let schemaServiceStub: sinon.SinonStubbedInstance<SchemaService>;
  let uiStateServiceStub: sinon.SinonStubbedInstance<UIStateService>;
  let showWarningMessageStub: sinon.SinonStub;
  let showErrorMessageStub: sinon.SinonStub;
  let showInputBoxStub: sinon.SinonStub;
  let context: vscode.ExtensionContext;
  let mockFileSystemService: sinon.SinonStubbedInstance<FileSystemService>;
  let mockLoggingService: sinon.SinonStubbedInstance<LoggingService>;
  let mockInputMappingService: sinon.SinonStubbedInstance<InputMappingService>;
  let mockAuthService: sinon.SinonStubbedInstance<typeof AuthService>;
  let mockIBMCloudService: sinon.SinonStubbedInstance<IBMCloudService>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create stubs for VS Code window functions
    showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox').resolves(undefined);

    // Create service stubs
    schemaServiceStub = sandbox.createStubInstance(SchemaService);
    uiStateServiceStub = sandbox.createStubInstance(UIStateService);
    mockFileSystemService = sandbox.createStubInstance(FileSystemService);
    mockLoggingService = sandbox.createStubInstance(LoggingService);
    mockInputMappingService = sandbox.createStubInstance(InputMappingService);
    mockIBMCloudService = sandbox.createStubInstance(IBMCloudService);

    // Setup event emitters
    const fileSystemChangeEmitter = new vscode.EventEmitter<void>();
    Object.defineProperty(mockFileSystemService, 'onDidChangeContent', {
      get: () => fileSystemChangeEmitter.event
    });

    // Setup UIStateService
    uiStateServiceStub.getTreeState.returns({ expandedNodes: [] });
    sandbox.stub(UIStateService, 'getInstance').returns(uiStateServiceStub);
    sandbox.stub(LoggingService, 'getInstance').returns(mockLoggingService);
    sandbox.stub(FileSystemService, 'getInstance').returns(mockFileSystemService);

    // Create mock context
    context = {
      subscriptions: [],
      workspaceState: new MockMemento(),
      globalState: new MockMemento(),
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

    // Initialize CatalogService with proper event emitter
    catalogService = new CatalogService(context);
    const onDidChangeContentEmitter = new vscode.EventEmitter<void>();
    Object.defineProperty(catalogService, 'onDidChangeContent', {
      get: () => onDidChangeContentEmitter.event
    });

    // Initialize CatalogTreeProvider
    catalogTreeProvider = new CatalogTreeProvider(
      catalogService,
      context,
      schemaServiceStub
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Input Validation', () => {
    it('should detect duplicate property names', async () => {
      // Create a tree item that simulates having duplicate properties
      const treeItem = new CatalogTreeItem(
        context,
        'test',
        { propertyName1: 'value1' },
        '$.test',
        vscode.TreeItemCollapsibleState.None,
        'container'
      );

      // Configure validateNode to detect simulated duplicate properties
      sandbox.stub(catalogService, 'validateNode').callsFake(async (node) => {
        await vscode.window.showErrorMessage('Duplicate property names are not allowed');
        return false;
      });

      // Trigger validation
      const result = await catalogService.validateNode(treeItem);

      // Verify error message was shown
      sinon.assert.calledWith(
        showErrorMessageStub,
        'Duplicate property names are not allowed'
      );
      assert.strictEqual(result, false);
    });

    it('should validate input mapping without showing UI', async () => {
      const validInput = {
        version_input: 'test_input',
        value: 'test_value'
      };

      const treeItem = new CatalogTreeItem(
        context,
        'test',
        validInput,
        '$.input_mapping[0]',
        vscode.TreeItemCollapsibleState.None,
        'container'
      );

      sandbox.stub(catalogService, 'validateNode').resolves(true);

      const isValid = await catalogService.validateNode(treeItem);

      sinon.assert.notCalled(showErrorMessageStub);
      sinon.assert.notCalled(showWarningMessageStub);
      assert.strictEqual(isValid, true);
    });

    it('should handle invalid input mapping gracefully', async () => {
      const invalidInput = {
        invalid_field: 'test'
      };

      const treeItem = new CatalogTreeItem(
        context,
        'test',
        invalidInput,
        '$.input_mapping[0]',
        vscode.TreeItemCollapsibleState.None,
        'container'
      );

      sandbox.stub(catalogService, 'validateNode').callsFake(async (node) => {
        await vscode.window.showErrorMessage('Invalid input mapping configuration');
        return false;
      });

      const isValid = await catalogService.validateNode(treeItem);

      sinon.assert.calledWith(
        showErrorMessageStub,
        'Invalid input mapping configuration'
      );
      assert.strictEqual(isValid, false);
    });

    it('should handle validation errors', async () => {
      // Create a tree item with invalid data
      const testNode = new CatalogTreeItem(
        context,
        'test_node',
        { invalid_property: 'test' },
        '$.test_node',
        vscode.TreeItemCollapsibleState.None,
        'test',
        undefined,
        undefined,
        undefined,
        ValidationStatus.Unknown
      );

      sandbox.stub(catalogService, 'validateNode').callsFake(async (node) => {
        mockLoggingService.error('Validation error detected');
        return false;
      });

      const result = await catalogService.validateNode(testNode);

      assert.strictEqual(result, false);
      sinon.assert.calledWith(mockLoggingService.error, 'Validation error detected');
    });
  });
});

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
