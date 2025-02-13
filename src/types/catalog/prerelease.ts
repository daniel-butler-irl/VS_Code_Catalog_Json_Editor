import { OfferingVersion as IBMCloudOfferingVersion } from '../ibmCloud';

export interface PreReleaseDetails {
  version: string;
  postfix: string;
  publishToCatalog: boolean;
  releaseGithub: boolean;
  targetVersion?: string;
  catalogId?: string;
  selectedFlavors?: Array<{
    name: string;
    label: string;
    working_directory: string;
    format_kind: string;
    selected?: boolean;
  }>;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  created_at: string;
  tarball_url: string;
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
export interface CatalogVersion extends Omit<IBMCloudOfferingVersion, 'flavor'> {
  tgz_url: string;
  flavor: OfferingFlavor;
  githubTag?: string;  // Optional GitHub tag associated with this version
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
  message?: string;
}

// Re-export the IBM Cloud type for consistency
export type OfferingVersion = IBMCloudOfferingVersion; 