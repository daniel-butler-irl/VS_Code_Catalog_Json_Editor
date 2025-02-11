import * as vscode from 'vscode';
import { PreReleaseService } from '../services/PreReleaseService';
import { LoggingService } from '../services/core/LoggingService';

interface WebviewMessage {
  command: string;
  data?: PreReleaseDetails & {
    message?: string;
  };
  catalogId?: string;
}

interface PreReleaseDetails {
  version: string;
  postfix: string;
  publishToCatalog: boolean;
  releaseGithub: boolean;
  targetVersion?: string;
}

export class PreReleaseWebview implements vscode.WebviewViewProvider {
  private static instance?: PreReleaseWebview;
  private readonly logger: LoggingService;
  private readonly preReleaseService: PreReleaseService;
  private readonly context: vscode.ExtensionContext;
  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private isInitialized: boolean = false;

  private constructor(
    context: vscode.ExtensionContext,
    logger: LoggingService,
    preReleaseService: PreReleaseService
  ) {
    this.context = context;
    this.logger = logger;
    this.preReleaseService = preReleaseService;
  }

  public static initialize(
    context: vscode.ExtensionContext,
    logger: LoggingService,
    preReleaseService: PreReleaseService
  ): PreReleaseWebview {
    if (!PreReleaseWebview.instance) {
      PreReleaseWebview.instance = new PreReleaseWebview(context, logger, preReleaseService);
    }
    return PreReleaseWebview.instance;
  }

  public static getInstance(): PreReleaseWebview | undefined {
    return PreReleaseWebview.instance;
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.view = webviewView;
    this.view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media')
      ]
    };

    const styleUri = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prerelease.css')
    );
    const scriptUri = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prerelease.js')
    );

    this.view.webview.html = this.getWebviewContent(styleUri, scriptUri);

    // Show loading state immediately
    this.view.webview.postMessage({ command: 'showLoading', message: 'Initializing Pre-Release Manager...' });

    // Initialize the webview
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.registerMessageHandlers();
  }

  private async initialize(): Promise<void> {
    try {
      // Remove automatic setup call
      // Get the webview state to restore the previously selected catalog
      if (this.view?.webview) {
        const state = await this.getWebviewState();
        if (state?.selectedCatalogId) {
          await this.handleCatalogSelection(state.selectedCatalogId);
        }
      }

      // Initial refresh without auth check
      await this.refresh();

      this.isInitialized = true;
    } catch (error) {
      this.logger.error('Failed to initialize Pre-Release webview', error);
      this.view?.webview.postMessage({
        command: 'showError',
        error: 'Failed to initialize Pre-Release Manager. Please try refreshing.'
      });
    } finally {
      // Hide loading state after initialization attempt
      this.view?.webview.postMessage({ command: 'hideLoading' });
    }
  }

  private getWebviewState(): Promise<{ selectedCatalogId: string } | undefined> {
    return new Promise((resolve) => {
      if (!this.view?.webview) {
        resolve(undefined);
        return;
      }

      let disposable: vscode.Disposable | undefined;

      const handler = (e: any) => {
        if (e.data.command === 'stateResponse') {
          disposable?.dispose();  // Remove the handler
          resolve(e.data.state);
        }
      };

      disposable = this.view.webview.onDidReceiveMessage(handler);
      this.view.webview.postMessage({ command: 'getState' });

      // Add timeout to prevent hanging
      setTimeout(() => {
        disposable?.dispose();  // Remove the handler
        resolve(undefined);
      }, 5000);
    });
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      // Show loading state
      this.view.webview.postMessage({ command: 'showLoading' });

      // Clear any existing error state during refresh
      this.view.webview.postMessage({
        command: 'showError',
        error: undefined
      });

      const [releases, catalogData] = await Promise.allSettled([
        this.preReleaseService.getLastPreReleases().catch(error => {
          this.logger.warn('Failed to fetch releases, showing empty state', { error }, 'preRelease');
          return [];
        }),
        this.preReleaseService.getCatalogDetails().catch(error => {
          this.logger.warn('Failed to fetch catalog details, showing empty state', { error }, 'preRelease');
          return {
            catalogs: [],
            selectedCatalog: {
              catalogId: '',
              offeringId: '',
              name: '',
              label: '',
              versions: []
            }
          };
        })
      ]);

      // Hide loading state
      this.view.webview.postMessage({ command: 'hideLoading' });

      this.logger.debug('Updating UI with fetched data', {
        releasesStatus: releases.status,
        catalogDataStatus: catalogData.status,
        releaseCount: releases.status === 'fulfilled' ? releases.value.length : 0,
        catalogCount: catalogData.status === 'fulfilled' ? catalogData.value.catalogs.length : 0
      }, 'preRelease');

      await this.view.webview.postMessage({
        command: 'updateData',
        releases: releases.status === 'fulfilled' ? releases.value : [],
        catalogs: catalogData.status === 'fulfilled' ? catalogData.value.catalogs : [],
        catalogDetails: catalogData.status === 'fulfilled' ? catalogData.value.selectedCatalog : {
          catalogId: '',
          offeringId: '',
          name: '',
          label: '',
          versions: []
        }
      });

      this.logger.info('Pre-release panel refresh complete', {}, 'preRelease');
    } catch (error) {
      this.logger.error('Error refreshing pre-release data', error, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: 'Failed to refresh data. Please try again.'
      });
      // Hide loading state even on error
      this.view.webview.postMessage({ command: 'hideLoading' });
    }
  }

  private async sendBranchName(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const branch = await this.preReleaseService.getCurrentBranch();
      await this.view.webview.postMessage({
        command: 'updateBranchName',
        branch
      });
    } catch (error) {
      this.logger.warn('Failed to get branch name, showing empty state',
        { error: error instanceof Error ? error.message : String(error) },
        'preRelease'
      );
      await this.view.webview.postMessage({
        command: 'updateBranchName',
        branch: '',
        error: 'Not in a Git repository'
      });
    }
  }

  private async handleSetup(): Promise<void> {
    try {
      await this.preReleaseService.ensureGitHubAuth();
      await this.refresh();
    } catch (error) {
      this.logger.error('Setup failed', { error }, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Setup failed'
      });
    }
  }

  private async handleCreatePreRelease(data: PreReleaseDetails): Promise<void> {
    try {
      this.logger.debug('Initiating pre-release creation', {
        version: data.version,
        postfix: data.postfix,
        publishToCatalog: data.publishToCatalog,
        releaseGithub: data.releaseGithub
      }, 'preRelease');

      this.logger.info('Creating pre-release', { version: `v${data.version}-${data.postfix}` }, 'preRelease');

      try {
        await this.preReleaseService.createPreRelease(data);

        this.logger.debug('Refreshing panel after pre-release creation', {}, 'preRelease');
        await this.refresh();

        this.logger.info('Pre-release created successfully', {
          version: `v${data.version}-${data.postfix}`,
          publishToCatalog: data.publishToCatalog
        }, 'preRelease');

        vscode.window.showInformationMessage('Pre-release created successfully');

        // Notify webview of success
        this.view?.webview.postMessage({
          command: 'releaseComplete',
          success: true
        });
      } catch (error) {
        let errorMessage = 'Failed to create pre-release';

        // Handle specific error cases
        if (error instanceof Error) {
          if (error.message.includes('no upstream configured')) {
            errorMessage = `Branch has no upstream. Please push the branch first: git push -u origin ${data.postfix.split('-')[0]}`;
          } else if (error.message.includes('failed to create tag')) {
            errorMessage = 'Failed to create tag. Please ensure you have write permissions.';
          } else {
            errorMessage = error.message;
          }
        }

        this.logger.error('Failed to create pre-release', { error }, 'preRelease');

        // Show error in VS Code UI
        vscode.window.showErrorMessage(errorMessage);

        // Show error in webview
        this.view?.webview.postMessage({
          command: 'releaseComplete',
          success: false,
          error: errorMessage
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      this.logger.error('Failed to handle pre-release creation', { error }, 'preRelease');

      // Show error in VS Code UI
      vscode.window.showErrorMessage(errorMessage);

      // Show error in webview
      this.view?.webview.postMessage({
        command: 'releaseComplete',
        success: false,
        error: errorMessage
      });
    }
  }

  private getWebviewContent(styleUri: vscode.Uri, scriptUri: vscode.Uri): string {
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view?.webview.cspSource}; script-src 'nonce-${nonce}';">
        <link href="${styleUri}" rel="stylesheet">
        <title>Pre-Release Manager</title>
    </head>
    <body>
        <div id="loadingView" class="loading-view">
            <div class="loading-spinner"></div>
            <div class="loading-text">Initializing Pre-Release Manager...</div>
        </div>
        <div id="mainContainer" class="container" style="display: none;">
            <div id="errorContainer" class="error-container"></div>
            <div id="authStatus" class="auth-status">
                <div id="githubAuthStatus" class="auth-item">
                    <span class="auth-text">GitHub: Not logged in</span>
                </div>
                <div id="catalogAuthStatus" class="auth-item">
                    <span class="auth-text">IBM Cloud: Not logged in</span>
                </div>
            </div>
            <div id="mainContent">
                <div class="section">
                    <h2>Create Pre-Release</h2>
                    <div class="form-group">
                        <label for="version">Version</label>
                        <input type="text" id="version" placeholder="1.0.0" disabled>
                        <small>The version number for this release</small>
                    </div>
                    <div class="form-group">
                        <label for="postfix">Postfix</label>
                        <input type="text" id="postfix" placeholder="branch-beta" disabled>
                        <small>The postfix to append to the version (e.g. beta)</small>
                    </div>
                    <div class="next-version" id="nextVersion">
                        <div class="next-version-info">
                            <div class="version-row">
                                <span class="version-label">GitHub:</span>
                                <span class="version-value">Loading...</span>
                            </div>
                            <div class="version-row">
                                <span class="version-label">Catalog:</span>
                                <span class="version-value">Loading...</span>
                            </div>
                        </div>
                    </div>
                    <div class="button-container">
                        <button id="githubBtn" class="action-button" disabled>
                            Create GitHub Release
                        </button>
                        <button id="catalogBtn" class="action-button" disabled>
                            Import to Catalog
                        </button>
                        <button id="getLatestBtn" class="action-button">
                            Get Latest Releases
                        </button>
                    </div>
                </div>
                <div class="section">
                    <h2>Catalog Details</h2>
                    <div class="form-group">
                        <label for="catalogSelect">Select Catalog</label>
                        <select id="catalogSelect" disabled title="Login to IBM Cloud to view catalogs">
                            <option value="">Loading catalogs...</option>
                        </select>
                    </div>
                    <div id="catalogDetails">
                        <p class="loading">Loading catalog details...</p>
                    </div>
                </div>
            </div>
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  private getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private getMediaUri(fileName: string): vscode.Uri {
    return this.view?.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', fileName)
    ) || vscode.Uri.file('');
  }

  private async handleCatalogSelection(catalogId: string): Promise<void> {
    try {
      this.logger.debug('Fetching catalog details', { catalogId }, 'preRelease');
      const catalogDetails = await this.preReleaseService.getSelectedCatalogDetails(catalogId);

      this.logger.debug('Updating catalog details in UI', {
        catalogId,
        name: catalogDetails.name,
        offeringId: catalogDetails.offeringId,
        versionCount: catalogDetails.versions?.length ?? 0
      }, 'preRelease');

      this.view?.webview.postMessage({
        command: 'updateCatalogDetails',
        catalogDetails
      });

      this.logger.info('Successfully updated catalog details', { catalogId }, 'preRelease');
    } catch (error) {
      this.logger.error('Failed to get catalog details', { error, catalogId }, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Failed to get catalog details'
      });
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      // Only log non-getBranchName messages to avoid noise
      if (message.command !== 'getBranchName') {
        this.logger.debug('Handling webview message', { command: message.command }, 'preRelease');
      }

      switch (message.command) {
        case 'getBranchName':
          await this.sendBranchName();
          break;
        case 'checkAuthentication':
          await this.sendAuthenticationStatus();
          break;
        case 'loginGitHub':
          await this.handleGitHubLogin();
          break;
        case 'selectCatalog':
          if (message.catalogId) {
            this.logger.info('Selecting catalog', { catalogId: message.catalogId }, 'preRelease');
            await this.handleCatalogSelection(message.catalogId);
          }
          break;
        case 'showConfirmation':
          if (message.data?.message) {
            const result = await vscode.window.showWarningMessage(
              message.data.message,
              { modal: true },
              'Yes',
              'No'
            );

            if (result === 'Yes') {
              await this.handleCreatePreRelease(message.data);
            }
          }
          break;
        case 'createPreRelease':
          if (message.data) {
            this.logger.info('Creating pre-release', {
              version: message.data.version,
              postfix: message.data.postfix,
              publishToCatalog: message.data.publishToCatalog,
              releaseGithub: message.data.releaseGithub
            }, 'preRelease');
            await this.handleCreatePreRelease(message.data);
          }
          break;
        case 'setup':
          this.logger.info('Setting up pre-release environment', {}, 'preRelease');
          await this.handleSetup();
          break;
        case 'forceRefresh':
          this.logger.info('Force refreshing catalog data', { catalogId: message.catalogId }, 'preRelease');
          await this.preReleaseService.handleForceRefresh(message.catalogId);

          // After force refresh, update the UI with fresh data
          this.logger.debug('Force refresh complete, updating UI', { catalogId: message.catalogId }, 'preRelease');

          // First do a full refresh to update catalogs and releases
          await this.refresh();

          // Then if we have a catalog selected, refresh its details
          if (message.catalogId) {
            this.logger.debug('Refreshing selected catalog details after force refresh', { catalogId: message.catalogId }, 'preRelease');
            await this.handleCatalogSelection(message.catalogId);
          }

          this.logger.info('Force refresh and UI update complete', { catalogId: message.catalogId }, 'preRelease');
          break;
      }
    } catch (error) {
      this.logger.error('Error handling message', { error, message }, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'An error occurred'
      });
    }
  }

  public async sendAuthenticationStatus(): Promise<void> {
    try {
      const githubAuth = await this.preReleaseService.isGitHubAuthenticated();
      const catalogAuth = await this.preReleaseService.isCatalogAuthenticated();

      // Update VS Code context
      await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', githubAuth);

      // Send status to webview
      this.view?.webview.postMessage({
        command: 'authenticationStatus',
        githubAuthenticated: githubAuth,
        catalogAuthenticated: catalogAuth
      });

      // Update UI elements based on auth status
      this.updateButtonStates(githubAuth, catalogAuth);
    } catch (error) {
      this.logger.error('Failed to get authentication status', { error }, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: 'Failed to check authentication status'
      });
    }
  }

  private updateButtonStates(githubAuth: boolean, catalogAuth: boolean): void {
    if (this.view?.webview) {
      this.view.webview.postMessage({
        command: 'updateButtonStates',
        data: {
          githubAuth,
          catalogAuth
        }
      });
    }
  }

  public async handleGitHubLogin(): Promise<void> {
    try {
      const authenticated = await this.preReleaseService.ensureGitHubAuth();
      if (authenticated) {
        await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', true);
        await this.sendAuthenticationStatus();
        await this.refresh();
      }
    } catch (error) {
      this.logger.error('GitHub login failed', { error }, 'preRelease');
      throw error; // Let the command handler show the error message
    }
  }

  private registerMessageHandlers(): void {
    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (this.view) {
          this.view.webview.html = this.getWebviewContent(this.getMediaUri('prerelease.css'), this.getMediaUri('prerelease.js'));
        }
      })
    );

    this.view?.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.logger.error('Error handling webview message', { error }, 'preRelease');
        vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });
  }
} 