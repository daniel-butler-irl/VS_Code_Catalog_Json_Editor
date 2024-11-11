import * as vscode from 'vscode';
import { CacheService } from './CacheService';
import { LoggingService } from './core/LoggingService';
import axios from 'axios';
import { CacheKeys, CacheConfigurations } from '../types/cache/cacheConfig';

/**
 * Service for handling IBM Cloud authentication.
 */
export class AuthService {
    private static readonly API_KEY_SECRET = 'ibmCatalogApiKey';
    private static logger = LoggingService.getInstance();

    /**
     * Retrieves the stored API key.
     * @param context - The VS Code extension context.
     * @returns The stored API key, or undefined if not set.
     */
    public static async getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
        const apiKey = await context.secrets.get(AuthService.API_KEY_SECRET);
        return apiKey;
    }

    /**
     * Prompts for and stores a valid API key.
     * If valid, invalidates relevant cache entries.
     * @param context - The VS Code extension context.
     */
    public static async promptForApiKey(context: vscode.ExtensionContext): Promise<void> {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your IBM Cloud API Key',
            ignoreFocusOut: true,
            password: true,
        });

        if (apiKey) {
            const isValid = await AuthService.validateApiKey(apiKey);
            if (isValid) {
                await context.secrets.store(AuthService.API_KEY_SECRET, apiKey);

                AuthService.logger.info('API Key saved and cache invalidated');
                vscode.window.showInformationMessage('IBM Cloud API Key saved');
            } else {
                vscode.window.showErrorMessage('Invalid IBM Cloud API Key. Please try again.');
            }
        } else {
            vscode.window.showWarningMessage('IBM Cloud API Key is required for validation features');
        }
    }

    /**
     * Clears the stored API key and invalidates related cache entries.
     * @param context - The VS Code extension context.
     */
    public static async clearApiKey(context: vscode.ExtensionContext): Promise<void> {
        await context.secrets.delete(AuthService.API_KEY_SECRET);
        AuthService.logger.info('API Key cleared');

        vscode.window.showInformationMessage('IBM Cloud API Key cleared');
    }

    /**
     * Checks if a user is logged in by verifying if the API key is stored.
     * @param context - The VS Code extension context.
     * @returns True if the API key is stored, false otherwise.
     */
    public static async isLoggedIn(context: vscode.ExtensionContext): Promise<boolean> {
        const apiKey = await context.secrets.get(AuthService.API_KEY_SECRET);
        return !!apiKey;
    }

    /**
     * Validates the provided API key by attempting to generate an IAM token.
     * @param apiKey - The API key to validate.
     * @returns True if the API key is valid, false otherwise.
     */
    private static async validateApiKey(apiKey: string): Promise<boolean> {
        try {
            const response = await axios.post(
                'https://iam.cloud.ibm.com/identity/token',
                null,
                {
                    params: {
                        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
                        apikey: apiKey,
                    },
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            );

            return response.status === 200 && response.data.access_token !== undefined;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                AuthService.logger.error('API Key validation failed', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                });
            } else if (error instanceof Error) {
                AuthService.logger.error('API Key validation failed', { error: error.message });
            } else {
                AuthService.logger.error('An unknown error occurred during API Key validation');
            }
            return false;
        }
    }
}
