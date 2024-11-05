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
    uri: vscode.Uri;
    workspaceFolder: vscode.WorkspaceFolder;
    displayPath: string;
}