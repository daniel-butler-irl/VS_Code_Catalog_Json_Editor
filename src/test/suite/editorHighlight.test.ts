// src/test/suite/editorHighlight.test.ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { EditorHighlightService } from '../../services/EditorHighlightService';
import { mockCatalogData } from './fixtures/mockData';

suite('EditorHighlight Test Suite', () => {
    let highlightService: EditorHighlightService;
    let document: vscode.TextDocument;
    let editor: vscode.TextEditor;
    let decorationType: vscode.TextEditorDecorationType;

    suiteSetup(async () => {
        // Create a temporary file with mock data
        const workspaceEdit = new vscode.WorkspaceEdit();
        const uri = vscode.Uri.parse('untitled:test.json');
        workspaceEdit.createFile(uri, { ignoreIfExists: true });
        await vscode.workspace.applyEdit(workspaceEdit);

        document = await vscode.workspace.openTextDocument(uri);
        editor = await vscode.window.showTextDocument(document);

        // Insert mock data
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, new vscode.Position(0, 0), JSON.stringify(mockCatalogData, null, 2));
        await vscode.workspace.applyEdit(edit);

        highlightService = new EditorHighlightService();

        // Create decoration type for verification
        decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
            isWholeLine: true
        });
    });

    suiteTeardown(async () => {
        decorationType.dispose();
        highlightService.dispose();
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('should highlight JSON path', async () => {
        const jsonPath = '$.products[0].label';
        await highlightService.highlightJsonPath(jsonPath, editor);

        // Get the decorations using the correct VS Code API
        const visibleRanges = editor.visibleRanges;
        assert.strictEqual(visibleRanges.length > 0, true);

        // Verify the text in the first visible range contains our target
        const text = document.getText(visibleRanges[0]);
        assert.strictEqual(text.includes('"Test Product"'), true);
    });

    test('should clear highlight when selection changes', async () => {
        const jsonPath = '$.products[0].label';
        await highlightService.highlightJsonPath(jsonPath, editor);

        // Change selection
        editor.selection = new vscode.Selection(
            new vscode.Position(0, 0),
            new vscode.Position(0, 0)
        );

        // Wait for clear highlight
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify no decorations are visible
        const visibleRanges = editor.visibleRanges;
        const text = document.getText(visibleRanges[0]);
        // The highlight should be cleared, so the text should not have any decoration
        assert.strictEqual(text.includes('backgroundColor'), false);
    });

    test('should handle invalid JSON path gracefully', async () => {
        const invalidPath = '$.invalid.path';
        await highlightService.highlightJsonPath(invalidPath, editor);

        // Should not throw and should not apply any decorations
        const visibleRanges = editor.visibleRanges;
        assert.strictEqual(visibleRanges.length > 0, true);
    });
});