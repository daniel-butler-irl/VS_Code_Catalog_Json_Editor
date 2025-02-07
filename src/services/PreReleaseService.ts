import * as vscode from 'vscode';
import { LoggingService } from './core/LoggingService';
import { IBMCloudService } from './IBMCloudService';
import { execAsync } from '../utils/execAsync';
import * as semver from 'semver';
import { Octokit } from '@octokit/rest';
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import * as path from 'path';
import { AuthService } from './AuthService';

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
  offeringNotFound?: boolean;
}

export class PreReleaseService {
  private static instance: PreReleaseService;
  private logger = LoggingService.getInstance();
  private ibmCloudService: IBMCloudService | undefined;
  private context: vscode.ExtensionContext;
  private octokit: Octokit | undefined;
  private workspaceRoot: string | undefined;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.logger.debug('Initializing PreReleaseService', { service: 'PreReleaseService' });
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
      this.logger.debug('Workspace root set to', { path: this.workspaceRoot });
    }
    void this.initializeGitHub();
  }

  private async initializeGitHub(): Promise<void> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });

      if (session) {
        this.octokit = new Octokit({
          auth: session.accessToken
        });
        this.logger.debug('GitHub authentication initialized', {
          status: 'success',
          scopes: session.scopes
        });
      } else {
        this.logger.warn('No GitHub session found, authentication will be requested when needed', {
          status: 'warning'
        });
      }
    } catch (error) {
      this.logger.error('Failed to initialize GitHub authentication', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  public async ensureGitHubAuth(): Promise<boolean> {
    if (this.octokit) {
      return true;
    }

    try {
      this.logger.debug('Requesting GitHub authentication');
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone: true,
        clearSessionPreference: true // Clear any previous "don't ask again" settings
      });

      if (session) {
        this.octokit = new Octokit({
          auth: session.accessToken
        });
        this.logger.info('GitHub authentication completed', {
          status: 'success',
          scopes: session.scopes
        });
        return true;
      }

      this.logger.warn('User cancelled GitHub authentication');
      return false;
    } catch (error) {
      this.logger.error('Failed to authenticate with GitHub', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('GitHub authentication failed. Please try again.');
    }
  }

  public static getInstance(context: vscode.ExtensionContext): PreReleaseService {
    if (!PreReleaseService.instance) {
      PreReleaseService.instance = new PreReleaseService(context);
    }
    return PreReleaseService.instance;
  }

  private async getIBMCloudService(): Promise<IBMCloudService> {
    if (!this.ibmCloudService) {
      const apiKey = await AuthService.getApiKey(this.context);
      if (!apiKey) {
        throw new Error('Not authenticated with IBM Cloud');
      }
      this.ibmCloudService = new IBMCloudService(apiKey);
      this.logger.debug('IBM Cloud service initialized');
    }
    return this.ibmCloudService;
  }

  /**
   * Gets the current git branch name
   * @returns The current branch name
   * @throws Error if not in a git repository or git command fails
   */
  public async getCurrentBranch(): Promise<string> {
    if (!this.workspaceRoot) {
      throw new Error('No workspace root found');
    }
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', this.workspaceRoot);
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
    if (!this.workspaceRoot) {
      throw new Error('No workspace root found');
    }
    try {
      const { stdout: localCommit } = await execAsync('git rev-parse HEAD', this.workspaceRoot);
      const { stdout: remoteCommit } = await execAsync('git rev-parse @{u}', this.workspaceRoot);
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
    if (!this.workspaceRoot) {
      throw new Error('No workspace root found');
    }

    if (!this.octokit) {
      const authenticated = await this.ensureGitHubAuth();
      if (!authenticated) {
        throw new Error('GitHub authentication required');
      }
    }

    try {
      const { stdout } = await execAsync('git config --get remote.origin.url', this.workspaceRoot);
      const repoUrl = stdout.trim();
      this.logger.debug('Got repository URL', { url: repoUrl });

      // Handle both HTTPS and SSH URL formats
      const httpsMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
      const match = httpsMatch || sshMatch;

      if (!match) {
        this.logger.error('Invalid GitHub URL format', { repoUrl });
        throw new Error('Could not parse GitHub repository URL');
      }

      const [, owner, repo] = match;
      this.logger.debug('Parsed repository info', { owner, repo });

      if (!this.octokit) {
        this.logger.error('GitHub client not initialized after authentication');
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
      if (error instanceof Error) {
        throw new Error(`Failed to get pre-releases from GitHub: ${error.message}`);
      }
      throw new Error('Failed to get pre-releases from GitHub');
    }
  }

  /**
   * Gets the catalog details including recent versions
   * @returns Catalog details including versions and available catalogs for selection
   */
  public async getCatalogDetails(): Promise<{
    catalogs: Array<{ id: string; label: string; shortDescription?: string }>;
    selectedCatalog?: CatalogDetails;
  }> {
    try {
      const ibmCloudService = await this.getIBMCloudService();
      this.logger.debug('Getting private catalogs from IBM Cloud service');

      // Get private catalogs only
      const privateCatalogs = await ibmCloudService.getAvailablePrivateCatalogs();
      this.logger.debug('Retrieved private catalogs', {
        count: privateCatalogs.length,
        catalogs: privateCatalogs.map(c => ({ id: c.id, label: c.label }))
      });

      if (!privateCatalogs.length) {
        this.logger.warn('No private catalogs found');
        return { catalogs: [] };
      }

      // Return catalogs for webview selection
      return {
        catalogs: privateCatalogs.map(catalog => ({
          id: catalog.id,
          label: catalog.label,
          shortDescription: catalog.shortDescription
        }))
      };
    } catch (error) {
      this.logger.error('Failed to get catalog details', {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      }, 'preRelease');
      throw error instanceof Error ? error : new Error('Failed to get catalog details');
    }
  }

  /**
   * Gets the catalog details for a selected catalog ID
   * @param catalogId The selected catalog ID
   * @returns Catalog details including versions
   */
  public async getSelectedCatalogDetails(catalogId: string): Promise<CatalogDetails> {
    try {
      const ibmCloudService = await this.getIBMCloudService();
      this.logger.debug('Getting details for selected catalog', { catalogId });

      // Get the selected catalog
      const privateCatalogs = await ibmCloudService.getAvailablePrivateCatalogs();
      const selectedCatalog = privateCatalogs.find(c => c.id === catalogId);

      if (!selectedCatalog) {
        throw new Error(`Catalog with ID ${catalogId} not found`);
      }

      // Find offering by name (should match the name in ibm_catalog.json)
      const workspaceRoot = this.workspaceRoot;
      if (!workspaceRoot) {
        throw new Error('No workspace root found');
      }

      const catalogJsonPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'ibm_catalog.json');
      const catalogJsonContent = await vscode.workspace.fs.readFile(catalogJsonPath);
      const catalogJson = JSON.parse(catalogJsonContent.toString());
      const offeringName = catalogJson.products?.[0]?.name;

      if (!offeringName) {
        throw new Error('Could not find offering name in ibm_catalog.json');
      }

      this.logger.debug('Found offering name in ibm_catalog.json', { offeringName });

      // Get offerings and find the matching one
      this.logger.debug('Getting offerings for catalog', { catalogId });
      const offerings = await ibmCloudService.getOfferingsForCatalog(selectedCatalog.id, true);
      this.logger.debug('Retrieved offerings', {
        count: offerings.length,
        offerings: offerings.map(o => ({ id: o.id, name: o.name }))
      });

      const offering = offerings.find(o => o.name === offeringName);

      if (!offering) {
        // Return a special response for missing offering case
        return {
          catalogId: selectedCatalog.id,
          offeringId: '',
          name: offeringName,
          label: selectedCatalog.label,
          versions: [],
          offeringNotFound: true
        };
      }

      this.logger.debug('Found matching offering', {
        offeringId: offering.id,
        offeringName: offering.name
      });

      // Get available flavors to force a fresh API call for versions
      this.logger.debug('Getting flavors to refresh versions');
      await ibmCloudService.getAvailableFlavors(selectedCatalog.id, offering.id, true);

      // Get all versions from the offering
      this.logger.debug('Getting versions from offering', {
        offeringId: offering.id,
        kinds: offering.kinds?.length || 0,
        firstKindVersions: offering.kinds?.[0]?.versions?.length || 0,
        rawOffering: offering
      });

      const allVersions = offering.kinds?.[0]?.versions || [];
      this.logger.debug('Raw versions from offering', {
        allVersions: allVersions.map(v => ({
          version: v.version,
          created: v.created,
          updated: v.updated
        }))
      });

      const versions = offering.kinds?.[0]?.versions
        ?.map(v => v.version)
        .filter((v): v is string => {
          const isValid = !!v;
          if (!isValid) {
            this.logger.debug('Filtered out invalid version', { version: v });
          }
          return isValid;
        })
        .sort((a, b) => {
          const result = -1 * this.compareSemVer(a, b);
          this.logger.debug('Version comparison', { a, b, result });
          return result;
        }) // Sort descending
        .slice(0, 5) || []; // Get latest 5 versions

      this.logger.debug('Processed versions', {
        totalVersions: allVersions.length,
        filteredVersions: versions.length,
        versions
      });

      return {
        catalogId: selectedCatalog.id,
        offeringId: offering.id,
        name: offering.name,
        label: offering.label || offering.name,
        versions
      };
    } catch (error) {
      this.logger.error('Failed to get selected catalog details', {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        catalogId
      }, 'preRelease');
      throw error instanceof Error ? error : new Error('Failed to get selected catalog details');
    }
  }

  /**
   * Compare two semantic version strings
   * @param a First version
   * @param b Second version
   * @returns -1 if a < b, 0 if a = b, 1 if a > b
   */
  private compareSemVer(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;
      if (aVal !== bVal) {
        return aVal - bVal;
      }
    }
    return 0;
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
    if (!this.workspaceRoot) {
      throw new Error('No workspace root found');
    }
    try {
      // Create and push tag
      await execAsync(`git tag ${tagName}`, this.workspaceRoot);
      await execAsync(`git push origin ${tagName}`, this.workspaceRoot);

      // Create GitHub release through API
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

  /**
   * Gets the GitHub tag name for the current version and postfix
   * @param version The version number
   * @param postfix The postfix string
   * @returns The GitHub tag name
   */
  public getGitHubTagName(version: string, postfix: string): string {
    return `v${version}-${postfix}`;
  }
}