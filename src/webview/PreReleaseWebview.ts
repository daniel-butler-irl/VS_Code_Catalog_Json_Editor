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
  private static instance: PreReleaseWebview;
  private view?: vscode.WebviewView;
  private preReleaseService: PreReleaseService;
  private logger = LoggingService.getInstance();
  private context: vscode.ExtensionContext;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.preReleaseService = PreReleaseService.getInstance(context);
    this.logger.debug('Initializing PreReleaseWebview', { service: 'PreReleaseWebview' }, 'preRelease');
  }

  public static getInstance(context: vscode.ExtensionContext): PreReleaseWebview {
    if (!PreReleaseWebview.instance) {
      PreReleaseWebview.instance = new PreReleaseWebview(context);
    }
    return PreReleaseWebview.instance;
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media')
      ]
    };

    const styleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prerelease.css')
    );
    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prerelease.js')
    );

    this.logger.debug('Loading webview resources', {
      styleUri: styleUri.toString(),
      scriptUri: scriptUri.toString()
    }, 'preRelease');

    // Set initial HTML
    webviewView.webview.html = this.getWebviewContent(styleUri, scriptUri);

    // Handle theme changes
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (this.view) {
          this.view.webview.html = this.getWebviewContent(styleUri, scriptUri);
        }
      })
    );

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.logger.error('Error handling webview message', { error }, 'preRelease');
        vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    // Initial data load
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      this.logger.debug('Starting pre-release panel refresh', {}, 'preRelease');

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
        <div class="container">
            <div id="errorContainer" class="error-container"></div>
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
                        <button id="githubBtn" class="github-button" disabled>
                            Pre-Release GitHub
                        </button>
                        <button id="catalogBtn" class="catalog-button" disabled>
                            Pre-Release Catalog
                        </button>
                    </div>
                </div>
                <div class="section">
                    <h2>Catalog Details</h2>
                    <div class="form-group">
                        <label for="catalogSelect">Select Catalog</label>
                        <select id="catalogSelect" disabled>
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

  private async sendAuthenticationStatus(): Promise<void> {
    try {
      const [githubAuth, catalogAuth] = await Promise.all([
        this.preReleaseService.isGitHubAuthenticated(),
        this.preReleaseService.isCatalogAuthenticated()
      ]);

      this.view?.webview.postMessage({
        command: 'authenticationStatus',
        githubAuthenticated: githubAuth,
        catalogAuthenticated: catalogAuth
      });
    } catch (error) {
      this.logger.error('Failed to get authentication status', { error }, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: 'Failed to check authentication status'
      });
    }
  }
} 