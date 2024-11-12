// src/tests/suite/editorHighlight.perf.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import { EditorHighlightService } from '../../services/EditorHighlightService';
import { generateLargeMockData } from './fixtures/mockData';
import { performance } from 'perf_hooks';

suite('EditorHighlight Performance Test Suite', () => {
  let highlightService: EditorHighlightService;
  let document: vscode.TextDocument;
  let editor: vscode.TextEditor;
  let largeDocument: vscode.TextDocument;
  let largeEditor: vscode.TextEditor;
  const PERFORMANCE_THRESHOLD = 50; // ms

  // Helper to measure execution time
  async function measurePerformance(fn: () => Promise<void>): Promise<number> {
    const start = performance.now();
    await fn();
    return performance.now() - start;
  }

  suiteSetup(async () => {
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
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    highlightService.dispose();
  });

  test('performance - highlighting in large document', async () => {
    // Test deep path highlight
    const deepPath = '$.products[999].flavors[0].dependencies[0].input_mapping[0].version_input';
    const executionTime = await measurePerformance(async () => {
      await highlightService.highlightJsonPath(deepPath, largeEditor);
    });

    assert.ok(
      executionTime < PERFORMANCE_THRESHOLD,
      `Highlighting took ${executionTime}ms, which exceeds the ${PERFORMANCE_THRESHOLD}ms threshold`
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

    // Simulate rapid highlight requests
    for (const path of paths) {
      const executionTime = await measurePerformance(async () => {
        await highlightService.highlightJsonPath(path, largeEditor);
      });
      times.push(executionTime);
      // Small delay to simulate rapid but not simultaneous requests
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const averageTime = times.reduce((a, b) => a + b) / times.length;
    assert.ok(
      averageTime < PERFORMANCE_THRESHOLD,
      `Average highlighting time ${averageTime}ms exceeds the ${PERFORMANCE_THRESHOLD}ms threshold`
    );
  });

  test('performance - highlight after document changes', async () => {
    const path = '$.products[0].label';

    // First highlight
    const initialTime = await measurePerformance(async () => {
      await highlightService.highlightJsonPath(path, largeEditor);
    });

    // Make a document change
    const edit = new vscode.WorkspaceEdit();
    edit.insert(largeDocument.uri, new vscode.Position(0, 0), '\n');
    await vscode.workspace.applyEdit(edit);

    // Highlight again
    const afterChangeTime = await measurePerformance(async () => {
      await highlightService.highlightJsonPath(path, largeEditor);
    });

    assert.ok(
      afterChangeTime < PERFORMANCE_THRESHOLD,
      `Highlighting after change took ${afterChangeTime}ms, which exceeds the ${PERFORMANCE_THRESHOLD}ms threshold`
    );

    // Compare times
    assert.ok(
      afterChangeTime < initialTime * 2,
      `Highlighting after change (${afterChangeTime}ms) was significantly slower than initial highlight (${initialTime}ms)`
    );
  });
});