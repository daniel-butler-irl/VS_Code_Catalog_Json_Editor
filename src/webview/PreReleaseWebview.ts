import * as vscode from 'vscode';
import { PreReleaseService } from '../services/PreReleaseService';
import { LoggingService } from '../services/core/LoggingService';

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

    webviewView.webview.html = await this.getWebviewContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: { command: string; data?: any }) => {
      try {
        switch (message.command) {
          case 'createPreRelease':
            await this.handleCreatePreRelease(message.data);
            break;
          case 'refresh':
            await this.refresh();
            break;
          case 'getBranchName':
            await this.sendBranchName();
            break;
        }
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
      const [releases, catalogDetails] = await Promise.allSettled([
        this.preReleaseService.getLastPreReleases().catch(error => {
          this.logger.warn('Failed to fetch releases, showing empty state', { error }, 'preRelease');
          return [];
        }),
        this.preReleaseService.getCatalogDetails().catch(error => {
          this.logger.warn('Failed to fetch catalog details, showing empty state', { error }, 'preRelease');
          return {
            catalogId: '',
            offeringId: '',
            name: '',
            label: '',
            versions: []
          };
        })
      ]);

      await this.view.webview.postMessage({
        command: 'updateData',
        releases: releases.status === 'fulfilled' ? releases.value : [],
        catalogDetails: catalogDetails.status === 'fulfilled' ? catalogDetails.value : {
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

  private async handleCreatePreRelease(data: {
    version: string;
    postfix: string;
    publishToCatalog: boolean;
  }): Promise<void> {
    try {
      // Show confirmation dialog
      const catalogDetails = await this.preReleaseService.getCatalogDetails();
      const confirmMessage = `Are you sure you want to create a pre-release?

Version: ${data.version}-${data.postfix}
${data.publishToCatalog ? `
Will be published to IBM Cloud Catalog:
Catalog: ${catalogDetails.catalogId}
Offering: ${catalogDetails.offeringId}
Name: ${catalogDetails.name}
Label: ${catalogDetails.label}` : 'Will not be published to IBM Cloud Catalog'}`;

      const result = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Yes, create pre-release',
        'Cancel'
      );

      if (result === 'Yes, create pre-release') {
        await this.preReleaseService.createPreRelease(data);
        await this.refresh();
        vscode.window.showInformationMessage('Pre-release created successfully');
      }
    } catch (error) {
      this.logger.error('Error creating pre-release', error, 'preRelease');
      throw error;
    }
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prerelease.js')
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prerelease.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pre-release Management</title>
    <link href="${styleUri}" rel="stylesheet">
</head>
<body>
    <div class="container">
        <div id="errorContainer" class="error-container" style="display: none;">
            <div class="error-message">
                <h3>⚠️ Setup Required</h3>
                <p id="errorText">Please ensure:</p>
                <ul>
                    <li>You are in a Git repository</li>
                    <li>You are signed in to GitHub</li>
                    <li>You have necessary permissions</li>
                </ul>
                <button id="setupBtn" class="primary-button">Setup Pre-release</button>
            </div>
        </div>

        <div id="mainContent">
            <div class="section">
                <h2>Create Pre-release</h2>
                <div class="form-group">
                    <label for="postfix">Postfix:</label>
                    <input type="text" id="postfix" placeholder="branch-beta">
                    <small>Will be added to the end of the version number</small>
                </div>
                <div class="form-group">
                    <label for="version">Version:</label>
                    <input type="text" id="version" placeholder="1.0.0">
                    <small>Next version will be suggested based on existing releases</small>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="publishToCatalog" checked>
                        Publish to IBM Cloud Catalog
                    </label>
                </div>
                <button id="createBtn">Create Pre-release</button>
            </div>

            <div class="section">
                <h2>Recent Pre-releases</h2>
                <div id="releases" class="list">
                    <div class="loading">Loading releases...</div>
                </div>
            </div>

            <div class="section">
                <h2>Catalog Details</h2>
                <div id="catalogDetails" class="details">
                    <div class="loading">Loading catalog details...</div>
                </div>
            </div>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
  }
} 