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
