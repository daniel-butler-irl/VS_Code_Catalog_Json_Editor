// src/services/SchemaService.ts
import * as vscode from 'vscode';
import * as https from 'https';
import { LoggingService } from './core/LoggingService';
import { SchemaMetadata } from '../types/schema';

/**
 * Service for handling JSON schema operations with improved error handling and caching
 */
export class SchemaService {
  private static readonly SCHEMA_URL = 'https://raw.githubusercontent.com/IBM/customized-deployable-architecture/main/ibm_catalog-schema.json';
  private schema: any;
  private _onDidUpdateSchema = new vscode.EventEmitter<void>();
  public readonly onDidUpdateSchema = this._onDidUpdateSchema.event;
  private logger = LoggingService.getInstance();
  private initPromise: Promise<void> | undefined;
  private retryCount = 0;
  private static readonly MAX_RETRIES = 3;

  constructor() {
    // Initialize schema on creation
    this.initPromise = this.initialize();
  }

  /**
   * Initializes the schema service by fetching the schema.
   * Includes retry logic and proper error handling.
   */
  public async initialize(): Promise<void> {
    if (this.schema) {
      return;
    }

    this.logger.debug('Initializing SchemaService');

    while (this.retryCount < SchemaService.MAX_RETRIES) {
      try {
        this.schema = await this.fetchSchema();
        this._onDidUpdateSchema.fire();
        this.logger.debug('Schema initialized successfully');
        return;
      } catch (error) {
        this.retryCount++;
        this.logger.error(`Schema initialization attempt ${this.retryCount} failed`, error);

        if (this.retryCount === SchemaService.MAX_RETRIES) {
          const errorMessage = 'Failed to initialize schema after multiple attempts';
          this.logger.error(errorMessage, error);
          await vscode.window.showErrorMessage(
            `Failed to load IBM Catalog schema: ${error instanceof Error ? error.message : 'Unknown error'}. Some features may be limited.`
          );
          throw new Error(errorMessage);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount));
      }
    }
  }

  /**
   * Gets schema metadata for a specific JSON path.
   * @param jsonPath The JSON path to retrieve the schema for
   * @returns The schema metadata for the path
   */
  public getSchemaForPath(jsonPath: string): SchemaMetadata | undefined {
    try {
      if (!this.schema) {
        this.logger.warn('Schema not available', { path: jsonPath });
        return undefined;
      }

      const pathParts = jsonPath.replace(/^\$./, '').split('.');
      let currentSchema = this.schema;
      let isRequired = false;
      let parentSchema = this.schema;

      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        const arrayMatch = part.match(/\[(\d+)\]/);

        if (arrayMatch) {
          // Handle array indices
          if (currentSchema.items) {
            currentSchema = currentSchema.items;
            // Array items are implicitly required if the array exists
            isRequired = true;
          } else {
            return undefined;
          }
        } else {
          // Check if this property is required in its parent
          if (currentSchema.required && currentSchema.required.includes(part)) {
            isRequired = true;
          }

          parentSchema = currentSchema;
          // Move to the next schema level
          if (currentSchema.properties && currentSchema.properties[part]) {
            currentSchema = currentSchema.properties[part];
          } else if (currentSchema.items) {
            currentSchema = currentSchema.items;
          } else {
            return undefined;
          }
        }
      }

      // Convert to SchemaMetadata format, ensuring required is boolean
      const metadata: SchemaMetadata = {
        type: currentSchema.type || 'object',
        required: isRequired,
        description: currentSchema.description,
        properties: currentSchema.properties,
        items: currentSchema.items,
        enum: currentSchema.enum,
        title: currentSchema.title
      };

      return metadata;

    } catch (error) {
      this.logger.error('Failed to get schema for path', error, { path: jsonPath });
      return undefined;
    }
  }

  /**
   * Fetches the schema from the remote URL with proper timeout handling
   */
  private fetchSchema(): Promise<any> {
    return new Promise((resolve, reject) => {
      const request = https.get(SchemaService.SCHEMA_URL, {
        timeout: 10000 // 10 second timeout
      }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch schema: ${res.statusCode} ${res.statusMessage}`));
          return;
        }

        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const schema = JSON.parse(data);
            this.logger.debug('Schema fetched successfully');
            resolve(schema);
          } catch (error) {
            reject(new Error('Failed to parse schema JSON'));
          }
        });
      });

      request.on('error', (error) => {
        reject(new Error(`Network error while fetching schema: ${error.message}`));
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Schema fetch request timed out'));
      });
    });
  }

  /**
   * Checks if the schema is available
   */
  public isSchemaAvailable(): boolean {
    return !!this.schema;
  }

  /**
   * Forces a schema refresh
   */
  public async refreshSchema(): Promise<void> {
    this.retryCount = 0;
    this.schema = undefined;
    this.initPromise = this.initialize();
    await this.initPromise;
  }
}
