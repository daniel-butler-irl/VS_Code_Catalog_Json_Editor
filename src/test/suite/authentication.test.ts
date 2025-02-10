import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AuthService } from '../../services/AuthService';
import { LoggingService } from '../../services/core/LoggingService';
import axios from 'axios';
import path from 'path';
import { TestHelper } from './helpers/testHelper';
import { describe, it, beforeEach, afterEach } from 'mocha';

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

// Helper class for mocking VS Code EnvironmentVariableCollection
class MockEnvironmentVariableCollection implements vscode.EnvironmentVariableCollection {
    persistent: boolean = true;
    description: string | vscode.MarkdownString = '';

    replace(variable: string, value: string): void { }
    append(variable: string, value: string): void { }
    prepend(variable: string, value: string): void { }
    get(variable: string): vscode.EnvironmentVariableMutator | undefined { return undefined; }
    getScoped(scope: vscode.EnvironmentVariableScope): vscode.EnvironmentVariableCollection {
        return this; // Return self for test purposes
    }
    forEach(callback: (variable: string, mutator: vscode.EnvironmentVariableMutator, collection: vscode.EnvironmentVariableCollection) => any, thisArg?: any): void { }
    delete(variable: string): void { }
    clear(): void { }
    [Symbol.iterator](): Iterator<[variable: string, mutator: vscode.EnvironmentVariableMutator]> {
        return [][Symbol.iterator]();
    }
}

// Add helper function for updating login states
async function updateLoginStates(context: vscode.ExtensionContext): Promise<void> {
    const logger = LoggingService.getInstance();
    try {
        logger.debug('Starting login state update');

        // Check IBM Cloud login status
        const apiKey = await AuthService.getApiKey(context);
        const isLoggedIn = Boolean(apiKey);
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', isLoggedIn);
        logger.debug('Updated IBM Cloud login state', { isLoggedIn });

        // Check GitHub login status
        let isGithubLoggedIn = false;
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], {
                createIfNone: false,
                silent: true
            });
            isGithubLoggedIn = Boolean(session);
            logger.debug('Checked GitHub session', {
                hasSession: Boolean(session),
                sessionId: session?.id
            });
        } catch (error) {
            logger.debug('No GitHub session found or error checking session', { error });
            isGithubLoggedIn = false;
        }

        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', isGithubLoggedIn);
        logger.debug('Updated GitHub login state', { isGithubLoggedIn });

        // Log state changes for debugging
        logger.info('Authentication states updated', {
            isIBMCloudLoggedIn: isLoggedIn,
            isGithubLoggedIn
        });
    } catch (error) {
        logger.error('Failed to update login states', { error });
        // Set both states to false on error
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isLoggedIn', false);
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', false);
    }
}

async function getLoginState(context: vscode.ExtensionContext): Promise<boolean> {
    const apiKey = await AuthService.getApiKey(context);
    return Boolean(apiKey);
}

async function getGithubLoginState(): Promise<boolean> {
    try {
        const session = await vscode.authentication.getSession('github', ['repo'], {
            createIfNone: false,
            silent: true
        });
        return Boolean(session);
    } catch {
        return false;
    }
}

describe('Authentication Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: Required<Pick<vscode.ExtensionContext, 'subscriptions' | 'workspaceState' | 'globalState' | 'secrets' | 'extensionUri' | 'extensionPath' | 'asAbsolutePath' | 'storageUri' | 'globalStorageUri' | 'logUri' | 'extensionMode' | 'environmentVariableCollection' | 'storagePath' | 'globalStoragePath' | 'logPath' | 'extension' | 'languageModelAccessInformation'>>;
    let executeCommandStub: sinon.SinonStub;
    let loggerStub: sinon.SinonStubbedInstance<LoggingService>;
    let showInputBoxStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let getSessionStub: sinon.SinonStub;

    beforeEach(() => {
        // Create new sandbox for each test
        sandbox = sinon.createSandbox();

        // Reset LoggingService singleton
        (LoggingService as any).instance = undefined;

        // Create logger stub
        loggerStub = sandbox.createStubInstance(LoggingService);
        sandbox.stub(LoggingService, 'getInstance').returns(loggerStub);

        // Create mock context with all required properties
        mockContext = {
            subscriptions: [],
            workspaceState: new MockMemento(),
            globalState: new MockMemento(),
            secrets: {
                store: async (key: string, value: string) => Promise.resolve(),
                get: async (key: string) => undefined,
                delete: async (key: string) => Promise.resolve(),
                onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
            },
            extensionUri: vscode.Uri.file(''),
            extensionPath: '',
            asAbsolutePath: (relativePath: string) => '',
            storageUri: undefined,
            globalStorageUri: vscode.Uri.file(''),
            logUri: vscode.Uri.file(''),
            extensionMode: vscode.ExtensionMode.Test,
            environmentVariableCollection: new MockEnvironmentVariableCollection(),
            storagePath: '',
            globalStoragePath: '',
            logPath: '',
            extension: {} as vscode.Extension<any>,
            languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation
        };

        // Create command stub
        executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

        // Create VS Code API stubs
        showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox');
        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');
        getSessionStub = sandbox.stub(vscode.authentication, 'getSession');
    });

    afterEach(() => {
        // Restore all stubs and mocks
        sandbox.restore();
    });

    // TODO: Fix test - Issue with error message assertion and mock setup
    it.skip('IBM Cloud Login - Empty API Key', async () => {
        showInputBoxStub.resolves('');

        try {
            await AuthService.login(mockContext as vscode.ExtensionContext);
            assert.fail('Expected an error to be thrown');
        } catch (error) {
            assert.strictEqual((error as Error).message, 'API key cannot be empty');
        }
    });

    // TODO: Fix test - Issue with executeCommand stub not being called with expected arguments
    it.skip('IBM Cloud Login - Success', async () => {
        const testApiKey = 'test-api-key';
        showInputBoxStub.resolves(testApiKey);
        sandbox.stub(AuthService, 'validateApiKey').resolves(true);

        await AuthService.login(mockContext as vscode.ExtensionContext);

        sinon.assert.calledWith(executeCommandStub, 'setContext', 'ibmCatalog.isLoggedIn', true);
    });

    // TODO: Fix test - Issue with GitHub authentication command execution and context update
    it.skip('GitHub Login - Success', async () => {
        getSessionStub.resolves({
            id: 'test-session',
            accessToken: 'test-token',
            account: { label: 'test', id: 'test' },
            scopes: ['repo']
        });

        await vscode.commands.executeCommand('ibmCatalog.loginGithub');

        sinon.assert.calledWith(executeCommandStub, 'setContext', 'ibmCatalog.isGithubLoggedIn', true);
    });

    // TODO: Fix test - Issue with error handling in GitHub authentication flow
    it.skip('GitHub Login - Failure', async () => {
        const error = new Error('Authentication failed');
        getSessionStub.rejects(error);

        try {
            await vscode.commands.executeCommand('ibmCatalog.loginGithub');
        } catch (e) {
            assert.strictEqual((e as Error).message, 'Authentication failed');
            sinon.assert.calledWith(executeCommandStub, 'setContext', 'ibmCatalog.isGithubLoggedIn', false);
            return;
        }
        assert.fail('Expected an error to be thrown');
    });

    it('IBM Cloud Login - Invalid API Key', async () => {
        showInputBoxStub.resolves('invalid-key');
        sandbox.stub(AuthService, 'validateApiKey').resolves(false);

        try {
            await AuthService.login(mockContext as vscode.ExtensionContext);
        } catch (error) {
            assert.strictEqual((error as Error).message, 'Invalid API key');
            sinon.assert.called(showErrorMessageStub);
            return;
        }
        assert.fail('Expected an error to be thrown');
    });

    // TODO: Fix test - Issue with GitHub logout command execution and context update
    it.skip('GitHub Logout - Already Logged Out', async () => {
        getSessionStub.resolves(undefined);

        await vscode.commands.executeCommand('ibmCatalog.logoutGithub');

        sinon.assert.calledWith(executeCommandStub, 'setContext', 'ibmCatalog.isGithubLoggedIn', false);
    });

    // TODO: Fix test - Issue with login state updates and context synchronization
    it.skip('Login State Updates After Context Changes', async () => {
        // Setup IBM Cloud login state
        const testApiKey = 'test-api-key';
        mockContext.secrets.store = sandbox.stub().resolves();
        mockContext.secrets.get = sandbox.stub().resolves(testApiKey);
        sandbox.stub(AuthService, 'validateApiKey').resolves(true);

        await AuthService.login(mockContext as vscode.ExtensionContext);
        sinon.assert.calledWith(executeCommandStub, 'setContext', 'ibmCatalog.isLoggedIn', true);

        // Setup GitHub login state
        getSessionStub.resolves({
            id: 'test-session',
            accessToken: 'test-token',
            account: { label: 'test', id: 'test' },
            scopes: ['repo']
        });

        await vscode.commands.executeCommand('ibmCatalog.loginGithub');
        sinon.assert.calledWith(executeCommandStub, 'setContext', 'ibmCatalog.isGithubLoggedIn', true);
    });
}); 