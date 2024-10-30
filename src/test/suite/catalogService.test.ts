// src/test/suite/catalogService.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CatalogService } from '../../services/CatalogService';

suite('CatalogService Test Suite', () => {
    let catalogService: CatalogService;
    let testWorkspaceFolder: string;
    let testFilePath: string;

    // Mock VS Code workspace
    const mockWorkspace = {
        workspaceFolders: [{
            uri: {
                fsPath: '',  // Will be set in suiteSetup
            },
            name: 'test-workspace',
            index: 0
        }]
    };

    suiteSetup(async () => {
        // Create a temporary workspace folder
        testWorkspaceFolder = path.join(__dirname, '../../../test-workspace');
        await fs.mkdir(testWorkspaceFolder, { recursive: true });

        // Update mock workspace path
        mockWorkspace.workspaceFolders[0].uri.fsPath = testWorkspaceFolder;

        // Copy test fixture to workspace
        const fixturePath = path.join(__dirname, '../fixtures/sample-catalog.json');
        testFilePath = path.join(testWorkspaceFolder, 'ibm_catalog.json');
        
        await fs.mkdir(path.dirname(testFilePath), { recursive: true });
        await fs.copyFile(fixturePath, testFilePath);

        // Mock VS Code API
        const mockVscode = {
            ...vscode,
            workspace: mockWorkspace
        };

        // Create mock context
        const context = {
            subscriptions: [],
            workspaceState: new Map(),
            globalState: new Map(),
            extensionPath: testWorkspaceFolder
        } as unknown as vscode.ExtensionContext;

        // Initialize service with mocked workspace
        catalogService = new CatalogService(context);
        
        // Replace the workspace in the CatalogService
        (global as any).vscode = mockVscode;
    });

    suiteTeardown(async () => {
        // Clean up test workspace
        await fs.rm(testWorkspaceFolder, { recursive: true, force: true });
        // Restore original vscode
        delete (global as any).vscode;
    });

    test('initialize loads catalog file', async () => {
        await catalogService.initialize();
        const data = await catalogService.getCatalogData();
        assert.ok(data, 'Data should be loaded');
        assert.strictEqual((data as any).name, 'test-catalog');
    });

    test('editElement updates JSON value', async () => {
        await catalogService.initialize();
        
        const mockTreeItem = {
            label: 'name',
            path: 'name',
            value: 'test-catalog'
        };

        // Mock the input box to return a new value
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => 'new-test-catalog';

        try {
            await catalogService.editElement(mockTreeItem as any);
            const data = await catalogService.getCatalogData();
            assert.strictEqual((data as any).name, 'new-test-catalog');
        } finally {
            // Restore original showInputBox
            vscode.window.showInputBox = originalShowInputBox;
        }
    });

    test('addElement adds new value to array', async () => {
        await catalogService.initialize();
        
        const mockParentTreeItem = {
            label: 'offerings',
            path: 'offerings',
            value: []
        };

        // Mock the input box to return a new value
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => '{"name": "new-offering"}';

        try {
            await catalogService.addElement(mockParentTreeItem as any);
            const data = await catalogService.getCatalogData();
            assert.ok(Array.isArray((data as any).offerings));
            assert.strictEqual((data as any).offerings.length, 2);
            assert.strictEqual((data as any).offerings[1].name, 'new-offering');
        } finally {
            // Restore original showInputBox
            vscode.window.showInputBox = originalShowInputBox;
        }
    });
});