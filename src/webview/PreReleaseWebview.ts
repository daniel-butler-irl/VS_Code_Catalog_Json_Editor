import * as vscode from 'vscode';
import { PreReleaseService } from '../services/PreReleaseService';
import { LoggingService } from '../services/core/LoggingService';
import { PreReleaseDetails } from '../types/catalog/prerelease';

interface WebviewMessage {
  command: string;
  data?: PreReleaseDetails & {
    message?: string;
    isLoggedIn?: boolean;
  };
  catalogId?: string;
  url?: string;
}

export class PreReleaseWebview implements vscode.WebviewViewProvider {
  private static instance?: PreReleaseWebview;
  private readonly logger: LoggingService;
  private readonly preReleaseService: PreReleaseService;
  private readonly context: vscode.ExtensionContext;
  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private isInitialized: boolean = false;
  private lastSentGitHubDetails: { branch?: string; repoUrl?: string } = {};
  private lastAuthCheck: number = 0;
  private gitHubDetailsTimeout: NodeJS.Timeout | undefined;
  private static readonly AUTH_CHECK_INTERVAL = 5000; // Reduce to 5 seconds for background checks
  private static readonly DEBOUNCE_DELAY = 1000; // 1 second debounce for GitHub details

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
    await this.view.webview.postMessage({
      command: 'setLoadingState',
      loading: true,
      message: 'Initializing Pre-Release Manager...'
    });

    // Register message handlers first
    this.registerMessageHandlers();

    // Initialize the webview
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private async initialize(): Promise<void> {
    try {
      this.logger.debug('Starting webview initialization', {}, 'preRelease');

      // Show loading state immediately
      if (this.view) {
        this.logger.debug('Setting initial loading state', {}, 'preRelease');
        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: true,
          message: 'Initializing Pre-Release Manager...'
        });
      }

      // Check for workspace first
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        if (this.view?.webview) {
          await this.view.webview.postMessage({
            command: 'showError',
            error: 'Please open a workspace to use the Pre-Release Manager.'
          });
          await this.view.webview.postMessage({
            command: 'setLoadingState',
            loading: false
          });
        }
        return;
      }

      // Check authentication state first
      const catalogAuth = await this.preReleaseService.isCatalogAuthenticated();
      const githubAuth = await this.preReleaseService.isGitHubAuthenticated();

      // Update button states based on auth status
      await this.updateButtonStates(githubAuth, catalogAuth);

      // Only proceed with initialization if authenticated
      if (catalogAuth) {
        // Get GitHub details first - this will also update the UI
        this.logger.debug('Fetching initial GitHub details', {}, 'preRelease');
        await this.sendGitHubDetails();

        // Get the webview state to restore the previously selected catalog
        if (this.view?.webview) {
          this.logger.debug('Restoring webview state', {}, 'preRelease');
          const state = await this.getWebviewState();
          if (state?.selectedCatalogId) {
            this.logger.debug('Restoring catalog selection', { catalogId: state.selectedCatalogId }, 'preRelease');
            await this.handleCatalogSelection(state.selectedCatalogId);
          }
        }

        // Initial refresh without auth check
        this.logger.debug('Performing initial refresh', {}, 'preRelease');
        await this.refresh();
      } else {
        // Clear any existing state if not authenticated
        if (this.view?.webview) {
          await this.view.webview.postMessage({
            command: 'clearState'
          });
          await this.view.webview.postMessage({
            command: 'setLoadingState',
            loading: false
          });
        }
      }

      this.isInitialized = true;
      this.logger.info('Webview initialization complete', {}, 'preRelease');
    } catch (error) {
      this.logger.error('Failed to initialize Pre-Release webview', {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }, 'preRelease');

      if (this.view?.webview) {
        await this.view.webview.postMessage({
          command: 'showError',
          error: 'Failed to initialize Pre-Release Manager. Please try refreshing.'
        });
      }
    }
  }

  private async sendGitHubDetails(): Promise<void> {
    if (!this.view) {
      return;
    }

    // Clear any existing timeout
    if (this.gitHubDetailsTimeout) {
      clearTimeout(this.gitHubDetailsTimeout);
    }

    // Set a new timeout for the update
    this.gitHubDetailsTimeout = setTimeout(async () => {
      try {
        const branch = await this.preReleaseService.getCurrentBranch();
        const repoInfo = await this.preReleaseService.getRepositoryInfo();
        const repoUrl = repoInfo ? `http://github.com/${repoInfo.owner}/${repoInfo.name}` : 'Not a Git repository';

        // Check if details have changed before sending update
        if (this.lastSentGitHubDetails.branch !== branch || this.lastSentGitHubDetails.repoUrl !== repoUrl) {
          await this.view?.webview.postMessage({
            command: 'updateGitHubDetails',
            branch: branch || 'Not a Git repository',
            repoUrl
          });

          // Update cached values
          this.lastSentGitHubDetails = { branch, repoUrl };

          // Only log when there's an actual update
          this.logger.info('GitHub details updated', {
            branch: branch || 'Not a Git repository',
            repoUrl
          }, 'preRelease');
        }
      } catch (error) {
        // Only update the UI if the error state is different from the last sent state
        const errorState = {
          branch: 'Not a Git repository',
          repoUrl: 'Not a Git repository'
        };

        if (this.lastSentGitHubDetails.branch !== errorState.branch ||
          this.lastSentGitHubDetails.repoUrl !== errorState.repoUrl) {
          this.logger.warn('Git repository access error', {
            error: error instanceof Error ? error.message : String(error)
          }, 'preRelease');

          await this.view?.webview.postMessage({
            command: 'updateGitHubDetails',
            ...errorState
          });

          // Update cached values for error state
          this.lastSentGitHubDetails = errorState;
        }
      }
    }, PreReleaseWebview.DEBOUNCE_DELAY);
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
    if (!this.view?.webview) {
      return;
    }

    try {
      // Check authentication state
      const catalogAuth = await this.preReleaseService.isCatalogAuthenticated();
      if (!catalogAuth) {
        // Clear state and show unauthenticated state
        await this.view.webview.postMessage({
          command: 'clearState'
        });
        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: false
        });
        return;
      }

      // Show loading state
      await this.view.webview.postMessage({
        command: 'setLoadingState',
        loading: true,
        message: 'Refreshing data...'
      });

      // Clear any existing error state during refresh
      await this.view.webview.postMessage({
        command: 'showError',
        error: undefined
      });

      // Always get fresh GitHub details first
      await this.sendGitHubDetails();

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
      await this.view.webview.postMessage({
        command: 'showError',
        error: 'Failed to refresh data. Please try again.'
      });
    } finally {
      // Hide loading state after refresh
      await this.view.webview.postMessage({
        command: 'setLoadingState',
        loading: false
      });
    }
  }

  private async sendBranchName(): Promise<void> {
    // Reuse sendGitHubDetails to keep code DRY
    await this.sendGitHubDetails();
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

      // Show loading state in UI
      if (this.view) {
        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: true,
          message: 'Creating pre-release...'
        });
      }

      this.logger.info('Creating pre-release', { version: `v${data.version}-${data.postfix}` }, 'preRelease');

      try {
        const success = await this.preReleaseService.createPreRelease(data);

        if (success) {
          // Add a small delay to ensure GitHub and catalog APIs have propagated the changes
          await new Promise(resolve => setTimeout(resolve, 2000));

          this.logger.debug('Refreshing panel after pre-release creation', {
            version: data.version,
            postfix: data.postfix
          }, 'preRelease');

          // Pass created version information to the refresh process
          await this.preReleaseService.handleForceRefresh(
            data.catalogId,
            data.version,
            data.postfix
          );

          this.logger.info('Pre-release created successfully', {
            version: `v${data.version}-${data.postfix}`,
            publishToCatalog: data.publishToCatalog
          }, 'preRelease');

          // Notify webview of success
          if (this.view) {
            await this.view.webview.postMessage({
              command: 'releaseComplete',
              success: true
            });

            // Clear loading state
            await this.view.webview.postMessage({
              command: 'setLoadingState',
              loading: false
            });
          }
        } else {
          // Operation was cancelled by user, reset the UI state
          this.logger.info('Pre-release creation cancelled by user', {
            version: `v${data.version}-${data.postfix}`
          }, 'preRelease');

          // Tell webview to reset button state
          if (this.view) {
            await this.view.webview.postMessage({
              command: 'releaseComplete',
              success: false,
              cancelled: true
            });

            // Clear loading state
            await this.view.webview.postMessage({
              command: 'setLoadingState',
              loading: false
            });
          }
        }
      } catch (error) {
        let errorMessage = 'Failed to create pre-release';

        // Handle specific error cases
        if (error instanceof Error) {
          if (error.message.includes('no upstream configured')) {
            errorMessage = `Branch has no upstream. Please push the branch first: git push -u origin ${data.postfix.split('-')[0]}`;
          } else if (error.message.includes('failed to create tag')) {
            errorMessage = 'Failed to create tag. Please ensure you have write permissions.';
          } else if (error.message.includes('already exists')) {
            errorMessage = `Release ${data.version}-${data.postfix} already exists. Please choose a different version or postfix.`;
          } else {
            errorMessage = error.message;
          }
        }

        this.logger.error('Failed to create pre-release', { error }, 'preRelease');

        // Show error in VS Code UI
        vscode.window.showErrorMessage(errorMessage);

        // Show error in webview and reset state
        if (this.view) {
          await this.view.webview.postMessage({
            command: 'releaseComplete',
            success: false,
            error: errorMessage
          });

          // Clear loading state
          await this.view.webview.postMessage({
            command: 'setLoadingState',
            loading: false
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      this.logger.error('Failed to handle pre-release creation', { error }, 'preRelease');

      // Show error in VS Code UI
      vscode.window.showErrorMessage(errorMessage);

      // Show error in webview and reset state
      if (this.view) {
        await this.view.webview.postMessage({
          command: 'releaseComplete',
          success: false,
          error: errorMessage
        });

        // Clear loading state
        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: false
        });
      }
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
            <div class="error-text"></div>
        </div>
        <div id="mainContainer" class="container" style="display: none;">
            <div id="authStatus" class="auth-status">
                <div id="githubAuthStatus" class="auth-item">
                    <span class="auth-text">GitHub: Not logged in</span>
                    <button id="githubAuthButton" class="auth-button">Login</button>
                </div>
                <div id="catalogAuthStatus" class="auth-item">
                    <span class="auth-text">IBM Cloud: Not logged in</span>
                    <button id="catalogAuthButton" class="auth-button">Login</button>
                </div>
            </div>
            <div id="mainContent">
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
                <div class="section">
                    <h2>GitHub Details</h2>
                    <div class="details-info">
                        <div class="details-row">
                            <span class="details-label">Repository:</span>
                            <span class="details-value" id="github-repo">Loading...</span>
                        </div>
                        <div class="details-row">
                            <span class="details-label">Branch:</span>
                            <span class="details-value" id="github-branch">Loading...</span>
                        </div>
                    </div>
                </div>
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
                                <span class="version-value">Please Select a Catalog...</span>
                            </div>
                            <div class="version-row">
                                <span class="version-label">Catalog:</span>
                                <span class="version-value">Please Select a Catalog...</span>
                            </div>
                        </div>
                    </div>
                    <div class="button-container">
                        <button id="githubBtn" class="action-button" disabled>
                            Create GitHub Pre-Release
                        </button>
                        <button id="catalogBtn" class="action-button" disabled>
                            Import to IBM Cloud Catalog
                        </button>
                        <button id="getLatestBtn" class="action-button">
                            Get Latest Releases
                        </button>
                    </div>
                </div>
                <div class="section">
                    <h2>Recent Versions</h2>
                    <div class="versions-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>GitHub</th>
                                    <th>Catalog</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td colspan="2" class="empty-state">Please select a catalog to view versions</td>
                                </tr>
                            </tbody>
                        </table>
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

      // Force a refresh when selecting a catalog to ensure fresh data
      await this.preReleaseService.handleForceRefresh(catalogId);

      // Do a full refresh to get fresh version mapping data
      await this.refresh();

      // Then get the catalog details with fresh data
      const catalogDetails = await this.preReleaseService.getSelectedCatalogDetails(catalogId);

      this.logger.debug('Updating catalog details in UI', {
        catalogId,
        name: catalogDetails.name,
        offeringId: catalogDetails.offeringId,
        versionCount: catalogDetails.versions?.length ?? 0
      }, 'preRelease');

      await this.view?.webview.postMessage({
        command: 'updateCatalogDetails',
        catalogDetails
      });

      // Update button states after catalog selection
      const githubAuth = await this.preReleaseService.isGitHubAuthenticated();
      const catalogAuth = await this.preReleaseService.isCatalogAuthenticated();
      await this.updateButtonStates(githubAuth, catalogAuth);

      this.logger.info('Successfully updated catalog details', { catalogId }, 'preRelease');
    } catch (error) {
      this.logger.error('Failed to get catalog details', { error, catalogId }, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Failed to get catalog details'
      });
    }
  }

  private async handleGetLatestClick(): Promise<void> {
    try {
      const state = await this.getWebviewState();
      if (state?.selectedCatalogId) {
        // Force a full refresh to clear caches and get fresh data
        await this.preReleaseService.handleForceRefresh(state.selectedCatalogId);
        await this.refresh();
      } else {
        await this.refresh();
      }
    } catch (error) {
      this.logger.error('Failed to get latest releases', { error }, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Failed to get latest releases'
      });
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      // Only log non-getBranchName and non-checkAuthentication messages to avoid noise
      if (message.command !== 'getBranchName' && message.command !== 'checkAuthentication') {
        this.logger.debug('Handling webview message', { command: message.command }, 'preRelease');
      }

      switch (message.command) {
        case 'getBranchName':
          await this.sendBranchName();
          break;
        case 'checkAuthentication':
          await this.sendAuthenticationStatus(true);
          break;
        case 'openUrl':
          if (message.url) {
            this.logger.debug('Opening URL', { url: message.url }, 'preRelease');
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
          }
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
        case 'githubAuth':
          await vscode.commands.executeCommand(message.data?.isLoggedIn ? 'ibmCatalog.logoutGithub' : 'ibmCatalog.loginGithub');
          await this.sendAuthenticationStatus(true);
          break;
        case 'catalogAuth':
          await vscode.commands.executeCommand(message.data?.isLoggedIn ? 'ibmCatalog.logout' : 'ibmCatalog.login');
          await this.sendAuthenticationStatus(true);
          break;
        default:
          this.logger.warn('Unknown message command received', {
            command: message.command,
            messageType: typeof message,
            hasData: !!message.data
          }, 'preRelease');
      }
    } catch (error) {
      this.logger.error('Error handling message', { error, message }, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'An error occurred'
      });
    }
  }

  public async sendAuthenticationStatus(force: boolean = false): Promise<void> {
    if (!this.view?.visible) {
      return;
    }

    // Only throttle routine checks, not forced updates
    const now = Date.now();
    if (!force && now - this.lastAuthCheck < PreReleaseWebview.AUTH_CHECK_INTERVAL) {
      return;
    }

    try {
      const githubAuth = await this.preReleaseService.isGitHubAuthenticated();
      const catalogAuth = await this.preReleaseService.isCatalogAuthenticated();

      // Update VS Code context for GitHub authentication
      await vscode.commands.executeCommand('setContext', 'ibmCatalog.isGithubLoggedIn', githubAuth);

      await this.view.webview.postMessage({
        command: 'updateAuthStatus',
        data: {
          github: {
            isLoggedIn: githubAuth,
            text: `GitHub: ${githubAuth ? 'Logged in' : 'Not logged in'}`
          },
          catalog: {
            isLoggedIn: catalogAuth,
            text: `IBM Cloud: ${catalogAuth ? 'Logged in' : 'Not logged in'}`
          }
        }
      });

      await this.updateButtonStates(githubAuth, catalogAuth);
      this.lastAuthCheck = now;
    } catch (error) {
      this.logger.error('Authentication check failed', {
        error: error instanceof Error ? error.message : String(error)
      }, 'preRelease');
    }
  }

  private async updateButtonStates(githubAuth: boolean, catalogAuth: boolean): Promise<void> {
    if (!this.view?.webview) {
      return;
    }

    try {
      // Get current catalog selection state
      const state = await this.getWebviewState();
      const hasCatalogSelected = !!state?.selectedCatalogId;

      await this.view.webview.postMessage({
        command: 'updateButtonStates',
        data: {
          githubAuth,
          catalogAuth,
          // Only enable catalog-related buttons if a catalog is selected
          enableCatalogButtons: hasCatalogSelected && catalogAuth,
          // GitHub buttons can be enabled if authenticated, regardless of catalog selection
          enableGithubButtons: githubAuth,
          // Add button text to ensure consistency
          githubBtnText: 'Create GitHub Pre-Release',
          catalogBtnText: 'Import to IBM Cloud Catalog'
        }
      });
    } catch (error) {
      this.logger.error('Failed to update button states', { error }, 'preRelease');
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
    if (!this.view) {
      return;
    }

    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (this.view) {
          const styleUri = this.view.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prerelease.css')
          );
          const scriptUri = this.view.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prerelease.js')
          );
          this.view.webview.html = this.getWebviewContent(styleUri, scriptUri);
        }
      })
    );

    this.view.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.logger.error('Error handling webview message', { error, message }, 'preRelease');
        if (this.view) {
          await this.view.webview.postMessage({
            command: 'showError',
            error: error instanceof Error ? error.message : 'An error occurred'
          });
        }
      }
    });
  }

  public dispose(): void {
    // Clear any pending timeouts
    if (this.gitHubDetailsTimeout) {
      clearTimeout(this.gitHubDetailsTimeout);
    }

    // Dispose of other resources
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}