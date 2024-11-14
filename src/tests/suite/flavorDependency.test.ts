// src/tests/suite/flavorDependency.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import { CatalogService } from '../../services/CatalogService';
import { CatalogTreeItem } from '../../models/CatalogTreeItem';
import { SchemaService } from '../../services/SchemaService';
import { FlavorObject } from '../../types/catalog';
import sinon from 'sinon';
import { LoggingService } from '../../services/core/LoggingService';
import { mockCatalogData } from './fixtures/mockData';

/**
 * Test suite for flavor dependency management functionality.
 * Covers the following scenarios:
 * - Adding dependencies to flavors that don't have them
 * - Handling attempts to add dependencies when they already exist
 * - Edge cases and error handling
 * - Dependency version flag management
 */
suite('Flavor Dependency Management Test Suite', () => {
  let catalogService: CatalogService;
  let sandbox: sinon.SinonSandbox;
  let loggerStub: sinon.SinonStubbedInstance<LoggingService>;
  let schemaService: SchemaService;
  let context: vscode.ExtensionContext;

  suiteSetup(async () => {
    // Initialize schema service
    schemaService = new SchemaService();
    await schemaService.initialize();
  });

  setup(() => {
    sandbox = sinon.createSandbox();

    // Create logger stub
    loggerStub = sandbox.createStubInstance(LoggingService);
    sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

    // Mock extension context
    context = {
      subscriptions: [],
      extensionPath: '',
      storageUri: vscode.Uri.parse('file:///tmp'),
      globalState: {
        get: sandbox.stub().returns(undefined),
        update: sandbox.stub().resolves(),
      },
      workspaceState: {
        get: sandbox.stub().returns(undefined),
        update: sandbox.stub().resolves(),
      },
    } as unknown as vscode.ExtensionContext;

    catalogService = new CatalogService(context);
  });

  teardown(() => {
    sandbox.restore();
  });

  /**
   * Tests adding dependencies to a flavor that doesn't have them.
   */
  test('should add dependencies block to flavor without dependencies', async () => {
    // Create a mock flavor node
    const initialFlavor: FlavorObject = {
      label: "Test Flavor",
      name: "test_flavor",
      licenses: [],
      configuration: [],
      install_type: "extension"
    };

    const flavorNode = new CatalogTreeItem(
      context,
      'test-flavor',
      initialFlavor,
      "$.products[0].flavors[0]",
      vscode.TreeItemCollapsibleState.None,
      'container'
    );

    // Stub the updateJsonValue method
    const updateStub = sandbox.stub(catalogService, 'updateJsonValue').resolves();

    // Add dependencies to the flavor
    await catalogService.addElement(flavorNode, schemaService);

    // Verify the update was called with correct parameters
    sinon.assert.calledOnce(updateStub);
    const updateCall = updateStub.getCall(0);
    const updatedValue = updateCall.args[1] as FlavorObject;

    assert.strictEqual(Array.isArray(updatedValue.dependencies), true, 'Dependencies should be an array');
    assert.strictEqual(updatedValue.dependency_version_2, true, 'dependency_version_2 flag should be true');
    sinon.assert.calledWith(loggerStub.debug, 'Handling dependencies addition to flavor');
  });

  /**
   * Tests attempting to add dependencies to a flavor that already has them.
   */
  test('should handle flavor that already has dependencies', async () => {
    const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage');

    const existingFlavor: FlavorObject = {
      label: "Test Flavor",
      name: "test_flavor",
      dependencies: [], // Already has dependencies
      dependency_version_2: true,
      licenses: [],
      configuration: [],
      install_type: "extension"
    };

    const flavorNode = new CatalogTreeItem(
      context,
      'test-flavor',
      existingFlavor,
      "$.products[0].flavors[0]",
      vscode.TreeItemCollapsibleState.None,
      'container'
    );

    await catalogService.addElement(flavorNode, schemaService);

    sinon.assert.calledWith(
      showInfoStub,
      'Dependencies block already exists in this flavor'
    );
  });

  /**
     * Tests error handling when adding dependencies fails.
     */
  test('should handle errors when adding dependencies', async () => {
    const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
    const expectedError = new Error('Update failed');
    const updateStub = sandbox.stub(catalogService, 'updateJsonValue')
      .rejects(expectedError);

    const initialFlavor: FlavorObject = {
      label: "Test Flavor",
      name: "test_flavor",
      licenses: [],
      configuration: [],
      install_type: "extension"
    };

    const flavorNode = new CatalogTreeItem(
      context,
      'test-flavor',
      initialFlavor,
      "$.products[0].flavors[0]",
      vscode.TreeItemCollapsibleState.None,
      'container'
    );

    // Use try-catch here to handle the expected error
    try {
      await catalogService.addElement(flavorNode, schemaService);
      assert.fail('Should have thrown an error');
    } catch (error) {
      // Verify error was logged
      sinon.assert.calledWith(loggerStub.error, 'Failed to add dependencies to flavor', expectedError);

      // Verify error message was shown
      sinon.assert.calledWith(
        showErrorStub,
        'Failed to add dependencies: Update failed'
      );

      // Verify the error was propagated
      assert.strictEqual(error, expectedError);
    }
  });

  /**
   * Tests that the isFlavorNode method correctly identifies flavor nodes.
   */
  test('should correctly identify flavor nodes', () => {
    const validFlavorPath = "$.products[0].flavors[0]";
    const invalidFlavorPath = "$.products[0].flavors[0].dependencies[0]";

    const flavorData: FlavorObject = {
      label: "Test Flavor",
      name: "test_flavor",
      licenses: [],
      configuration: [],
      install_type: "extension"
    };

    const validNode = new CatalogTreeItem(
      context,
      'test-flavor',
      flavorData,
      validFlavorPath,
      vscode.TreeItemCollapsibleState.None,
      'container'
    );

    const invalidNode = new CatalogTreeItem(
      context,
      'dependency',
      {},
      invalidFlavorPath,
      vscode.TreeItemCollapsibleState.None,
      'container'
    );

    assert.strictEqual(
      (catalogService as any).isFlavorNode(validNode),
      true,
      'Should identify valid flavor node'
    );
    assert.strictEqual(
      (catalogService as any).isFlavorNode(invalidNode),
      false,
      'Should reject non-flavor node'
    );
  });

  /**
   * Tests that dependency handling preserves existing flavor data.
   */
  test('should preserve existing flavor data when adding dependencies', async () => {
    const existingData: FlavorObject = {
      label: "Test Flavor",
      name: "test_flavor",
      licenses: [{ id: "test", name: "test", type: "test/plain", description: "test" }],
      configuration: [{ key: "test", type: "string" }],
      install_type: "extension"
    };

    const flavorNode = new CatalogTreeItem(
      context,
      'test-flavor',
      existingData,
      "$.products[0].flavors[0]",
      vscode.TreeItemCollapsibleState.None,
      'container'
    );

    const updateStub = sandbox.stub(catalogService, 'updateJsonValue').resolves();

    await catalogService.addElement(flavorNode, schemaService);

    sinon.assert.calledOnce(updateStub);
    const updatedValue = updateStub.getCall(0).args[1] as FlavorObject;

    // Verify all existing data was preserved
    Object.entries(existingData).forEach(([key, value]) => {
      assert.deepStrictEqual(
        updatedValue[key as keyof FlavorObject],
        value,
        `Should preserve existing ${key} value`
      );
    });

    // Verify new fields were added
    assert.strictEqual(Array.isArray(updatedValue.dependencies), true);
    assert.strictEqual(updatedValue.dependency_version_2, true);
  });

  /**
     * Tests that dependency_version_2 flag is not duplicated when already present.
     */
  test('should not duplicate dependency_version_2 flag when it exists', async () => {
    const existingData: FlavorObject = {
      label: "Test Flavor",
      name: "test_flavor",
      licenses: [],
      configuration: [],
      install_type: "extension",
      dependency_version_2: true // Already exists
    };

    const flavorNode = new CatalogTreeItem(
      context,
      'test-flavor',
      existingData,
      "$.products[0].flavors[0]",
      vscode.TreeItemCollapsibleState.None,
      'container'
    );

    const updateStub = sandbox.stub(catalogService, 'updateJsonValue').resolves();

    await catalogService.addElement(flavorNode, schemaService);

    sinon.assert.calledOnce(updateStub);
    const updatedValue = updateStub.getCall(0).args[1] as FlavorObject;

    // Verify dependency_version_2 is still true but not duplicated
    const keys = Object.keys(updatedValue);
    const versionFlagCount = keys.filter(key => key === 'dependency_version_2').length;
    assert.strictEqual(versionFlagCount, 1, 'Should have exactly one dependency_version_2 flag');
    assert.strictEqual(updatedValue.dependency_version_2, true, 'dependency_version_2 should remain true');
  });

  /**
   * Tests that dependency_version_2 flag is added when missing.
   */
  test('should add dependency_version_2 flag when missing', async () => {
    const existingData: FlavorObject = {
      label: "Test Flavor",
      name: "test_flavor",
      licenses: [],
      configuration: [],
      install_type: "extension"
      // No dependency_version_2 flag
    };

    const flavorNode = new CatalogTreeItem(
      context,
      'test-flavor',
      existingData,
      "$.products[0].flavors[0]",
      vscode.TreeItemCollapsibleState.None,
      'container'
    );

    const updateStub = sandbox.stub(catalogService, 'updateJsonValue').resolves();

    await catalogService.addElement(flavorNode, schemaService);

    sinon.assert.calledOnce(updateStub);
    const updatedValue = updateStub.getCall(0).args[1] as FlavorObject;

    // Verify dependency_version_2 was added and is true
    assert.strictEqual(updatedValue.dependency_version_2, true, 'dependency_version_2 should be added as true');
  });

  /**
 * Tests that dependency_version_2 flag remains false if explicitly set to false.
 */
  test('should preserve false dependency_version_2 flag', async () => {
    const existingData: FlavorObject = {
      label: "Test Flavor",
      name: "test_flavor",
      licenses: [],
      configuration: [],
      install_type: "extension",
      dependency_version_2: false // Explicitly set to false
    };

    const flavorNode = new CatalogTreeItem(
      context,
      'test-flavor',
      existingData,
      "$.products[0].flavors[0]",
      vscode.TreeItemCollapsibleState.None,
      'container'
    );

    const updateStub = sandbox.stub(catalogService, 'updateJsonValue').resolves();

    await catalogService.addElement(flavorNode, schemaService);

    sinon.assert.calledOnce(updateStub);
    const updatedValue = updateStub.getCall(0).args[1] as FlavorObject;

    // Verify both that dependencies were added and dependency_version_2 remained false
    assert.strictEqual(Array.isArray(updatedValue.dependencies), true, 'Dependencies should be added');
    assert.deepStrictEqual(updatedValue.dependencies, [], 'Dependencies should be empty array');
    assert.strictEqual(updatedValue.dependency_version_2, false, 'dependency_version_2 should remain false');

    // Verify all other properties were preserved
    assert.strictEqual(updatedValue.label, existingData.label);
    assert.strictEqual(updatedValue.name, existingData.name);
    assert.deepStrictEqual(updatedValue.licenses, existingData.licenses);
    assert.deepStrictEqual(updatedValue.configuration, existingData.configuration);
    assert.strictEqual(updatedValue.install_type, existingData.install_type);
  });
});