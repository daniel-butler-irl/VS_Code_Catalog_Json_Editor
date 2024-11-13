import * as assert from 'assert';
import * as vscode from 'vscode';
import { CatalogTreeProvider } from '../../providers/CatalogTreeProvider';
import { CatalogService } from '../../services/CatalogService';
import { SchemaService } from '../../services/SchemaService';
import { performance } from 'perf_hooks';
import sinon from 'sinon';
import { UIStateService } from '../../services/core/UIStateService';
import { CatalogTreeItem } from '../../models/CatalogTreeItem';
import { mockCatalogData } from './fixtures/mockData';
import { DEFAULT_PERFORMANCE_THRESHOLDS, IPerformanceThresholds } from '../../types/performance/thresholds';

suite('CatalogTreeProvider Performance Test Suite', () => {
  const PERF_THRESHOLDS: IPerformanceThresholds = DEFAULT_PERFORMANCE_THRESHOLDS;
  let treeProvider: CatalogTreeProvider;

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

  suiteSetup(async function () {
    this.timeout(PERF_THRESHOLDS.TIMEOUT_MS);

    // Mock ExtensionContext
    const context = {} as vscode.ExtensionContext;

    // Stub UIStateService.getInstance()
    const mockUIStateService = {
      logger: sinon.stub(),
      stateKey: 'mockStateKey',
      state: { treeView: { expandedNodes: [] } },
      debounceSaveTimer: undefined,
      getTreeState: () => ({ expandedNodes: [] }),
      updateTreeState: sinon.stub().resolves(),
      dispose: sinon.stub(),
      saveState: sinon.stub(),
      loadState: sinon.stub().returns({ expandedNodes: [] }),
    } as unknown as UIStateService;
    sinon.stub(UIStateService, 'getInstance').returns(mockUIStateService);

    // Mock CatalogService to use mock data
    const catalogService = new CatalogService(context);
    sinon.stub(catalogService, 'getCatalogData').returns(Promise.resolve(mockCatalogData));

    const schemaService = new SchemaService();
    await schemaService.initialize();

    // Initialize CatalogTreeProvider with the mocked services
    treeProvider = new CatalogTreeProvider(catalogService, context, schemaService);
  });

  suiteTeardown(() => {
    sinon.restore();
    treeProvider.dispose();
  });

  test('performance - load and expand large tree', async function () {
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

  test('performance - rapid expand and collapse', async () => {
    const rootItems = await treeProvider.getChildren();
    const node = rootItems[0];

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

  test('performance - cache clearing on data change', async () => {
    const clearTime = await measurePerformance(async () => {
      // @ts-ignore - bypass access restriction for testing purposes
      treeProvider.clearCaches();
      treeProvider.refresh();
    }, 'clear caches on data change');

    assert.ok(
      clearTime < PERF_THRESHOLDS.STANDARD_OP,
      `Clearing caches took ${clearTime.toFixed(2)}ms, which exceeds threshold of ${PERF_THRESHOLDS.STANDARD_OP}ms`
    );
  });

  test('performance - validation queue processing', async function () {
    this.timeout(PERF_THRESHOLDS.STRESS_MEMORY_TIMEOUT_MS);

    const items = await treeProvider.getChildren();
    const testItem = items[0] as CatalogTreeItem;

    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const queueTime = await measurePerformance(async () => {
        await testItem.queueForValidation();
      }, `queue validation for item ${i}`);
      times.push(queueTime);
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      // @ts-ignore - bypass access restriction for testing purposes
      averageTime < PERF_THRESHOLDS.STANDARD_OP,
      `Average queue processing time ${averageTime.toFixed(2)}ms exceeds threshold of ${PERF_THRESHOLDS.STANDARD_OP}ms`
    );
  });

  test('performance - getTreeItem and collapsible state update', async () => {
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

  test('performance - batch state update with debounce', async () => {
    const times: number[] = [];

    for (let i = 0; i < 5; i++) {
      const updateExecutionTime = await measurePerformance(async () => {
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