import { OfferingVersion as IBMCloudOfferingVersion } from '../ibmCloud';

export interface PreReleaseDetails {
  version: string;
  postfix: string;
  publishToCatalog?: boolean;
  releaseGithub?: boolean;
  targetVersion?: string;
  catalogId?: string;
  selectedFlavors?: Array<{
    name: string;
    label: string;
    install_type?: 'extension' | 'fullstack';
    selected?: boolean;
  }>;
  skipConfirmation?: boolean;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  created_at: string;
  tarball_url: string;
  html_url: string;
}

// Define the flavor interface directly
export interface OfferingFlavor {
  name: string;
  label: string;
  format_kind?: string;
  metadata?: {
    name: string;
    label: string;
    index?: number;
  };
}

// Extend the IBM Cloud version for catalog-specific needs
export interface CatalogVersion {
  id: string;
  version: string;
  flavor: {
    name: string;
    label: string;
    install_type?: 'extension' | 'fullstack';
  };
  tgz_url?: string;
  githubTag?: string;
}

export interface CatalogDetails {
  catalogId: string;
  offeringId: string;
  name: string;
  label: string;
  versions: CatalogVersion[];
  offeringNotFound?: boolean;
}

export interface WebviewMessage {
  command: string;
  data?: PreReleaseDetails;
  catalogId?: string;
  currentVersion?: string;
  message?: string;
  // Additional properties for direct message data
  version?: string;
  postfix?: string;
  publishToCatalog?: boolean;
  releaseGithub?: boolean;
}

// Re-export the IBM Cloud type for consistency
export type OfferingVersion = IBMCloudOfferingVersion; 