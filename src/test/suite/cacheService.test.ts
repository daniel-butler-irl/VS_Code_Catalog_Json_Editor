// src/tests/suite/cacheService.test.ts

import * as assert from 'assert';
import { CacheService } from '../../services/CacheService';
import { CacheConfig } from '../../types/cache/cacheConfig';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { LoggingService } from '../../services/core/LoggingService';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';

// Helper class for mocking VS Code Memento
class MockMemento implements vscode.Memento {
    private storage = new Map<string, any>();

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get(key: string, defaultValue?: any) {
        return this.storage.get(key) ?? defaultValue;
    }

    update(key: string, value: any): Thenable<void> {
        this.storage.set(key, value);
        return Promise.resolve();
    }

    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }

    setKeysForSync(keys: readonly string[]): void {
        // No-op for tests
    }
}

describe('CacheService Test Suite', () => {
    let cacheService: CacheService;
    let clock: sinon.SinonFakeTimers;
    let mockExtensionContext: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;
    let loggerStub: sinon.SinonStubbedInstance<LoggingService>;
    let disposables: vscode.Disposable[] = [];
    let executeCommandStub: sinon.SinonStub;
    let secretsChangeEmitter: vscode.EventEmitter<vscode.SecretStorageChangeEvent>;
    let mockSecrets: { [key: string]: string };

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

    beforeEach(() => {
        // Create new sandbox for each test
        sandbox = sinon.createSandbox();
        clock = sandbox.useFakeTimers();

        // Reset the singleton instance before each test
        (CacheService as any).instance = undefined;

        // Create logger stub
        loggerStub = sandbox.createStubInstance(LoggingService);
        // Reset LoggingService singleton and stub getInstance
        (LoggingService as any).instance = undefined;
        sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

        // Create mock context
        secretsChangeEmitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
        mockSecrets = {};
        mockExtensionContext = {
            subscriptions: [],
            workspaceState: new MockMemento(),
            globalState: new MockMemento(),
            secrets: {
                store: async (key: string, value: string) => {
                    mockSecrets[key] = value;
                    return Promise.resolve();
                },
                get: async (key: string) => mockSecrets[key],
                delete: async (key: string) => {
                    delete mockSecrets[key];
                    return Promise.resolve();
                },
                onDidChange: secretsChangeEmitter.event
            },
            extensionUri: vscode.Uri.file(''),
            extensionPath: '',
            asAbsolutePath: (relativePath: string) => '',
            storageUri: null,
            globalStorageUri: vscode.Uri.file(''),
            logUri: vscode.Uri.file(''),
            extensionMode: vscode.ExtensionMode.Test,
            environmentVariableCollection: {} as vscode.EnvironmentVariableCollection,
            storagePath: '',
            globalStoragePath: '',
            logPath: ''
        } as unknown as vscode.ExtensionContext;

        // Create command stubs
        executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
        executeCommandStub.callsFake(async (command: string, ...args: any[]) => {
            switch (command) {
                case 'setContext':
                    return Promise.resolve();
                default:
                    throw new Error(`Command not found: ${command}`);
            }
        });

        // Initialize cache service
        cacheService = CacheService.getInstance();
        cacheService.setContext(mockExtensionContext);
    });

    afterEach(() => {
        // Restore all stubs and clean up
        clock.restore();
        sandbox.restore();
        disposables.forEach(d => d.dispose());
        disposables = [];

        // Reset all singleton instances
        (CacheService as any).instance = undefined;
        (LoggingService as any).instance = undefined;

        // Clean up event emitter
        secretsChangeEmitter.dispose();
    });

    describe('Basic Cache Operations', () => {
        it('should perform basic set and get operations', () => {
            // Test basic set and get
            cacheService.set('test:key', 'value', testConfig);
            assert.strictEqual(cacheService.get('test:key'), 'value');

            // Test non-existent key
            assert.strictEqual(cacheService.get('test:nonexistent'), undefined);
        });

        it('should handle cache expiration correctly', () => {
            const shortConfig: CacheConfig = {
                ttlSeconds: 60,
                persistent: false,
                storagePrefix: 'test_'
            };

            cacheService.set('test:expiring', 'value', shortConfig);
            assert.strictEqual(cacheService.get('test:expiring'), 'value');

            // Advance time past TTL
            clock.tick(61 * 1000);

            // Value should be expired
            assert.strictEqual(cacheService.get('test:expiring'), undefined);
        });

        it('should clear all cache entries', async () => {
            // Set multiple entries
            cacheService.set('test:1', 'value1', testConfig);
            cacheService.set('test:2', 'value2', testConfig);

            // Clear all entries
            await cacheService.clearAll();

            // Verify all entries are cleared
            assert.strictEqual(cacheService.get('test:1'), undefined);
            assert.strictEqual(cacheService.get('test:2'), undefined);
        });

        it('should invalidate entries by prefix', async () => {
            // Set entries with different prefixes
            cacheService.set('test:1', 'value1', testConfig);
            cacheService.set('other:1', 'value2', testConfig);

            // Invalidate only 'test:' prefix
            await cacheService.invalidatePrefix('test');

            // Verify correct entries are invalidated
            assert.strictEqual(cacheService.get('test:1'), undefined);
            assert.strictEqual(cacheService.get('other:1'), 'value2');
        });
    });

    describe('Persistence and State Management', () => {
        beforeEach(() => {
            // Reset singleton instance before each persistence test
            (CacheService as any).instance = undefined;
        });

        it('should handle persistent storage correctly', async () => {
            const persistentConfig: CacheConfig = {
                ttlSeconds: 3600,
                persistent: true,
                storagePrefix: 'persistent_'
            };

            // Set persistent value
            const firstInstance = CacheService.getInstance();
            firstInstance.setContext(mockExtensionContext);
            firstInstance.set('test:persistent', 'value', persistentConfig);

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

        it('should handle undefined context gracefully', () => {
            const newService = CacheService.getInstance();
            // Should not throw when context is undefined
            newService.set('test:key', 'value', testConfig);
            assert.strictEqual(newService.get('test:key'), 'value');
        });
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

