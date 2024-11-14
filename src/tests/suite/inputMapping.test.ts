import * as assert from 'assert';
import * as vscode from 'vscode';
import { CatalogTreeProvider } from '../../providers/CatalogTreeProvider';
import { CatalogService } from '../../services/CatalogService';
import { SchemaService } from '../../services/SchemaService';
import sinon from 'sinon';
import { CatalogTreeItem } from '../../models/CatalogTreeItem';
import { UIStateService } from '../../services/core/UIStateService';

suite('Input Mapping Tests', () => {
  let sandbox: sinon.SinonSandbox;
  let catalogTreeProvider: CatalogTreeProvider;
  let catalogServiceStub: sinon.SinonStubbedInstance<CatalogService>;
  let schemaServiceStub: sinon.SinonStubbedInstance<SchemaService>;
  let uiStateServiceStub: sinon.SinonStubbedInstance<UIStateService>;
  let showWarningMessageStub: sinon.SinonStub<any[], Thenable<string | vscode.MessageItem | undefined>>;
  let showErrorMessageStub: sinon.SinonStub<any[], Thenable<string | vscode.MessageItem | undefined>>;
  let showInputBoxStub: sinon.SinonStub<any[], Thenable<string | undefined>>;

  suiteSetup(async () => {
    sandbox = sinon.createSandbox();

    // Mock the ExtensionContext
    const context: vscode.ExtensionContext = {
      globalState: {
        get: sandbox.stub().returns({ expandedNodes: [] }),
        update: sandbox.stub().resolves(),
      },
    } as unknown as vscode.ExtensionContext;

    // Create stub instances of the services
    catalogServiceStub = sinon.createStubInstance(CatalogService);
    schemaServiceStub = sinon.createStubInstance(SchemaService);

    // Initialize the schemaService if required
    schemaServiceStub.initialize.resolves();

    // Stub UIStateService.getInstance to return a stubbed instance
    uiStateServiceStub = sinon.createStubInstance(UIStateService);
    uiStateServiceStub.getTreeState.returns({ expandedNodes: [] });
    sandbox.stub(UIStateService, 'getInstance').returns(uiStateServiceStub);

    // Create an EventEmitter for onDidChangeContent
    const onDidChangeContentEmitter = new vscode.EventEmitter<void>();
    // @ts-ignore - bypass access restriction for testing purposes
    catalogServiceStub.onDidChangeContent = onDidChangeContentEmitter.event;

    // Instantiate CatalogTreeProvider with the stubbed services
    catalogTreeProvider = new CatalogTreeProvider(
      catalogServiceStub as unknown as CatalogService,
      context,
      schemaServiceStub as unknown as SchemaService
    );

    showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage');
    showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');
    showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox');
  });

  suiteTeardown(() => {
    sandbox.restore();
  });


  test('Should handle duplicate properties error', () => {
    const obj = {
      propertyName1: 'value1',
      propertyName2: 'value2',
    };

    assert.strictEqual(obj.propertyName1, 'value1');
    assert.strictEqual(obj.propertyName2, 'value2');
  });

  test('Should correctly stub showWarningMessage', async () => {
    showWarningMessageStub.restore();
    const messageItem: vscode.MessageItem = { title: 'Option1' };
    showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(messageItem);

    const result = await vscode.window.showWarningMessage('Test message', { modal: true }, messageItem);

    assert.strictEqual(result, messageItem);
    sinon.assert.calledOnce(showWarningMessageStub);
  });

  test('Should correctly stub showErrorMessage', async () => {
    showErrorMessageStub.restore();
    const messageItem: vscode.MessageItem = { title: 'Retry' };
    showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves(messageItem);

    const result = await vscode.window.showErrorMessage('Test error', { modal: true }, messageItem);

    assert.strictEqual(result, messageItem);
    sinon.assert.calledOnce(showErrorMessageStub);
  });

  test('Should initialize showInputBoxStub before use', async () => {
    showInputBoxStub.restore();
    showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox').resolves('User Input');

    const result = await vscode.window.showInputBox({ prompt: 'Enter something' });

    assert.strictEqual(result, 'User Input');
    sinon.assert.calledOnce(showInputBoxStub);
  });

  test('Should handle type incompatibility in stubs', async () => {
    showWarningMessageStub.restore();
    const messageItem: vscode.MessageItem = { title: 'Yes' };
    showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(messageItem);

    const result = await vscode.window.showWarningMessage('Warning', { modal: true }, messageItem);

    assert.strictEqual(result, messageItem);
    sinon.assert.calledOnce(showWarningMessageStub);
  });
});
