// src/test/suite/catalogTreeProvider.test.ts

import * as assert from 'assert';
import * as vscode from 'vscode';
import { CatalogTreeProvider } from '../../providers/CatalogTreeProvider';
import { CatalogService } from '../../services/CatalogService';
import { CatalogTreeItem } from '../../models/CatalogTreeItem';

suite('CatalogTreeProvider Test Suite', () => {
    let treeProvider: CatalogTreeProvider;
    let mockCatalogService: CatalogService;

    setup(() => {
        // Create mock catalog service
        mockCatalogService = {
            getCatalogData: async () => ({
                name: 'test-catalog',
                version: '1.0.0',
                offerings: []
            })
        } as any;

        treeProvider = new CatalogTreeProvider(mockCatalogService);
    });

    test('getChildren returns root elements for undefined parent', async () => {
        const children = await treeProvider.getChildren();
        assert.strictEqual(children.length, 3); // name, version, offerings
        assert.strictEqual(children[0].label, 'name');
        assert.strictEqual(children[1].label, 'version');
        assert.strictEqual(children[2].label, 'offerings');
    });

    test('getTreeItem returns valid TreeItem', async () => {
        const children = await treeProvider.getChildren();
        const treeItem = treeProvider.getTreeItem(children[0]);
        
        assert.strictEqual(treeItem instanceof vscode.TreeItem, true);
        assert.strictEqual(treeItem.label, 'name');
        assert.strictEqual(treeItem.contextValue, 'editable');
    });

    test('refresh fires tree data change event', async () => {
        let eventFired = false;
        treeProvider.onDidChangeTreeData(() => {
            eventFired = true;
        });

        treeProvider.refresh();
        assert.strictEqual(eventFired, true);
    });
});