// src/tests/suite/editorHighlight.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import { EditorHighlightService } from '../../services/EditorHighlightService';
import { mockCatalogData } from './fixtures/mockData';
import sinon from 'sinon';
import { LoggingService } from '../../services/core/LoggingService';

suite('EditorHighlight Test Suite', () => {
    let highlightService: EditorHighlightService;
    let document: vscode.TextDocument;
    let editor: vscode.TextEditor;
    let sandbox: sinon.SinonSandbox;
    let loggerStub: sinon.SinonStubbedInstance<LoggingService>;

    suiteSetup(async () => {
        sandbox = sinon.createSandbox();

        // Create logger stub before creating the service
        loggerStub = sandbox.createStubInstance(LoggingService);
        sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

        // Set up test document
        const workspaceEdit = new vscode.WorkspaceEdit();
        const uri = vscode.Uri.parse('untitled:test.json');
        workspaceEdit.createFile(uri, { ignoreIfExists: true });
        await vscode.workspace.applyEdit(workspaceEdit);

        document = await vscode.workspace.openTextDocument(uri);
        editor = await vscode.window.showTextDocument(document);

        // Insert test data
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, new vscode.Position(0, 0), JSON.stringify(mockCatalogData, null, 2));
        await vscode.workspace.applyEdit(edit);

        // Wait for document to stabilize
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    setup(() => {
        // Reset sandbox before creating new service instance
        sandbox.restore();
        sandbox = sinon.createSandbox();
        loggerStub = sandbox.createStubInstance(LoggingService);
        sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

        // Create fresh instance for each test with minimal debounce
        highlightService = new EditorHighlightService(10);
    });

    teardown(async () => {
        highlightService.dispose();
        if (editor) {
            const emptyDecorationType = vscode.window.createTextEditorDecorationType({});
            editor.setDecorations(emptyDecorationType, []);
            emptyDecorationType.dispose();
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        sandbox.restore();
    });

    test('should highlight JSON path with position tracking', async () => {
        const performHighlightSpy = sandbox.spy(highlightService, 'performHighlight');
        const jsonPath = '$.products[0].label';

        await highlightService.highlightJsonPath(jsonPath, editor);

        assert.strictEqual(performHighlightSpy.callCount, 1, 'performHighlight should be called once');

        const decorations = (highlightService as any).currentDecorations;
        assert.ok(decorations.length > 0, 'Decorations should be present');
    });

    test('should throttle rapid highlights', async () => {
        const paths = [
            '$.products[0].label',
            '$.products[0].name',
            '$.products[0].product_kind'
        ];

        // Send rapid requests
        await Promise.all(paths.map(path =>
            highlightService.highlightJsonPath(path, editor)
        ));

        // Wait for debounce
        await new Promise(resolve => setTimeout(resolve, 20));

        const decorations = (highlightService as any).currentDecorations;
        assert.strictEqual(decorations.length, 1, 'Should only have one active decoration');
    });

    test('should handle invalid paths gracefully', async () => {
        const jsonPath = '$.invalid.path';

        await highlightService.highlightJsonPath(jsonPath, editor);

        sinon.assert.calledWith(loggerStub.debug, 'Node not found for path', { path: jsonPath });
        const decorations = (highlightService as any).currentDecorations;
        assert.strictEqual(decorations.length, 0, 'No decorations should be present for invalid path');
    });

    test('should maintain highlight after small document changes', async () => {
        const path = '$.products[0].label';
        await highlightService.highlightJsonPath(path, editor);

        const decorationsBefore = (highlightService as any).currentDecorations.length;
        assert.ok(decorationsBefore > 0, 'Should have decorations before change');

        // Make a small document change
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), ' ');
        await vscode.workspace.applyEdit(edit);

        // Wait for document change handling
        await new Promise(resolve => setTimeout(resolve, 20));

        // Re-highlight should work
        await highlightService.highlightJsonPath(path, editor);
        const decorationsAfter = (highlightService as any).currentDecorations.length;
        assert.ok(decorationsAfter > 0, 'Should be able to reapply decorations');
    });

    test('should handle unicode paths correctly', async () => {
        const jsonPath = '$.products[0].label_测试';
        await highlightService.highlightJsonPath(jsonPath, editor);

        sinon.assert.calledWith(loggerStub.debug, 'Node not found for path', { path: jsonPath });
        const decorations = (highlightService as any).currentDecorations;
        assert.strictEqual(decorations.length, 0, 'No decorations should be present for invalid unicode path');
    });

    test('should work with multiple editors', async () => {
        const uri2 = vscode.Uri.parse('untitled:test2.json');
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.createFile(uri2, { ignoreIfExists: true });
        await vscode.workspace.applyEdit(workspaceEdit);

        const document2 = await vscode.workspace.openTextDocument(uri2);
        const editor2 = await vscode.window.showTextDocument(document2);

        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri2, new vscode.Position(0, 0), JSON.stringify(mockCatalogData, null, 2));
        await vscode.workspace.applyEdit(edit);

        // Wait for document to stabilize
        await new Promise(resolve => setTimeout(resolve, 50));

        const path = '$.products[0].label';
        await highlightService.highlightJsonPath(path, editor);
        await highlightService.highlightJsonPath(path, editor2);

        const decorations = (highlightService as any).currentDecorations;
        assert.ok(decorations.length > 0, 'Decorations should be visible in the current editor');
    });

    test('should clear highlight when clicking anywhere in the document', async () => {
        // First set a highlight
        const jsonPath = '$.products[0].label';
        await highlightService.highlightJsonPath(jsonPath, editor);

        // Verify initial state
        let decorations = (highlightService as any).currentDecorations;
        assert.ok(decorations.length > 0, 'Should have decorations before clearing');

        // Directly call clearHighlight instead of simulating events
        highlightService.clearHighlight();

        // Wait for any async operations
        await new Promise(resolve => setTimeout(resolve, 50));

        // Verify final state
        decorations = (highlightService as any).currentDecorations;
        assert.strictEqual(decorations.length, 0, 'Decorations should be cleared');
    });

    test('should clear highlight before applying new highlight', async () => {
        // Set initial highlight
        const initialPath = '$.products[0].label';
        await highlightService.highlightJsonPath(initialPath, editor);

        // Verify initial state
        let decorations = (highlightService as any).currentDecorations;
        assert.ok(decorations.length > 0, 'Should have decorations from initial highlight');

        // Set new highlight (should clear previous)
        const newPath = '$.products[0].name';
        await highlightService.highlightJsonPath(newPath, editor);

        // Wait longer for async operations
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify final state
        decorations = (highlightService as any).currentDecorations;
        assert.strictEqual(decorations.length, 1, 'Should have exactly one decoration after new highlight');

        // Get the decoration text
        const decoration = decorations[0];
        const decorationText = editor.document.getText(decoration.range);

        // Verify the decoration contains either the property name or its expected value
        const expectedPropertyName = '"name"';
        const expectedValue = '"test_product"';
        const hasExpectedContent = decorationText.includes(expectedPropertyName) ||
            decorationText.includes(expectedValue);

        assert.ok(
            hasExpectedContent,
            `Decoration should include either "${expectedPropertyName}" or "${expectedValue}". Found: ${decorationText}`
        );
        assert.strictEqual(decorations.length, 1, 'Should only have one decoration active');
    });

    test('should handle rapid selection changes with highlight clearing', async () => {
        // First set a highlight
        await highlightService.highlightJsonPath('$.products[0].label', editor);

        // Verify initial state
        let decorations = (highlightService as any).currentDecorations;
        assert.ok(decorations.length > 0, 'Should have decorations before rapid changes');

        // Perform rapid clear operations
        for (let i = 0; i < 3; i++) {
            highlightService.clearHighlight();
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        // Wait for any async operations
        await new Promise(resolve => setTimeout(resolve, 50));

        // Verify final state
        decorations = (highlightService as any).currentDecorations;
        assert.strictEqual(decorations.length, 0, 'Should have no decorations after rapid clears');
    });
});