import * as assert from 'assert';
import * as vscode from 'vscode';
import { CatalogTreeProvider } from '../../providers/CatalogTreeProvider';
import { CatalogService } from '../../services/CatalogService';
import { SchemaService } from '../../services/SchemaService';
import { performance } from 'perf_hooks';
import * as sinon from 'sinon';
import { UIStateService } from '../../services/core/UIStateService';
import { CatalogTreeItem } from '../../models/CatalogTreeItem';
import { mockCatalogData, generateLargeMockData } from './fixtures/mockData';
import { DEFAULT_PERFORMANCE_THRESHOLDS, IPerformanceThresholds } from '../../types/performance/thresholds';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { LoggingService } from '../../services/core/LoggingService';

describe('CatalogTreeProvider Performance Test Suite', () => {
  const PERF_THRESHOLDS: IPerformanceThresholds = DEFAULT_PERFORMANCE_THRESHOLDS;
  let treeProvider: CatalogTreeProvider;
  let sandbox: sinon.SinonSandbox;
  let catalogServiceStub: sinon.SinonStubbedInstance<CatalogService>;
  let schemaServiceStub: sinon.SinonStubbedInstance<SchemaService>;
  let loggerStub: sinon.SinonStubbedInstance<LoggingService>;
  let mockContext: Required<Pick<vscode.ExtensionContext, 'subscriptions' | 'workspaceState' | 'globalState' | 'extensionUri'>>;
  let onDidChangeContentEmitter: vscode.EventEmitter<void>;

  /**
   * Measures the execution time of an asynchronous function and logs the result
   * @param fn The async function to measure
   * @param testName The name of the test for logging
   * @returns The execution time in milliseconds
   */
  async function measurePerformance(fn: () => Promise<void>, testName: string): Promise<number> {
    const start = performance.now();
    await fn();
    const duration = performance.now() - start;
    console.log(`Test "${testName}" execution time: ${duration.toFixed(2)}ms`);
    return duration;
  }

  beforeEach(async function () {
    this.timeout(PERF_THRESHOLDS.TIMEOUT_MS);

    // Create new sandbox for each test
    sandbox = sinon.createSandbox();

    // Reset singletons
    (LoggingService as any).instance = undefined;
    (CatalogService as any).instance = undefined;
    (SchemaService as any).instance = undefined;
    (UIStateService as any).instance = undefined;

    // Create event emitter
    onDidChangeContentEmitter = new vscode.EventEmitter<void>();

    // Create logger stub
    loggerStub = sandbox.createStubInstance(LoggingService);
    sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

    // Create service stubs
    catalogServiceStub = sandbox.createStubInstance(CatalogService);
    schemaServiceStub = sandbox.createStubInstance(SchemaService);

    // Setup event emitter for catalog service
    Object.defineProperty(catalogServiceStub, 'onDidChangeContent', {
      get: () => onDidChangeContentEmitter.event
    });

    // Mock context with required properties
    mockContext = {
      subscriptions: [],
      workspaceState: new MockMemento(),
      globalState: new MockMemento(),
      extensionUri: vscode.Uri.file('')
    };

    // Initialize tree provider with stubs
    treeProvider = new CatalogTreeProvider(
      catalogServiceStub,
      mockContext as vscode.ExtensionContext,
      schemaServiceStub
    );

    // Setup default stub behavior
    catalogServiceStub.getCatalogData.resolves(mockCatalogData);
    schemaServiceStub.isSchemaAvailable.returns(true);
  });

  afterEach(() => {
    // Restore all stubs and mocks
    sandbox.restore();
    onDidChangeContentEmitter.dispose();
  });

  it('should handle rapid expand/collapse operations', async () => {
    const node = new CatalogTreeItem(
      {} as vscode.ExtensionContext,
      'test',
      { label: 'Test Node' },
      '$.products[0]',
      vscode.TreeItemCollapsibleState.Collapsed,
      'container'
    );

    // Define the operations to measure
    const expandCollapseOperations = async () => {
      for (let i = 0; i < 100; i++) {
        await treeProvider.getChildren(node);
      }
    };

    // Measure performance
    const duration = await measurePerformance(expandCollapseOperations, 'Expand/Collapse Operations');
    assert.ok(duration < PERF_THRESHOLDS.RAPID_OP, `Expand/collapse operations took too long (${duration}ms)`);
  });

  it('should efficiently render a large product with many flavors', async function () {
    this.timeout(PERF_THRESHOLDS.TIMEOUT_MS * 2);

    // Generate a catalog with a single product that has many flavors
    const numFlavors = 20;
    const largeData = generateLargeMockData(numFlavors);
    catalogServiceStub.getCatalogData.resolves(largeData);

    // Define operations to measure
    const renderLargeTree = async () => {
      const rootItems = await treeProvider.getChildren();
      console.log('Root items:', rootItems.map(item => ({
        label: item.label,
        jsonPath: item.jsonPath,
        contextValue: item.contextValue
      })));
      assert.ok(rootItems.length > 0, 'Root items should not be empty');

      // Find the products array node first
      const productsNode = rootItems.find(item => item.label === 'products');
      console.log('Products node search result:', productsNode ?
        { label: productsNode.label, jsonPath: productsNode.jsonPath } : 'Not found');
      assert.ok(productsNode, 'Products node should exist');

      // Get products children (should include the product)
      const productsChildren = await treeProvider.getChildren(productsNode);
      console.log('Products children:', productsChildren.map(item => ({
        label: item.label,
        jsonPath: item.jsonPath
      })));
      assert.ok(productsChildren.length > 0, 'Products children should not be empty');

      // Get the first product (Single Product)
      const productNode = productsChildren[0];
      console.log('Product node:', productNode ?
        { label: productNode.label, jsonPath: productNode.jsonPath } : 'Not found');
      assert.ok(productNode, 'Product node should exist');

      // Get product children (should include flavors)
      const productChildren = await treeProvider.getChildren(productNode);
      console.log('Product children:', productChildren.map(item => ({
        label: item.label,
        jsonPath: item.jsonPath
      })));
      assert.ok(productChildren.length > 0, 'Product children should not be empty');

      // Find flavors node
      const flavorsNode = productChildren.find(item => item.label === 'flavors');
      console.log('Flavors node search result:', flavorsNode ?
        { label: flavorsNode.label, jsonPath: flavorsNode.jsonPath } : 'Not found');
      assert.ok(flavorsNode, 'Flavors node should exist');

      // Get all flavors
      const flavors = await treeProvider.getChildren(flavorsNode);
      console.log('Flavors count:', flavors.length);
      assert.strictEqual(flavors.length, numFlavors, `Should have ${numFlavors} flavors`);
    };

    // Measure performance
    const duration = await measurePerformance(renderLargeTree, 'Render Large Tree');
    assert.ok(duration < PERF_THRESHOLDS.LARGE_DOC_THRESHOLD, `Large tree rendering took too long (${duration}ms)`);
  });

  it('should handle refreshing the tree view efficiently', async () => {
    // Define operations to measure
    const refreshOperations = async () => {
      for (let i = 0; i < 10; i++) {
        onDidChangeContentEmitter.fire();
        await treeProvider.getChildren();
      }
    };

    // Measure performance
    const duration = await measurePerformance(refreshOperations, 'Tree Refresh Operations');
    assert.ok(duration < PERF_THRESHOLDS.STRESS_OP, `Tree refresh operations took too long (${duration}ms)`);
  });

  // Note: We've updated tests to reflect the extension only supporting
  // a single ibm_catalog.json file in the workspace root with a single product
});

// Mock classes for testing
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