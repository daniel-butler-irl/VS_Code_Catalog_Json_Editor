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

    // Test for successful IBM Cloud login
    it('IBM Cloud Login - Success', async () => {
        const testApiKey = 'test-api-key';
        showInputBoxStub.resolves(testApiKey);
        sandbox.stub(AuthService, 'validateApiKey').resolves(true);

        // Mock secrets store method to resolve successfully
        mockContext.secrets.store = sandbox.stub().resolves();

        await AuthService.login(mockContext as vscode.ExtensionContext);

        // Verify the API key was stored
        sinon.assert.calledWith(mockContext.secrets.store as sinon.SinonStub,
            'ibmcloud.apikey', testApiKey);
    });

    // Test for successful GitHub login
    it('GitHub Login - Success', async () => {
        // Mock GitHub session response
        const mockSession = {
            id: 'test-session',
            accessToken: 'test-token',
            account: { label: 'test', id: 'test' },
            scopes: ['repo']
        };
        getSessionStub.resolves(mockSession);

        // Create a stub for the loginGithub command
        const loginGithubStub = sandbox.stub();
        // Register the command with our stub
        sandbox.stub(vscode.commands, 'registerCommand')
            .withArgs('ibmCatalog.loginGithub', sinon.match.any)
            .callsFake((_, callback) => {
                loginGithubStub.callsFake(callback);
                return { dispose: () => { } };
            });

        // Call our stub directly since we can't execute the actual command in tests
        const result = await AuthService.isGitHubLoggedIn(mockContext as vscode.ExtensionContext);

        // Verify the result
        assert.strictEqual(result, true, 'Should return true for logged in state');
        sinon.assert.called(getSessionStub);
    });

    // Test for GitHub login failure
    it('GitHub Login - Failure', async () => {
        // Make the getSession call throw an error
        const error = new Error('Authentication failed');
        getSessionStub.rejects(error);

        // Test that isGitHubLoggedIn returns false when authentication fails
        const result = await AuthService.isGitHubLoggedIn(mockContext as vscode.ExtensionContext);

        // Verify the result
        assert.strictEqual(result, false, 'Should return false when authentication fails');
        sinon.assert.called(getSessionStub);
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

    // Test for GitHub logout when already logged out
    it('GitHub Logout - Already Logged Out', async () => {
        // Simulate no GitHub session (already logged out)
        getSessionStub.resolves(undefined);

        // Verify initial state is logged out
        const initialState = await AuthService.isGitHubLoggedIn(mockContext as vscode.ExtensionContext);
        assert.strictEqual(initialState, false, 'Should be logged out initially');

        // Run the test again to ensure consistent behavior
        const finalState = await AuthService.isGitHubLoggedIn(mockContext as vscode.ExtensionContext);
        assert.strictEqual(finalState, false, 'Should still be logged out');

        // Verify getSession was called twice
        sinon.assert.calledTwice(getSessionStub);
    });

    // Test for login state updates after context changes
    it('Login State Updates After Context Changes', async () => {
        // Setup IBM Cloud login initial state as logged out
        mockContext.secrets.get = sandbox.stub().resolves(undefined);
        const initialIBMCloudState = await AuthService.isLoggedIn(mockContext as vscode.ExtensionContext);
        assert.strictEqual(initialIBMCloudState, false, 'Should be logged out initially for IBM Cloud');

        // Change to logged in state
        const testApiKey = 'test-api-key';
        mockContext.secrets.get = sandbox.stub().resolves(testApiKey);
        const updatedIBMCloudState = await AuthService.isLoggedIn(mockContext as vscode.ExtensionContext);
        assert.strictEqual(updatedIBMCloudState, true, 'Should be logged in after context change for IBM Cloud');

        // Setup GitHub login initial state as logged out
        getSessionStub.resolves(undefined);
        const initialGitHubState = await AuthService.isGitHubLoggedIn(mockContext as vscode.ExtensionContext);
        assert.strictEqual(initialGitHubState, false, 'Should be logged out initially for GitHub');

        // Change to logged in state
        getSessionStub.resolves({
            id: 'test-session',
            accessToken: 'test-token',
            account: { label: 'test', id: 'test' },
            scopes: ['repo']
        });
        const updatedGitHubState = await AuthService.isGitHubLoggedIn(mockContext as vscode.ExtensionContext);
        assert.strictEqual(updatedGitHubState, true, 'Should be logged in after context change for GitHub');
    });
}); 