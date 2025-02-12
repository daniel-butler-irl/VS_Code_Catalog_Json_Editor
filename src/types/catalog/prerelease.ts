import { OfferingVersion as IBMCloudOfferingVersion, OfferingFlavor } from '../ibmCloud';

export interface PreReleaseDetails {
  version: string;
  postfix: string;
  publishToCatalog: boolean;
  releaseGithub: boolean;
  targetVersion?: string;
  catalogId?: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  created_at: string;
  tarball_url: string;
}

// Extend the IBM Cloud version for catalog-specific needs
export interface CatalogVersion extends Omit<IBMCloudOfferingVersion, 'flavor'> {
  tgz_url: string;
  flavor: OfferingFlavor;  // Make flavor required for our use case
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