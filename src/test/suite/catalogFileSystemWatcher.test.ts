// src/test/suite/catalogFileSystemWatcher.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import { CatalogFileSystemWatcher } from '../../services/CatalogFileSystemWatcher';
import { CatalogService } from '../../services/CatalogService';
import { CatalogTreeProvider } from '../../providers/CatalogTreeProvider';

suite('CatalogFileSystemWatcher Test Suite', () => {
    let fileWatcher: CatalogFileSystemWatcher;
    let mockCatalogService: CatalogService;
    let mockTreeProvider: CatalogTreeProvider;
    let refreshCalled = false;

    setup(() => {
        // Create mocks
        mockCatalogService = {
            initialize: async () => {},
        } as any;

        mockTreeProvider = {
            refresh: () => { refreshCalled = true; }
        } as any;

        fileWatcher = new CatalogFileSystemWatcher(mockCatalogService, mockTreeProvider);
    });

    teardown(() => {
        fileWatcher.dispose();
        refreshCalled = false;
    });

    test('handles file change events with debounce', async () => {
        // Simulate multiple rapid file changes
        const uri = vscode.Uri.file('test/ibm_catalog.json');
        
        // Trigger multiple changes
        for (let i = 0; i < 5; i++) {
            await fileWatcher['debounceFileChange'](uri);
        }

        // Wait for debounce
        await new Promise(resolve => setTimeout(resolve, 400));

        assert.strictEqual(refreshCalled, true);
    });

    test('cleanup on dispose', () => {
        fileWatcher.dispose();
        assert.strictEqual(fileWatcher['isDisposed'], true);
    });
});