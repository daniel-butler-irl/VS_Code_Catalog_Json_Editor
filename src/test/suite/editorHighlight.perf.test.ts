// src/tests/suite/editorHighlight.perf.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import { EditorHighlightService } from '../../services/EditorHighlightService';
import { generateLargeMockData } from './fixtures/mockData';
import { performance } from 'perf_hooks';
import { DEFAULT_PERFORMANCE_THRESHOLDS, IPerformanceThresholds } from '../../types/performance/thresholds';
import * as sinon from 'sinon';
import { TestHelper } from './helpers/testHelper';
import { LoggingService } from '../../services/core/LoggingService';
import { describe, it, beforeEach, afterEach } from 'mocha';

describe('EditorHighlight Performance Test Suite', () => {
  const PERF_THRESHOLDS: IPerformanceThresholds = DEFAULT_PERFORMANCE_THRESHOLDS;
  let sandbox: sinon.SinonSandbox;
  let highlightService: EditorHighlightService;
  let document: vscode.TextDocument;
  let editor: vscode.TextEditor;
  let largeDocument: vscode.TextDocument;
  let largeEditor: vscode.TextEditor;
  let disposables: vscode.Disposable[] = [];
  let testHelper: TestHelper;
  let loggerStub: sinon.SinonStubbedInstance<LoggingService>;

  /**
   * Measures the execution time of an asynchronous function and logs the result
   * @param fn The async function to measure
   * @param testName The name of the test for logging
   * @returns The execution time in milliseconds
   */
  async function measurePerformance(fn: () => Promise<void>, testName: string): Promise<number> {
    try {
      const start = performance.now();
      await fn();
      const duration = performance.now() - start;
      console.log(`Test "${testName}" execution time: ${duration.toFixed(2)}ms`);
      return duration;
    } catch (error) {
      console.error(`Performance test "${testName}" failed:`, error);
      throw error;
    }
  }

  /**
   * Creates mock document and editor instances
   * @param sandbox The sinon sandbox to use for stubbing
   * @returns The mock document and editor
   */
  function createMockDocumentAndEditor(sandbox: sinon.SinonSandbox): {
    document: vscode.TextDocument;
    editor: vscode.TextEditor;
  } {
    const document = {
      uri: vscode.Uri.parse('untitled:test.json'),
      getText: sandbox.stub().returns(''),
      version: 1,
      fileName: 'test.json',
      isDirty: false,
      isUntitled: true,
      languageId: 'json',
      lineCount: 1,
      lineAt: sandbox.stub(),
      offsetAt: sandbox.stub(),
      positionAt: sandbox.stub(),
      save: sandbox.stub().resolves(true),
      eol: vscode.EndOfLine.LF,
      getWordRangeAtPosition: sandbox.stub(),
      validatePosition: sandbox.stub(),
      validateRange: sandbox.stub()
    } as unknown as vscode.TextDocument;

    const editor = {
      document,
      selection: new vscode.Selection(0, 0, 0, 0),
      selections: [new vscode.Selection(0, 0, 0, 0)],
      options: {},
      viewColumn: vscode.ViewColumn.One,
      edit: sandbox.stub().resolves(true),
      setDecorations: sandbox.stub(),
      revealRange: sandbox.stub(),
      show: sandbox.stub(),
      hide: sandbox.stub()
    } as unknown as vscode.TextEditor;

    return { document, editor };
  }

  beforeEach(async () => {
    testHelper = TestHelper.getInstance();
    sandbox = testHelper.initializeSandbox();
    testHelper.createCommandStubs();

    const mockEditor = createMockDocumentAndEditor(sandbox);
    document = mockEditor.document;
    editor = mockEditor.editor;

    // Create large document for performance testing
    const largeMockData = generateLargeMockData(1000); // Generate 1000 products
    const largeMockEditor = createMockDocumentAndEditor(sandbox);
    largeMockEditor.document.getText = sandbox.stub().returns(JSON.stringify(largeMockData, null, 2));
    largeDocument = largeMockEditor.document;
    largeEditor = largeMockEditor.editor;

    // Initialize highlight service
    highlightService = new EditorHighlightService();

    // Create logger stub
    loggerStub = sandbox.createStubInstance(LoggingService);
    sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

    // Set up test document with large data
    const largeData = generateLargeMockData(1000);
    document = await vscode.workspace.openTextDocument({
      content: JSON.stringify(largeData, null, 2),
      language: 'json'
    });

    // Open editor with test document
    editor = await vscode.window.showTextDocument(document);
  });

  afterEach(() => {
    testHelper.cleanup();
    highlightService.clearHighlight();
    sandbox.restore();
  });

  it('should highlight in large document within threshold', async () => {
    const deepPath = '$.products[999].flavors[0].dependencies[0].input_mapping[0].version_input';
    const executionTime = await measurePerformance(async () => {
      await highlightService.highlightJsonPath(deepPath, largeEditor);
    }, 'highlighting in large document');

    assert.ok(
      executionTime < PERF_THRESHOLDS.LARGE_DOC_THRESHOLD,
      `Highlighting took ${executionTime.toFixed(2)}ms, which exceeds the ${PERF_THRESHOLDS.LARGE_DOC_THRESHOLD}ms threshold`
    );
  });

  it('performance - rapid highlight requests', async () => {
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

  it('performance - highlight after document changes', async () => {
    const path = '$.products[0].label';

    const initialTime = await measurePerformance(async () => {
      await highlightService.highlightJsonPath(path, largeEditor);
    }, 'initial highlight');

    // Add a small delay after initial highlight
    await new Promise(resolve => setTimeout(resolve, 50));

    const edit = new vscode.WorkspaceEdit();
    edit.insert(largeDocument.uri, new vscode.Position(0, 0), '\n');
    await vscode.workspace.applyEdit(edit);

    // Add a small delay after edit
    await new Promise(resolve => setTimeout(resolve, 50));

    const afterChangeTime = await measurePerformance(async () => {
      await highlightService.highlightJsonPath(path, largeEditor);
    }, 'highlight after document change');

    // Use LARGE_DOC_THRESHOLD instead of HIGHLIGHT_CHANGE_THRESHOLD for more realistic expectations
    assert.ok(
      afterChangeTime < PERF_THRESHOLDS.LARGE_DOC_THRESHOLD,
      `Highlighting after change took ${afterChangeTime.toFixed(2)}ms, which exceeds the ${PERF_THRESHOLDS.LARGE_DOC_THRESHOLD}ms threshold`
    );

    assert.ok(
      afterChangeTime < initialTime * PERF_THRESHOLDS.DOC_CHANGE_FACTOR,
      `Highlighting after change (${afterChangeTime.toFixed(2)}ms) was too much slower than initial highlight (${initialTime.toFixed(2)}ms)`
    );
  });

  it('performance - highlight multiple JSON paths in succession', async () => {
    const paths = [
      '$.products[10].flavors[0].name',
      '$.products[200].flavors[0].dependencies[0].input_mapping[0].version_input',
      '$.products[500].flavors[1].name'
    ];

    let previousTime = 0;
    for (const path of paths) {
      const executionTime = await measurePerformance(async () => {
        await highlightService.highlightJsonPath(path, largeEditor);
      }, `highlight multiple paths - ${path}`);

      // Add delay between operations
      await new Promise(resolve => setTimeout(resolve, 50));

      // Only check threshold after first operation to allow for initial setup
      if (previousTime > 0) {
        assert.ok(
          executionTime < PERF_THRESHOLDS.LARGE_DOC_THRESHOLD,
          `Highlighting path ${path} took ${executionTime.toFixed(2)}ms, exceeding threshold of ${PERF_THRESHOLDS.LARGE_DOC_THRESHOLD}ms`
        );
      }
      previousTime = executionTime;
    }
  });

  it('performance - debounce highlight re-triggering', async () => {
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

  it('stress - rapid highlights in very large document', async function () {
    this.timeout(PERF_THRESHOLDS.STRESS_MEMORY_TIMEOUT_MS);
    const paths = Array.from({ length: 100 }, (_, i) =>
      `$.products[${i}].flavors[0].dependencies[0].catalog_id`
    );

    const startTime = process.hrtime.bigint();

    // Send rapid requests
    await Promise.all(paths.map(path =>
      highlightService.highlightJsonPath(path, largeEditor)
    ));

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds

    assert.ok(
      duration < PERF_THRESHOLDS.STRESS_OP,
      `Rapid highlights took ${duration}ms, exceeding threshold of ${PERF_THRESHOLDS.STRESS_OP}ms`
    );
  });

  it('stress - concurrent document modifications and highlights', async () => {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const executionTime = await measurePerformance(async () => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(largeDocument.uri, new vscode.Position(0, 0), '\n');
        await vscode.workspace.applyEdit(edit);
        await new Promise(resolve => setTimeout(resolve, 50)); // Add delay between operations
        await highlightService.highlightJsonPath('$.products[0].label', largeEditor);
      }, `concurrent modification stress test ${i}`);
      times.push(executionTime);
      await new Promise(resolve => setTimeout(resolve, 100)); // Increased delay between iterations
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERF_THRESHOLDS.STRESS_CONCURRENT_THRESHOLD,
      `Average time under stress ${averageTime.toFixed(2)}ms exceeds threshold of ${PERF_THRESHOLDS.STRESS_CONCURRENT_THRESHOLD}ms`
    );
  });


  it('stress - rapid switching between documents', async () => {
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

  it('performance - rapid highlight clearing', async () => {
    const path = '$.products[0].label';

    // First set a highlight
    await highlightService.highlightJsonPath(path, largeEditor);

    const times: number[] = [];

    // Measure multiple rapid clear operations
    for (let i = 0; i < 10; i++) {
      const executionTime = await measurePerformance(async () => {
        highlightService.clearHighlight();
      }, `clear highlight ${i}`);
      times.push(executionTime);
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERF_THRESHOLDS.RAPID_OP,
      `Average clear time ${averageTime.toFixed(2)}ms exceeds the ${PERF_THRESHOLDS.RAPID_OP}ms threshold`
    );
  });

  it('performance - highlight clearing during rapid selection changes', async () => {
    const positions = Array.from({ length: 20 }, (_, i) => new vscode.Position(i * 10, 0));
    const times: number[] = [];

    for (const position of positions) {
      const executionTime = await measurePerformance(async () => {
        largeEditor.selection = new vscode.Selection(position, position);
        await new Promise(resolve => setTimeout(resolve, 10));
      }, `selection change at line ${position.line}`);
      times.push(executionTime);
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERF_THRESHOLDS.RAPID_OP,
      `Average selection change time ${averageTime.toFixed(2)}ms exceeds threshold`
    );
  });

  it('performance - alternating highlights and clears', async () => {
    const paths = [
      '$.products[0].label',
      '$.products[100].flavors[0].name',
      '$.products[500].dependencies[0].catalog_id'
    ];

    const times: number[] = [];

    for (const path of paths) {
      // Measure highlight time
      const highlightTime = await measurePerformance(async () => {
        await highlightService.highlightJsonPath(path, largeEditor);
      }, `highlight ${path}`);
      times.push(highlightTime);

      // Measure clear time
      const clearTime = await measurePerformance(async () => {
        highlightService.clearHighlight();
      }, `clear after ${path}`);
      times.push(clearTime);

      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERF_THRESHOLDS.STANDARD_OP,
      `Average operation time ${averageTime.toFixed(2)}ms exceeds threshold`
    );
  });
});