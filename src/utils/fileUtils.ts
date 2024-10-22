// src/utils/fileUtils.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceRequiredError, FileOperationError } from './errors';

export class FileUtils {
    public static async readFileContent(filePath: string): Promise<string> {
        try {
            return await fs.readFile(filePath, 'utf8');
        } catch (error) {
            throw new FileOperationError(
                `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                filePath
            );
        }
    }

    public static readFileContentSync(filePath: string): string {
        try {
            return require('fs').readFileSync(filePath, 'utf8');
        } catch (error) {
            throw new FileOperationError(
                `Failed to read file synchronously: ${error instanceof Error ? error.message : 'Unknown error'}`,
                filePath
            );
        }
    }

    public static async writeFileContent(filePath: string, content: string): Promise<void> {
        try {
            await fs.writeFile(filePath, content, 'utf8');
        } catch (error) {
            throw new FileOperationError(
                `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                filePath
            );
        }
    }

    public static getWorkspaceFilePath(fileName: string): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new WorkspaceRequiredError(
                'A workspace is required to perform this operation. Please open a folder or workspace.'
            );
        }
        return path.join(workspaceFolders[0].uri.fsPath, fileName);
    }

    public static isWorkspaceAvailable(): boolean {
        return !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
    }
}