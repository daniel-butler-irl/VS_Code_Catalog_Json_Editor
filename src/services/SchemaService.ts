// src/services/SchemaService.ts

import * as vscode from 'vscode';
import * as https from 'https';

/**
 * Service for handling JSON schema operations.
 */
export class SchemaService {
  private static readonly SCHEMA_URL = 'https://raw.githubusercontent.com/IBM/customized-deployable-architecture/main/ibm_catalog-schema.json';
  private schema: any;
  private _onDidUpdateSchema = new vscode.EventEmitter<void>();
  public readonly onDidUpdateSchema = this._onDidUpdateSchema.event;

  /**
   * Initializes the schema service by fetching the schema.
   */
  public async initialize(): Promise<void> {
    try {
      this.schema = await this.fetchSchema();
      this._onDidUpdateSchema.fire();
    } catch (error) {
      this.handleError('Failed to initialize schema', error);
    }
  }

  /**
   * Gets schema metadata for a specific JSON path.
   * @param jsonPath The JSON path to retrieve the schema for.
   */
  public getSchemaForPath(jsonPath: string): any {
    try {
      if (!this.schema) {
        return undefined;
      }

      const pathParts = jsonPath.replace(/^\$./, '').split('.');
      let currentSchema = this.schema;

      for (const part of pathParts) {
        if (currentSchema.properties && currentSchema.properties[part]) {
          currentSchema = currentSchema.properties[part];
        } else if (currentSchema.items) {
          currentSchema = currentSchema.items;
        } else {
          return undefined;
        }
      }

      return currentSchema;
    } catch (error) {
      this.handleError('Failed to get schema for path', error);
      return undefined;
    }
  }

  /**
   * Fetches the schema from the remote URL.
   */
  private async fetchSchema(): Promise<any> {
    return new Promise((resolve, reject) => {
      https.get(SchemaService.SCHEMA_URL, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Handles errors consistently.
   * @param message The error message.
   * @param error The error object.
   */
  private handleError(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`${message}: ${errorMessage}`);
  }
}
