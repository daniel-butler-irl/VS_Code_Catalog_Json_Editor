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
import { PreReleaseDetails, GitHubRelease, CatalogVersion, CatalogDetails, WebviewMessage } from '../types/catalog/prerelease';
import * as fs from 'fs';
import * as os from 'os';
import { Readable, Transform, Writable } from 'stream';
import fetch from 'node-fetch';
import * as tar from 'tar';
import axios from 'axios';

interface CatalogFlavor {
  name: string;
  label: string;
  working_directory: string;
  format_kind: string;
  selected?: boolean;
}

interface CatalogProduct {
  name: string;
  label: string;
  id?: string;
  flavors?: CatalogFlavor[];
}

interface CatalogJson {
  products?: CatalogProduct[];
}

interface VersionMappingSummary {
  version: string;
  githubRelease: {
    tag: string;
    tarball_url: string;
  } | null;
  catalogVersions: {
    version: string;
    flavor: {
      name: string;
      label: string;
    };
    tgz_url: string;
    githubTag?: string;
  }[] | null;
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
    this.logger.debug('Initializing PreReleaseService', { service: 'PreReleaseService' }, 'preRelease');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
      this.logger.debug('Workspace root set to', { path: this.workspaceRoot }, 'preRelease');
    }
    this.cacheService = CacheService.getInstance();

    // Initialize GitHub authentication
    void this.initializeGitHub().catch(error => {
      this.logger.warn('Failed to initialize GitHub authentication', { error }, 'preRelease');
    });
  }

  public static async initialize(context: vscode.ExtensionContext): Promise<PreReleaseService> {
    if (!PreReleaseService.instance) {
      PreReleaseService.instance = new PreReleaseService(context);
      try {
        // Initialize GitHub authentication
        await PreReleaseService.instance.initializeGitHub();

        // Pre-initialize IBM Cloud Service if already authenticated
        const apiKey = await AuthService.getApiKey(context);
        if (apiKey) {
          PreReleaseService.instance.ibmCloudService = new IBMCloudService(apiKey);
          PreReleaseService.instance.logger.debug('IBM Cloud service pre-initialized', {}, 'preRelease');
        }

        PreReleaseService.instance.logger.info('PreReleaseService initialized successfully', {}, 'preRelease');
      } catch (error) {
        PreReleaseService.instance.logger.warn('PreReleaseService initialization had non-critical errors', { error }, 'preRelease');
        // Don't throw - allow the service to initialize with reduced functionality
      }
    }
    return PreReleaseService.instance;
  }

  public static getInstance(context: vscode.ExtensionContext): PreReleaseService {
    if (!PreReleaseService.instance) {
      throw new Error('PreReleaseService not initialized. Call initialize() first.');
    }
    return PreReleaseService.instance;
  }

  private async initializeGitHub(): Promise<void> {
    try {
      // Only check for existing session, don't create one
      const session = await vscode.authentication.getSession('github', ['repo', 'write:packages'], {
        createIfNone: false,
        clearSessionPreference: false
      });

      if (session) {
        this.octokit = new Octokit({
          auth: session.accessToken
        });
        this.logger.debug('GitHub authentication initialized', {
          status: 'success',
          scopes: session.scopes
        }, 'preRelease');
      } else {
        this.logger.debug('No GitHub session found, will authenticate when needed', {
          status: 'pending'
        }, 'preRelease');
      }
    } catch (error) {
      this.logger.error('Failed to initialize GitHub authentication', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 'preRelease');
    }
  }

  public async ensureGitHubAuth(): Promise<boolean> {
    if (this.octokit) {
      return true;
    }

    try {
      this.logger.debug('Requesting GitHub authentication', {}, 'preRelease');
      const session = await vscode.authentication.getSession('github', ['repo', 'write:packages'], {
        createIfNone: true,
        clearSessionPreference: true
      });

      if (session) {
        this.octokit = new Octokit({
          auth: session.accessToken
        });

        // Clear all caches when GitHub authentication changes
        const ibmCloudService = await this.getIBMCloudService();
        await ibmCloudService.clearAllCaches();

        this.logger.info('GitHub authentication completed', {
          status: 'success',
          scopes: session.scopes
        }, 'preRelease');
        return true;
      }

      this.logger.warn('User cancelled GitHub authentication', {}, 'preRelease');
      return false;
    } catch (error) {
      this.logger.error('Failed to authenticate with GitHub', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 'preRelease');
      throw new Error('GitHub authentication failed. Please try again.');
    }
  }

  private async getIBMCloudService(): Promise<IBMCloudService> {
    if (!this.ibmCloudService) {
      const apiKey = await AuthService.getApiKey(this.context);
      if (!apiKey) {
        throw new Error('Not authenticated with IBM Cloud');
      }
      this.ibmCloudService = new IBMCloudService(apiKey);
      this.logger.debug('IBM Cloud service initialized', {}, 'preRelease');
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
   * Gets the last 5 pre-releases from both GitHub and the catalog
   * @returns Array of pre-release details
   */
  public async getLastPreReleases(): Promise<any[]> {
    try {
      // Try to get repository info even if not authenticated
      const repoInfo = await this.getRepositoryInfo();
      if (!repoInfo) {
        this.logger.debug('No repository info available', {}, 'preRelease');
        return [];
      }

      // Create an anonymous Octokit instance for public repos if not authenticated
      const octokit = this.octokit || new Octokit();

      try {
        const releases = await octokit.rest.repos.listReleases({
          owner: repoInfo.owner,
          repo: repoInfo.name,
          per_page: 5
        });

        return releases.data;
      } catch (error) {
        // If it fails and we're not authenticated, log it as debug (expected for private repos)
        if (!this.octokit) {
          this.logger.debug('Failed to fetch releases (possibly private repository)', { error }, 'preRelease');
        } else {
          this.logger.error('Failed to fetch releases', { error }, 'preRelease');
        }
        return [];
      }
    } catch (error) {
      this.logger.error('Failed to get pre-releases', { error }, 'preRelease');
      return [];
    }
  }

  /**
   * Gets the last 5 pre-releases from GitHub
   * @returns Array of GitHub releases
   */
  private async getGitHubReleases(): Promise<GitHubRelease[]> {
    if (!this.octokit) {
      const authenticated = await this.ensureGitHubAuth();
      if (!authenticated) {
        throw new Error('GitHub authentication required');
      }
    }

    try {
      const { stdout } = await execAsync('git config --get remote.origin.url', this.workspaceRoot);
      const repoUrl = stdout.trim();
      this.logger.debug('Got repository URL', { url: repoUrl }, 'preRelease');

      // Handle both HTTPS and SSH URL formats
      const httpsMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
      const match = httpsMatch || sshMatch;

      if (!match) {
        this.logger.error('Invalid GitHub URL format', { repoUrl }, 'preRelease');
        throw new Error('Could not parse GitHub repository URL');
      }

      const [, owner, repo] = match;
      this.logger.debug('Parsed repository info', { owner, repo }, 'preRelease');

      if (!this.octokit) {
        this.logger.error('GitHub client not initialized after authentication', {}, 'preRelease');
        throw new Error('GitHub client not initialized');
      }

      // Get all releases first
      const releases = await this.octokit.repos.listReleases({
        owner,
        repo,
        per_page: 100 // Get more releases to ensure we don't miss any catalog-referenced ones
      });

      // Get catalog details to check for referenced releases
      let catalogReferencedTags = new Map<string, { tgz_url?: string; version: string }>();
      try {
        if (this.workspaceRoot) {
          // Get catalog ID directly from ibm_catalog.json
          const catalogJsonPath = vscode.Uri.joinPath(vscode.Uri.file(this.workspaceRoot), 'ibm_catalog.json');
          const catalogJsonContent = await vscode.workspace.fs.readFile(catalogJsonPath);
          const catalogJson = JSON.parse(catalogJsonContent.toString());
          const catalogId = catalogJson.catalogId;

          if (catalogId) {
            // Get catalog versions directly from IBM Cloud service
            const ibmCloudService = await this.getIBMCloudService();
            const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);
            const offering = offerings.find((o: { name: string }) => o.name === catalogJson.products?.[0]?.name);

            if (offering) {
              for (const kind of offering.kinds || []) {
                const kindVersions = await ibmCloudService.getOfferingKindVersions(
                  catalogId,
                  offering.id,
                  kind.target_kind || kind.install_kind || 'terraform'
                );

                // Add any GitHub tags referenced in catalog versions
                kindVersions.versions.forEach((version: { tgz_url?: string; version: string }) => {
                  if (version.tgz_url) {
                    const tgzUrlTag = version.tgz_url.match(/\/(?:tags|tarball)\/([^/]+?)(?:\.tar\.gz)?$/)?.[1];
                    if (tgzUrlTag) {
                      catalogReferencedTags.set(tgzUrlTag, {
                        tgz_url: version.tgz_url,
                        version: version.version
                      });
                    }
                  }
                });
              }
            }
          }
        }
      } catch (error) {
        this.logger.warn('Failed to get catalog referenced tags', { error }, 'preRelease');
        // Continue without catalog filtering if there's an error
      }

      this.logger.debug('Processing releases', {
        totalReleases: releases.data.length,
        catalogReferencedTags: Array.from(catalogReferencedTags.keys()),
      }, 'preRelease');

      // First, get all catalog-referenced releases
      const catalogReleases = releases.data
        .filter(release => catalogReferencedTags.has(release.tag_name))
        .sort((a, b) => {
          // Sort by catalog version number (descending)
          const versionA = catalogReferencedTags.get(a.tag_name)?.version || '';
          const versionB = catalogReferencedTags.get(b.tag_name)?.version || '';
          return semver.rcompare(versionA, versionB);
        })
        .slice(0, 5);

      // Then, if we have less than 5 catalog releases, add pre-releases until we reach 5
      const remainingSlots = 5 - catalogReleases.length;
      const preReleases = remainingSlots > 0 ? releases.data
        .filter(release => release.prerelease && !catalogReferencedTags.has(release.tag_name))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, remainingSlots) : [];

      // Combine and sort all releases by date
      const combinedReleases = [...catalogReleases, ...preReleases];

      this.logger.debug('Release breakdown', {
        totalCatalogReleases: catalogReleases.length,
        totalPreReleases: preReleases.length,
        combinedReleases: combinedReleases.map(r => ({
          tag_name: r.tag_name,
          is_catalog: catalogReferencedTags.has(r.tag_name),
          is_prerelease: r.prerelease,
          created_at: r.created_at
        }))
      }, 'preRelease');

      // Deduplicate releases by tag_name before returning
      const uniqueReleases = new Map<string, GitHubRelease>();
      combinedReleases.forEach(release => {
        if (!uniqueReleases.has(release.tag_name)) {
          uniqueReleases.set(release.tag_name, {
            tag_name: release.tag_name,
            name: release.name || '',
            created_at: release.created_at,
            tarball_url: release.tarball_url || ''
          });
        }
      });

      return Array.from(uniqueReleases.values());
    } catch (error) {
      this.logger.error('Failed to get GitHub releases', { error }, 'preRelease');
      throw error;
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
      this.logger.debug('Getting private catalogs from IBM Cloud service', {}, 'preRelease');

      // Get private catalogs only
      const privateCatalogs = await ibmCloudService.getAvailablePrivateCatalogs();
      this.logger.debug('Retrieved private catalogs', {
        count: privateCatalogs.length,
        catalogs: privateCatalogs.map(c => ({ id: c.id, label: c.label }))
      }, 'preRelease');

      if (!privateCatalogs.length) {
        this.logger.warn('No private catalogs found', {}, 'preRelease');
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
      // Clear all caches at the start to ensure fresh data
      const ibmCloudService = await this.getIBMCloudService();
      await ibmCloudService.clearOfferingCache(catalogId);
      this.cacheService.delete(`${CacheKeys.OFFERING_DETAILS}_${catalogId}`);
      this.cacheService.delete(`${CacheKeys.CATALOG_OFFERINGS}_${catalogId}`);
      this.logger.debug('Cleared all caches before fetching catalog details', {
        catalogId,
        clearedKeys: [
          `${CacheKeys.OFFERING_DETAILS}_${catalogId}`,
          `${CacheKeys.CATALOG_OFFERINGS}_${catalogId}`
        ]
      }, 'preRelease');

      // Check cache first
      const cacheKey = `${CacheKeys.OFFERING_DETAILS}_${catalogId}`;
      const workspaceRoot = this.workspaceRoot;
      if (!workspaceRoot) {
        throw new Error('No workspace root found');
      }

      // Get GitHub releases for version mapping
      const githubReleases = await this.getGitHubReleases().catch(error => {
        this.logger.warn('Failed to fetch GitHub releases for version mapping', { error }, 'preRelease');
        return [];
      });

      // Log GitHub releases for debugging
      this.logger.debug('GitHub releases available for mapping', {
        releases: githubReleases.map(r => ({
          tag: r.tag_name,
          version: r.tag_name.replace(/^v/, ''),
          tarball_url: r.tarball_url,
          created_at: r.created_at
        }))
      }, 'preRelease');

      // Get the selected catalog
      const privateCatalogs = await ibmCloudService.getAvailablePrivateCatalogs();
      const selectedCatalog = privateCatalogs.find((c: { id: string }) => c.id === catalogId);

      if (!selectedCatalog) {
        throw new Error(`Catalog with ID ${catalogId} not found`);
      }

      // Find offering by name (should match the name in ibm_catalog.json)
      const catalogJsonPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'ibm_catalog.json');
      const catalogJsonContent = await vscode.workspace.fs.readFile(catalogJsonPath);
      const catalogJson = JSON.parse(catalogJsonContent.toString()) as CatalogJson;

      this.logger.info('Reading ibm_catalog.json for offering details', {
        hasProducts: !!catalogJson.products,
        productCount: catalogJson.products?.length,
        productNames: catalogJson.products?.map(p => p.name),
        catalogId
      }, 'preRelease');

      const offeringName = catalogJson.products?.[0]?.name;
      const offeringLabel = catalogJson.products?.[0]?.label;

      this.logger.info('Offering details from ibm_catalog.json', {
        offeringLabel,
        offeringName,
        hasLabel: !!offeringLabel,
        source: 'ibm_catalog.json',
        catalogId
      }, 'preRelease');

      if (!offeringName) {
        throw new Error('Could not find offering name in ibm_catalog.json');
      }

      if (!offeringLabel) {
        throw new Error('Could not find offering label in ibm_catalog.json. Label is required.');
      }

      // Get offerings and find the matching one
      this.logger.debug('Getting offerings for catalog', { catalogId, offeringLabel }, 'preRelease');
      const offerings = await ibmCloudService.getOfferingsForCatalog(selectedCatalog.id);
      const offering = offerings.find((o: { name: string }) => o.name === offeringName);

      if (!offering) {
        this.logger.error('Offering not found in catalog', {
          catalogId,
          offeringName,
          availableOfferings: offerings.map((o: { name: string }) => o.name)
        }, 'preRelease');
        throw new Error(`Offering "${offeringName}" not found in catalog ${catalogId}. Please ensure the offering exists in the catalog before proceeding.`);
      }

      // Clear version-related caches before fetching fresh data
      await ibmCloudService.clearOfferingCache(catalogId);
      this.cacheService.delete(`${CacheKeys.OFFERING_DETAILS}_${catalogId}`);
      this.logger.debug('Cleared version caches before fetching fresh data', {
        catalogId,
        offeringId: offering.id
      }, 'preRelease');

      // Get all versions for each kind
      const allVersions: CatalogVersion[] = [];
      const kindVersions = await ibmCloudService.getOfferingKindVersions(
        selectedCatalog.id,
        offering.id,
        'terraform'
      );

      kindVersions.versions.forEach((version: { tgz_url?: string; version: string }) => {
        if (version.tgz_url) {
          const tgzUrlTag = version.tgz_url.match(/\/(?:tags|tarball)\/([^/]+?)(?:\.tar\.gz)?$/)?.[1];
          if (tgzUrlTag) {
            allVersions.push({
              version: version.version,
              flavor: {
                name: offering.name,
                label: offering.label,
                working_directory: version.working_directory || '.',
                format_kind: version.format_kind || 'terraform',
                selected: true
              },
              tgz_url: version.tgz_url,
              githubTag: tgzUrlTag
            });
          }
        }
      });

      if (allVersions.length === 0) {
        this.logger.error('No versions found in catalog', {
          catalogId,
          offeringId: offering.id,
          offeringName: offering.name
        }, 'preRelease');
        throw new Error(`No versions found for offering "${offeringName}" in catalog ${catalogId}. There must be at least one version in the catalog.`);
      }

      this.logger.info('Stored offering ID in cache after successful version retrieval', {
        catalogId,
        offeringId: offering.id
      }, 'preRelease');

      return {
        name: offering.name,
        label: offering.label,
        versions: allVersions,
        offeringId: offering.id
      };
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
   * Extracts catalog details from a GitHub release tarball
   * @param tarballUrl URL of the GitHub release tarball
   * @returns Extracted catalog details including all flavors
   */
  private async extractCatalogDetailsFromTarball(tarballUrl: string): Promise<{
    name: string;
    label: string;
    flavors: Array<CatalogFlavor>;
  }> {
    const tempDir = path.join(os.tmpdir(), `catalog-${Date.now()}`);
    const tempFile = path.join(tempDir, 'release.tar.gz');

    this.logger.info('Created temporary directory', { tempDir, tempFile });

    try {
      await fs.promises.mkdir(tempDir, { recursive: true });

      // Download the tarball
      this.logger.info('Downloading tarball', { archiveUrl: tarballUrl });
      const response = await axios.get(tarballUrl, { responseType: 'arraybuffer' });
      await fs.promises.writeFile(tempFile, response.data);
      this.logger.info('Downloaded tarball', { fileSize: response.data.length, tempFile });

      // Extract and find ibm_catalog.json
      const catalogJsonPath = await this.findIbmCatalogJson(tempDir, tempFile);
      if (!catalogJsonPath) {
        throw new Error('Could not find ibm_catalog.json in the release tarball');
      }

      this.logger.info('Found ibm_catalog.json', { catalogJsonPath });

      // Read and parse the catalog JSON
      const catalogJsonContent = await fs.promises.readFile(catalogJsonPath, 'utf8');
      const catalogJson: CatalogJson = JSON.parse(catalogJsonContent);

      // Debug log the catalog JSON content
      this.logger.debug('Parsed ibm_catalog.json content', {
        hasProducts: !!catalogJson.products?.length,
        productCount: catalogJson.products?.length,
        firstProductFlavors: catalogJson.products?.[0]?.flavors?.map(f => ({
          name: f.name,
          label: f.label,
          working_directory: f.working_directory
        }))
      }, 'preRelease');

      if (!catalogJson.products?.[0]) {
        throw new Error('No products found in ibm_catalog.json');
      }

      const product = catalogJson.products[0];
      const flavors = product.flavors?.map(flavor => ({
        name: flavor.name,
        label: flavor.label || flavor.name,
        working_directory: flavor.working_directory || '.',
        format_kind: flavor.format_kind || 'terraform',
        selected: true  // All flavors selected by default
      })) || [];

      this.logger.debug('Extracted flavors from ibm_catalog.json', {
        productName: product.name,
        productLabel: product.label,
        flavorCount: flavors.length,
        flavors: flavors.map(f => ({
          name: f.name,
          label: f.label,
          working_directory: f.working_directory,
          selected: f.selected
        }))
      }, 'preRelease');

      return {
        name: product.name,
        label: product.label,
        flavors
      };
    } catch (error) {
      this.logger.error('Failed to extract catalog details from tarball', {
        error,
        tarballUrl,
        tempDir
      });
      throw error;
    } finally {
      // Clean up temp directory
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        this.logger.warn('Failed to clean up temporary directory', { error, tempDir });
      }
    }
  }

  /**
   * Filters out flavors that already exist for a given version
   * @param allFlavors All available flavors
   * @param versions Catalog versions
   * @param version Version to check
   * @returns Available flavors and list of already imported flavors
   */
  private filterAvailableFlavors(
    allFlavors: CatalogFlavor[],
    versions: CatalogVersion[],
    version: string
  ): { availableFlavors: CatalogFlavor[]; alreadyImportedFlavors: CatalogFlavor[] } {
    const alreadyImportedFlavors: CatalogFlavor[] = [];
    const availableFlavors = allFlavors.filter(flavor => {
      const exists = this.flavorExistsInVersion(versions, version, flavor.name);
      if (exists) {
        // Find the existing version to get its format_kind
        const existingVersion = versions.find(v =>
          v.version === version &&
          v.flavor.name === flavor.name
        );
        alreadyImportedFlavors.push({
          ...flavor,
          format_kind: existingVersion?.flavor.format_kind || flavor.format_kind
        });
        return false;
      }
      return true;
    });

    return { availableFlavors, alreadyImportedFlavors };
  }

  /**
   * Determines if a flavor should use stack or terraform format
   * @param flavor The flavor to check
   * @returns The correct format_kind
   */
  private determineFormatKind(flavor: CatalogFlavor): string {
    // Check working directory for stack_definition.json
    if (flavor.working_directory && flavor.working_directory.includes('stack_definition.json')) {
      return 'stack';
    }
    // Check if the working directory contains 'solutions' which typically indicates a stack
    if (flavor.working_directory && flavor.working_directory.includes('solutions')) {
      return 'stack';
    }
    return flavor.format_kind || 'terraform';
  }

  private async selectFlavorsToImport(flavors: CatalogFlavor[]): Promise<CatalogFlavor[]> {
    this.logger.debug('Showing flavor selection dialog', {
      totalFlavors: flavors.length,
      flavors: flavors.map(f => ({ name: f.name, label: f.label }))
    }, 'preRelease');

    const items = flavors.map(flavor => {
      const format_kind = this.determineFormatKind(flavor);
      return {
        label: `${flavor.label}: ${flavor.name} (${format_kind})`,
        picked: true,  // All flavors selected by default
        flavor: {
          ...flavor,
          label: flavor.label || flavor.name,  // Ensure label is never undefined
          working_directory: flavor.working_directory || '.',  // Ensure working_directory is never undefined
          format_kind  // Use the determined format_kind
        }
      };
    });

    const selectedItems = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: 'Select Flavors to Import',
      placeHolder: 'All flavors are selected by default'
    });

    if (!selectedItems) {
      this.logger.debug('Flavor selection cancelled', {}, 'preRelease');
      return [];
    }

    const selectedFlavors = selectedItems.map(item => ({
      ...item.flavor,
      selected: true
    }));

    this.logger.debug('Flavors selected', {
      selectedCount: selectedFlavors.length,
      selectedFlavors: selectedFlavors.map(f => ({ name: f.name, label: f.label }))
    }, 'preRelease');

    return selectedFlavors;
  }

  /**
   * Checks if a flavor already exists for a given version in the catalog
   * @param versions Catalog versions
   * @param version Version to check
   * @param flavorName Flavor name to check
   * @returns boolean indicating if the flavor exists
   */
  private flavorExistsInVersion(versions: CatalogVersion[], version: string, flavorName: string): boolean {
    return versions.some(v =>
      v.version === version &&
      v.flavor.name === flavorName
    );
  }

  /**
   * Creates a new pre-release
   * @param details Pre-release details
   * @returns boolean indicating if the release was created
   */
  public async createPreRelease(details: PreReleaseDetails): Promise<boolean> {
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

      let confirmMessage: string;
      let confirmButtons: { title: string; isCloseAffordance: boolean }[];

      if (details.releaseGithub) {
        // For GitHub releases, check if it already exists
        const existingReleases = await this.getLastPreReleases();
        const releaseExists = existingReleases.some(release => release.tag_name === tagName);
        if (releaseExists) {
          throw new Error(`A release with tag ${tagName} already exists. Please choose a different version or postfix.`);
        }

        // GitHub release confirmation
        confirmMessage = `Create the following GitHub pre-release?\n\n` +
          `Version: ${details.version}\n` +
          `Postfix: ${details.postfix}\n` +
          `Tag: ${tagName}\n` +
          `Branch: ${branch}\n` +
          `${hasUnpushedChanges ? '⚠️ Warning: Branch has unpushed changes\n' : ''}`;

        confirmButtons = [
          { title: 'Create Pre-Release', isCloseAffordance: false },
          { title: 'Cancel', isCloseAffordance: true }
        ];
      } else if (details.publishToCatalog) {
        // For catalog imports, verify we have a catalog ID
        if (!details.catalogId) {
          this.logger.error('Catalog import attempted without catalog ID', { details });
          throw new Error('No catalog selected. Please select a catalog before importing.');
        }

        // Get catalog details for confirmation
        const catalogDetails = await this.getSelectedCatalogDetails(details.catalogId);

        // Get the catalog label from the available catalogs
        const privateCatalogs = await this.ibmCloudService?.getAvailablePrivateCatalogs();
        const selectedCatalog = privateCatalogs?.find(c => c.id === details.catalogId);
        if (!selectedCatalog) {
          throw new Error('Selected catalog not found');
        }

        // For catalog imports, verify the GitHub release exists and get its details
        const githubRelease = await this.getGitHubRelease(tagName);
        if (!githubRelease) {
          throw new Error(`GitHub release ${tagName} not found. A GitHub release is required for catalog import.`);
        }

        // Set the target version URL for catalog import
        details.targetVersion = githubRelease.tarball_url;

        // Extract catalog details from the release tarball
        const releaseDetails = await this.extractCatalogDetailsFromTarball(githubRelease.tarball_url);

        // Filter available flavors
        const { availableFlavors, alreadyImportedFlavors } = this.filterAvailableFlavors(
          releaseDetails.flavors,
          catalogDetails.versions,
          details.version
        );

        // Log flavor availability
        this.logger.debug('Flavor availability for version', {
          version: details.version,
          totalFlavors: releaseDetails.flavors.length,
          availableFlavors: availableFlavors.map(f => f.name),
          alreadyImported: alreadyImportedFlavors
        }, 'preRelease');

        // If no flavors are available, show error and return
        if (availableFlavors.length === 0) {
          const errorMessage = `All flavors are already imported for version ${details.version}:\n` +
            alreadyImportedFlavors.map(f => `  • ${f.label}: ${f.name} (${this.determineFormatKind(f)})`).join('\n');
          throw new Error(errorMessage);
        }

        // Show flavor selection dialog with only available flavors
        const selectedFlavors = await this.selectFlavorsToImport(availableFlavors);

        if (selectedFlavors.length === 0) {
          this.logger.info('Pre-release creation cancelled - no flavors selected', { tagName });
          return false;
        }

        // Store selected flavors in release details and details object
        releaseDetails.flavors = selectedFlavors;
        details.selectedFlavors = selectedFlavors;

        // Update confirmation message to show which flavors are being imported and which already exist
        confirmMessage = `Import the following to the IBM Cloud Catalog?\n\n` +
          `Catalog: ${selectedCatalog.label}\n` +
          `Offering Name: ${releaseDetails.name}\n` +
          `Offering Label: ${releaseDetails.label}\n` +
          `GitHub Release Tag: ${tagName}\n` +
          `Catalog Version: ${details.version}\n` +
          `Selected Flavors to Import:\n${selectedFlavors.map(f =>
            `  • ${f.label}: ${f.name} (${this.determineFormatKind(f)})`
          ).join('\n')}` +
          (alreadyImportedFlavors.length > 0 ? `\n\nAlready Imported Flavors:\n${alreadyImportedFlavors.map(f =>
            `  • ${f.label}: ${f.name} (${this.determineFormatKind(f)})`
          ).join('\n')}` : '') +
          `\n\nNote: A separate version will be imported for each selected flavor.`;

        confirmButtons = [
          { title: 'Import to Catalog', isCloseAffordance: false },
          { title: 'Cancel', isCloseAffordance: true }
        ];
      } else {
        throw new Error('Invalid operation: Must specify either GitHub release or catalog import');
      }

      const confirmation = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        ...confirmButtons
      );

      if (!confirmation || confirmation.title.includes('Cancel')) {
        this.logger.info('Pre-release creation cancelled by user', { tagName });
        return false;
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

        // Clear any cached GitHub releases
        this.cacheService.delete(CacheKeys.GITHUB_RELEASES);
      }

      // Import to catalog if requested
      if (details.publishToCatalog) {
        try {
          if (!details.targetVersion) {
            // If we don't have a target version yet, get it from the existing release
            const existingRelease = await this.getGitHubRelease(tagName);
            if (!existingRelease?.tarball_url) {
              throw new Error('No target version URL available for catalog import');
            }
            details.targetVersion = existingRelease.tarball_url;
          }
          await this.importToCatalog(details);

          // Clear cache after successful release
          const ibmCloudService = await this.getIBMCloudService();
          if (details.catalogId) {
            await ibmCloudService.clearOfferingCache(details.catalogId);
          }
        } catch (importError) {
          this.logger.error('Failed to import to catalog during pre-release creation', {
            error: importError,
            errorMessage: importError instanceof Error ? importError.message : 'Unknown error',
            errorStack: importError instanceof Error ? importError.stack : undefined,
            version: details.version,
            catalogId: details.catalogId,
            targetVersion: details.targetVersion,
            context: 'createPreRelease'
          }, 'preRelease');
          throw importError;
        }
      }

      vscode.window.showInformationMessage(`Successfully created pre-release ${tagName}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to create pre-release', {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        version: details.version,
        catalogId: details.catalogId,
        context: 'createPreRelease'
      }, 'preRelease');
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
        this.logger.debug('Tag does not exist, proceeding with creation', { tagName });
      }

      // Verify GitHub authentication and permissions
      if (!this.octokit) {
        const authenticated = await this.ensureGitHubAuth();
        if (!authenticated) {
          throw new Error('GitHub authentication required. Please sign in first.');
        }
      }

      // Get repository info and verify permissions
      const { stdout: repoUrl } = await execAsync('git config --get remote.origin.url', this.workspaceRoot);
      const httpsMatch = repoUrl.trim().match(/github\.com[:/]([^/]+)\/([^.]+)\.git/);
      const sshMatch = repoUrl.trim().match(/git@github\.com:([^/]+)\/([^.]+)\.git/);
      const match = httpsMatch || sshMatch;

      if (!match) {
        throw new Error('Could not parse GitHub repository URL');
      }

      const [, owner, repo] = match;

      // Verify repository permissions
      try {
        if (!this.octokit) {
          throw new Error('GitHub client not initialized');
        }
        const { data: repository } = await this.octokit.repos.get({ owner, repo });
        this.logger.debug('Checking repository permissions', {
          permissions: repository.permissions,
          isPrivate: repository.private,
          owner,
          repo
        }, 'preRelease');

        if (!repository.permissions?.push) {
          throw new Error(`You don't have write access to ${owner}/${repo}. Please check your repository permissions.`);
        }
      } catch (error) {
        this.logger.error('Failed to verify repository permissions', { error, owner, repo });
        throw new Error('Failed to verify repository permissions. Please ensure you have write access.');
      }

      // Create tag
      try {
        await execAsync(`git tag ${tagName}`, this.workspaceRoot);
        this.logger.debug('Local tag created successfully', { tagName });
      } catch (error) {
        this.logger.error('Failed to create local tag', { tagName, error });
        throw new Error(`Failed to create tag ${tagName}. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Push tag
      try {
        await execAsync(`git push origin ${tagName}`, this.workspaceRoot);
        this.logger.debug('Tag pushed successfully', { tagName });
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
    this.logger.debug('Starting catalog import process', {
      version: details.version,
      catalogId: details.catalogId,
      hasView: !!this.view
    }, 'preRelease');

    // Get catalog details first
    const catalogDetails = await this.getSelectedCatalogDetails(details.catalogId!);
    this.logger.info('Retrieved catalog details for import', {
      catalogId: details.catalogId,
      offeringId: catalogDetails.offeringId,
      name: catalogDetails.name,
      label: catalogDetails.label,
      currentVersionCount: catalogDetails.versions.length
    }, 'preRelease');

    // Start import process
    this.logger.info('Starting flavor import process', {
      catalogId: details.catalogId,
      offeringId: catalogDetails.offeringId,
      version: details.version
    }, 'preRelease');

    const ibmCloudService = await this.getIBMCloudService();

    // Get the release details to extract flavor information
    const releaseDetails = await this.extractCatalogDetailsFromTarball(details.targetVersion!);

    if (!releaseDetails.flavors || releaseDetails.flavors.length === 0) {
      throw new Error('No flavors found in the catalog manifest');
    }

    // Double check which flavors are still available (in case catalog was updated between selection and import)
    const { availableFlavors } = this.filterAvailableFlavors(
      details.selectedFlavors || releaseDetails.flavors,
      catalogDetails.versions,
      details.version
    );

    if (availableFlavors.length === 0) {
      throw new Error(`No flavors available to import for version ${details.version}. They may have been imported by another user.`);
    }

    // Use only the flavors that are still available
    const flavorsToImport = availableFlavors;

    this.logger.info('Starting import of selected flavors', {
      totalFlavors: releaseDetails.flavors.length,
      selectedFlavors: flavorsToImport.length,
      selectedFlavorNames: flavorsToImport.map((f: CatalogFlavor) => f.name)
    }, 'preRelease');

    // Import each selected flavor as a separate version
    for (const flavor of flavorsToImport) {
      // Verify one last time that this specific flavor hasn't been imported
      if (this.flavorExistsInVersion(catalogDetails.versions, details.version, flavor.name)) {
        this.logger.warn('Skipping flavor that was imported by another user', {
          version: details.version,
          flavorName: flavor.name
        }, 'preRelease');
        continue;
      }

      this.logger.info('Importing flavor', {
        flavorName: flavor.name,
        flavorLabel: flavor.label,
        workingDirectory: flavor.working_directory,
        formatKind: flavor.format_kind
      }, 'preRelease');

      try {
        const format_kind = this.determineFormatKind(flavor);
        // Import the version for this flavor
        await ibmCloudService.importVersion(
          details.catalogId!,
          catalogDetails.offeringId,
          {
            zipurl: details.targetVersion!,
            targetVersion: details.targetVersion!,
            version: details.version,
            repotype: 'git',
            catalogIdentifier: details.catalogId!,
            target_kinds: ['terraform'],
            format_kind,  // Use the determined format_kind
            product_kind: 'solution',
            flavor: {
              metadata: {
                name: flavor.name,
                label: flavor.label,
                index: flavorsToImport.indexOf(flavor) + 1  // Use flavorsToImport for index
              }
            },
            working_directory: flavor.working_directory
          }
        );

        this.logger.info('Successfully imported flavor version to catalog', {
          catalogId: details.catalogId,
          offeringId: catalogDetails.offeringId,
          version: details.version,
          flavorName: flavor.name
        }, 'preRelease');
      } catch (error) {
        this.logger.error('Failed to import flavor version', {
          error,
          catalogId: details.catalogId,
          offeringId: catalogDetails.offeringId,
          version: details.version,
          flavorName: flavor.name
        }, 'preRelease');
        throw new Error(`Failed to import flavor ${flavor.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    this.logger.debug('All flavors imported, starting cache clearing and refresh', {
      catalogId: details.catalogId,
      version: details.version
    }, 'preRelease');

    // Clear caches and force refresh of offerings
    await ibmCloudService.clearOfferingCache(details.catalogId!);
    await ibmCloudService.getOfferingsForCatalog(details.catalogId!, true);
    this.logger.debug('Cleared offering cache and refreshed offerings', {
      catalogId: details.catalogId
    }, 'preRelease');

    // Force a refresh of the selected catalog details
    this.logger.debug('Getting updated catalog details', {
      catalogId: details.catalogId
    }, 'preRelease');
    const updatedCatalogDetails = await this.getSelectedCatalogDetails(details.catalogId!);
    this.logger.debug('Retrieved updated catalog details', {
      catalogId: details.catalogId,
      offeringId: updatedCatalogDetails.offeringId,
      newVersionCount: updatedCatalogDetails.versions.length
    }, 'preRelease');

    // Get GitHub releases for version mapping
    this.logger.debug('Getting GitHub releases for version mapping', {}, 'preRelease');
    const githubReleases = await this.getGitHubReleases().catch(error => {
      this.logger.warn('Failed to fetch GitHub releases for version mapping', { error }, 'preRelease');
      return [];
    });
    this.logger.debug('Retrieved GitHub releases', {
      releaseCount: githubReleases.length,
      releases: githubReleases.map(r => r.tag_name)
    }, 'preRelease');

    // Create version mappings
    this.logger.debug('Creating version mappings', {
      catalogId: details.catalogId,
      offeringId: updatedCatalogDetails.offeringId
    }, 'preRelease');
    const versionMappings = this.getVersionMappingSummary(
      details.catalogId!,
      updatedCatalogDetails.offeringId,
      'terraform',
      githubReleases,
      updatedCatalogDetails.versions
    );
    this.logger.debug('Created version mappings', {
      mappingCount: versionMappings.length,
      mappings: versionMappings.map(m => ({
        version: m.version,
        hasGithubRelease: !!m.githubRelease,
        catalogVersionCount: m.catalogVersions?.length || 0
      }))
    }, 'preRelease');

    // Update the UI with new catalog details
    if (this.view) {
      this.logger.debug('Updating UI with new catalog details', {
        catalogId: details.catalogId,
        hasVersionMappings: !!versionMappings.length
      }, 'preRelease');
      const detailsWithMappings = {
        ...updatedCatalogDetails,
        versionMappings
      };

      await this.view.webview.postMessage({
        command: 'updateCatalogDetails',
        catalogDetails: detailsWithMappings
      });
      this.logger.debug('Sent updateCatalogDetails message to webview', {
        command: 'updateCatalogDetails',
        hasView: !!this.view
      }, 'preRelease');
    } else {
      this.logger.warn('No view available to update UI', {
        catalogId: details.catalogId
      }, 'preRelease');
    }

    this.logger.info('Successfully imported all flavors to catalog and updated UI', {
      catalogId: details.catalogId,
      offeringId: updatedCatalogDetails.offeringId,
      version: details.version,
      flavorCount: releaseDetails.flavors.length,
      flavors: releaseDetails.flavors.map(f => f.name),
      hasView: !!this.view
    }, 'preRelease');
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
      // Log the error but don't show it in the UI
      this.logger.error('Error handling message', { error, message }, 'preRelease');

      // Instead of showing an error, refresh the view with empty data
      await this.refresh();
    }
  }

  public async handleForceRefresh(catalogId?: string): Promise<void> {
    this.logger.debug('Force refreshing data', { catalogId }, 'preRelease');

    try {
      if (this.view) {
        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: true,
          message: 'Force refreshing data...'
        });
      }

      const { githubReleases, catalogDetails, versionMappings } = await this.getLatestVersions(catalogId);

      if (this.view) {
        if (catalogId && catalogDetails) {
          await this.view.webview.postMessage({
            command: 'updateCatalogDetails',
            catalogDetails: {
              ...catalogDetails,
              versionMappings
            }
          });
        }

        await this.view.webview.postMessage({
          command: 'updateData',
          releases: githubReleases,
          catalogs: (await this.getCatalogDetails()).catalogs,
          catalogDetails: catalogDetails
        });

        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: false
        });
      }

      this.logger.info('Force refresh completed successfully', { catalogId }, 'preRelease');
    } catch (error) {
      this.logger.error('Failed to force refresh', { error, catalogId }, 'preRelease');

      if (this.view) {
        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: false,
          error: 'Failed to refresh data. Please try again.'
        });
      }

      throw error;
    }
  }

  private async handleSetup(): Promise<void> {
    try {
      // Ensure GitHub authentication
      await this.ensureGitHubAuth();
      // Refresh data after setup
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
      this.logger.debug('Starting pre-release creation process', {
        version: data.version,
        postfix: data.postfix,
        releaseGithub: data.releaseGithub,
        publishToCatalog: data.publishToCatalog,
        catalogId: data.catalogId
      }, 'preRelease');

      const success = await this.createPreRelease(data);
      if (success) {
        // Add a small delay to ensure GitHub and catalog APIs have propagated the changes
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Clear all relevant caches
        const cachesToClear = new Set<string>();
        cachesToClear.add(CacheKeys.GITHUB_RELEASES);

        if (data.catalogId) {
          cachesToClear.add(`${CacheKeys.OFFERING_DETAILS}_${data.catalogId}`);
          cachesToClear.add(`${CacheKeys.CATALOG_OFFERINGS}_${data.catalogId}`);
          cachesToClear.add(`offerings:${data.catalogId}`);
          cachesToClear.add(`offeringValidation:${data.catalogId}:*`);
        }

        // Clear all unique caches at once
        this.logger.debug('Clearing caches after pre-release creation', {
          cacheKeys: Array.from(cachesToClear)
        }, 'preRelease');

        for (const cacheKey of cachesToClear) {
          this.cacheService.delete(cacheKey);
        }

        if (data.catalogId) {
          const ibmCloudService = await this.getIBMCloudService();
          await ibmCloudService.clearCatalogCache();
          await ibmCloudService.clearOfferingCache(data.catalogId);
        }

        // Force refresh the data using the same path as "Get Latest Versions"
        await this.handleForceRefresh(data.catalogId);

        this.logger.info('Pre-release created and data refreshed successfully', {
          version: `v${data.version}-${data.postfix}`,
          publishToCatalog: data.publishToCatalog
        }, 'preRelease');
      }
    } catch (error) {
      this.logger.error('Failed to create pre-release', {
        error,
        errorDetails: error instanceof Error ? {
          message: error.message,
          stack: error.stack
        } : 'Unknown error type',
        version: data.version,
        postfix: data.postfix
      }, 'preRelease');
      throw error;
    }
  }

  private async handleCatalogSelection(catalogId: string): Promise<void> {
    try {
      if (this.view) {
        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: true,
          message: 'Loading catalog details...'
        });
      }

      const { catalogDetails, versionMappings } = await this.getLatestVersions(catalogId);

      if (catalogDetails && this.view) {
        const detailsWithMappings = {
          ...catalogDetails,
          versionMappings
        };

        await this.view.webview.postMessage({
          command: 'updateCatalogDetails',
          catalogDetails: detailsWithMappings
        });

        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: false
        });
      }

      this.logger.info('Successfully updated catalog details', {
        catalogId,
        label: catalogDetails?.label,
        offeringId: catalogDetails?.offeringId
      }, 'preRelease');
    } catch (error) {
      this.logger.error('Failed to get catalog details', { error, catalogId }, 'preRelease');

      if (this.view) {
        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to get catalog details'
        });
      }
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

  private async refresh(forceRefresh: boolean = false): Promise<void> {
    if (!this.view) {
      this.logger.debug('No view available for refresh', {}, 'preRelease');
      return;
    }

    try {
      await this.view.webview.postMessage({
        command: 'setLoadingState',
        loading: true,
        message: 'Fetching latest data...'
      });

      // Get the currently selected catalog ID if any
      const selectedCatalogId = await this.getSelectedCatalogId();

      if (forceRefresh) {
        // Use the same path as "Get Latest Versions" for consistency
        await this.handleForceRefresh(selectedCatalogId);
        return;
      }

      // Get latest versions using the consolidated function
      const { githubReleases, catalogDetails, versionMappings } = await this.getLatestVersions(selectedCatalogId);

      // Get catalogs list
      const catalogData = await this.getCatalogDetails().catch(error => {
        this.logger.warn('Failed to fetch catalog details', { error }, 'preRelease');
        return { catalogs: [], selectedCatalog: undefined };
      });

      // Update UI with all data
      await this.view.webview.postMessage({
        command: 'updateData',
        releases: githubReleases,
        catalogs: catalogData.catalogs,
        catalogDetails: catalogDetails ? {
          ...catalogDetails,
          versionMappings
        } : undefined
      });

      await this.view.webview.postMessage({
        command: 'setLoadingState',
        loading: false
      });

      this.logger.info('Pre-release panel refresh complete', { forceRefresh }, 'preRelease');
    } catch (error) {
      this.logger.error('Error refreshing pre-release data', { error, forceRefresh }, 'preRelease');

      if (this.view) {
        await this.view.webview.postMessage({
          command: 'updateData',
          releases: [],
          catalogs: [],
          catalogDetails: undefined
        });

        await this.view.webview.postMessage({
          command: 'setLoadingState',
          loading: false,
          error: 'Failed to load data. Please try again.'
        });
      }
    }
  }

  public async isGitHubAuthenticated(): Promise<boolean> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo', 'write:packages'], {
        createIfNone: false,
        silent: true
      });

      if (session) {
        // Initialize Octokit if we have a valid session
        this.octokit = new Octokit({
          auth: session.accessToken
        });
        return true;
      }
      return false;
    } catch (error) {
      this.logger.warn('GitHub authentication check failed', { error }, 'preRelease');
      return false;
    }
  }

  public async isCatalogAuthenticated(): Promise<boolean> {
    try {
      const apiKey = await AuthService.getApiKey(this.context);
      return !!apiKey;
    } catch (error) {
      this.logger.warn('IBM Cloud authentication check failed', { error }, 'preRelease');
      return false;
    }
  }

  private async getRepositoryInfo(): Promise<{ owner: string; name: string } | undefined> {
    try {
      if (!this.workspaceRoot) {
        return undefined;
      }

      // Get the remote URL from git config
      const gitConfigPath = path.join(this.workspaceRoot, '.git', 'config');
      const configContent = await fs.promises.readFile(gitConfigPath, 'utf8');

      // Parse the remote URL
      const remoteUrlMatch = configContent.match(/url\s*=\s*.*github\.com[:/]([^/]+)\/([^.]+)\.git/);
      if (!remoteUrlMatch) {
        return undefined;
      }

      return {
        owner: remoteUrlMatch[1],
        name: remoteUrlMatch[2]
      };
    } catch (error) {
      this.logger.debug('Failed to get repository info', { error }, 'preRelease');
      return undefined;
    }
  }

  private async findIbmCatalogJson(tempDir: string, tempFile: string): Promise<string | undefined> {
    let catalogJsonFound = false;
    let extractedFiles: string[] = [];
    let extractedRootDir = '';

    // Extract and process the tarball
    await tar.x({
      file: tempFile,
      cwd: tempDir,
      onentry: (entry: tar.ReadEntry) => {
        extractedFiles.push(entry.path);
        if (!extractedRootDir && entry.path.includes('/')) {
          extractedRootDir = entry.path.split('/')[0];
        }
        if (entry.path.endsWith('ibm_catalog.json')) {
          this.logger.info('Found ibm_catalog.json in tarball', {
            path: entry.path,
            size: entry.size,
            type: entry.type,
            mode: entry.mode
          }, 'preRelease');
          catalogJsonFound = true;
        }
      }
    });

    this.logger.info('Extracted files from tarball', {
      totalFiles: extractedFiles.length,
      extractedFiles,
      extractedRootDir,
      catalogJsonFound
    }, 'preRelease');

    // Look for ibm_catalog.json in all subdirectories
    const findIbmCatalogJson = async (dir: string): Promise<string | undefined> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = await findIbmCatalogJson(fullPath);
          if (found) { return found; }
        } else if (entry.name === 'ibm_catalog.json') {
          return fullPath;
        }
      }
      return undefined;
    };

    const catalogFilePath = await findIbmCatalogJson(tempDir);

    if (!catalogFilePath) {
      this.logger.error('ibm_catalog.json not found after extraction', {
        tempDir,
        filesInTempDir: await fs.promises.readdir(tempDir),
        extractedFiles
      }, 'preRelease');
      throw new Error('ibm_catalog.json not found in release tarball');
    }

    this.logger.info('Found ibm_catalog.json', { catalogFilePath }, 'preRelease');
    return catalogFilePath;
  }

  private getVersionMappingSummary(
    catalogId: string,
    offeringId: string,
    kindType: string,
    githubReleases: GitHubRelease[],
    catalogVersions: CatalogVersion[]
  ): VersionMappingSummary[] {
    // Get all unique versions from both GitHub and catalog
    const allVersions = new Set([
      ...githubReleases.map(r => r.tag_name.replace(/^v/, '').split('-')[0]),
      ...catalogVersions.map(v => v.version)
    ]);

    // Sort versions by semver (newest first) and take latest 5
    const latestVersions = Array.from(allVersions)
      .sort((a, b) => -this.compareSemVer(a, b))
      .slice(0, 5);

    // Create the final mapping summary
    const mappedVersions = latestVersions.map(version => {
      // Find all catalog entries for this version
      const catalogEntries = catalogVersions.filter(v => v.version === version);

      // Find GitHub release with matching base version or tag
      const githubRelease = githubReleases.find(r => {
        const releaseVersion = r.tag_name.replace(/^v/, '').split('-')[0];
        return releaseVersion === version || r.tag_name === `v${version}`;
      });

      // Log mapping details for debugging
      this.logger.debug('Version mapping details', {
        version,
        catalogEntries: catalogEntries.map(e => ({
          version: e.version,
          flavor: e.flavor,
          tgz_url: e.tgz_url
        })),
        githubRelease: githubRelease ? {
          tag: githubRelease.tag_name,
          tarball_url: githubRelease.tarball_url
        } : null
      }, 'preRelease');

      return {
        version,
        githubRelease: githubRelease ? {
          tag: githubRelease.tag_name,
          tarball_url: githubRelease.tarball_url
        } : null,
        catalogVersions: catalogEntries.length > 0 ? catalogEntries.map(entry => ({
          version: entry.version,
          flavor: entry.flavor,
          tgz_url: entry.tgz_url,
          githubTag: entry.githubTag
        })) : null
      };
    });

    this.logger.debug('Final version mapping summary', {
      catalogId,
      offeringId,
      kindType,
      totalVersions: latestVersions.length,
      mappedVersions: mappedVersions.map(v => ({
        version: v.version,
        hasGithubRelease: !!v.githubRelease,
        githubTag: v.githubRelease?.tag,
        catalogVersionCount: v.catalogVersions?.length || 0,
        catalogFlavors: v.catalogVersions?.map(cv => cv.flavor.label)
      }))
    }, 'preRelease');

    return mappedVersions;
  }

  /**
   * Gets the latest versions from both GitHub and catalog
   * @param catalogId Optional catalog ID to get catalog versions
   * @returns Latest versions from both sources with mappings
   */
  private async getLatestVersions(catalogId?: string): Promise<{
    githubReleases: GitHubRelease[];
    catalogDetails?: CatalogDetails;
    versionMappings: VersionMappingSummary[];
  }> {
    try {
      // Get GitHub releases
      const githubReleases = await this.getGitHubReleases().catch(error => {
        this.logger.warn('Failed to fetch GitHub releases', { error }, 'preRelease');
        return [];
      });

      // Get catalog details if catalogId is provided
      let catalogDetails: CatalogDetails | undefined;
      if (catalogId) {
        catalogDetails = await this.getSelectedCatalogDetails(catalogId).catch(error => {
          this.logger.warn('Failed to fetch catalog details', { error }, 'preRelease');
          return undefined;
        });
      }

      // Create version mappings
      const versionMappings: VersionMappingSummary[] = [];
      if (catalogDetails?.versions) {
        // Get all unique versions
        const allVersions = new Set([
          ...githubReleases.map(r => r.tag_name.replace(/^v/, '').split('-')[0]),
          ...catalogDetails.versions.map(v => v.version)
        ]);

        // Sort versions by semver (newest first)
        const sortedVersions = Array.from(allVersions)
          .filter(v => semver.valid(v))
          .sort((a, b) => semver.rcompare(a, b));

        // Create mapping for each version
        for (const version of sortedVersions) {
          const githubRelease = githubReleases.find(r => {
            const releaseVersion = r.tag_name.replace(/^v/, '').split('-')[0];
            return releaseVersion === version;
          });

          const catalogVersions = catalogDetails.versions.filter(v => v.version === version);

          versionMappings.push({
            version,
            githubRelease: githubRelease ? {
              tag: githubRelease.tag_name,
              tarball_url: githubRelease.tarball_url
            } : null,
            catalogVersions: catalogVersions.length > 0 ? catalogVersions.map(v => ({
              version: v.version,
              flavor: v.flavor,
              tgz_url: v.tgz_url,
              githubTag: v.githubTag
            })) : null
          });
        }

        // Update version input with next suggested version if available
        if (sortedVersions.length > 0 && this.view) {
          const latestVersion = sortedVersions[0];
          const nextVersion = this.suggestNextVersion(latestVersion);

          // Send message to update version input
          await this.view.webview.postMessage({
            command: 'updateNextVersion',
            version: nextVersion
          });
        }
      }

      return {
        githubReleases,
        catalogDetails,
        versionMappings
      };
    } catch (error) {
      this.logger.error('Failed to get latest versions', { error }, 'preRelease');
      throw error;
    }
  }
}