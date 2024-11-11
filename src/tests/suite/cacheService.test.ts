// src/test/suite/cacheService.test.ts

import * as assert from 'assert';
import { CacheService } from '../../services/CacheService';
import { CacheRecord } from '../../types/cache';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { LoggingService } from '../../services/core/LoggingService';

/**
 * Test Suite for CacheService.
 * Covers caching, TTL handling, persistence, and cache statistics.
 */
suite('CacheService Test Suite', () => {
    let cacheService: CacheService;
    let clock: sinon.SinonFakeTimers;
    let mockExtensionContext: vscode.ExtensionContext;

    /**
     * Sets up the test environment before each test.
     * Initializes fake timers and the CacheService instance with a mocked ExtensionContext.
     */
    setup(() => {
        // Initialize Sinon fake timers to control time-dependent functionality
        clock = sinon.useFakeTimers({
            now: 1000, // Start at fixed time
            shouldAdvanceTime: false, // Do not auto-advance time
            toFake: ['Date', 'setTimeout', 'clearTimeout'], // Specify which timers to fake
            shouldClearNativeTimers: true // Automatically clean-up native timers
        });

        // Create a mocked ExtensionContext for CacheService
        mockExtensionContext = createMockExtensionContext();

        // Initialize CacheService singleton and set the mocked context
        cacheService = CacheService.getInstance();
        cacheService.setContext(mockExtensionContext);
    });

    /**
     * Cleans up after each test.
     * Restores the real timers and resets the CacheService singleton.
     */
    teardown(() => {
        clock.restore(); // Restore real timers
        (CacheService as any).instance = undefined; // Reset singleton instance for isolation
    });

    /**
     * Tests that CacheService can cache and retrieve values correctly.
     */
    test('should cache and retrieve values', () => {
        cacheService.set('catalog:test-key', 'test-value');
        assert.strictEqual(cacheService.get('catalog:test-key'), 'test-value');
    });

    /**
     * Tests that CacheService respects a TTL (Time-to-Live) of 1 hour.
     */
    test('should respect TTL of 1 hour', () => {
        const testLogger = LoggingService.getInstance();
        const oneHour = 1 * 60 * 60; // 1 hour in seconds

        // Set cache entry with 1-hour TTL
        cacheService.set('catalog:ttl-test', 'test-value', { ttl: oneHour });

        // Verify value is initially set
        const initialValue = cacheService.get('catalog:ttl-test');
        testLogger.debug('Initial cache value', { value: initialValue });
        assert.strictEqual(initialValue, 'test-value');

        // Advance time by 30 minutes
        clock.tick(30 * 60 * 1000); // 30 minutes in milliseconds

        // Verify that the value is still present
        const thirtyMinuteValue = cacheService.get('catalog:ttl-test');
        testLogger.debug('Cache value after 30 minutes', { value: thirtyMinuteValue });
        assert.strictEqual(thirtyMinuteValue, 'test-value');

        // Advance time by another 30 minutes + 1ms; total time is just over 1 hour
        clock.tick(30 * 60 * 1000 + 1); // 30 minutes + 1ms

        // Verify that the entry has expired
        const finalValue = cacheService.get('catalog:ttl-test');
        testLogger.debug('Cache value after 1 hour', { value: finalValue });
        assert.strictEqual(finalValue, undefined);
    });

    /**
     * Tests that CacheService can clear cache entries by prefix correctly.
     */
    test('should handle clearing cache by prefix', async () => {
        // Set multiple cache entries with different prefixes
        cacheService.set('catalog:test1', 'value1');
        cacheService.set('catalog:test2', 'value2');
        cacheService.set('offering:test3', 'value3');

        // Clear entries with the prefix 'catalog'
        const clearedCount = await cacheService.clearPrefix('catalog');
        assert.strictEqual(clearedCount, 2);

        // Verify that 'catalog' entries are cleared and others remain
        assert.strictEqual(cacheService.get('catalog:test1'), undefined);
        assert.strictEqual(cacheService.get('catalog:test2'), undefined);
        assert.strictEqual(cacheService.get('offering:test3'), 'value3');
    });

    /**
     * Tests that expired cache entries are correctly invalidated and return undefined.
     */
    test('should retrieve undefined for expired cache', () => {
        // Set a cache entry with a short TTL (1 second)
        cacheService.set('catalog:expired-key', 'test-value', { ttl: 1 });

        // Advance time beyond the TTL to expire the entry
        clock.tick(1000 + 1); // 1 second + 1ms

        // Verify that the expired entry returns undefined
        assert.strictEqual(cacheService.get('catalog:expired-key'), undefined);
    });

    /**
     * Tests that CacheService can refresh TTLs for entries with a specific prefix.
     */
    test('should refresh prefix TTL', () => {
        // Set cache entries with the prefix 'catalog' and 1-hour TTL
        cacheService.set('catalog:test1', 'value1', { ttl: 3600 });
        cacheService.set('catalog:test2', 'value2', { ttl: 3600 });

        // Advance time by 30 minutes
        clock.tick(1800 * 1000); // 30 minutes in milliseconds

        // Refresh TTLs for 'catalog' prefix
        cacheService.refreshPrefix('catalog');

        // Advance time by another 30 minutes + 1ms; original TTL would have expired
        clock.tick(1800 * 1000 + 1); // 30 minutes + 1ms

        // Verify that entries are still present due to refreshed TTL
        assert.strictEqual(cacheService.get('catalog:test1'), 'value1');
        assert.strictEqual(cacheService.get('catalog:test2'), 'value2');
    });

    /**
     * Tests that retrieving a non-existent key returns undefined.
     */
    test('should return undefined for non-existent key', () => {
        // Attempt to retrieve a key that was never set
        assert.strictEqual(cacheService.get('catalog:non-existent-key'), undefined);
    });

    /**
     * Tests that CacheService can clear all cache entries correctly.
     */
    test('should clear all cache entries', async () => {
        // Set multiple cache entries with different prefixes
        cacheService.set('catalog:test1', 'value1');
        cacheService.set('catalog:test2', 'value2');
        cacheService.set('offering:test3', 'value3');

        // Clear all cache entries
        await cacheService.clearAll();

        // Verify that all entries are cleared
        assert.strictEqual(cacheService.get('catalog:test1'), undefined);
        assert.strictEqual(cacheService.get('catalog:test2'), undefined);
        assert.strictEqual(cacheService.get('offering:test3'), undefined);
    });

    /**
    * Tests that persistent entries are retained across CacheService instances.
    */
    test('should retain persistent entry across instances', async () => {
        // Use a key with a known prefix 'catalog'
        const persistentKey = 'catalog:persistent-key';
        const persistentValue = 'persistent-value';

        // Set a persistent cache entry with specific TTL
        cacheService.set(persistentKey, persistentValue, { persistent: true, ttl: 3600 });

        // Verify that the entry is stored in globalState with the correct storage key
        const storageKey = `catalog_cache_${persistentKey}`;
        const storedRecord = mockExtensionContext.globalState.get<CacheRecord>(storageKey);
        console.log(`Stored Record for ${storageKey}:`, storedRecord);
        console.log(`Date.now(): ${Date.now()}, record.expiry: ${storedRecord?.expiry}`);
        assert.strictEqual(storedRecord?.value, persistentValue);
        assert.strictEqual(storedRecord?.persistent, true);

        // Log the globalState keys before resetting
        console.log('GlobalState keys before reset:', mockExtensionContext.globalState.keys());

        // Reset the CacheService singleton to simulate a new instance
        (CacheService as any).instance = undefined;

        // Create a new CacheService instance and set the same context
        cacheService = CacheService.getInstance();
        cacheService.setContext(mockExtensionContext);

        // Wait for the persisted cache to load
        await cacheService.waitForCacheLoad();

        // Log the globalState keys after resetting
        console.log('GlobalState keys after reset:', mockExtensionContext.globalState.keys());

        // Verify that the persistent entry is loaded correctly
        const loadedValue = cacheService.get(persistentKey);
        console.log(`Loaded Value for ${persistentKey}:`, loadedValue);
        assert.strictEqual(loadedValue, persistentValue);
    });

    /**
     * Tests that CacheService accurately reports cache statistics.
     */
    test('should return accurate cache statistics', () => {
        // Set an active cache entry with a 1-hour TTL
        cacheService.set('catalog:active-key', 'active-value', { ttl: 3600 });

        // Set an expired cache entry with a 1-second TTL
        cacheService.set('catalog:expired-key', 'expired-value', { ttl: 1 });

        // Advance time to expire the second entry
        clock.tick(1000 + 1); // 1 second + 1ms

        // Retrieve cache statistics
        const stats = cacheService.getStats();
        console.log('Cache Stats:', stats);

        // Verify that statistics reflect one active and one expired entry
        assert.strictEqual(stats.totalSize, 2);
        assert.strictEqual(stats.activeEntries, 1);
        assert.strictEqual(stats.expiredEntries, 1);
    });

    /**
     * Tests that only persistent entries are counted in the persistentEntries statistic.
     */
    test('should report only persistent entries in stats', () => {
        // Set a persistent cache entry with a known prefix
        cacheService.set('catalog:persistent-key', 'value1', { persistent: true });

        // Set a non-persistent cache entry with the same prefix
        cacheService.set('catalog:non-persistent-key', 'value2', { persistent: false });

        // Retrieve cache statistics
        const stats = cacheService.getStats();
        console.log('Cache Stats for Persistent Entries:', stats);

        // Verify that only one persistent entry is reported
        assert.strictEqual(stats.persistentEntries, 1);
    });

    /**
     * Tests that CacheService only clears entries with the specified prefix.
     */
    test('should clear only specified prefix', async () => {
        // Set cache entries with similar but distinct prefixes
        cacheService.set('catalog:test1', 'value1');
        cacheService.set('category:test1', 'value2');

        // Clear entries with the prefix 'catalog'
        await cacheService.clearPrefix('catalog');

        // Verify that only 'catalog' entries are cleared
        assert.strictEqual(cacheService.get('catalog:test1'), undefined);
        assert.strictEqual(cacheService.get('category:test1'), 'value2');
    });

    /**
     * Tests that CacheService logs the correct message when setting a cache entry.
     */
    test('should log correct message on cache set', () => {
        const testLogger = LoggingService.getInstance();
        const logSpy = sinon.spy(testLogger, 'debug');

        // Set a cache entry with TTL and metadata
        cacheService.set('catalog:log-test', 'value', { ttl: 3600, metadata: { source: 'test' } });

        // Assert that the debug log was called with expected arguments
        sinon.assert.calledWith(
            logSpy,
            sinon.match.string, // Log message string
            sinon.match({
                expiresAt: sinon.match.string,
                ttlSeconds: 3600,
                isPersistent: true,
                metadata: { source: 'test' }
            })
        );

        logSpy.restore(); // Restore the original method
    });

    /**
     * Tests that CacheService immediately expires an entry with a TTL of zero.
     */
    test('should immediately expire entry with zero TTL', async () => {
        // Set a cache entry with zero TTL
        cacheService.set('catalog:zero-ttl-test', 'value', { ttl: 0 });

        // Wait for invalidations to complete
        await cacheService.waitForInvalidations();

        // Verify that the entry has been expired and returns undefined
        assert.strictEqual(cacheService.get('catalog:zero-ttl-test'), undefined);
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

});
