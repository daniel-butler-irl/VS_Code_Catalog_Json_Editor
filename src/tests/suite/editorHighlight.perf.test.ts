// src/tests/suite/editorHighlight.perf.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import { EditorHighlightService } from '../../services/EditorHighlightService';
import { generateLargeMockData } from './fixtures/mockData';
import { performance } from 'perf_hooks';
import { DEFAULT_PERFORMANCE_THRESHOLDS, IPerformanceThresholds } from '../../types/performance/thresholds';
import sinon from 'sinon';

suite('EditorHighlight Performance Test Suite', () => {
  const PERF_THRESHOLDS: IPerformanceThresholds = DEFAULT_PERFORMANCE_THRESHOLDS;
  let sandbox: sinon.SinonSandbox;
  let highlightService: EditorHighlightService;
  let document: vscode.TextDocument;
  let editor: vscode.TextEditor;
  let largeDocument: vscode.TextDocument;
  let largeEditor: vscode.TextEditor;

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

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  suiteSetup(function () {
    this.timeout(PERF_THRESHOLDS.TIMEOUT_MS);

    return (async () => {
      // Setup for standard tests
      const workspaceEdit = new vscode.WorkspaceEdit();
      const uri = vscode.Uri.parse('untitled:test.json');
      const largeUri = vscode.Uri.parse('untitled:large_test.json');

      workspaceEdit.createFile(uri, { ignoreIfExists: true });
      workspaceEdit.createFile(largeUri, { ignoreIfExists: true });
      await vscode.workspace.applyEdit(workspaceEdit);

      // Create regular test document
      document = await vscode.workspace.openTextDocument(uri);
      editor = await vscode.window.showTextDocument(document);

      // Create large test document (1MB+ of JSON)
      largeDocument = await vscode.workspace.openTextDocument(largeUri);
      const edit = new vscode.WorkspaceEdit();
      const largeMockData = generateLargeMockData(1000); // Generate 1000 products
      edit.insert(largeUri, new vscode.Position(0, 0), JSON.stringify(largeMockData, null, 2));
      await vscode.workspace.applyEdit(edit);
      largeEditor = await vscode.window.showTextDocument(largeDocument);

      highlightService = new EditorHighlightService();
    })();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    highlightService.dispose();
  });

  test('performance - highlighting in large document', async () => {
    const deepPath = '$.products[999].flavors[0].dependencies[0].input_mapping[0].version_input';
    const executionTime = await measurePerformance(async () => {
      await highlightService.highlightJsonPath(deepPath, largeEditor);
    }, 'highlighting in large document');

    assert.ok(
      executionTime < PERF_THRESHOLDS.LARGE_DOC_THRESHOLD,
      `Highlighting took ${executionTime.toFixed(2)}ms, which exceeds the ${PERF_THRESHOLDS.LARGE_DOC_THRESHOLD}ms threshold`
    );
  });

  test('performance - rapid highlight requests', async () => {
    const paths = [
      '$.products[0].label',
      '$.products[0].name',
      '$.products[0].product_kind',
      '$.products[0].flavors[0].name',
      '$.products[0].flavors[0].dependencies[0].catalog_id'
    ];

    const times: number[] = [];

    for (const path of paths) {
      const executionTime = await measurePerformance(async () => {
        await highlightService.highlightJsonPath(path, largeEditor);
      }, `rapid highlight request for path ${path}`);
      times.push(executionTime);
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    console.log(`Average execution time for rapid highlight requests: ${averageTime.toFixed(2)}ms`);

    assert.ok(
      averageTime < PERF_THRESHOLDS.RAPID_OP,
      `Average highlighting time ${averageTime.toFixed(2)}ms exceeds the ${PERF_THRESHOLDS.RAPID_OP}ms threshold`
    );
  });

  test('performance - highlight after document changes', async () => {
    const path = '$.products[0].label';

    const initialTime = await measurePerformance(async () => {
      await highlightService.highlightJsonPath(path, largeEditor);
    }, 'initial highlight');

    const edit = new vscode.WorkspaceEdit();
    edit.insert(largeDocument.uri, new vscode.Position(0, 0), '\n');
    await vscode.workspace.applyEdit(edit);

    const afterChangeTime = await measurePerformance(async () => {
      await highlightService.highlightJsonPath(path, largeEditor);
    }, 'highlight after document change');

    assert.ok(
      afterChangeTime < PERF_THRESHOLDS.HIGHLIGHT_CHANGE_THRESHOLD,
      `Highlighting after change took ${afterChangeTime.toFixed(2)}ms, which exceeds the ${PERF_THRESHOLDS.HIGHLIGHT_CHANGE_THRESHOLD}ms threshold`
    );

    assert.ok(
      afterChangeTime < initialTime * PERF_THRESHOLDS.DOC_CHANGE_FACTOR,
      `Highlighting after change (${afterChangeTime.toFixed(2)}ms) was too much slower than initial highlight (${initialTime.toFixed(2)}ms)`
    );
  });

  test('performance - highlight multiple JSON paths in succession', async () => {
    const paths = [
      '$.products[10].flavors[0].name',
      '$.products[200].flavors[0].dependencies[0].input_mapping[0].version_input',
      '$.products[500].flavors[1].name',
      '$.products[750].flavors[0].dependencies[0].catalog_id'
    ];

    for (const path of paths) {
      const executionTime = await measurePerformance(async () => {
        await highlightService.highlightJsonPath(path, largeEditor);
      }, `highlight multiple paths - ${path}`);

      assert.ok(
        executionTime < PERF_THRESHOLDS.STANDARD_OP,
        `Highlighting path ${path} took ${executionTime.toFixed(2)}ms, exceeding threshold`
      );
    }
  });

  test('performance - debounce highlight re-triggering', async () => {
    const path = '$.products[999].flavors[0].dependencies[0].input_mapping[0].version_input';

    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const executionTime = await measurePerformance(async () => {
        await highlightService.highlightJsonPath(path, largeEditor);
      }, `debounce re-trigger ${i}`);
      times.push(executionTime);
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERF_THRESHOLDS.RAPID_OP,
      `Average debounce highlight time ${averageTime.toFixed(2)}ms exceeds threshold`
    );
  });

  test('stress - rapid highlights in very large document', async function () {
    // Add timeout specifically for this test
    this.timeout(PERF_THRESHOLDS.STRESS_MEMORY_TIMEOUT_MS);

    const paths = Array.from({ length: 20 }, (_, i) =>
      `$.products[${i * 250}].flavors[0].dependencies[0].input_mapping[0].version_input`
    );

    const times: number[] = [];

    // Spy on the public performHighlight method
    const highlightSpy = sandbox.spy(highlightService, 'performHighlight');

    for (let i = 0; i < paths.length; i++) {
      const executionTime = await measurePerformance(async () => {
        await highlightService.highlightJsonPath(paths[i], largeEditor);
      }, `stress test highlight ${i}`);
      times.push(executionTime);
      // Add small delay between operations to prevent system overload
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const maxTime = Math.max(...times);
    assert.ok(
      maxTime < PERF_THRESHOLDS.STRESS_OP,
      `Maximum highlight time ${maxTime.toFixed(2)}ms exceeds stress threshold of ${PERF_THRESHOLDS.STRESS_OP}ms`
    );

    // Expect 'performHighlight' to be called for each path
    assert.strictEqual(highlightSpy.callCount, paths.length, `performHighlight should be called ${paths.length} times`);
  });

  test('stress - concurrent document modifications and highlights', async () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const executionTime = await measurePerformance(async () => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(largeDocument.uri, new vscode.Position(0, 0), '\n');
        await vscode.workspace.applyEdit(edit);
        await highlightService.highlightJsonPath('$.products[0].label', largeEditor);
      }, `concurrent modification stress test ${i}`);
      times.push(executionTime);
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERF_THRESHOLDS.STRESS_CONCURRENT_THRESHOLD,
      `Average time under stress ${averageTime.toFixed(2)}ms exceeds threshold`
    );
  });

  test('stress - memory usage with large documents', async function () {
    this.timeout(PERF_THRESHOLDS.STRESS_MEMORY_TIMEOUT_MS);

    const initialMemory = process.memoryUsage().heapUsed;

    // Perform multiple operations
    for (let i = 0; i < 100; i++) {
      await highlightService.highlightJsonPath(
        `$.products[${i % 1000}].flavors[0].dependencies[0].catalog_id`,
        largeEditor
      );
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryUsedMB = (finalMemory - initialMemory) / 1024 / 1024;

    console.log(`Memory used during stress test: ${memoryUsedMB.toFixed(2)}MB`);

    assert.ok(
      memoryUsedMB < PERF_THRESHOLDS.MEMORY_LIMIT_MB,
      `Memory usage ${memoryUsedMB.toFixed(2)}MB exceeds limit of ${PERF_THRESHOLDS.MEMORY_LIMIT_MB}MB`
    );
  });

  test('stress - rapid switching between documents', async () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const executionTime = await measurePerformance(async () => {
        await vscode.window.showTextDocument(i % 2 === 0 ? document : largeDocument);
        await highlightService.highlightJsonPath('$.products[0].label');
      }, `document switch stress test ${i}`);
      times.push(executionTime);
    }

    const maxTime = Math.max(...times);
    assert.ok(
      maxTime < PERF_THRESHOLDS.STRESS_OP,
      `Maximum switch and highlight time ${maxTime.toFixed(2)}ms exceeds threshold`
    );
  });
});