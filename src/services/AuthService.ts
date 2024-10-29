// src/services/AuthService.ts

import * as vscode from 'vscode';

/**
 * Service for handling IBM Cloud authentication.
 */
export class AuthService {
  private static readonly API_KEY_SECRET = 'ibmCatalogApiKey';

  /**
   * Retrieves the stored API key.
   */
  public static async getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    const apiKey = await context.secrets.get(AuthService.API_KEY_SECRET);
    return apiKey;
  }

  public static async promptForApiKey(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    prompt: 'Enter your IBM Cloud API Key',
    ignoreFocusOut: true,
    password: true,
  });

  if (apiKey) {
    await context.secrets.store(AuthService.API_KEY_SECRET, apiKey);
    vscode.window.showInformationMessage('IBM Cloud API Key saved.');
  } else {
    vscode.window.showWarningMessage('IBM Cloud API Key is required for validation features.');
  }
}

public static async clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(AuthService.API_KEY_SECRET);
}

public static async isLoggedIn(context: vscode.ExtensionContext): Promise<boolean> {
  const apiKey = await context.secrets.get(AuthService.API_KEY_SECRET);
  return !!apiKey;
}

}
