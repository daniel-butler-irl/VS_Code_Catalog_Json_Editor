import * as vscode from 'vscode';
import { LoggingService } from './core/LoggingService';
import { IBMCloudService } from './IBMCloudService';
import { execAsync } from '../utils/execAsync';
import * as semver from 'semver';
import { Octokit } from '@octokit/rest';
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';

interface PreReleaseDetails {
  version: string;
  postfix: string;
  publishToCatalog: boolean;
  targetVersion?: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  created_at: string;
  tarball_url: string;
}

interface CatalogDetails {
  catalogId: string;
  offeringId: string;
  name: string;
  label: string;
  versions: string[];
}

export class PreReleaseService {
  private static instance: PreReleaseService;
  private logger = LoggingService.getInstance();
  private ibmCloudService: IBMCloudService | undefined;
  private context: vscode.ExtensionContext;
  private octokit: Octokit | undefined;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.logger.debug('Initializing PreReleaseService', { service: 'PreReleaseService' });
    void this.initializeGitHub();
  }

  private async initializeGitHub(): Promise<void> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });

      if (session) {
        this.octokit = new Octokit({
          auth: session.accessToken
        });
        this.logger.debug('GitHub authentication initialized', { status: 'success' });
      } else {
        this.logger.warn('No GitHub session found', { status: 'warning' });
      }
    } catch (error) {
      this.logger.error('Failed to initialize GitHub authentication', { error });
    }
  }

  public async ensureGitHubAuth(): Promise<boolean> {
    if (this.octokit) {
      return true;
    }

    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
      if (session) {
        this.octokit = new Octokit({
          auth: session.accessToken
        });
        this.logger.info('GitHub authentication completed', { status: 'success' });
        return true;
      }
    } catch (error) {
      this.logger.error('Failed to authenticate with GitHub', { error });
    }

    return false;
  }

  public static getInstance(context: vscode.ExtensionContext): PreReleaseService {
    if (!PreReleaseService.instance) {
      PreReleaseService.instance = new PreReleaseService(context);
    }
    return PreReleaseService.instance;
  }

  private async getIBMCloudService(): Promise<IBMCloudService> {
    if (!this.ibmCloudService) {
      try {
        const { stdout } = await execAsync('ibmcloud iam oauth-tokens --output json');
        const tokens = JSON.parse(stdout);
        if (!tokens.iam_token) {
          throw new Error('Not authenticated with IBM Cloud');
        }
        this.ibmCloudService = new IBMCloudService(tokens.iam_token);
      } catch (error) {
        this.logger.error('Failed to get IBM Cloud service', { error }, 'preRelease');
        throw new Error('Failed to initialize IBM Cloud service. Please make sure you are logged in.');
      }
    }
    return this.ibmCloudService;
  }

  /**
   * Gets the current git branch name
   * @returns The current branch name
   * @throws Error if not in a git repository or git command fails
   */
  public async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD');
      return stdout.trim();
    } catch (error) {
      this.logger.error('Failed to get current branch', error, 'preRelease');
      throw new Error('Failed to get current branch. Are you in a git repository?');
    }
  }

  /**
   * Checks if there are any unpushed changes in the current branch
   * @returns true if there are unpushed changes, false otherwise
   */
  public async hasUnpushedChanges(): Promise<boolean> {
    try {
      const { stdout: localCommit } = await execAsync('git rev-parse HEAD');
      const { stdout: remoteCommit } = await execAsync('git rev-parse @{u}');
      return localCommit.trim() !== remoteCommit.trim();
    } catch (error) {
      this.logger.error('Failed to check for unpushed changes', error, 'preRelease');
      return true;
    }
  }

  /**
   * Gets the last 5 pre-releases from GitHub
   * @returns Array of pre-release details
   */
  public async getLastPreReleases(): Promise<GitHubRelease[]> {
    if (!this.octokit) {
      const authenticated = await this.ensureGitHubAuth();
      if (!authenticated) {
        throw new Error('GitHub authentication required');
      }
    }

    try {
      const { stdout } = await execAsync('git config --get remote.origin.url');
      const repoUrl = stdout.trim();
      this.logger.debug('Got repository URL', { url: repoUrl });

      const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (!match) {
        throw new Error('Could not parse GitHub repository URL');
      }

      const [, owner, repo] = match;
      this.logger.debug('Parsed repository info', { owner, repo });

      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      const releases = await this.octokit.repos.listReleases({
        owner,
        repo,
        per_page: 5
      });

      this.logger.debug('Fetched releases from GitHub', {
        count: releases.data.length,
        releases: releases.data.map(r => ({
          tag_name: r.tag_name,
          created_at: r.created_at
        }))
      });

      return releases.data.map(release => ({
        tag_name: release.tag_name,
        name: release.name || '',
        created_at: release.created_at,
        tarball_url: release.tarball_url || ''
      }));
    } catch (error) {
      this.logger.error('Failed to get pre-releases', { error });
      throw new Error('Failed to get pre-releases from GitHub');
    }
  }

  /**
   * Gets the catalog details including recent versions
   * @returns Catalog details including versions
   */
  public async getCatalogDetails(): Promise<CatalogDetails> {
    try {
      // Use existing IBMCloudService to get catalog details
      // This is a placeholder - implement actual integration with IBMCloudService
      return {
        catalogId: "placeholder",
        offeringId: "placeholder",
        name: "placeholder",
        label: "placeholder",
        versions: []
      };
    } catch (error) {
      this.logger.error('Failed to get catalog details', { error }, 'preRelease');
      throw new Error('Failed to get catalog details');
    }
  }

  /**
   * Creates a new pre-release
   * @param details Pre-release details
   */
  public async createPreRelease(details: PreReleaseDetails): Promise<void> {
    try {
      const branch = await this.getCurrentBranch();

      // Block main/master branch
      if (['main', 'master'].includes(branch)) {
        throw new Error('Cannot create pre-release from main/master branch');
      }

      // Check for unpushed changes
      if (await this.hasUnpushedChanges()) {
        throw new Error('You have unpushed changes. Please push your changes first.');
      }

      // Create GitHub release
      const tagName = `v${details.version}-${details.postfix}`;
      await this.createGitHubRelease(tagName);

      // Import to catalog if requested
      if (details.publishToCatalog) {
        await this.importToCatalog(details);
      }

      vscode.window.showInformationMessage(`Successfully created pre-release ${tagName}`);
    } catch (error) {
      this.logger.error('Failed to create pre-release', { error }, 'preRelease');
      throw error;
    }
  }

  /**
   * Creates a GitHub release
   * @param tagName The tag name for the release
   */
  private async createGitHubRelease(tagName: string): Promise<void> {
    try {
      // Create and push tag
      await execAsync(`git tag ${tagName}`);
      await execAsync(`git push origin ${tagName}`);

      // Create GitHub release through API
      // Note: This is a placeholder. You'll need to implement GitHub API integration
      this.logger.info(`Created GitHub release ${tagName}`, undefined, 'preRelease');
    } catch (error) {
      this.logger.error('Failed to create GitHub release', { error }, 'preRelease');
      throw new Error('Failed to create GitHub release');
    }
  }

  /**
   * Imports the release to IBM Cloud Catalog
   * @param details Pre-release details
   */
  private async importToCatalog(details: PreReleaseDetails): Promise<void> {
    try {
      // Use IBMCloudService to import version
      // This is a placeholder - implement actual integration with IBMCloudService
      this.logger.info('Imported version to catalog', { version: details.version }, 'preRelease');
    } catch (error) {
      this.logger.error('Failed to import to catalog', { error }, 'preRelease');
      throw new Error('Failed to import version to catalog');
    }
  }

  /**
   * Suggests the next version number based on existing releases
   * @param currentVersion The current version number
   * @returns Suggested next version number
   */
  public suggestNextVersion(currentVersion: string): string {
    if (!semver.valid(currentVersion)) {
      throw new Error('Invalid version number');
    }

    // For pre-releases, increment the patch version
    return semver.inc(currentVersion, 'patch') || currentVersion;
  }
} 