// src/tests/suite/cacheService.test.ts

import * as assert from 'assert';
import { CacheService } from '../../services/CacheService';
import { CacheConfig } from '../../types/cache/cacheConfig';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { LoggingService } from '../../services/core/LoggingService';

suite('CacheService Test Suite', () => {
    let cacheService: CacheService;
    let clock: sinon.SinonFakeTimers;
    let mockExtensionContext: vscode.ExtensionContext;

    const testConfig: CacheConfig = {
        ttlSeconds: 3600,
        persistent: true,
        storagePrefix: 'test_'
    };

    const shortConfig: CacheConfig = {
        ttlSeconds: 1,
        persistent: false,
        storagePrefix: 'test_'
    };

    suiteSetup(() => {
        mockExtensionContext = createMockExtensionContext();
    });

    setup(async () => {
        clock = sinon.useFakeTimers({
            now: 1000,
            shouldAdvanceTime: false,
            toFake: ['Date', 'setTimeout', 'clearTimeout']
        });

        // Reset singleton instance before each test
        (CacheService as any).instance = undefined;
        cacheService = CacheService.getInstance();
        cacheService.setContext(mockExtensionContext);

        // Ensure any async initialization is complete
        await Promise.resolve();
    });

    teardown(() => {
        clock.restore();
        sinon.restore();
        (CacheService as any).instance = undefined;
    });

    test('basic cache operations', () => {
        // Test basic set and get
        cacheService.set('test:key', 'value', testConfig);
        assert.strictEqual(cacheService.get('test:key'), 'value');

        // Test non-existent key
        assert.strictEqual(cacheService.get('nonexistent'), undefined);

        // Test overwriting value
        cacheService.set('test:key', 'new-value', testConfig);
        assert.strictEqual(cacheService.get('test:key'), 'new-value');
    });

    test('cache expiration', () => {
        cacheService.set('test:expiring', 'value', shortConfig);

        // Value should exist initially
        assert.strictEqual(cacheService.get('test:expiring'), 'value');

        // Advance time past TTL
        clock.tick(1001);

        // Value should be expired
        assert.strictEqual(cacheService.get('test:expiring'), undefined);
    });

    test('clear all cache entries', async () => {
        // Set multiple entries
        cacheService.set('test:1', 'value1', testConfig);
        cacheService.set('test:2', 'value2', testConfig);

        // Clear all entries
        await cacheService.clearAll();

        // Verify all entries are cleared
        assert.strictEqual(cacheService.get('test:1'), undefined);
        assert.strictEqual(cacheService.get('test:2'), undefined);
    });

    test('invalidate by prefix', async () => {
        // Set entries with different prefixes
        cacheService.set('test:1', 'value1', testConfig);
        cacheService.set('other:1', 'value2', testConfig);

        // Invalidate only 'test:' prefix
        await cacheService.invalidatePrefix('test');

        // Verify correct entries are invalidated
        assert.strictEqual(cacheService.get('test:1'), undefined);
        assert.strictEqual(cacheService.get('other:1'), 'value2');
    });

    test('persistent storage', async () => {
        const persistentConfig: CacheConfig = {
            ttlSeconds: 3600,
            persistent: true,
            storagePrefix: 'persistent_'
        };

        // Set persistent value
        cacheService.set('test:persistent', 'value', persistentConfig);

        // Create new instance
        (CacheService as any).instance = undefined;
        const newInstance = CacheService.getInstance();
        newInstance.setContext(mockExtensionContext);

        // Allow async operations to complete
        await Promise.resolve();
        clock.tick(1);

        // Verify value persists
        assert.strictEqual(newInstance.get('test:persistent'), 'value');
    });

    test('logging behavior', () => {
        const logger = LoggingService.getInstance();
        const debugSpy = sinon.spy(logger, 'debug');

        cacheService.set('test:log', 'value', testConfig);

        sinon.assert.calledWith(
            debugSpy,
            sinon.match('Cache SET for key: cache:test:log')
        );
    });

    test('handling undefined context', () => {
        const newService = CacheService.getInstance();
        // Should not throw when context is undefined
        newService.set('test:key', 'value', testConfig);
        assert.strictEqual(newService.get('test:key'), 'value');
    });
});


// Helper Functions

/**
 * Creates a mock SecretStorage for testing purposes.
 * @returns A mocked vscode.SecretStorage with basic store/delete/get functionality.
 */
function createMockSecretStorage(): vscode.SecretStorage {
    const storage = new Map<string, string>();
    const onDidChangeEmitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();

    return {
        get: sinon.stub().callsFake((key: string) => Promise.resolve(storage.get(key))),
        store: sinon.stub().callsFake((key: string, value: string) => {
            storage.set(key, value);
            onDidChangeEmitter.fire({ key });
            return Promise.resolve();
        }),
        delete: sinon.stub().callsFake((key: string) => {
            const existed = storage.delete(key);
            if (existed) {
                onDidChangeEmitter.fire({ key });
            }
            return Promise.resolve();
        }),
        onDidChange: onDidChangeEmitter.event
    };
}

/**
 * Creates a mock GlobalState Memento, which includes setKeysForSync method.
 * @returns A mocked vscode.Memento for globalState.
 */
function createMockGlobalState(): vscode.Memento & { setKeysForSync(keys: readonly string[]): void } {
    const storage = new Map<string, any>();
    return {
        get: sinon.stub().callsFake((key: string, defaultValue?: any) => {
            return storage.has(key) ? storage.get(key) : defaultValue;
        }),
        update: sinon.stub().callsFake((key: string, value: any) => {
            if (value === undefined) {
                storage.delete(key);
            } else {
                storage.set(key, value);
            }
            return Promise.resolve();
        }),
        keys: () => Array.from(storage.keys()),
        setKeysForSync: sinon.stub().callsFake(() => { /* Mock implementation */ })
    };
}

/**
 * Creates a mock WorkspaceState Memento.
 * @returns A mocked vscode.Memento for workspaceState.
 */
function createMockWorkspaceState(): vscode.Memento {
    const storage = new Map<string, any>();
    return {
        get: sinon.stub().callsFake((key: string, defaultValue?: any) => {
            return storage.has(key) ? storage.get(key) : defaultValue;
        }),
        update: sinon.stub().callsFake((key: string, value: any) => {
            storage.set(key, value);
            return Promise.resolve();
        }),
        keys: () => Array.from(storage.keys())
        // No setKeysForSync here as workspaceState does not require it
    };
}

/**
 * Creates a mock GlobalEnvironmentVariableCollection.
 * @returns A mocked vscode.GlobalEnvironmentVariableCollection.
 */
function createMockEnvironmentVariableCollection(): vscode.GlobalEnvironmentVariableCollection {
    const storage = new Map<string, vscode.EnvironmentVariableMutator>();

    return {
        replace: sinon.stub().callsFake((variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions) => {
            storage.set(variable, { value, type: vscode.EnvironmentVariableMutatorType.Replace, options: {} });
        }),
        append: sinon.stub().callsFake((variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions) => {
            storage.set(variable, { value, type: vscode.EnvironmentVariableMutatorType.Append, options: {} });
        }),
        prepend: sinon.stub().callsFake((variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions) => {
            storage.set(variable, { value, type: vscode.EnvironmentVariableMutatorType.Prepend, options: {} });
        }),
        get: sinon.stub().callsFake((variable: string) => {
            return storage.get(variable);
        }),
        forEach: sinon.stub().callsFake(function (this: vscode.EnvironmentVariableCollection, callback, thisArg) {
            storage.forEach((mutator, key) => {
                callback.call(thisArg, key, mutator, this);
            });
        }),
        delete: sinon.stub().callsFake((variable: string) => {
            storage.delete(variable);
        }),
        clear: sinon.stub().callsFake(() => {
            storage.clear();
        }),
        [Symbol.iterator]: function* () {
            yield* storage.entries();
        },
        persistent: true,
        description: 'Mock Environment Variable Collection',
        getScoped: sinon.stub().callsFake(() => createMockEnvironmentVariableCollection())
    };
}

/**
 * Creates a mock Memento with in-memory storage and setKeysForSync method.
 * @returns A mocked vscode.Memento with basic get/update functionality.
 */
function createMockMemento(): vscode.Memento & { setKeysForSync(keys: readonly string[]): void; keys(): readonly string[] } {
    const storage = new Map<string, any>();
    return {
        get: (key: string, defaultValue?: any) => {
            return storage.has(key) ? storage.get(key) : defaultValue;
        },
        update: (key: string, value: any) => {
            if (value === undefined) {
                storage.delete(key);
            } else {
                storage.set(key, value);
            }
            return Promise.resolve();
        },
        keys: () => Array.from(storage.keys()),
        setKeysForSync: (keys: readonly string[]) => { /* Mock implementation */ }
    };
}

/**
 * Creates a mock ExtensionContext for testing purposes.
 * @returns A mocked vscode.ExtensionContext.
 */
function createMockExtensionContext(): vscode.ExtensionContext {
    const mockWorkspaceState = createMockMemento();
    const mockGlobalState = createMockMemento();
    const mockSecrets = createMockSecretStorage();
    const mockEnvVarCollection = createMockEnvironmentVariableCollection();

    // Create a stub for the extension property
    const mockExtension: vscode.Extension<any> = {
        id: 'mock.extension',
        extensionUri: vscode.Uri.file('/path/to/extension'),
        extensionPath: '/path/to/extension',
        isActive: true,
        packageJSON: {},
        exports: undefined,
        activate: sinon.stub().resolves(),
        extensionKind: vscode.ExtensionKind.Workspace // or vscode.ExtensionKind.UI if more appropriate
    };

    return {
        subscriptions: [],
        workspaceState: mockWorkspaceState,
        globalState: mockGlobalState,
        extensionUri: vscode.Uri.file('/path/to/extension'),
        extensionPath: '/path/to/extension',
        storagePath: '/path/to/storage',
        globalStoragePath: '/path/to/globalStorage',
        logPath: '/path/to/logs',
        storageUri: vscode.Uri.file('/path/to/storage'),
        globalStorageUri: vscode.Uri.file('/path/to/globalStorage'),
        logUri: vscode.Uri.file('/path/to/logs'),
        asAbsolutePath: sinon.stub().callsFake((relativePath: string) => `/path/to/extension/${relativePath}`),
        secrets: mockSecrets,
        environmentVariableCollection: mockEnvVarCollection,
        extensionMode: vscode.ExtensionMode.Test,
        extension: mockExtension,
        languageModelAccessInformation: {
            getLanguageId: sinon.stub().resolves('plaintext'),
            onDidChange: new vscode.EventEmitter<void>().event,
            canSendRequest: sinon.stub().resolves(true)
        }
    } as vscode.ExtensionContext;
}
