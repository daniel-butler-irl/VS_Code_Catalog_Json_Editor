// src/utils/fileUtils.ts

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Utility class for file operations.
 */
export class FileUtils {
    private static readonly EXTENSION_ID = 'catalog-editor';

    /**
     * Gets the full file path within the workspace.
     * @param fileName The name of the file.
     * @returns The full file path as a string.
     */
    public static getWorkspaceFilePath(fileName: string): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder is open.');
        }
        return path.join(workspaceFolders[0].uri.fsPath, fileName);
    }

    /**
     * Reads the content of a file.
     * @param filePath The path to the file.
     * @returns The file content as a string.
     */
    public static async readFileContent(filePath: string): Promise<string> {
        return await fs.readFile(filePath, 'utf-8');
    }

    /**
     * Writes content to a file.
     * @param filePath The path to the file.
     * @param content The content to write.
     */
    public static async writeFileContent(filePath: string, content: string): Promise<void> {
        await fs.writeFile(filePath, content, 'utf-8');
    }

    // /**
    //  * Gets the full path of a file within the extension's directory.
    //  * @param segments The path segments.
    //  * @returns The full path as a string.
    //  */
    //  public static getExtensionPath(...segments: string[]): string {
    //     const extension = vscode.extensions.getExtension(this.EXTENSION_ID);
    //     if (!extension) {
    //         throw new Error(`Extension ${this.EXTENSION_ID} not found. Please ensure the extension ID matches the name in package.json`);
    //     }
    //     return path.join(extension.extensionPath, ...segments);
    // }

    /**
     * Gets the full path of a file within the extension's directory with context.
     * @param context The extension context.
     * @param segments The path segments.
     * @returns The full path as a string.
     **/
     public static getExtensionPathWithContext(context: vscode.ExtensionContext, ...segments: string[]): string {
        return path.join(context.extensionPath, ...segments);
    }
}
