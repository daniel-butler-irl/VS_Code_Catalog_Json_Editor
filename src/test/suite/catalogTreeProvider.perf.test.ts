import * as assert from 'assert';
import * as vscode from 'vscode';
import { CatalogTreeProvider } from '../../providers/CatalogTreeProvider';
import { CatalogService } from '../../services/CatalogService';
import { SchemaService } from '../../services/SchemaService';
import { performance } from 'perf_hooks';
import * as sinon from 'sinon';
import { UIStateService } from '../../services/core/UIStateService';
import { CatalogTreeItem } from '../../models/CatalogTreeItem';
import { mockCatalogData } from './fixtures/mockData';
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

    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const expandTime = await measurePerformance(async () => {
        await treeProvider.getChildren(node);
        treeProvider.refresh(node);
      }, 'expand node');
      times.push(expandTime);

      const collapseTime = await measurePerformance(async () => {
        treeProvider.refresh();
      }, 'collapse node');
      times.push(collapseTime);

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERF_THRESHOLDS.RAPID_OP,
      `Average expand/collapse time ${averageTime.toFixed(2)}ms exceeds threshold of ${PERF_THRESHOLDS.RAPID_OP}ms`
    );
  });


  it('should process validation queue efficiently', async function () {
    this.timeout(PERF_THRESHOLDS.STRESS_MEMORY_TIMEOUT_MS);

    const items = await treeProvider.getChildren();
    const testItem = items[0] as CatalogTreeItem;

    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const queueTime = await measurePerformance(async () => {
        await testItem.queueForValidation();
      }, `queue validation for item ${i}`);
      times.push(queueTime);

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERF_THRESHOLDS.RAPID_OP,
      `Average validation queue time ${averageTime.toFixed(2)}ms exceeds threshold of ${PERF_THRESHOLDS.RAPID_OP}ms`
    );
  });

  it('should load and expand large tree efficiently', async function () {
    this.timeout(PERF_THRESHOLDS.STRESS_MEMORY_TIMEOUT_MS);

    const rootItems = await treeProvider.getChildren();
    assert.ok(rootItems.length > 0, 'Root items should not be empty');

    const largeNode = rootItems[0];
    const executionTime = await measurePerformance(async () => {
      await treeProvider.getChildren(largeNode);
    }, 'load and expand large tree');

    assert.ok(
      executionTime < PERF_THRESHOLDS.STRESS_OP,
      `Loading large tree took ${executionTime.toFixed(2)}ms, which exceeds threshold of ${PERF_THRESHOLDS.STRESS_OP}ms`
    );
  });

  it('should update getTreeItem and collapsible state efficiently', async () => {
    const rootItems = await treeProvider.getChildren();
    assert.ok(rootItems.length > 0, 'Root items should not be empty');

    const testItem = rootItems[0] as CatalogTreeItem;
    const executionTime = await measurePerformance(async () => {
      treeProvider.getTreeItem(testItem);
    }, 'getTreeItem and collapsible state update');

    assert.ok(
      executionTime < PERF_THRESHOLDS.STANDARD_OP,
      `getTreeItem execution time ${executionTime.toFixed(2)}ms exceeds threshold of ${PERF_THRESHOLDS.STANDARD_OP}ms`
    );
  });

  it('should handle batch state updates with debounce efficiently', async () => {
    const times: number[] = [];

    for (let i = 0; i < 5; i++) {
      const updateExecutionTime = await measurePerformance(async () => {
        // @ts-ignore - bypass access restriction for testing purposes
        treeProvider['queueStateUpdate']();
      }, `debounced batch state update ${i}`);
      times.push(updateExecutionTime);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERF_THRESHOLDS.RAPID_OP,
      `Average batch update time ${averageTime.toFixed(2)}ms exceeds threshold of ${PERF_THRESHOLDS.RAPID_OP}ms`
    );
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