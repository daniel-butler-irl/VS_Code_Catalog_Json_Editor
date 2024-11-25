// types/catalog/index.ts
import * as vscode from 'vscode';

export interface InputMapping {
    dependency_output?: string;
    dependency_input?: string;
    version_input: string;
}

export interface InputMappingContext {
    catalogId: string;
    offeringId: string;
    flavorName: string;
    version?: string;
}

export interface MappingOption {
    label: string;
    description: string;
    value: string;
    type: any;
    detail?: string;
    required?: boolean;
    defaultValue?: any;
    mappingType: 'input' | 'output';
}

/**
 * Represents a standard dependency in the catalog
 */
export interface Dependency {
    /**
     * The ID of the catalog containing this dependency
     */
    catalog_id: string;

    /**
     * The unique identifier of this dependency
     */
    id: string;

    /**
     * Display name of the dependency
     */
    name: string;

    /**
     * Version constraint for this dependency
     */
    version: string;

    /**
     * List of available flavors for this dependency
     */
    flavors: string[];

    /**
     * Whether this dependency is optional
     */
    optional: boolean;

    /**
     * Whether this dependency is enabled by default
     * @default true
     */
    on_by_default?: boolean;

    /**
     * Input mappings for this dependency
     */
    input_mapping: InputMapping[];
}

/**
 * Represents a swappable dependency group that contains alternative dependencies
 */
export interface SwappableDependency {
    /**
     * Name identifier for this swappable dependency group
     */
    name: string;

    /**
     * The dependency that should be used by default
     */
    default_dependency: string;

    /**
     * Whether this swappable dependency group is optional
     */
    optional: boolean;

    /**
     * Collection of alternative dependencies that can be swapped
     */
    dependencies: Dependency[];
}

/**
 * Represents a flavor in the catalog
 */
export interface FlavorObject {
    /**
     * Standard dependencies for this flavor
     */
    dependencies?: Dependency[];

    /**
     * Groups of swappable dependencies
     */
    swappable_dependencies?: SwappableDependency[];

    /**
     * Flag indicating dependency version 2 format
     */
    dependency_version_2?: boolean;

    /**
     * Additional flavor properties
     */
    [key: string]: any;
}

export interface ICatalogFileInfo {
    /**
     * The URI of the catalog file.
     */
    uri: vscode.Uri;

    /**
     * The workspace folder containing the catalog file.
     */
    workspaceFolder: vscode.WorkspaceFolder;

    /**
     * The display path of the catalog file.
     */
    displayPath: string;
}

/**
 * Represents the initialization and workspace state of the Catalog Service.
 */
export interface CatalogServiceState {
    /**
     * Whether the service has completed initialization.
     */
    initialized: boolean;

    /**
     * Whether a workspace is available.
     */
    hasWorkspace: boolean;

    /**
     * Current catalog file information, if available.
     */
    catalogFile?: ICatalogFileInfo;

    /**
     * Last initialization error, if any.
     */
    lastError?: Error;
    /** Operating mode of the service */
    mode: CatalogServiceMode;
}

/**
 * Operating modes for the Catalog Service
 */
export enum CatalogServiceMode {
    /** No workspace available - limited functionality */
    NoWorkspace = 'no-workspace',
    /** Workspace available but no catalog file found */
    WorkspaceOnly = 'workspace-only',
    /** Full functionality with workspace and catalog file */
    Full = 'full'
}
