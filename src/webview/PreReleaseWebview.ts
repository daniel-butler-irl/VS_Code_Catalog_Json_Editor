import * as vscode from 'vscode';
import { PreReleaseService } from '../services/PreReleaseService';
import { LoggingService } from '../services/core/LoggingService';

interface WebviewMessage {
  command: string;
  data?: PreReleaseDetails;
  catalogId?: string;
}

interface PreReleaseDetails {
  version: string;
  postfix: string;
  publishToCatalog: boolean;
  catalogId: string;
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
    this.logger.debug('Initializing PreReleaseWebview', { service: 'PreReleaseWebview' });
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
    });

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
        this.logger.error('Error handling webview message', { error });
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
    } catch (error) {
      this.logger.error('Error refreshing pre-release data', error, 'preRelease');
      // Don't rethrow - let the view stay alive with empty state
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
      this.logger.warn('Failed to get branch name, showing empty state', { error: error instanceof Error ? error.message : String(error) });
      await this.view.webview.postMessage({
        command: 'updateBranchName',
        branch: '',
        error: 'Not in a Git repository'
      });
    }
  }

  private async handleSetup(): Promise<void> {
    try {
      // Ensure GitHub authentication
      await this.preReleaseService.ensureGitHubAuth();
      // Refresh data after setup
      await this.refresh();
    } catch (error) {
      this.logger.error('Setup failed', { error });
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Setup failed'
      });
    }
  }

  private async handleCreatePreRelease(data: PreReleaseDetails): Promise<void> {
    try {
      // Show confirmation dialog
      const confirmMessage = `Are you sure you want to create a pre-release?
  
Version: v${data.version}-${data.postfix}
Publish to Catalog: ${data.publishToCatalog ? 'Yes' : 'No'}`;

      const result = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Yes',
        'No'
      );

      if (result === 'Yes') {
        await this.preReleaseService.createPreRelease(data);
        await this.refresh(); // Refresh data after creation
        vscode.window.showInformationMessage('Pre-release created successfully');
      }
    } catch (error) {
      this.logger.error('Failed to create pre-release', { error });
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Failed to create pre-release'
      });
    }
  }

  private getWebviewContent(styleUri: vscode.Uri, scriptUri: vscode.Uri): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view?.webview.cspSource} 'unsafe-inline'; script-src ${this.view?.webview.cspSource};">
        <title>Create Pre-release</title>
        <link rel="stylesheet" type="text/css" href="${styleUri}">
    </head>
    <body>
        <div class="container">
            <div id="errorContainer" class="error-container">
                <div class="error-message">
                    <h3>Error</h3>
                    <p id="errorText"></p>
                </div>
            </div>

            <div id="mainContent">
                <div class="section compact">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="version">Version</label>
                            <input type="text" id="version" placeholder="1.0.0" required>
                            <small>Use semantic versioning</small>
                        </div>
                        <div class="form-group">
                            <label for="postfix">Postfix</label>
                            <input type="text" id="postfix" placeholder="branch-beta" required>
                            <small>Added to version (e.g., -beta, -preview)</small>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="catalogSelect">Target Catalog</label>
                        <select id="catalogSelect" required>
                            <option value="">Select a catalog...</option>
                        </select>
                    </div>
                </div>

                <div id="catalogDetails">
                    <div class="terminal-section">
                        <div class="next-version">
                            <div>Next Versions</div>
                            <div>GitHub: Not set</div>
                            <div>Catalog: Not set</div>
                        </div>

                        <hr class="separator-line">

                        <div class="catalog-quick-info">
                            <div>Name: Not set</div>
                            <div>Offering ID: Not set</div>
                            <div>Label: Not set</div>
                        </div>

                        <hr class="separator-line">

                        <table class="version-table">
                            <thead>
                                <tr>
                                    <th>GitHub Releases</th>
                                    <th>Catalog Releases</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td colspan="2" class="empty-state">No versions available</td>
                                </tr>
                            </tbody>
                        </table>

                        <hr class="separator-line">

                        <div class="release-options">
                            <label>
                                <input type="checkbox" id="releaseGithub" checked>
                                Release GitHub
                            </label>
                            <label>
                                <input type="checkbox" id="publishToCatalog" checked>
                                Release Catalog
                            </label>
                        </div>

                        <button id="createBtn" class="release-button">Release Now</button>
                    </div>
                </div>
            </div>
        </div>
        <script src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  private getMediaUri(fileName: string): vscode.Uri {
    return this.view?.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', fileName)
    ) || vscode.Uri.file('');
  }

  private async handleCatalogSelection(catalogId: string): Promise<void> {
    try {
      const catalogDetails = await this.preReleaseService.getSelectedCatalogDetails(catalogId);
      this.view?.webview.postMessage({
        command: 'updateCatalogDetails',
        catalogDetails
      });
    } catch (error) {
      this.logger.error('Failed to get catalog details', { error, catalogId });
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Failed to get catalog details'
      });
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.command) {
        case 'getBranchName':
          await this.sendBranchName();
          break;
        case 'refresh':
          await this.refresh();
          break;
        case 'selectCatalog':
          if (message.catalogId) {
            await this.handleCatalogSelection(message.catalogId);
          }
          break;
        case 'createPreRelease':
          if (message.data) {
            await this.handleCreatePreRelease(message.data);
          }
          break;
        case 'setup':
          await this.handleSetup();
          break;
      }
    } catch (error) {
      this.logger.error('Error handling message', { error, message });
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'An error occurred'
      });
    }
  }
} 