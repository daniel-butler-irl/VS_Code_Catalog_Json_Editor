import * as vscode from 'vscode';
import { LoggingService } from './core/LoggingService';
import { IBMCloudService } from './IBMCloudService';
import { execAsync } from '../utils/execAsync';
import * as semver from 'semver';
import { Octokit } from '@octokit/rest';
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import * as path from 'path';
import { AuthService } from './AuthService';
import { CacheService } from '../services/CacheService';
import { DynamicCacheKeys } from '../types/cache/cacheConfig';
import { CacheKeys } from '../types/cache/cacheConfig';
import { CacheConfigurations } from '../types/cache/cacheConfig';

interface PreReleaseDetails {
  version: string;
  postfix: string;
  publishToCatalog: boolean;
  releaseGithub: boolean;
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

interface WebviewMessage {
  command: string;
  data?: PreReleaseDetails;
  catalogId?: string;
  message?: string;
}

export class PreReleaseService {
  private static instance: PreReleaseService;
  private logger = LoggingService.getInstance();
  private ibmCloudService: IBMCloudService | undefined;
  private context: vscode.ExtensionContext;
  private octokit: Octokit | undefined;
  private workspaceRoot: string | undefined;
  private view?: vscode.WebviewView;
  private cacheService: CacheService;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.logger = LoggingService.getInstance();
    this.logger.debug('Initializing PreReleaseService', { service: 'PreReleaseService' });
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
      this.logger.debug('Workspace root set to', { path: this.workspaceRoot });
    }
    this.cacheService = CacheService.getInstance();
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
      // Check cache first
      const cacheKey = `${CacheKeys.OFFERING_DETAILS}_${catalogId}`;
      const cachedDetails = this.cacheService.get<CatalogDetails>(cacheKey);
      if (cachedDetails) {
        this.logger.debug('Using cached catalog details', {
          catalogId,
          offeringId: cachedDetails.offeringId,
          name: cachedDetails.name
        }, 'preRelease');
        return cachedDetails;
      }

      const ibmCloudService = await this.getIBMCloudService();
      this.logger.debug('Getting details for selected catalog', { catalogId }, 'preRelease');

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

      this.logger.debug('Found offering name in ibm_catalog.json', { offeringName }, 'preRelease');

      // Get offerings and find the matching one
      this.logger.debug('Getting offerings for catalog', { catalogId }, 'preRelease');
      const offerings = await ibmCloudService.getOfferingsForCatalog(selectedCatalog.id);
      this.logger.debug('Retrieved offerings', {
        count: offerings.length,
        offerings: offerings.map(o => ({ id: o.id, name: o.name }))
      }, 'preRelease');

      const offering = offerings.find(o => o.name === offeringName);

      let catalogDetails: CatalogDetails;
      if (!offering) {
        // Return a special response for missing offering case
        catalogDetails = {
          catalogId: selectedCatalog.id,
          offeringId: '',
          name: offeringName,
          label: selectedCatalog.label,
          versions: [],
          offeringNotFound: true
        };
      } else {
        // Get all versions for the offering
        const allVersions = (offering.kinds || [])
          .flatMap(kind => kind.versions?.map(version => version.version) ?? [])
          .filter((version): version is string => Boolean(version))
          .sort((a, b) => semver.rcompare(a, b));

        catalogDetails = {
          catalogId: selectedCatalog.id,
          offeringId: offering.id,
          name: offering.name,
          label: selectedCatalog.label,
          versions: allVersions
        };
      }

      // Cache the result
      this.cacheService.set(cacheKey, catalogDetails, CacheConfigurations[CacheKeys.OFFERING_DETAILS]);
      this.logger.debug('Cached catalog details', {
        catalogId,
        offeringId: catalogDetails.offeringId,
        name: catalogDetails.name
      }, 'preRelease');

      return catalogDetails;
    } catch (error) {
      this.logger.error('Failed to get catalog details', {
        error,
        catalogId,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      }, 'preRelease');
      throw error instanceof Error ? error : new Error('Failed to get catalog details');
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
      const hasUnpushedChanges = await this.hasUnpushedChanges();
      if (hasUnpushedChanges) {
        this.logger.warn('Creating release with unpushed changes', { branch });
      }

      const tagName = `v${details.version}-${details.postfix}`;

      // If only publishing to catalog, verify GitHub release exists and get tarball URL
      if (!details.releaseGithub && details.publishToCatalog) {
        const existingRelease = await this.getGitHubRelease(tagName);
        if (!existingRelease) {
          throw new Error(`GitHub release ${tagName} not found. Cannot publish to catalog without a GitHub release.`);
        }
        details.targetVersion = existingRelease.tarball_url;
      }

      // Create GitHub release if requested
      if (details.releaseGithub) {
        await this.createGitHubRelease(tagName);
        if (details.publishToCatalog) {
          // Get the newly created release to get its tarball URL
          const newRelease = await this.getGitHubRelease(tagName);
          if (!newRelease) {
            throw new Error('Failed to get tarball URL for the new release');
          }
          details.targetVersion = newRelease.tarball_url;
        }
      }

      // Import to catalog if requested
      if (details.publishToCatalog) {
        if (!details.targetVersion) {
          throw new Error('No target version URL available for catalog import');
        }
        await this.importToCatalog(details);

        // Clear cache after successful release
        const ibmCloudService = await this.getIBMCloudService();
        const catalogId = await this.getSelectedCatalogId();
        if (catalogId) {
          await ibmCloudService.clearOfferingCache(catalogId);
        }
      }

      vscode.window.showInformationMessage(`Successfully created pre-release ${tagName}`);
    } catch (error) {
      this.logger.error('Failed to create pre-release', { error }, 'preRelease');
      throw error;
    }
  }

  /**
   * Gets a specific GitHub release
   * @param tagName The tag name to look for
   * @returns The release details or undefined if not found
   */
  private async getGitHubRelease(tagName: string): Promise<GitHubRelease | undefined> {
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

      const httpsMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
      const match = httpsMatch || sshMatch;

      if (!match) {
        throw new Error('Could not parse GitHub repository URL');
      }

      const [, owner, repo] = match;

      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      const response = await this.octokit.repos.getReleaseByTag({
        owner,
        repo,
        tag: tagName
      });

      return {
        tag_name: response.data.tag_name,
        name: response.data.name || '',
        created_at: response.data.created_at,
        tarball_url: response.data.tarball_url || ''
      };
    } catch (error) {
      if ((error as any).status === 404) {
        return undefined;
      }
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
      // First check if branch is published and has tracking information
      const branch = await this.getCurrentBranch();
      try {
        await execAsync('git rev-parse --abbrev-ref @{u}', this.workspaceRoot);
      } catch (error) {
        // Branch has no upstream
        this.logger.error('Branch has no upstream', { branch, error });
        throw new Error(`Branch '${branch}' is not published. Please push the branch first: git push -u origin ${branch}`);
      }

      // Check if tag already exists
      try {
        await execAsync(`git rev-parse ${tagName}`, this.workspaceRoot);
        this.logger.warn('Tag already exists', { tagName });
        throw new Error(`Tag ${tagName} already exists. Please choose a different version or postfix.`);
      } catch (error) {
        // Tag doesn't exist, which is what we want
      }

      // Create tag
      try {
        await execAsync(`git tag ${tagName}`, this.workspaceRoot);
      } catch (error) {
        this.logger.error('Failed to create tag', { tagName, error });
        throw new Error(`Failed to create tag ${tagName}. Please ensure you have write permissions.`);
      }

      // Push tag
      try {
        await execAsync(`git push origin ${tagName}`, this.workspaceRoot);
      } catch (error) {
        // If push fails, try to delete the local tag
        try {
          await execAsync(`git tag -d ${tagName}`, this.workspaceRoot);
        } catch (deleteError) {
          this.logger.error('Failed to clean up local tag after push failure', { tagName, deleteError });
        }
        this.logger.error('Failed to push tag', { tagName, error });
        throw new Error(`Failed to push tag ${tagName}. Please ensure you have push access to the repository.`);
      }

      // Get repository info
      const { stdout } = await execAsync('git config --get remote.origin.url', this.workspaceRoot);
      const repoUrl = stdout.trim();

      const httpsMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
      const match = httpsMatch || sshMatch;

      if (!match) {
        throw new Error('Could not parse GitHub repository URL');
      }

      const [, owner, repo] = match;

      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      // Create GitHub release through API
      try {
        await this.octokit.repos.createRelease({
          owner,
          repo,
          tag_name: tagName,
          name: tagName,
          prerelease: true, // Mark as pre-release since it contains a postfix
          generate_release_notes: true // Automatically generate release notes
        });
      } catch (error) {
        // If release creation fails, try to delete the tag
        try {
          await execAsync(`git push --delete origin ${tagName}`, this.workspaceRoot);
          await execAsync(`git tag -d ${tagName}`, this.workspaceRoot);
        } catch (deleteError) {
          this.logger.error('Failed to clean up tag after release creation failure', { tagName, deleteError });
        }
        this.logger.error('Failed to create GitHub release', { error });
        throw new Error('Failed to create GitHub release. Please ensure you have necessary permissions.');
      }

      this.logger.info(`Created GitHub release ${tagName}`, undefined, 'preRelease');
    } catch (error) {
      this.logger.error('Failed to create GitHub release', { error }, 'preRelease');
      throw error instanceof Error ? error : new Error('Failed to create GitHub release');
    }
  }

  /**
   * Imports the release to IBM Cloud Catalog
   * @param details Pre-release details
   */
  private async importToCatalog(details: PreReleaseDetails): Promise<void> {
    try {
      const ibmCloudService = await this.getIBMCloudService();
      const catalogId = await this.getSelectedCatalogId();
      const offeringId = await this.getSelectedOfferingId();

      if (!catalogId || !offeringId) {
        throw new Error('Catalog or offering ID not found');
      }

      if (!details.targetVersion) {
        throw new Error('No target version URL available');
      }

      await ibmCloudService.importVersion(catalogId, offeringId, {
        zipurl: details.targetVersion,
        version: details.version,
        tags: [`v${details.version}-${details.postfix}`],
        target_kinds: ['terraform'],
        install_kind: 'terraform'
      });

      this.logger.info('Imported version to catalog', {
        version: details.version,
        catalogId,
        offeringId
      }, 'preRelease');
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

  private async getSelectedCatalogId(): Promise<string | undefined> {
    const workspaceRoot = this.workspaceRoot;
    if (!workspaceRoot) {
      return undefined;
    }

    try {
      const catalogJsonPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'ibm_catalog.json');
      const catalogJsonContent = await vscode.workspace.fs.readFile(catalogJsonPath);
      const catalogJson = JSON.parse(catalogJsonContent.toString());
      return catalogJson.catalogId;
    } catch (error) {
      this.logger.error('Failed to get selected catalog ID', { error });
      return undefined;
    }
  }

  private async getSelectedOfferingId(): Promise<string | undefined> {
    const workspaceRoot = this.workspaceRoot;
    if (!workspaceRoot) {
      return undefined;
    }

    try {
      const catalogJsonPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'ibm_catalog.json');
      const catalogJsonContent = await vscode.workspace.fs.readFile(catalogJsonPath);
      const catalogJson = JSON.parse(catalogJsonContent.toString());
      return catalogJson.products?.[0]?.id;
    } catch (error) {
      this.logger.error('Failed to get selected offering ID', { error });
      return undefined;
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
        case 'forceRefresh':
          await this.handleForceRefresh(message.catalogId);
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

  public async handleForceRefresh(catalogId?: string): Promise<void> {
    this.logger.debug('Force refreshing catalog data', { catalogId }, 'preRelease');

    try {
      // Get IBM Cloud service
      const ibmCloudService = await this.getIBMCloudService();

      // Clear relevant caches first
      if (catalogId) {
        try {
          // Clear specific catalog cache
          await ibmCloudService.clearOfferingCache(catalogId);
          this.cacheService.delete(DynamicCacheKeys.OFFERING_DETAILS(catalogId));
          this.cacheService.delete(DynamicCacheKeys.CATALOG_VALIDATION(catalogId));
          this.logger.debug('Cleared cache for specific catalog', { catalogId }, 'preRelease');
        } catch (error) {
          this.logger.error('Failed to clear catalog cache', { error, catalogId }, 'preRelease');
          throw new Error(`Failed to clear catalog cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } else {
        try {
          // Clear all catalog-related caches
          await ibmCloudService.clearCatalogCache();
          this.logger.debug('Cleared all catalog caches', {}, 'preRelease');
        } catch (error) {
          this.logger.error('Failed to clear all catalog caches', { error }, 'preRelease');
          throw new Error(`Failed to clear catalog caches: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Force refresh by fetching new data with skipCache=true
      try {
        const catalogs = await ibmCloudService.getAvailableCatalogs();
        this.logger.debug('Fetched fresh catalog list', { count: catalogs.length }, 'preRelease');

        if (catalogId) {
          // Force refresh specific catalog details
          await ibmCloudService.getOfferingsForCatalog(catalogId, true);
          this.logger.debug('Fetched fresh offerings for catalog', { catalogId }, 'preRelease');
        }

        // Refresh the UI with new data
        await this.refresh();

        // If we have a catalog selected, refresh its details
        if (catalogId) {
          const catalogDetails = await this.getSelectedCatalogDetails(catalogId);
          this.view?.webview.postMessage({
            command: 'updateCatalogDetails',
            catalogDetails
          });
        }

        this.logger.info('Force refresh completed successfully', { catalogId }, 'preRelease');
      } catch (error) {
        this.logger.error('Failed to fetch fresh data', { error, catalogId }, 'preRelease');
        throw new Error(`Failed to fetch fresh data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } catch (error) {
      this.logger.error('Force refresh failed', { error, catalogId }, 'preRelease');
      // Show error to user
      this.view?.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Failed to refresh data'
      });
      throw error;
    } finally {
      // Always notify completion to restore UI state
      this.view?.webview.postMessage({
        command: 'refreshComplete'
      });
    }
  }

  private async handleSetup(): Promise<void> {
    try {
      // Ensure GitHub authentication
      await this.ensureGitHubAuth();
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
      await this.createPreRelease(data);
      await this.refresh(); // Refresh data after creation
      vscode.window.showInformationMessage('Pre-release created successfully');
    } catch (error) {
      this.logger.error('Failed to create pre-release', { error });
      throw error;
    }
  }

  private async handleCatalogSelection(catalogId: string): Promise<void> {
    try {
      const catalogDetails = await this.getSelectedCatalogDetails(catalogId);
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

  private async sendBranchName(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const branch = await this.getCurrentBranch();
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

  private async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      // Clear any existing error state during refresh
      this.view.webview.postMessage({
        command: 'showError',
        error: undefined
      });

      const [releases, catalogData] = await Promise.allSettled([
        this.getLastPreReleases().catch(error => {
          this.logger.warn('Failed to fetch releases, showing empty state', { error }, 'preRelease');
          return [];
        }),
        this.getCatalogDetails().catch(error => {
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

      // If both promises rejected, show an error
      if (releases.status === 'rejected' && catalogData.status === 'rejected') {
        this.logger.error('All refresh operations failed', {
          releasesError: releases.reason,
          catalogError: catalogData.reason
        });
        this.view.webview.postMessage({
          command: 'showError',
          error: 'Failed to refresh data. Please try again.'
        });
        return;
      }

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

      // If any operation failed, show a warning
      if (releases.status === 'rejected' || catalogData.status === 'rejected') {
        this.view.webview.postMessage({
          command: 'showError',
          error: 'Some data could not be refreshed. Please try again.'
        });
      }
    } catch (error) {
      this.logger.error('Error refreshing pre-release data', error, 'preRelease');
      this.view?.webview.postMessage({
        command: 'showError',
        error: 'Failed to refresh data. Please try again.'
      });
    }
  }
}