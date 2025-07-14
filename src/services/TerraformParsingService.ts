import * as vscode from 'vscode';
import { LoggingService } from './core/LoggingService';
import { CacheService } from './CacheService';

export interface TerraformVariable {
  name: string;
  type?: string;
  description?: string;
  default?: any;
  required?: boolean;
  sensitive?: boolean;
}

export interface TerraformOutput {
  name: string;
  type?: string;
  description?: string;
  value?: string;
  sensitive?: boolean;
}

export interface TerraformModule {
  path: string;
  variables: TerraformVariable[];
  outputs: TerraformOutput[];
}

interface ParsedBlock {
  type: 'variable' | 'output';
  name: string;
  content: string;
  startLine: number;
  endLine: number;
}

export class TerraformParsingService {
  private static instance?: TerraformParsingService;
  private readonly logger: LoggingService;
  private readonly cacheService: CacheService;
  private readonly disposables: vscode.Disposable[] = [];

  // Regex patterns for parsing Terraform files
  private readonly BLOCK_REGEX = /(variable|output)\s+"([^"]+)"\s*\{/g;
  private readonly TYPE_REGEX = /type\s*=\s*([^\n\r]+)/;
  private readonly DESCRIPTION_REGEX = /description\s*=\s*"([^"]*)"/;
  private readonly DEFAULT_REGEX = /default\s*=\s*([^\n\r]+?)(?:\n|\r|$)/;
  private readonly SENSITIVE_REGEX = /sensitive\s*=\s*(true|false)/;
  private readonly VALUE_REGEX = /value\s*=\s*([^\n\r]+)/;

  private constructor() {
    this.logger = LoggingService.getInstance();
    this.cacheService = CacheService.getInstance();
    this.setupFileWatcher();
  }

  public static getInstance(): TerraformParsingService {
    if (!TerraformParsingService.instance) {
      TerraformParsingService.instance = new TerraformParsingService();
    }
    return TerraformParsingService.instance;
  }

  private setupFileWatcher(): void {
    // Watch for changes to .tf files
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.tf');
    
    fileWatcher.onDidChange(uri => {
      this.invalidateCache(uri.fsPath);
    });

    fileWatcher.onDidCreate(uri => {
      this.invalidateCache(uri.fsPath);
    });

    fileWatcher.onDidDelete(uri => {
      this.invalidateCache(uri.fsPath);
    });

    this.disposables.push(fileWatcher);
  }

  private invalidateCache(filePath: string): void {
    const cacheKey = `terraform-parse-${filePath}`;
    this.cacheService.delete(cacheKey);
    this.logger.debug('Invalidated Terraform cache for file', { filePath }, 'terraformParsing');
  }

  /**
   * Parse all Terraform files in the workspace to find root module structure
   */
  public async parseWorkspaceRootModule(): Promise<TerraformModule | null> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      return await this.parseModuleAtPath(rootPath);
    } catch (error) {
      this.logger.error('Failed to parse workspace root module', { error }, 'terraformParsing');
      return null;
    }
  }

  /**
   * Parse a specific module directory for Terraform variables and outputs
   */
  public async parseModuleAtPath(modulePath: string): Promise<TerraformModule | null> {
    const cacheKey = `terraform-module-${modulePath}`;
    
    // Check cache first
    const cached = this.cacheService.get<TerraformModule>(cacheKey);
    if (cached) {
      this.logger.debug('Using cached Terraform module data', { modulePath }, 'terraformParsing');
      return cached;
    }

    try {
      this.logger.debug('Parsing Terraform module', { modulePath }, 'terraformParsing');
      
      // Find all .tf files in the module directory
      const tfFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(modulePath, '*.tf'),
        '**/node_modules/**'
      );

      const variables: TerraformVariable[] = [];
      const outputs: TerraformOutput[] = [];

      // Parse each Terraform file
      for (const file of tfFiles) {
        const fileContent = await vscode.workspace.fs.readFile(file);
        const content = Buffer.from(fileContent).toString('utf8');
        
        const blocks = this.parseBlocks(content);
        
        for (const block of blocks) {
          if (block.type === 'variable') {
            const variable = this.parseVariable(block);
            if (variable) {
              variables.push(variable);
            }
          } else if (block.type === 'output') {
            const output = this.parseOutput(block);
            if (output) {
              outputs.push(output);
            }
          }
        }
      }

      const module: TerraformModule = {
        path: modulePath,
        variables: this.deduplicateVariables(variables),
        outputs: this.deduplicateOutputs(outputs)
      };

      // Cache the result
      this.cacheService.set(cacheKey, module, 300000); // 5 minutes

      this.logger.debug('Successfully parsed Terraform module', {
        modulePath,
        variableCount: module.variables.length,
        outputCount: module.outputs.length
      }, 'terraformParsing');

      return module;
    } catch (error) {
      this.logger.error('Failed to parse Terraform module', { modulePath, error }, 'terraformParsing');
      return null;
    }
  }

  /**
   * Parse dependency modules based on offering information
   */
  public async parseDependencyModule(offeringId: string, localPath?: string): Promise<TerraformModule | null> {
    if (localPath) {
      // If we have a local path, parse it directly
      return await this.parseModuleAtPath(localPath);
    }

    // For external dependencies, we might not have the source code
    // In this case, we could potentially use cached metadata or provide defaults
    this.logger.debug('External dependency module - using defaults', { offeringId }, 'terraformParsing');
    
    return {
      path: `external:${offeringId}`,
      variables: [],
      outputs: []
    };
  }

  private parseBlocks(content: string): ParsedBlock[] {
    const blocks: ParsedBlock[] = [];
    const lines = content.split('\n');
    
    let match;
    this.BLOCK_REGEX.lastIndex = 0; // Reset regex state
    
    while ((match = this.BLOCK_REGEX.exec(content)) !== null) {
      const blockType = match[1] as 'variable' | 'output';
      const blockName = match[2];
      const startIndex = match.index;
      
      // Find the start line
      const beforeMatch = content.substring(0, startIndex);
      const startLine = beforeMatch.split('\n').length - 1;
      
      // Find the matching closing brace
      const endIndex = this.findClosingBrace(content, startIndex);
      if (endIndex === -1) {
        continue; // Skip malformed blocks
      }
      
      const blockContent = content.substring(startIndex, endIndex + 1);
      const endLine = startLine + blockContent.split('\n').length - 1;
      
      blocks.push({
        type: blockType,
        name: blockName,
        content: blockContent,
        startLine,
        endLine
      });
    }
    
    return blocks;
  }

  private findClosingBrace(content: string, startIndex: string | number): number {
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !inString) {
        inString = true;
        continue;
      }
      
      if (char === '"' && inString) {
        inString = false;
        continue;
      }
      
      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            return i;
          }
        }
      }
    }
    
    return -1; // No matching closing brace found
  }

  private parseVariable(block: ParsedBlock): TerraformVariable | null {
    try {
      const variable: TerraformVariable = {
        name: block.name,
        required: true // Default to required
      };

      // Parse type
      const typeMatch = block.content.match(this.TYPE_REGEX);
      if (typeMatch) {
        variable.type = this.cleanValue(typeMatch[1]);
      }

      // Parse description
      const descMatch = block.content.match(this.DESCRIPTION_REGEX);
      if (descMatch) {
        variable.description = descMatch[1];
      }

      // Parse default value
      const defaultMatch = block.content.match(this.DEFAULT_REGEX);
      if (defaultMatch) {
        variable.default = this.parseValue(defaultMatch[1]);
        variable.required = false; // Has default, so not required
      }

      // Parse sensitive flag
      const sensitiveMatch = block.content.match(this.SENSITIVE_REGEX);
      if (sensitiveMatch) {
        variable.sensitive = sensitiveMatch[1] === 'true';
      }

      return variable;
    } catch (error) {
      this.logger.error('Failed to parse variable block', { blockName: block.name, error }, 'terraformParsing');
      return null;
    }
  }

  private parseOutput(block: ParsedBlock): TerraformOutput | null {
    try {
      const output: TerraformOutput = {
        name: block.name
      };

      // Parse description
      const descMatch = block.content.match(this.DESCRIPTION_REGEX);
      if (descMatch) {
        output.description = descMatch[1];
      }

      // Parse value (simplified - just get the expression)
      const valueMatch = block.content.match(this.VALUE_REGEX);
      if (valueMatch) {
        output.value = this.cleanValue(valueMatch[1]);
      }

      // Parse sensitive flag
      const sensitiveMatch = block.content.match(this.SENSITIVE_REGEX);
      if (sensitiveMatch) {
        output.sensitive = sensitiveMatch[1] === 'true';
      }

      // Try to infer type from value if possible
      if (output.value) {
        output.type = this.inferTypeFromValue(output.value);
      }

      return output;
    } catch (error) {
      this.logger.error('Failed to parse output block', { blockName: block.name, error }, 'terraformParsing');
      return null;
    }
  }

  private cleanValue(value: string): string {
    return value.trim().replace(/,$/, ''); // Remove trailing comma
  }

  private parseValue(valueStr: string): any {
    const cleaned = this.cleanValue(valueStr);
    
    // Try to parse as JSON for simple values
    if (cleaned === 'null') return null;
    if (cleaned === 'true') return true;
    if (cleaned === 'false') return false;
    
    // Try to parse as number
    const num = Number(cleaned);
    if (!isNaN(num)) return num;
    
    // Try to parse as JSON string/array/object
    try {
      return JSON.parse(cleaned);
    } catch {
      // Return as string if all else fails
      return cleaned.replace(/^"(.*)"$/, '$1'); // Remove quotes if present
    }
  }

  private inferTypeFromValue(value: string): string {
    if (value.includes('var.') || value.includes('local.')) return 'string'; // Variable reference
    if (value.includes('[') && value.includes(']')) return 'list';
    if (value.includes('{') && value.includes('}')) return 'object';
    if (value.includes('true') || value.includes('false')) return 'bool';
    if (/^\d+$/.test(value.trim())) return 'number';
    return 'string';
  }

  private deduplicateVariables(variables: TerraformVariable[]): TerraformVariable[] {
    const seen = new Set<string>();
    return variables.filter(variable => {
      if (seen.has(variable.name)) {
        return false;
      }
      seen.add(variable.name);
      return true;
    });
  }

  private deduplicateOutputs(outputs: TerraformOutput[]): TerraformOutput[] {
    const seen = new Set<string>();
    return outputs.filter(output => {
      if (seen.has(output.name)) {
        return false;
      }
      seen.add(output.name);
      return true;
    });
  }

  /**
   * Get all Terraform files in the workspace
   */
  public async getAllTerraformFiles(): Promise<vscode.Uri[]> {
    try {
      return await vscode.workspace.findFiles('**/*.tf', '**/node_modules/**');
    } catch (error) {
      this.logger.error('Failed to find Terraform files', { error }, 'terraformParsing');
      return [];
    }
  }

  /**
   * Parse a single Terraform file for quick analysis
   */
  public async parseFile(uri: vscode.Uri): Promise<{ variables: TerraformVariable[]; outputs: TerraformOutput[] }> {
    const cacheKey = `terraform-file-${uri.fsPath}`;
    
    const cached = this.cacheService.get<{ variables: TerraformVariable[]; outputs: TerraformOutput[] }>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const fileContent = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(fileContent).toString('utf8');
      
      const blocks = this.parseBlocks(content);
      const variables: TerraformVariable[] = [];
      const outputs: TerraformOutput[] = [];

      for (const block of blocks) {
        if (block.type === 'variable') {
          const variable = this.parseVariable(block);
          if (variable) variables.push(variable);
        } else if (block.type === 'output') {
          const output = this.parseOutput(block);
          if (output) outputs.push(output);
        }
      }

      const result = { variables, outputs };
      this.cacheService.set(cacheKey, result, 300000); // 5 minutes
      
      return result;
    } catch (error) {
      this.logger.error('Failed to parse Terraform file', { file: uri.fsPath, error }, 'terraformParsing');
      return { variables: [], outputs: [] };
    }
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}