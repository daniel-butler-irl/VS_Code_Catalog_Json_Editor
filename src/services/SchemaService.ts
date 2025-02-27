// src/services/SchemaService.ts
import * as vscode from 'vscode';
import * as https from 'https';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { LoggingService } from './core/LoggingService';
import { SchemaMetadata } from '../types/schema';
import { ValidationUIService } from './ValidationUIService';
import { ValidationRuleRegistry } from './validation';
import { SchemaModification, SchemaModificationType } from '../types/validation/rules';
import { parseTree } from 'jsonc-parser';
import { SchemaValidationIgnoreService } from './validation/SchemaValidationIgnoreService';

interface Schema {
  $schema?: string;
  $id?: string;
  type: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  description?: string;
  enum?: string[];
  title?: string;
}

interface ValidationErrorWithLocation {
  message: string;
  path: string;
  range?: vscode.Range;
}

interface JsonNode {
  type: string;
  offset: number;
  length: number;
  children?: JsonNode[];
  value?: string;
}

/**
 * Service for handling JSON schema operations with improved error handling and caching
 */
export class SchemaService {
  private static readonly SCHEMA_URL = 'https://raw.githubusercontent.com/IBM/customized-deployable-architecture/main/ibm_catalog-schema.json';
  private schema: Schema | null = null;
  private _onDidUpdateSchema = new vscode.EventEmitter<void>();
  public readonly onDidUpdateSchema = this._onDidUpdateSchema.event;
  private logger = LoggingService.getInstance();
  private initPromise: Promise<void>;
  private ajv: Ajv;

  // Add a static instance property to make the service accessible globally
  private static instance: SchemaService;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.logger.debug('Initializing SchemaService', {
      contextUri: context.extensionUri.fsPath
    }, 'schemaValidation');

    // Initialize Ajv with all options we need
    this.ajv = new Ajv({
      allErrors: true, // Don't stop on first error
      verbose: true, // Include schema path in errors
      strict: false, // Don't fail on unknown keywords
      validateFormats: true // Enable format validation
    });

    // Add format validators
    addFormats(this.ajv);

    this.initPromise = this.initialize();

    // Set the static instance
    SchemaService.instance = this;
  }

  /**
   * Get the singleton instance of the schema service
   */
  public static getInstance(): SchemaService | undefined {
    return SchemaService.instance;
  }

  /**
   * Public method to ensure the schema is initialized.
   * This is a wrapper around the private initialize method.
   * @returns Promise that resolves when initialization is complete
   */
  public async ensureInitialized(): Promise<void> {
    try {
      await this.initialize();
    } catch (error) {
      this.logger.error('Schema initialization failed', {
        error: error instanceof Error ? error.message : String(error)
      }, 'schemaValidation');
      // Schema will be null, which is handled by other methods
    }
  }

  /**
   * Initializes the schema service by fetching the schema.
   * Always tries to fetch fresh schema first, falls back to local cache if fetch fails.
   */
  private async initialize(): Promise<void> {
    if (this.schema) {
      return;
    }

    this.logger.debug('Starting schema initialization', undefined, 'schemaValidation');

    // First try to fetch fresh schema
    try {
      this.logger.debug('Fetching fresh schema from GitHub', undefined, 'schemaValidation');
      this.schema = await this.fetchSchema();

      // Compile the schema with Ajv
      try {
        this.ajv.compile(this.schema);
        this._onDidUpdateSchema.fire();
        this.logger.info('Successfully compiled schema with Ajv', undefined, 'schemaValidation');
      } catch (compileError) {
        this.logger.error('Failed to compile schema with Ajv', {
          error: compileError instanceof Error ? compileError.message : String(compileError)
        }, 'schemaValidation');
        // Don't throw, just log the error and set schema to null
        this.schema = null;
        return;
      }

      // Save fetched schema locally
      try {
        const schemaPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'schema.json');
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.context.extensionUri, 'resources'));
        await vscode.workspace.fs.writeFile(schemaPath, Buffer.from(JSON.stringify(this.schema, null, 2)));
        this.logger.info('Saved fresh schema locally for backup', undefined, 'schemaValidation');
      } catch (saveError) {
        this.logger.warn('Could not save schema locally', {
          error: saveError instanceof Error ? saveError.message : String(saveError)
        }, 'schemaValidation');
      }
      return;
    } catch (fetchError) {
      this.logger.warn('Failed to fetch fresh schema, trying local cache', {
        error: fetchError instanceof Error ? fetchError.message : String(fetchError)
      }, 'schemaValidation');

      // Try to load from local cache
      try {
        const schemaPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'schema.json');
        const schemaContent = await vscode.workspace.fs.readFile(schemaPath);
        this.schema = JSON.parse(schemaContent.toString()) as Schema;

        // Compile the cached schema
        this.ajv.compile(this.schema);
        this._onDidUpdateSchema.fire();
        this.logger.info('Successfully loaded and compiled schema from local cache', undefined, 'schemaValidation');
        return;
      } catch (localError) {
        this.logger.error('Failed to load schema from local cache', {
          error: localError instanceof Error ? localError.message : String(localError)
        }, 'schemaValidation');
      }
    }

    // If we get here, both fresh fetch and local cache failed
    // Don't throw an error, just log it and set schema to null
    this.logger.error('Failed to load schema from both GitHub and local cache', undefined, 'schemaValidation');
    this.schema = null;
  }

  /**
   * Ensure schema is loaded without throwing an error
   * @returns true if schema is available, false otherwise
   */
  private async ensureSchemaLoaded(): Promise<boolean> {
    await this.initPromise;
    return this.schema !== null;
  }

  /**
   * Gets schema metadata for a specific JSON path.
   * @param jsonPath The JSON path to retrieve the schema for
   * @returns The schema metadata for the path
   */
  public async getSchemaForPath(jsonPath: string): Promise<SchemaMetadata | undefined> {
    try {
      this.logger.debug('Getting schema for path', {
        path: jsonPath
      }, 'schemaValidation');

      await this.ensureSchemaLoaded();

      // Special handling for root path
      if (jsonPath === '$') {
        this.logger.debug('Handling root path schema request', undefined, 'schemaValidation');
        return {
          type: 'object',
          required: true,
          properties: {
            products: {
              type: 'array',
              required: true,
              description: 'Array of products in the catalog'
            }
          }
        };
      }

      // Use Ajv's internal utilities to resolve the schema for this path
      const pathParts = jsonPath.replace(/^\$\.?/, '').split('.');
      let currentSchema = this.schema!;
      let isRequired = false;

      for (const part of pathParts) {
        const arrayMatch = part.match(/(\w+)(?:\[(\d+)\])?/);
        if (!arrayMatch) {
          this.logger.warn('Invalid path part format', { part, path: jsonPath }, 'schemaValidation');
          return undefined;
        }

        const [, propertyName, arrayIndex] = arrayMatch;

        // Handle property traversal
        if (currentSchema.properties?.[propertyName]) {
          isRequired = currentSchema.required?.includes(propertyName) || false;
          currentSchema = currentSchema.properties[propertyName];
        } else {
          this.logger.warn('Property not found in schema', { propertyName }, 'schemaValidation');
          return undefined;
        }

        // Handle array index if present
        if (arrayIndex !== undefined) {
          if (currentSchema.type === 'array' && currentSchema.items) {
            currentSchema = currentSchema.items;
            isRequired = true; // Array items are required in this context
          } else {
            this.logger.warn('Invalid array access', { propertyName, arrayIndex }, 'schemaValidation');
            return undefined;
          }
        }
      }

      // Convert the schema to our metadata format
      const metadata: SchemaMetadata = {
        type: currentSchema.type,
        required: isRequired,
        description: currentSchema.description,
        enum: currentSchema.enum,
        title: currentSchema.title,
        properties: currentSchema.properties ?
          Object.fromEntries(
            Object.entries(currentSchema.properties).map(([key, value]) => [
              key,
              {
                type: value.type,
                required: currentSchema.required?.includes(key) || false,
                description: value.description,
                enum: value.enum,
                title: value.title
              }
            ])
          ) : undefined,
        items: currentSchema.items ? {
          type: currentSchema.items.type,
          required: false,
          description: currentSchema.items.description,
          enum: currentSchema.items.enum,
          title: currentSchema.items.title
        } : undefined
      };

      this.logger.debug('Resolved schema metadata', { path: jsonPath, metadata }, 'schemaValidation');
      return metadata;

    } catch (error) {
      this.logger.error('Failed to get schema for path', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        path: jsonPath
      }, 'schemaValidation');
      return undefined;
    }
  }

  /**
   * Converts an Ajv error to our internal error format with location information
   */
  private convertAjvError(error: any, document?: vscode.TextDocument): ValidationErrorWithLocation {
    // For required property errors, adjust the path to include the missing property name
    // This helps with more specific filtering
    let path = error.instancePath ? `$${error.instancePath}` : '$';

    // For required property errors, include the missing property in the path
    if (error.keyword === 'required' && error.params?.missingProperty) {
      path = `${path}/${error.params.missingProperty}`;

      this.logger.debug('Enhanced path for required property error', {
        originalPath: error.instancePath ? `$${error.instancePath}` : '$',
        enhancedPath: path,
        missingProperty: error.params.missingProperty
      }, 'schemaValidation');
    }

    let range: vscode.Range | undefined;

    if (document) {
      const root = parseTree(document.getText()) as JsonNode;
      const pathParts = error.instancePath.split('/').filter(Boolean).map((part: string) => {
        const numericIndex = parseInt(part, 10);
        return isNaN(numericIndex) ? part : numericIndex;
      });

      this.logger.debug('Converting Ajv error', {
        errorKeyword: error.keyword,
        path: error.instancePath,
        formattedPath: path,
        pathParts,
        params: error.params
      }, 'schemaValidation');

      // For missing required properties, find the parent object
      if (error.keyword === 'required') {
        const node = this.findNodeAtPath(root, pathParts);
        if (node) {
          // If we found the parent node, highlight the entire object
          range = new vscode.Range(
            document.positionAt(node.offset),
            document.positionAt(node.offset + node.length)
          );

          this.logger.debug('Found range for required property error', {
            property: error.params.missingProperty,
            path: error.instancePath,
            range: {
              start: { line: range.start.line, character: range.start.character },
              end: { line: range.end.line, character: range.end.character }
            }
          }, 'schemaValidation');
        } else {
          this.logger.warn('Could not find node for required property error', {
            property: error.params.missingProperty,
            path: error.instancePath,
            pathParts
          }, 'schemaValidation');
        }
      }
      // For additional properties errors
      else if (error.keyword === 'additionalProperties') {
        const node = this.findNodeAtPath(root, [...pathParts, error.params.additionalProperty]);
        if (node) {
          range = new vscode.Range(
            document.positionAt(node.offset),
            document.positionAt(node.offset + node.length)
          );
        }
      }
      // For all other errors
      else {
        const node = this.findNodeAtPath(root, pathParts);
        if (node) {
          range = new vscode.Range(
            document.positionAt(node.offset),
            document.positionAt(node.offset + node.length)
          );
        }
      }

      // If we still don't have a range, try to find the closest parent
      if (!range && pathParts.length > 0) {
        let currentParts = [...pathParts];
        while (currentParts.length > 0 && !range) {
          const node = this.findNodeAtPath(root, currentParts);
          if (node) {
            range = new vscode.Range(
              document.positionAt(node.offset),
              document.positionAt(node.offset + node.length)
            );
            break;
          }
          currentParts.pop();
        }
      }

      // If we still don't have a range and it's a root error, use the root object
      if (!range && error.instancePath === '') {
        const rootObj = root.children?.find((child: JsonNode) => child.type === 'object');
        if (rootObj) {
          range = new vscode.Range(
            document.positionAt(rootObj.offset),
            document.positionAt(rootObj.offset + rootObj.length)
          );
        }
      }
    }

    return {
      message: error.message || 'Unknown error',
      path,
      range
    };
  }

  /**
   * Finds the parent property node that contains the target path
   */
  private findParentPropertyNode(root: any, path: string[]): any {
    if (!root || path.length === 0) { return undefined; }

    // Remove the last segment as we want the parent
    const parentPath = path.slice(0, -1);
    let current = root;

    for (const segment of parentPath) {
      if (!current.children) { return undefined; }

      const propNode = current.children.find((c: any) =>
        c.type === 'property' &&
        c.children?.[0]?.value === segment
      );

      if (!propNode?.children?.[1]) { return undefined; }
      current = propNode.children[1];
    }

    // Now find the property node for the last segment
    if (!current.children) { return undefined; }

    const lastSegment = path[path.length - 1];
    return current.children.find((c: any) =>
      c.type === 'property' &&
      c.children?.[0]?.value === lastSegment
    );
  }

  /**
   * Converts a validation range to a vscode.Range
   */
  private convertToVSCodeRange(range: any): vscode.Range {
    if (range instanceof vscode.Range) {
      return range;
    }
    return new vscode.Range(
      new vscode.Position(range.start.line, range.start.character),
      new vscode.Position(range.end.line, range.end.character)
    );
  }

  /**
   * Validates a JSON document against a schema
   * @param document The document to validate
   * @param schema The schema to validate against
   * @returns An array of validation errors
   */
  public async validateDocument(document: vscode.TextDocument, schema: Schema | null): Promise<ValidationErrorWithLocation[]> {
    try {
      const jsonPath = document.uri.fsPath;
      const text = document.getText();
      let value: any;

      try {
        value = JSON.parse(text);
      } catch (e: unknown) {
        this.logger.error('Failed to parse JSON', {
          path: jsonPath,
          error: e instanceof Error ? e.message : String(e)
        }, 'schemaValidation');
        return [{
          message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
          path: jsonPath,
          range: undefined
        }];
      }

      // Log file path only, not the entire JSON content
      this.logger.debug('Validating document', {
        path: jsonPath,
        contentLength: text.length,
        schemaId: schema?.$id || 'schema not available'
      }, 'schemaValidation');

      const errors: ValidationErrorWithLocation[] = [];

      // Add schema validation errors only if schema is available
      if (schema) {
        const validate = this.ajv.compile(schema);
        const valid = validate(value);

        if (!valid && validate.errors) {
          const schemaErrors = validate.errors.map(err => this.convertAjvError(err, document));

          // Log all schema errors before filtering
          this.logger.debug('Schema validation errors before filtering', {
            errorCount: schemaErrors.length,
            errors: schemaErrors.map(e => ({
              message: e.message,
              path: e.path
            }))
          }, 'schemaValidation');

          // Filter out ignored schema validation errors
          const ignoreService = SchemaValidationIgnoreService.getInstance();
          const filteredSchemaErrors = ignoreService.filterIgnoredErrors(schemaErrors);

          // Log filtered schema errors
          this.logger.debug('Schema validation errors after filtering', {
            errorCount: filteredSchemaErrors.length,
            errors: filteredSchemaErrors.map(e => ({
              message: e.message,
              path: e.path
            }))
          }, 'schemaValidation');

          errors.push(...filteredSchemaErrors);
        }
      } else {
        // Schema is not available, log warning
        this.logger.warn('Schema validation skipped - schema not available', {
          path: jsonPath
        }, 'schemaValidation');
      }

      // Add custom validation rule errors (these already have proper location info)
      // These will run whether schema is available or not
      const ruleErrors = await ValidationRuleRegistry.getInstance().validateAll(value, text);
      errors.push(...ruleErrors.map(err => ({
        message: err.message,
        path: err.path || jsonPath,
        range: err.range ? this.convertToVSCodeRange(err.range) : undefined
      })));

      if (errors.length > 0) {
        this.logger.warn('Validation failed', {
          path: jsonPath,
          errorCount: errors.length
        }, 'schemaValidation');

        return errors;
      }

      this.logger.debug('Validation successful', {
        path: jsonPath
      }, 'schemaValidation');

      return [];
    } catch (error: unknown) {
      const docPath = document.uri.fsPath;
      this.logger.error('Validation error', {
        error: error instanceof Error ? error.message : String(error),
        path: docPath
      }, 'schemaValidation');
      return [{
        message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        path: docPath
      }];
    }
  }

  /**
   * Finds the range in the document for a given JSON path
   */
  private findRangeForJsonPath(document: vscode.TextDocument, jsonPath: string): vscode.Range | undefined {
    try {
      const text = document.getText();
      const parser = require('jsonc-parser');

      interface JsonNode {
        type: string;
        offset: number;
        length: number;
        children?: JsonNode[];
        value?: string;
      }

      const root = parser.parseTree(text) as JsonNode;

      // Handle root path
      if (jsonPath === '$') {
        return new vscode.Range(
          document.positionAt(root.offset),
          document.positionAt(root.offset + root.length)
        );
      }

      // Parse path segments
      const segments = jsonPath.split('/').filter(s => s).map(segment =>
        segment.replace(/~1/g, '/').replace(/~0/g, '~')
      );

      // Navigate through the JSON structure using AST
      let currentNode: JsonNode = root;
      let parentNode: JsonNode | undefined;
      let lastFoundNode: JsonNode = root;
      let missingSegment: string | undefined;

      for (const segment of segments) {
        if (!currentNode.children) {
          // We've hit a leaf node but still have segments to process
          // Return the last found node's range
          return new vscode.Range(
            document.positionAt(lastFoundNode.offset),
            document.positionAt(lastFoundNode.offset + lastFoundNode.length)
          );
        }

        parentNode = currentNode;
        lastFoundNode = currentNode;

        // Handle array indices
        if (/^\d+$/.test(segment)) {
          const index = parseInt(segment, 10);
          if (currentNode.type === 'array' && currentNode.children.length > index) {
            currentNode = currentNode.children[index];
            continue;
          }
          missingSegment = segment;
          break;
        }

        // For object properties, find the property node and get its value
        const propNode: JsonNode | undefined = currentNode.children.find(c =>
          c.type === 'property' &&
          c.children?.[0]?.value === segment
        );

        if (!propNode?.children?.[1]) {
          missingSegment = segment;
          break;
        }

        currentNode = propNode.children[1];
      }

      // If we found the target node, return its range
      if (!missingSegment) {
        return new vscode.Range(
          document.positionAt(currentNode.offset),
          document.positionAt(currentNode.offset + currentNode.length)
        );
      }

      // For missing properties, return the parent object's range
      // This is better than returning line 1, column 1
      if (parentNode) {
        // Find where we should insert the missing property
        const position = document.positionAt(parentNode.offset + 1); // Just inside the opening brace
        return new vscode.Range(position, position);
      }

      // Fallback to the last successfully found node
      return new vscode.Range(
        document.positionAt(lastFoundNode.offset),
        document.positionAt(lastFoundNode.offset + lastFoundNode.length)
      );
    } catch (error) {
      this.logger.error('Error finding range for JSON path', {
        error: error instanceof Error ? error.message : String(error),
        jsonPath
      }, 'schemaValidation');

      // Return first line as last resort
      return new vscode.Range(0, 0, 0, 0);
    }
  }

  /**
   * Finds the end position of a JSON value
   */
  private findValueEnd(text: string, start: number): number {
    let pos = start;
    while (pos < text.length && /\s/.test(text[pos])) {
      pos++;
    }

    if (pos >= text.length) {
      return -1;
    }

    switch (text[pos]) {
      case '"': {
        // String value
        pos++;
        while (pos < text.length) {
          if (text[pos] === '"' && text[pos - 1] !== '\\') {
            return pos + 1;
          }
          pos++;
        }
        return -1;
      }
      case '{':
      case '[': {
        // Object or array
        const stack = [text[pos]];
        pos++;
        while (pos < text.length && stack.length > 0) {
          if (text[pos] === '"') {
            pos++;
            while (pos < text.length) {
              if (text[pos] === '"' && text[pos - 1] !== '\\') {
                break;
              }
              pos++;
            }
          } else if (text[pos] === '{' || text[pos] === '[') {
            stack.push(text[pos]);
          } else if (text[pos] === '}' && stack[stack.length - 1] === '{') {
            stack.pop();
          } else if (text[pos] === ']' && stack[stack.length - 1] === '[') {
            stack.pop();
          }
          pos++;
        }
        return pos;
      }
      default: {
        // Number, boolean, or null
        while (pos < text.length && !/[,}\]]/g.test(text[pos])) {
          pos++;
        }
        return pos;
      }
    }
  }

  private fetchSchema(): Promise<Schema> {
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
            const schema = JSON.parse(data) as Schema;
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

  public isSchemaAvailable(): boolean {
    const available = this.schema !== null;
    this.logger.debug('Checking schema availability', {
      available,
      schemaLoaded: !!this.schema
    }, 'schemaValidation');
    return available;
  }

  public async refreshSchema(): Promise<void> {
    this.logger.debug('Refreshing schema', undefined, 'schemaValidation');
    this.schema = null;
    await this.initialize();
  }

  /**
   * Gets the schema for validation
   * @returns The schema if available, or null if not available
   */
  public async getSchema(): Promise<Schema | null> {
    await this.ensureSchemaLoaded();
    return this.schema;
  }

  /**
   * Modifies the schema based on enabled validation rules
   * @param schema The schema to modify
   * @param ruleRegistry The validation rule registry
   * @returns Modified schema
   */
  private modifySchemaForRules(schema: Schema, ruleRegistry: ValidationRuleRegistry): Schema {
    const modifiedSchema = JSON.parse(JSON.stringify(schema));

    // Get all enabled rules that can override schema
    const enabledRules = ruleRegistry.getAllRules()
      .filter(rule => {
        const config = ruleRegistry.getRuleConfig(rule.id);
        return rule.overrideSchema && config?.enabled;
      });

    // Apply each rule's schema modifications
    enabledRules.forEach(rule => {
      if (rule.schemaModifications) {
        rule.schemaModifications.forEach(mod => {
          switch (mod.type) {
            case SchemaModificationType.RemoveRequired:
              this.removeRequiredProperty(modifiedSchema, mod.property);
              break;
            // Add more cases here for other modification types
            // case SchemaModificationType.AddRequired:
            //   this.addRequiredProperty(modifiedSchema, mod.property);
            //   break;
          }
        });
      }
    });

    return modifiedSchema;
  }

  /**
   * Removes a property from required arrays throughout the schema
   * @param schema The schema to modify
   * @param propertyName The property name to remove from required arrays
   */
  private removeRequiredProperty(schema: Schema, propertyName: string): void {
    const processNode = (node: any) => {
      if (node.required && Array.isArray(node.required)) {
        node.required = node.required.filter((prop: string) => prop !== propertyName);
      }
      if (node.properties) {
        Object.values(node.properties).forEach(processNode);
      }
      if (node.items) {
        processNode(node.items);
      }
    };

    processNode(schema);
  }

  /**
   * Finds a node at the given path in the parse tree
   */
  private findNodeAtPath(root: JsonNode, path: (string | number)[]): JsonNode | undefined {
    if (!root || !path.length) { return root; }

    let current = root;

    // First find the root object node if we're starting from the document root
    if (current.type === 'object' && current.children?.[0]?.type === 'object') {
      current = current.children[0];
    }

    for (const segment of path) {
      if (!current.children) {
        this.logger.debug('No children found at current node', {
          nodeType: current.type,
          segment
        }, 'schemaValidation');
        return undefined;
      }

      if (typeof segment === 'number') {
        // For array indices, first find the array node
        const arrayNode = current.type === 'array' ? current : current.children.find(c => c.type === 'array');

        if (!arrayNode?.children || segment >= arrayNode.children.length) {
          this.logger.debug('Array index out of bounds or array not found', {
            segment,
            arrayLength: arrayNode?.children?.length
          }, 'schemaValidation');
          return undefined;
        }

        current = arrayNode.children[segment];
      } else {
        // For object properties, find the property node
        const propNode = current.children.find(c =>
          c.type === 'property' &&
          c.children?.[0]?.value === segment
        );

        if (!propNode?.children?.[1]) {
          this.logger.debug('Property not found', {
            segment,
            currentNodeType: current.type
          }, 'schemaValidation');
          return undefined;
        }

        current = propNode.children[1];
      }
    }

    return current;
  }

  /**
   * Generates a formatted error summary for creating ignore patterns
   * This method creates a structured representation of validation errors
   * that can be used to create ignore patterns without logging the entire file
   * 
   * @param errors The validation errors to summarize
   * @returns A formatted error summary object
   */
  public generateErrorSummary(errors: ValidationErrorWithLocation[]): any {
    // Group errors by message pattern
    const errorGroups = new Map<string, {
      pattern: string;
      paths: string[];
      count: number;
      sample: ValidationErrorWithLocation;
    }>();

    // Process each error
    errors.forEach(error => {
      // Create a simplified pattern by removing specific details
      const pattern = error.message
        .replace(/'.+?'/g, "'*'") // Replace quoted values with '*'
        .replace(/\d+/g, "*");    // Replace numbers with '*'

      // Get or create group
      const group = errorGroups.get(pattern) || {
        pattern,
        paths: [],
        count: 0,
        sample: error
      };

      // Add path if not already in the group
      if (error.path && !group.paths.includes(error.path)) {
        group.paths.push(error.path);
      }

      // Increment count
      group.count++;

      // Update the group
      errorGroups.set(pattern, group);
    });

    // Convert to array and sort by count (most frequent first)
    const summary = Array.from(errorGroups.values())
      .sort((a, b) => b.count - a.count)
      .map(group => ({
        pattern: group.pattern,
        count: group.count,
        paths: group.paths.slice(0, 5), // Show up to 5 paths as examples
        hasMorePaths: group.paths.length > 5,
        suggestedIgnorePattern: {
          messagePattern: group.sample.message
            .replace(/'/g, "\\'")         // Escape quotes
            .replace(/\(/g, "\\(")        // Escape parentheses
            .replace(/\)/g, "\\)"),       // Escape parentheses
          pathPattern: this.suggestPathPattern(group.paths)
        }
      }));

    return {
      totalErrors: errors.length,
      errorGroups: summary,
      usage: "Use this information to create ignore patterns in SchemaValidationIgnoreService"
    };
  }

  /**
   * Suggests a path pattern based on common elements in paths
   */
  private suggestPathPattern(paths: string[]): string {
    if (paths.length === 0) {
      return "";
    }

    // Find common segments in the paths
    const segments = paths.map(path => path.split(/[\.\[\]\/]/g).filter(Boolean));

    // Find repeating patterns in paths
    const commonPatterns: string[] = [];

    // Look for product/flavor patterns
    if (segments.some(s => s.includes('products') && s.includes('flavors'))) {
      commonPatterns.push("products\\[\\d+\\]\\.flavors\\[\\d+\\]");
    }

    // Look for compliance patterns
    if (segments.some(s => s.includes('compliance'))) {
      commonPatterns.push("\\.compliance");
    }

    if (commonPatterns.length === 0) {
      // If no common patterns found, suggest a generic pattern based on first path
      return paths[0].replace(/\d+/g, "\\d+").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    }

    return commonPatterns.join("");
  }
}
