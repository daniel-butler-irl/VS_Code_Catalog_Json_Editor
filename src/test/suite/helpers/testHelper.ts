import * as vscode from 'vscode';
import * as sinon from 'sinon';

export class TestHelper {
  private static instance: TestHelper;
  private sandbox: sinon.SinonSandbox | null = null;
  private commandStubs: Map<string, sinon.SinonStub> = new Map();
  private disposables: vscode.Disposable[] = [];

  private constructor() { }

  public static getInstance(): TestHelper {
    if (!TestHelper.instance) {
      TestHelper.instance = new TestHelper();
    }
    return TestHelper.instance;
  }

  public initializeSandbox(): sinon.SinonSandbox {
    if (this.sandbox) {
      this.sandbox.restore();
    }
    this.sandbox = sinon.createSandbox();
    return this.sandbox;
  }

  public createCommandStubs(): void {
    if (!this.sandbox) {
      throw new Error('Sandbox not initialized. Call initializeSandbox() first.');
    }

    // Only create stubs if they don't exist
    if (!this.commandStubs.has('executeCommand')) {
      const executeCommandStub = this.sandbox.stub(vscode.commands, 'executeCommand');
      executeCommandStub.callsFake(async (command: string, ...args: any[]) => {
        switch (command) {
          case 'workbench.action.closeAllEditors':
          case 'setContext':
          case 'ibmCatalog.login':
          case 'ibmCatalog.logout':
          case 'ibmCatalog.loginGithub':
          case 'ibmCatalog.logoutGithub':
          case 'workbench.action.authentication.clear':
            return Promise.resolve();
          default:
            console.warn(`Unhandled command in stub: ${command}`);
            return Promise.resolve();
        }
      });
      this.commandStubs.set('executeCommand', executeCommandStub);
    }

    if (!this.commandStubs.has('registerCommand')) {
      const registerCommandStub = this.sandbox.stub(vscode.commands, 'registerCommand');
      registerCommandStub.callsFake((command: string, callback: (...args: any[]) => any) => {
        const disposable = {
          dispose: () => { }
        };
        this.disposables.push(disposable);
        return disposable;
      });
      this.commandStubs.set('registerCommand', registerCommandStub);
    }
  }

  public getStub(name: string): sinon.SinonStub | undefined {
    return this.commandStubs.get(name);
  }

  public cleanup(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.commandStubs.clear();
    if (this.sandbox) {
      this.sandbox.restore();
      this.sandbox = null;
    }
  }
} 