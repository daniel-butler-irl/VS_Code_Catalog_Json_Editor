import * as vscode from 'vscode';
import { CatalogService } from '../services/CatalogService';
import { IBMCloudService } from '../services/IBMCloudService';
import { AuthService } from '../services/AuthService';
import { SchemaService } from '../services/SchemaService';
import { LoggingService } from '../services/core/LoggingService';
import { CacheService } from '../services/CacheService';
import { Dependency } from '../types/catalog';
import { JsonPathService } from '../services/core/JsonPathService';
import { TerraformParsingService } from '../services/TerraformParsingService';
import * as jsonc from 'jsonc-parser';

interface WebviewMessage {
  command: string;
  data?: any;
  nodeId?: string;
  connectionId?: string;
  property?: string;
  value?: any;
}

interface GraphNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  data: any;
  position: { x: number; y: number };
}

interface GraphConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}

interface GraphModel {
  nodes: GraphNode[];
  connections: GraphConnection[];
  selectedFlavor: string;
  products: Product[];
  selectedProduct: string;
}

interface Product {
  name: string;
  label: string;
  flavors: Flavor[];
}

interface Flavor {
  name: string;
  label: string;
}

export class CatalogVisualEditorProvider implements vscode.CustomTextEditorProvider {
  private static instance?: CatalogVisualEditorProvider;
  private readonly logger: LoggingService;
  private readonly catalogService: CatalogService;
  private readonly ibmCloudService: IBMCloudService;
  private readonly schemaService: SchemaService;
  private readonly jsonPathService: JsonPathService;
  private readonly terraformParsingService: TerraformParsingService;
  private readonly context: vscode.ExtensionContext;
  private readonly cacheService: CacheService;
  private disposables: vscode.Disposable[] = [];
  private currentOfferings: any[] = []; // Store current offerings data for node label lookup
  private rootNodeConfigurations: Map<string, { inputs?: any[], outputs?: any[] }> = new Map(); // Store root node input/output configurations

  private constructor(
    context: vscode.ExtensionContext,
    logger: LoggingService,
    catalogService: CatalogService,
    ibmCloudService: IBMCloudService | null,
    schemaService: SchemaService,
    jsonPathService: JsonPathService,
    cacheService: CacheService
  ) {
    this.context = context;
    this.logger = logger;
    this.catalogService = catalogService;
    this.ibmCloudService = ibmCloudService as IBMCloudService;
    this.schemaService = schemaService;
    this.jsonPathService = jsonPathService;
    this.terraformParsingService = TerraformParsingService.getInstance();
    this.cacheService = cacheService;
  }

  public static initialize(
    context: vscode.ExtensionContext,
    logger: LoggingService,
    catalogService: CatalogService,
    ibmCloudService: IBMCloudService | null,
    schemaService: SchemaService,
    jsonPathService: JsonPathService,
    cacheService: CacheService
  ): CatalogVisualEditorProvider {
    if (!CatalogVisualEditorProvider.instance) {
      CatalogVisualEditorProvider.instance = new CatalogVisualEditorProvider(
        context,
        logger,
        catalogService,
        ibmCloudService,
        schemaService,
        jsonPathService,
        cacheService
      );
    }
    return CatalogVisualEditorProvider.instance;
  }

  public static getInstance(): CatalogVisualEditorProvider | undefined {
    return CatalogVisualEditorProvider.instance;
  }

  private getOfferingLabel(offeringName: string): string {
    const offering = this.currentOfferings.find(o => o.name === offeringName);
    return offering?.label || offeringName;
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.logger.info('Visual Editor: Starting resolveCustomTextEditor', { 
      documentUri: document.uri.toString(),
      fileName: document.fileName 
    }, 'visualEditor');

    try {
      // Set up webview options
      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media'),
          vscode.Uri.joinPath(this.context.extensionUri, 'media')
        ]
      };

      this.logger.debug('Visual Editor: Webview options configured', {
        enableScripts: true,
        localResourceRoots: webviewPanel.webview.options.localResourceRoots?.map(uri => uri.toString())
      }, 'visualEditor');

      // Set up webview content
      const htmlContent = this.getWebviewContent(webviewPanel.webview);
      webviewPanel.webview.html = htmlContent;
      
      this.logger.debug('Visual Editor: Webview HTML content set', {
        htmlLength: htmlContent.length,
        containsScript: htmlContent.includes('<script'),
        containsCSS: htmlContent.includes('<link')
      }, 'visualEditor');

      // Register message handlers
      this.registerMessageHandlers(webviewPanel, document);

      this.logger.info('Visual Editor: Successfully initialized webview', {}, 'visualEditor');

      // Set webview state to persist across reloads
      webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
        this.logger.debug('Visual Editor: Received message from webview', { 
          command: message.command,
          hasData: !!message.data 
        }, 'visualEditor');

        try {
          await this.handleMessage(message, webviewPanel, document);
        } catch (error) {
          this.logger.error('Visual Editor: Error handling webview message', { error, message }, 'visualEditor');
          await webviewPanel.webview.postMessage({
            command: 'showError',
            error: error instanceof Error ? error.message : 'An error occurred'
          });
        }
      });

    } catch (error) {
      this.logger.error('Visual Editor: Failed to initialize', { error }, 'visualEditor');
      throw error;
    }
  }

  private async initializeEditor(
    webviewPanel: vscode.WebviewPanel,
    document: vscode.TextDocument
  ): Promise<void> {
    try {
      this.logger.info('Visual Editor: Starting initialization', { 
        documentLength: document.getText().length 
      }, 'visualEditor');

      // Parse the JSON document
      const text = document.getText();
      this.logger.debug('Visual Editor: Parsing JSON document', { textLength: text.length }, 'visualEditor');
      
      const parsedCatalog = jsonc.parse(text);

      if (!parsedCatalog) {
        throw new Error('Invalid JSON document - unable to parse');
      }

      this.logger.debug('Visual Editor: Successfully parsed catalog JSON', {
        hasProducts: !!parsedCatalog.products,
        productCount: parsedCatalog.products?.length || 0
      }, 'visualEditor');

      // Convert catalog JSON to graph model
      const graphModel = await this.buildGraphModel(parsedCatalog, document);
      
      this.logger.debug('Visual Editor: Built graph model', {
        nodeCount: graphModel.nodes.length,
        connectionCount: graphModel.connections.length,
        selectedFlavor: graphModel.selectedFlavor
      }, 'visualEditor');

      // Send initial data to webview
      console.log('WEBVIEW_MESSAGE: Sending initializeGraph to webview', {
        command: 'initializeGraph',
        graphModel,
        nodeCount: graphModel.nodes.length,
        connectionCount: graphModel.connections.length
      });
      
      this.logger.debug('Visual Editor: Sending initializeGraph message to webview', {}, 'visualEditor');
      await webviewPanel.webview.postMessage({
        command: 'initializeGraph',
        data: graphModel
      });

      this.logger.info('Visual Editor: Successfully initialized', {}, 'visualEditor');
    } catch (error) {
      this.logger.error('Visual Editor: Failed to initialize', { error }, 'visualEditor');
      await webviewPanel.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Failed to initialize editor'
      });
    }
  }

  private async buildGraphModel(catalogData: any, document?: vscode.TextDocument, selectedProduct?: string, selectedFlavor?: string): Promise<GraphModel> {
    this.logger.debug('Visual Editor: Building graph model from catalog data', {
      hasProducts: !!catalogData.products,
      productCount: catalogData.products?.length || 0,
      selectedProduct,
      selectedFlavor
    }, 'visualEditor');

    console.log('BUILD_GRAPH_MODEL: Starting buildGraphModel', {
      catalogData,
      hasProducts: !!catalogData.products,
      productCount: catalogData.products?.length || 0,
      selectedProduct,
      selectedFlavor
    });

    const nodes: GraphNode[] = [];
    const connections: GraphConnection[] = [];

    // Check if we have products array - provide better error handling
    if (!catalogData || typeof catalogData !== 'object') {
      throw new Error('Invalid catalog data: not an object');
    }
    
    if (!catalogData.products || !Array.isArray(catalogData.products)) {
      throw new Error('Invalid catalog structure: products must be an array');
    }
    
    if (catalogData.products.length === 0) {
      throw new Error('No products found in catalog JSON');
    }

    // Transform products to the format expected by the UI
    const products: Product[] = catalogData.products.map((product: any) => ({
      name: product.name,
      label: product.label || product.name,
      flavors: (product.flavors || []).map((flavor: any) => ({
        name: flavor.name,
        label: flavor.label || flavor.name
      }))
    }));

    // Determine which product and flavor to use
    const targetProductName = selectedProduct || products[0]?.name;
    const targetProduct = products.find(p => p.name === targetProductName) || products[0];
    const targetFlavorName = selectedFlavor || targetProduct?.flavors[0]?.name || '';
    
    // Find the actual product and flavor from the catalog data
    const product = catalogData.products.find((p: any) => p.name === targetProductName) || catalogData.products[0];
    const flavor = product.flavors?.find((f: any) => f.name === targetFlavorName) || product.flavors?.[0];

    // Analyze input mappings to determine which ports should be exposed
    const portAnalysis = this.analyzeInputMappings(flavor.dependencies || []);
    
    this.logger.debug('Visual Editor: Port analysis results', {
      rootInputPortsCount: portAnalysis.rootInputPorts.size,
      rootInputPorts: Array.from(portAnalysis.rootInputPorts),
      rootOutputPortsCount: portAnalysis.rootOutputPorts.size,
      rootOutputPorts: Array.from(portAnalysis.rootOutputPorts),
      dependencyPortsCount: portAnalysis.dependencyPorts.size,
      dependencyPortsDetails: Array.from(portAnalysis.dependencyPorts.entries()).map(([id, ports]) => ({
        id,
        inputCount: ports.inputs.size,
        inputs: Array.from(ports.inputs),
        outputCount: ports.outputs.size,
        outputs: Array.from(ports.outputs)
      }))
    }, 'visualEditor');

    this.logger.debug('Visual Editor: Processing product and flavor', {
      productName: product.name,
      productLabel: product.label,
      flavorName: flavor?.name,
      flavorLabel: flavor?.label
    }, 'visualEditor');

    if (!flavor) {
      throw new Error(`No flavor found for product ${product.name}`);
    }
    
    // Parse root module Terraform files to get inputs/outputs
    let rootInputs: any[] = [];
    let rootOutputs: any[] = [];
    
    try {
      this.logger.debug('Visual Editor: Parsing root module Terraform files', {}, 'visualEditor');
      const rootModule = await this.terraformParsingService.parseWorkspaceRootModule();
      
      if (rootModule) {
        this.logger.debug('Visual Editor: Found root module', {
          variableCount: rootModule.variables.length,
          outputCount: rootModule.outputs.length
        }, 'visualEditor');
        
        // Transform Terraform variables to our input format, enhancing with port metadata
        rootInputs = rootModule.variables.map(variable => {
          const metadata = portAnalysis.portMetadata.get(variable.name);
          return {
            name: variable.name,
            type: variable.type || metadata?.type || 'string',
            description: variable.description || metadata?.description,
            required: variable.required ?? metadata?.required ?? false,
            defaultValue: variable.default,
            sensitive: variable.sensitive,
            connector: metadata?.isConnector ?? portAnalysis.rootInputPorts.has(variable.name),
            virtual: false,
            mappingTypes: metadata?.mappingTypes || [], // Enhanced: track mapping types
            isFromTerraform: true // Enhanced: mark as Terraform-sourced
          };
        });
        
        // Also add any input mapping ports that weren't found in Terraform variables
        portAnalysis.rootInputPorts.forEach(portName => {
          if (!rootInputs.find(input => input.name === portName)) {
            const metadata = portAnalysis.portMetadata.get(portName);
            this.logger.debug('Visual Editor: Adding missing input port from mapping analysis', {
              portName,
              metadata: metadata
            }, 'visualEditor');
            
            rootInputs.push({
              name: portName,
              type: metadata?.type || 'string',
              description: metadata?.description || `Input port for ${portName} (from input mapping)`,
              required: metadata?.required ?? false,
              defaultValue: null,
              sensitive: false,
              connector: metadata?.isConnector ?? true,
              virtual: false,
              mappingTypes: metadata?.mappingTypes || [],
              isFromTerraform: false // Enhanced: mark as mapping-sourced
            });
          }
        });
        
        // Transform Terraform outputs to our output format, enhancing with port metadata
        rootOutputs = rootModule.outputs.map(output => {
          const metadata = portAnalysis.portMetadata.get(output.name);
          return {
            name: output.name,
            type: output.type || metadata?.type || 'string',
            description: output.description || metadata?.description,
            value: output.value,
            sensitive: output.sensitive,
            connector: metadata?.isConnector ?? portAnalysis.rootOutputPorts.has(output.name),
            mappingTypes: metadata?.mappingTypes || [], // Enhanced: track mapping types
            isFromTerraform: true // Enhanced: mark as Terraform-sourced
          };
        });
        
        // Also add any output mapping ports that weren't found in Terraform outputs
        portAnalysis.rootOutputPorts.forEach(portName => {
          if (!rootOutputs.find(output => output.name === portName)) {
            const metadata = portAnalysis.portMetadata.get(portName);
            this.logger.debug('Visual Editor: Adding missing output port from mapping analysis', {
              portName,
              metadata: metadata
            }, 'visualEditor');
            
            rootOutputs.push({
              name: portName,
              type: metadata?.type || 'string',
              description: metadata?.description || `Output port for ${portName} (from input mapping)`,
              value: null,
              sensitive: false,
              connector: metadata?.isConnector ?? true,
              mappingTypes: metadata?.mappingTypes || [],
              isFromTerraform: false // Enhanced: mark as mapping-sourced
            });
          }
        });
      } else {
        this.logger.debug('Visual Editor: No root module found, using defaults', {}, 'visualEditor');
      }
    } catch (error) {
      this.logger.warn('Visual Editor: Failed to parse root module, using defaults', { error }, 'visualEditor');
    }

    // If no root inputs found from Terraform parsing, create them from input mapping analysis
    if (rootInputs.length === 0 && portAnalysis.rootInputPorts.size > 0) {
      this.logger.debug('Visual Editor: Creating root inputs from input mapping analysis', {
        portCount: portAnalysis.rootInputPorts.size,
        ports: Array.from(portAnalysis.rootInputPorts)
      }, 'visualEditor');
      
      rootInputs = Array.from(portAnalysis.rootInputPorts).map(portName => ({
        name: portName,
        type: 'string', // Default to string type
        description: `Input port for ${portName}`,
        required: false,
        defaultValue: null,
        sensitive: false,
        connector: true, // All ports from input mapping analysis are connectors
        virtual: false
      }));
    }

    // If no root outputs found from Terraform parsing, create them from input mapping analysis
    if (rootOutputs.length === 0 && portAnalysis.rootOutputPorts.size > 0) {
      this.logger.debug('Visual Editor: Creating root outputs from input mapping analysis', {
        portCount: portAnalysis.rootOutputPorts.size,
        ports: Array.from(portAnalysis.rootOutputPorts)
      }, 'visualEditor');
      
      rootOutputs = Array.from(portAnalysis.rootOutputPorts).map(portName => ({
        name: portName,
        type: 'string', // Default to string type
        description: `Output port for ${portName}`,
        value: null,
        sensitive: false,
        connector: true // All ports from input mapping analysis are connectors
      }));
    }

    // Get stored root node configurations if they exist
    const documentUri = document?.uri.toString();
    const rootConfig = documentUri ? this.rootNodeConfigurations.get(documentUri) : undefined;
    
    // Use stored configurations if available, otherwise use derived inputs/outputs
    const finalInputs = rootConfig?.inputs || rootInputs;
    const finalOutputs = rootConfig?.outputs || rootOutputs;
    
    // Create root node
    const rootNode: GraphNode = {
      id: 'root',
      type: 'root',
      name: flavor.label || flavor.name || 'Root',
      data: {
        flavor: flavor.name,
        label: flavor.label,
        description: flavor.description,
        inputs: finalInputs,
        outputs: finalOutputs
      },
      position: { x: 200, y: 50 }  // Compact center position
    };
    
    this.logger.debug('Visual Editor: Created root node', {
      rootNode: {
        id: rootNode.id,
        name: rootNode.name,
        inputCount: rootInputs.length,
        outputCount: rootOutputs.length,
        connectorInputs: rootInputs.filter(input => input.connector).map(input => input.name),
        connectorOutputs: rootOutputs.filter(output => output.connector).map(output => output.name),
        allInputs: rootInputs.map(input => ({ name: input.name, connector: input.connector })),
        allOutputs: rootOutputs.map(output => ({ name: output.name, connector: output.connector }))
      },
      flavorData: {
        name: flavor.name,
        label: flavor.label,
        description: flavor.description
      }
    }, 'visualEditor');
    
    nodes.push(rootNode);

    // Create dependency nodes
    const dependencies = flavor.dependencies || [];
    
    console.log('BUILD_GRAPH_MODEL: Starting dependency node creation', {
      flavor: {
        name: flavor.name,
        label: flavor.label,
        hasDependencies: !!flavor.dependencies,
        dependencyCount: dependencies.length
      },
      dependencies: dependencies.map((dep, index) => ({
        index,
        id: dep.id,
        name: dep.name,
        version: dep.version,
        flavors: dep.flavors,
        hasInputMapping: !!dep.input_mapping,
        inputMappingCount: dep.input_mapping?.length || 0,
        optional: dep.optional,
        onByDefault: dep.on_by_default
      }))
    });
    
    for (const [index, dep] of dependencies.entries()) {
      console.log(`BUILD_GRAPH_MODEL: Processing dependency ${index}:`, {
        depId: dep.id,
        depName: dep.name,
        depVersion: dep.version,
        depFlavors: dep.flavors,
        hasInputMapping: !!dep.input_mapping,
        inputMappingLength: dep.input_mapping?.length || 0,
        optional: dep.optional,
        onByDefault: dep.on_by_default
      });
      // Try to parse dependency module if it's local
      let depInputs: any[] = [];
      let depOutputs: any[] = [];
      
      try {
        this.logger.debug('Visual Editor: Parsing dependency module', {
          dependencyName: dep.name,
          dependencyId: dep.id
        }, 'visualEditor');
        
        // Try to parse dependency module (could be local or external)
        const depModule = await this.terraformParsingService.parseDependencyModule(
          dep.id || dep.name || '',
          undefined // localPath - for now we don't have this info
        );
        
        if (depModule && depModule.variables.length > 0) {
          this.logger.debug('Visual Editor: Found dependency module', {
            dependencyName: dep.name,
            variableCount: depModule.variables.length,
            outputCount: depModule.outputs.length
          }, 'visualEditor');
          
          const depId = `dep-${index}`;
          const depPorts = portAnalysis.dependencyPorts.get(depId);
          
          // Transform Terraform variables to our input format, marking connectors based on input mappings
          depInputs = depModule.variables.map(variable => ({
            name: variable.name,
            type: variable.type || 'string',
            description: variable.description,
            required: variable.required,
            defaultValue: variable.default,
            sensitive: variable.sensitive,
            connector: depPorts?.inputs.has(variable.name) || false, // Set connector based on actual mappings
            virtual: false
          }));
          
          // Transform Terraform outputs to our output format, marking connectors based on input mappings
          depOutputs = depModule.outputs.map(output => ({
            name: output.name,
            type: output.type || 'string',
            description: output.description,
            value: output.value,
            sensitive: output.sensitive,
            connector: depPorts?.outputs.has(output.name) || false // Set connector based on actual mappings
          }));
          
          // Also add any input mapping ports that weren't found in Terraform
          if (depPorts) {
            depPorts.inputs.forEach(portName => {
              if (!depInputs.find(input => input.name === portName)) {
                this.logger.debug('Visual Editor: Adding missing dependency input port from mapping analysis', {
                  dependencyName: dep.name,
                  portName
                }, 'visualEditor');
                
                depInputs.push({
                  name: portName,
                  type: 'string', // Default to string type
                  description: `Input port for ${portName} (from input mapping)`,
                  required: false,
                  defaultValue: null,
                  sensitive: false,
                  connector: true, // All ports from input mapping analysis are connectors
                  virtual: false
                });
              }
            });
            
            depPorts.outputs.forEach(portName => {
              if (!depOutputs.find(output => output.name === portName)) {
                this.logger.debug('Visual Editor: Adding missing dependency output port from mapping analysis', {
                  dependencyName: dep.name,
                  portName
                }, 'visualEditor');
                
                depOutputs.push({
                  name: portName,
                  type: 'string', // Default to string type
                  description: `Output port for ${portName} (from input mapping)`,
                  value: null,
                  sensitive: false,
                  connector: true // All ports from input mapping analysis are connectors
                });
              }
            });
          }
        }
      } catch (error) {
        this.logger.debug('Visual Editor: Failed to parse dependency module, using defaults', {
          dependencyName: dep.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, 'visualEditor');
      }
      
      // If no inputs/outputs found from Terraform parsing, create them from input mapping analysis
      const depId = `dep-${index}`;
      const depPorts = portAnalysis.dependencyPorts.get(depId);
      
      if (depInputs.length === 0 && depPorts && depPorts.inputs.size > 0) {
        this.logger.debug('Visual Editor: Creating dependency inputs from input mapping analysis', {
          dependencyName: dep.name,
          portCount: depPorts ? depPorts.inputs.size : 0,
          ports: depPorts ? Array.from(depPorts.inputs) : []
        }, 'visualEditor');
        
        depInputs = Array.from(depPorts?.inputs || []).map(portName => ({
          name: portName,
          type: 'string', // Default to string type
          description: `Input port for ${portName}`,
          required: false,
          defaultValue: null,
          sensitive: false,
          connector: true, // All ports from input mapping analysis are connectors
          virtual: false
        }));
      }

      if (depOutputs.length === 0 && depPorts && depPorts.outputs.size > 0) {
        this.logger.debug('Visual Editor: Creating dependency outputs from input mapping analysis', {
          dependencyName: dep.name,
          portCount: depPorts ? depPorts.outputs.size : 0,
          ports: depPorts ? Array.from(depPorts.outputs) : []
        }, 'visualEditor');
        
        depOutputs = Array.from(depPorts?.outputs || []).map(portName => ({
          name: portName,
          type: 'string', // Default to string type
          description: `Output port for ${portName}`,
          value: null,
          sensitive: false,
          connector: true // All ports from input mapping analysis are connectors
        }));
      }

      const depNode: GraphNode = {
        id: `dep-${index}`,
        type: 'dependency',
        name: this.getOfferingLabel(dep.name) || dep.id || `Dependency ${index + 1}`,
        data: {
          ...dep,
          inputs: depInputs,
          outputs: depOutputs
        },
        position: { 
          x: 50 + (index % 2) * 300,  // 2 columns with compact spacing
          y: 200 + Math.floor(index / 2) * 160  // Compact vertical spacing
        }
      };
      
      console.log(`BUILD_GRAPH_MODEL: Created dependency node ${index}:`, {
        nodeId: depNode.id,
        nodeName: depNode.name,
        nodeType: depNode.type,
        position: depNode.position,
        inputCount: depInputs.length,
        outputCount: depOutputs.length,
        hasInputMapping: !!dep.input_mapping,
        inputMappingLength: dep.input_mapping?.length || 0
      });
      
      nodes.push(depNode);

      // Create connections from input mappings
      if (dep.input_mapping) {
        dep.input_mapping.forEach((mapping: any, mappingIndex: number) => {
          const connectionId = `connection-${index}-${mappingIndex}`;
          
          if (mapping.dependency_output && mapping.version_input) {
            // Output from dependency to root input
            connections.push({
              id: connectionId,
              source: depNode.id,
              target: rootNode.id,
              sourceHandle: `output-${mapping.dependency_output}`, // Prefix with output-
              targetHandle: `input-${mapping.version_input}`      // Prefix with input-
            });
          } else if (mapping.dependency_input && mapping.version_input && mapping.reference_version) {
            // Input from root to dependency
            connections.push({
              id: connectionId,
              source: rootNode.id,
              target: depNode.id,
              sourceHandle: `output-${mapping.version_input}`,   // Root output (pass-through)
              targetHandle: `input-${mapping.dependency_input}`  // Dependency input
            });
          }
        });
      }
    }
    
    console.log('BUILD_GRAPH_MODEL: Dependency processing completed', {
      totalDependencies: dependencies.length,
      totalNodesCreated: nodes.length,
      rootNodeCount: nodes.filter(n => n.type === 'root').length,
      dependencyNodeCount: nodes.filter(n => n.type === 'dependency').length,
      totalConnectionsCreated: connections.length,
      nodeDetails: nodes.map(n => ({
        id: n.id,
        type: n.type,
        name: n.name,
        position: n.position
      }))
    });

    const graphModel = {
      nodes,
      connections,
      selectedFlavor: targetFlavorName,
      products,
      selectedProduct: targetProductName
    };

    console.log('BUILD_GRAPH_MODEL: Final graph model created', {
      nodeCount: graphModel.nodes.length,
      connectionCount: graphModel.connections.length,
      selectedProduct: graphModel.selectedProduct,
      selectedFlavor: graphModel.selectedFlavor,
      nodes: graphModel.nodes.map(n => ({ 
        id: n.id, 
        type: n.type, 
        name: n.name,
        position: n.position,
        hasData: !!n.data,
        inputCount: n.data?.inputs?.length || 0,
        outputCount: n.data?.outputs?.length || 0
      })),
      connections: graphModel.connections.map(conn => ({
        id: conn.id,
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle,
        targetHandle: conn.targetHandle
      }))
    });

    this.logger.debug('Visual Editor: Built complete graph model', {
      nodeCount: graphModel.nodes.length,
      connectionCount: graphModel.connections.length,
      selectedProduct: graphModel.selectedProduct,
      selectedFlavor: graphModel.selectedFlavor,
      nodeTypes: graphModel.nodes.map(n => ({ id: n.id, type: n.type, name: n.name })),
      connections: graphModel.connections.map(conn => ({
        id: conn.id,
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle,
        targetHandle: conn.targetHandle
      }))
    }, 'visualEditor');

    return graphModel;
  }

  private registerMessageHandlers(
    webviewPanel: vscode.WebviewPanel,
    document: vscode.TextDocument
  ): void {
    // Handle document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        // Document was changed externally, update the webview
        this.updateWebviewFromDocument(webviewPanel, document);
      }
    });

    // Handle theme changes
    const themeChangeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview);
    });

    // Clean up subscriptions when webview is disposed
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      themeChangeSubscription.dispose();
    });
  }

  private async updateWebviewFromDocument(
    webviewPanel: vscode.WebviewPanel,
    document: vscode.TextDocument
  ): Promise<void> {
    try {
      const text = document.getText();
      const parsedCatalog = jsonc.parse(text);
      
      if (parsedCatalog) {
        const graphModel = await this.buildGraphModel(parsedCatalog, document);
        await webviewPanel.webview.postMessage({
          command: 'updateGraph',
          data: graphModel
        });
      }
    } catch (error) {
      this.logger.error('Failed to update webview from document', { error }, 'visualEditor');
    }
  }

  private async handleMessage(
    message: WebviewMessage,
    webviewPanel: vscode.WebviewPanel,
    document: vscode.TextDocument
  ): Promise<void> {
    try {
      switch (message.command) {
        case 'addDependency':
          await this.handleAddDependency(message, document);
          break;
        case 'removeDependency':
          await this.handleRemoveDependency(message, document);
          break;
        case 'updateNodeProperty':
          await this.handleUpdateNodeProperty(message, webviewPanel, document);
          break;
        case 'updateNodePropertyIncremental':
          await this.handleUpdateNodePropertyIncremental(message, webviewPanel, document);
          break;
        case 'addConnection':
          await this.handleAddConnection(message, document);
          break;
        case 'removeConnection':
          await this.handleRemoveConnection(message, document);
          break;
        case 'requestOfferingsData':
          await this.handleRequestOfferingsData(webviewPanel);
          break;
        case 'requestOfferingsForCatalog':
          await this.handleRequestOfferingsForCatalog(webviewPanel, message.data?.catalogId);
          break;
        case 'changeProductFlavor':
          await this.handleChangeProductFlavor(message, webviewPanel, document);
          break;
        case 'ready':
          // Webview is ready, send initial data
          this.logger.info('Visual Editor: Received ready message from webview, initializing...', {}, 'visualEditor');
          await this.initializeEditor(webviewPanel, document);
          // Also send offerings data immediately after initialization
          await this.loadAndSendOfferingsData(webviewPanel);
          break;
        case 'debug':
          // Log debug messages from webview to extension output
          this.handleDebugMessage(message);
          break;
        default:
          this.logger.warn('Unknown message command', { command: message.command }, 'visualEditor');
      }
    } catch (error) {
      this.logger.error('Visual Editor: Error handling message', { 
        error, 
        command: message.command 
      }, 'visualEditor');
      
      // Send error message to UI instead of crashing
      await webviewPanel.webview.postMessage({
        command: 'showError',
        error: `Failed to handle ${message.command}: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  private async handleAddDependency(message: WebviewMessage, document: vscode.TextDocument): Promise<void> {
    try {
      this.logger.info('Visual Editor: Adding dependency to document', { 
        offering: message.data?.offering?.name,
        position: message.data?.position 
      }, 'visualEditor');

      const offering = message.data?.offering;
      const position = message.data?.position;

      if (!offering || !position) {
        throw new Error('Invalid dependency data: missing offering or position');
      }

      // Parse current document
      const text = document.getText();
      const parsedCatalog = jsonc.parse(text);

      if (!parsedCatalog || !parsedCatalog.products || parsedCatalog.products.length === 0) {
        throw new Error('Invalid catalog structure: no products found');
      }

      const product = parsedCatalog.products[0];
      if (!product.flavors || product.flavors.length === 0) {
        throw new Error('Invalid product structure: no flavors found');
      }

      // Get the first flavor to add the dependency to
      const flavor = product.flavors[0];
      if (!flavor.dependencies) {
        flavor.dependencies = [];
      }

      // Create new dependency object
      const newDependency: Dependency = {
        id: offering.id,
        name: offering.name,
        version: offering.selectedVersion || offering.versions?.[0] || 'latest',
        flavors: offering.selectedFlavor ? [offering.selectedFlavor] : (offering.flavors?.slice(0, 1).map((f: any) => f.name) || ['standard']),
        catalog_id: 'public', // Default to public catalog
        input_mapping: [], // Will be configured later
        optional: false // Default to required
      };

      // Add the dependency
      flavor.dependencies.push(newDependency);

      // Apply the changes to the document
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );

      // Format the JSON with proper indentation
      const updatedJson = JSON.stringify(parsedCatalog, null, 2);
      edit.replace(document.uri, fullRange, updatedJson);

      // Apply the edit
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        this.logger.info('Visual Editor: Successfully added dependency to document', {
          dependencyName: newDependency.name,
          dependencyId: newDependency.id
        }, 'visualEditor');
      } else {
        throw new Error('Failed to apply document changes');
      }

    } catch (error) {
      this.logger.error('Visual Editor: Failed to add dependency', { error, message }, 'visualEditor');
      throw error;
    }
  }

  private async handleRemoveDependency(message: WebviewMessage, document: vscode.TextDocument): Promise<void> {
    try {
      this.logger.info('Visual Editor: Removing dependency from document', { 
        nodeId: message.nodeId
      }, 'visualEditor');

      const nodeId = message.nodeId;
      if (!nodeId) {
        throw new Error('Invalid nodeId: missing node identifier');
      }

      // Parse current document
      const text = document.getText();
      const parsedCatalog = jsonc.parse(text);

      if (!parsedCatalog || !parsedCatalog.products || parsedCatalog.products.length === 0) {
        throw new Error('Invalid catalog structure: no products found');
      }

      const product = parsedCatalog.products[0];
      if (!product.flavors || product.flavors.length === 0) {
        throw new Error('Invalid product structure: no flavors found');
      }

      // Get the first flavor to remove the dependency from
      const flavor = product.flavors[0];
      if (!flavor.dependencies || flavor.dependencies.length === 0) {
        throw new Error('No dependencies found to remove');
      }

      // Extract dependency index from nodeId (format: "dep-{index}")
      const match = nodeId.match(/^dep-(\d+)$/);
      if (!match) {
        throw new Error(`Invalid dependency node ID format: ${nodeId}`);
      }

      const dependencyIndex = parseInt(match[1], 10);
      if (dependencyIndex < 0 || dependencyIndex >= flavor.dependencies.length) {
        throw new Error(`Dependency index out of bounds: ${dependencyIndex}`);
      }

      // Remove the dependency
      const removedDependency = flavor.dependencies.splice(dependencyIndex, 1)[0];

      // Apply the changes to the document
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );

      // Format the JSON with proper indentation
      const updatedJson = JSON.stringify(parsedCatalog, null, 2);
      edit.replace(document.uri, fullRange, updatedJson);

      // Apply the edit
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        this.logger.info('Visual Editor: Successfully removed dependency from document', {
          dependencyName: removedDependency.name,
          dependencyId: removedDependency.id
        }, 'visualEditor');
      } else {
        throw new Error('Failed to apply document changes');
      }

    } catch (error) {
      this.logger.error('Visual Editor: Failed to remove dependency', { error, message }, 'visualEditor');
      throw error;
    }
  }

  private async handleUpdateNodeProperty(message: WebviewMessage, webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument): Promise<void> {
    try {
      this.logger.info('Visual Editor: Updating node property in document', { 
        nodeId: message.nodeId, 
        property: message.property, 
        value: message.value 
      }, 'visualEditor');

      const nodeId = message.nodeId;
      const property = message.property;
      const value = message.value;

      if (!nodeId || !property) {
        throw new Error('Invalid data: missing nodeId or property');
      }

      // Parse current document
      const text = document.getText();
      const parsedCatalog = jsonc.parse(text);

      if (!parsedCatalog || !parsedCatalog.products || parsedCatalog.products.length === 0) {
        throw new Error('Invalid catalog structure: no products found');
      }

      const product = parsedCatalog.products[0];
      if (!product.flavors || product.flavors.length === 0) {
        throw new Error('Invalid product structure: no flavors found');
      }

      const flavor = product.flavors[0];

      // Handle root node updates
      if (nodeId === 'root') {
        // Update flavor properties
        if (property === 'name') {
          flavor.name = value;
        } else if (property === 'label') {
          flavor.label = value;
        } else if (property === 'description') {
          flavor.description = value;
        } else if (property === 'inputs') {
          // Store inputs configuration for root node
          const documentUri = document.uri.toString();
          const rootConfig = this.rootNodeConfigurations.get(documentUri) || {};
          rootConfig.inputs = value;
          this.rootNodeConfigurations.set(documentUri, rootConfig);
          this.logger.info('Visual Editor: Updated root node inputs configuration', { 
            documentUri, 
            inputsCount: value?.length || 0 
          }, 'visualEditor');
          
          // Refresh the UI with updated graph model
          const text = document.getText();
          const parsedCatalog = jsonc.parse(text);
          if (parsedCatalog) {
            const graphModel = await this.buildGraphModel(parsedCatalog, document);
            await webviewPanel.webview.postMessage({
              command: 'updateGraph',
              data: graphModel
            });
          }
          return;
        } else if (property === 'outputs') {
          // Store outputs configuration for root node
          const documentUri = document.uri.toString();
          const rootConfig = this.rootNodeConfigurations.get(documentUri) || {};
          rootConfig.outputs = value;
          this.rootNodeConfigurations.set(documentUri, rootConfig);
          this.logger.info('Visual Editor: Updated root node outputs configuration', { 
            documentUri, 
            outputsCount: value?.length || 0 
          }, 'visualEditor');
          
          // Refresh the UI with updated graph model
          const text = document.getText();
          const parsedCatalog = jsonc.parse(text);
          if (parsedCatalog) {
            const graphModel = await this.buildGraphModel(parsedCatalog, document);
            await webviewPanel.webview.postMessage({
              command: 'updateGraph',
              data: graphModel
            });
          }
          return;
        } else {
          throw new Error(`Unsupported root property: ${property}`);
        }
      } else {
        // Handle dependency node updates
        if (!flavor.dependencies || flavor.dependencies.length === 0) {
          throw new Error('No dependencies found to update');
        }

        // Extract dependency index from nodeId (format: "dep-{index}")
        const match = nodeId.match(/^dep-(\d+)$/);
        if (!match) {
          throw new Error(`Invalid dependency node ID format: ${nodeId}`);
        }

        const dependencyIndex = parseInt(match[1], 10);
        if (dependencyIndex < 0 || dependencyIndex >= flavor.dependencies.length) {
          throw new Error(`Dependency index out of bounds: ${dependencyIndex}`);
        }

        const dependency = flavor.dependencies[dependencyIndex];

        // Update dependency properties
        if (property === 'name') {
          dependency.name = value;
        } else if (property === 'version') {
          dependency.version = value;
        } else if (property === 'flavors') {
          dependency.flavors = Array.isArray(value) ? value : [value];
        } else if (property === 'optional') {
          dependency.optional = Boolean(value);
        } else if (property === 'install_type') {
          dependency.install_type = value;
        } else if (property === 'catalog_id') {
          dependency.catalog_id = value;
        } else {
          throw new Error(`Unsupported dependency property: ${property}`);
        }
      }

      // Apply the changes to the document
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );

      // Format the JSON with proper indentation
      const updatedJson = JSON.stringify(parsedCatalog, null, 2);
      edit.replace(document.uri, fullRange, updatedJson);

      // Apply the edit
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        this.logger.info('Visual Editor: Successfully updated node property in document', {
          nodeId,
          property,
          value
        }, 'visualEditor');
      } else {
        throw new Error('Failed to apply document changes');
      }

    } catch (error) {
      this.logger.error('Visual Editor: Failed to update node property', { error, message }, 'visualEditor');
      throw error;
    }
  }

  private async handleUpdateNodePropertyIncremental(message: WebviewMessage, webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument): Promise<void> {
    try {
      this.logger.info('Visual Editor: Updating node property incrementally (in-memory)', { 
        nodeId: message.nodeId, 
        property: message.property, 
        value: message.value 
      }, 'visualEditor');

      const nodeId = message.nodeId;
      const property = message.property;
      const value = message.value;

      if (!nodeId || !property) {
        throw new Error('Invalid data: missing nodeId or property');
      }

      const documentUri = document.uri.toString();

      // Handle root node updates
      if (nodeId === 'root') {
        if (property === 'inputs' || property === 'outputs') {
          // Update in-memory configuration for root node
          const rootConfig = this.rootNodeConfigurations.get(documentUri) || {};
          rootConfig[property] = value;
          this.rootNodeConfigurations.set(documentUri, rootConfig);
          
          this.logger.info('Visual Editor: Updated root node configuration incrementally', { 
            documentUri, 
            property,
            itemsCount: value?.length || 0 
          }, 'visualEditor');
          
          // Send incremental update to UI
          await webviewPanel.webview.postMessage({
            command: 'updateNodeIncremental',
            nodeId,
            property,
            value
          });
          
          return;
        }
        
        // For other root properties, we could update in-memory state here
        // For now, fall back to structural update
        this.logger.info('Visual Editor: Root property not supported incrementally, falling back to structural update', { 
          property 
        }, 'visualEditor');
        
        // Fallback to structural update
        return this.handleUpdateNodeProperty(message, webviewPanel, document);
      }
      
      // Handle dependency node updates
      if (nodeId.startsWith('dep-')) {
        // For dependency updates, we can update in-memory state and send to UI
        // For now, send incremental update to UI
        await webviewPanel.webview.postMessage({
          command: 'updateNodeIncremental',
          nodeId,
          property,
          value
        });
        
        this.logger.info('Visual Editor: Sent incremental dependency update to UI', { 
          nodeId, 
          property 
        }, 'visualEditor');
        
        return;
      }
      
      // Unknown node type, fallback to structural update
      this.logger.warn('Visual Editor: Unknown node type for incremental update, falling back to structural', { 
        nodeId 
      }, 'visualEditor');
      
      return this.handleUpdateNodeProperty(message, webviewPanel, document);

    } catch (error) {
      this.logger.error('Visual Editor: Failed to update node property incrementally, falling back to structural update', { error, message }, 'visualEditor');
      
      // Fallback to structural update on error
      try {
        return this.handleUpdateNodeProperty(message, webviewPanel, document);
      } catch (fallbackError) {
        this.logger.error('Visual Editor: Fallback to structural update also failed', { fallbackError }, 'visualEditor');
        throw fallbackError;
      }
    }
  }

  private async handleAddConnection(message: WebviewMessage, document: vscode.TextDocument): Promise<void> {
    try {
      this.logger.info('Visual Editor: Adding connection to document', { 
        data: message.data 
      }, 'visualEditor');

      const connection = message.data;
      if (!connection || !connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
        throw new Error('Invalid connection data: missing required fields');
      }

      // Parse current document
      const text = document.getText();
      const parsedCatalog = jsonc.parse(text);

      if (!parsedCatalog || !parsedCatalog.products || parsedCatalog.products.length === 0) {
        throw new Error('Invalid catalog structure: no products found');
      }

      const product = parsedCatalog.products[0];
      if (!product.flavors || product.flavors.length === 0) {
        throw new Error('Invalid product structure: no flavors found');
      }

      const flavor = product.flavors[0];
      if (!flavor.dependencies) {
        flavor.dependencies = [];
      }

      // Determine mapping type based on source and target
      let targetDependencyIndex: number;
      let mapping: any;

      if (connection.source === 'root' && connection.target.startsWith('dep-')) {
        // Root to dependency connection (parent input to dependency input)
        const match = connection.target.match(/^dep-(\d+)$/);
        if (!match) {
          throw new Error(`Invalid target node ID format: ${connection.target}`);
        }
        
        targetDependencyIndex = parseInt(match[1], 10);
        if (targetDependencyIndex < 0 || targetDependencyIndex >= flavor.dependencies.length) {
          throw new Error(`Target dependency index out of bounds: ${targetDependencyIndex}`);
        }

        mapping = {
          dependency_input: connection.targetHandle,
          version_input: connection.sourceHandle,
          // reference_version: true
        };

      } else if (connection.source.startsWith('dep-') && connection.target === 'root') {
        // Dependency to root connection (dependency output to parent input)
        const match = connection.source.match(/^dep-(\d+)$/);
        if (!match) {
          throw new Error(`Invalid source node ID format: ${connection.source}`);
        }
        
        targetDependencyIndex = parseInt(match[1], 10);
        if (targetDependencyIndex < 0 || targetDependencyIndex >= flavor.dependencies.length) {
          throw new Error(`Source dependency index out of bounds: ${targetDependencyIndex}`);
        }

        mapping = {
          dependency_output: connection.sourceHandle,
          version_input: connection.targetHandle
        };

      } else {
        throw new Error('Unsupported connection type: only root-to-dependency and dependency-to-root connections are supported');
      }

      // Add the mapping to the target dependency
      const targetDependency = flavor.dependencies[targetDependencyIndex];
      if (!targetDependency.input_mapping) {
        targetDependency.input_mapping = [];
      }

      // Check if mapping already exists
      const existingMapping = targetDependency.input_mapping.find((m: any) => {
        if (mapping.dependency_output) {
          return m.dependency_output === mapping.dependency_output && m.version_input === mapping.version_input;
        } else {
          return m.dependency_input === mapping.dependency_input && m.version_input === mapping.version_input;
        }
      });

      if (existingMapping) {
        throw new Error('Connection already exists between these nodes');
      }

      targetDependency.input_mapping.push(mapping);

      // Apply the changes to the document
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );

      // Format the JSON with proper indentation
      const updatedJson = JSON.stringify(parsedCatalog, null, 2);
      edit.replace(document.uri, fullRange, updatedJson);

      // Apply the edit
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        this.logger.info('Visual Editor: Successfully added connection to document', {
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          mapping
        }, 'visualEditor');
      } else {
        throw new Error('Failed to apply document changes');
      }

    } catch (error) {
      this.logger.error('Visual Editor: Failed to add connection', { error, message }, 'visualEditor');
      throw error;
    }
  }

  private async handleRemoveConnection(message: WebviewMessage, document: vscode.TextDocument): Promise<void> {
    try {
      this.logger.info('Visual Editor: Removing connection from document', { 
        connectionId: message.connectionId 
      }, 'visualEditor');

      const connectionId = message.connectionId;
      if (!connectionId) {
        throw new Error('Invalid connectionId: missing connection identifier');
      }

      // Parse current document
      const text = document.getText();
      const parsedCatalog = jsonc.parse(text);

      if (!parsedCatalog || !parsedCatalog.products || parsedCatalog.products.length === 0) {
        throw new Error('Invalid catalog structure: no products found');
      }

      const product = parsedCatalog.products[0];
      if (!product.flavors || product.flavors.length === 0) {
        throw new Error('Invalid product structure: no flavors found');
      }

      const flavor = product.flavors[0];
      if (!flavor.dependencies) {
        throw new Error('No dependencies found');
      }

      // Parse connection ID format: "connection-{depIndex}-{mappingIndex}"
      const match = connectionId.match(/^connection-(\d+)-(\d+)$/);
      if (!match) {
        throw new Error(`Invalid connection ID format: ${connectionId}`);
      }

      const dependencyIndex = parseInt(match[1], 10);
      const mappingIndex = parseInt(match[2], 10);

      if (dependencyIndex < 0 || dependencyIndex >= flavor.dependencies.length) {
        throw new Error(`Dependency index out of bounds: ${dependencyIndex}`);
      }

      const dependency = flavor.dependencies[dependencyIndex];
      if (!dependency.input_mapping || dependency.input_mapping.length === 0) {
        throw new Error('No input mappings found on dependency');
      }

      if (mappingIndex < 0 || mappingIndex >= dependency.input_mapping.length) {
        throw new Error(`Mapping index out of bounds: ${mappingIndex}`);
      }

      // Remove the mapping
      const removedMapping = dependency.input_mapping.splice(mappingIndex, 1)[0];

      // Apply the changes to the document
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );

      // Format the JSON with proper indentation
      const updatedJson = JSON.stringify(parsedCatalog, null, 2);
      edit.replace(document.uri, fullRange, updatedJson);

      // Apply the edit
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        this.logger.info('Visual Editor: Successfully removed connection from document', {
          connectionId,
          dependencyIndex,
          mappingIndex,
          removedMapping
        }, 'visualEditor');
      } else {
        throw new Error('Failed to apply document changes');
      }

    } catch (error) {
      this.logger.error('Visual Editor: Failed to remove connection', { error, message }, 'visualEditor');
      throw error;
    }
  }

  private async handleChangeProductFlavor(message: WebviewMessage, webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument): Promise<void> {
    try {
      this.logger.info('Visual Editor: Changing product/flavor selection', {
        product: message.data?.product,
        flavor: message.data?.flavor
      }, 'visualEditor');

      const selectedProduct = message.data?.product;
      const selectedFlavor = message.data?.flavor;

      // Parse current document and rebuild graph model with new selection
      const text = document.getText();
      const parsedCatalog = jsonc.parse(text);

      if (!parsedCatalog) {
        throw new Error('Invalid JSON document - unable to parse');
      }

      // Build new graph model with selected product/flavor
      const graphModel = await this.buildGraphModel(parsedCatalog, document, selectedProduct, selectedFlavor);

      // Send updated graph model to webview
      await webviewPanel.webview.postMessage({
        command: 'updateGraph',
        data: graphModel
      });

      this.logger.info('Visual Editor: Successfully updated graph for product/flavor change', {
        selectedProduct: graphModel.selectedProduct,
        selectedFlavor: graphModel.selectedFlavor,
        nodeCount: graphModel.nodes.length
      }, 'visualEditor');

    } catch (error) {
      this.logger.error('Visual Editor: Failed to handle product/flavor change', { error, message }, 'visualEditor');
      await webviewPanel.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Failed to change product/flavor'
      });
    }
  }

  private async getIBMCloudService(): Promise<IBMCloudService | null> {
    if (this.ibmCloudService) {
      return this.ibmCloudService;
    }

    try {
      const apiKey = await AuthService.getApiKey(this.context);
      if (!apiKey) {
        return null;
      }
      (this as any).ibmCloudService = new IBMCloudService(apiKey);
      return this.ibmCloudService;
    } catch (error) {
      this.logger.error('Failed to create IBM Cloud service', { error }, 'visualEditor');
      return null;
    }
  }

  private async loadAndSendOfferingsData(webviewPanel: vscode.WebviewPanel): Promise<void> {
    await this.handleRequestOfferingsData(webviewPanel);
  }

  private async handleRequestOfferingsForCatalog(webviewPanel: vscode.WebviewPanel, catalogId?: string): Promise<void> {
    if (!catalogId) {
      this.logger.error('Visual Editor: No catalog ID provided for requestOfferingsForCatalog', {}, 'visualEditor');
      await webviewPanel.webview.postMessage({
        command: 'updateOfferingsData',
        data: {
          offerings: [],
          error: 'No catalog ID provided'
        }
      });
      return;
    }

    try {
      const ibmCloudService = await this.getIBMCloudService();
      if (!ibmCloudService) {
        this.logger.warn('Visual Editor: IBM Cloud service not available - no API key', {}, 'visualEditor');
        await webviewPanel.webview.postMessage({
          command: 'updateOfferingsData',
          data: {
            offerings: [],
            error: 'IBM Cloud authentication required to load offerings'
          }
        });
        return;
      }

      // Get the catalog info to include in the response
      const allCatalogs = await ibmCloudService.getAvailableCatalogs();
      const selectedCatalog = allCatalogs.find(catalog => catalog.id === catalogId);
      
      if (!selectedCatalog) {
        this.logger.error('Visual Editor: Catalog not found', { catalogId }, 'visualEditor');
        await webviewPanel.webview.postMessage({
          command: 'updateOfferingsData',
          data: {
            offerings: [],
            error: `Catalog ${catalogId} not found`
          }
        });
        return;
      }

      // Fetch offerings for the specific catalog
      let offerings;
      try {
        // Use cache-first approach (skipCache: false) to avoid rate limiting
        offerings = await ibmCloudService.getOfferingsForCatalog(catalogId, false);
      } catch (offeringsError) {
        this.logger.error('Visual Editor: Failed to retrieve offerings for catalog', { 
          error: offeringsError, 
          catalogId 
        }, 'visualEditor');
        await webviewPanel.webview.postMessage({
          command: 'updateOfferingsData',
          data: {
            offerings: [],
            error: `Failed to retrieve offerings for ${selectedCatalog.label}`
          }
        });
        return;
      }

      this.logger.debug('Visual Editor: Retrieved offerings for catalog', {
        catalogId,
        catalogLabel: selectedCatalog.label,
        count: offerings.length
      }, 'visualEditor');

      // Transform offerings with error handling for malformed data
      const transformedOfferings = offerings.map(offering => {
        try {
          const versions = offering.kinds?.[0]?.versions?.map(v => v.version) || [];
          // Extract unique flavors with both name and label
          const flavorMap = new Map();
          offering.kinds?.[0]?.versions?.forEach(v => {
            if (v.flavor?.name) {
              flavorMap.set(v.flavor.name, {
                name: v.flavor.name,
                label: v.flavor.label || v.flavor.name
              });
            }
          });
          const flavors = Array.from(flavorMap.values());
          
          return {
            id: offering.id || `unknown-${Date.now()}`,
            name: offering.name || offering.id || 'Unknown Offering',
            label: offering.label || offering.name || 'Unknown Offering',
            description: offering.shortDescription || offering.label || 'No description available',
            versions: versions,
            flavors: flavors.length > 0 ? flavors : [{ name: 'standard', label: 'Standard' }],
            catalogId: catalogId,
            catalogLabel: selectedCatalog.label
          };
        } catch (transformError) {
          this.logger.warn('Visual Editor: Failed to transform offering', { 
            error: transformError, 
            offeringId: offering.id 
          }, 'visualEditor');
          
          return {
            id: offering.id || `fallback-${Date.now()}`,
            name: offering.name || 'Unknown Offering',
            label: offering.label || offering.name || 'Unknown Offering',
            description: 'Error loading offering details',
            versions: [],
            flavors: [{ name: 'standard', label: 'Standard' }],
            catalogId: catalogId,
            catalogLabel: selectedCatalog.label
          };
        }
      }).filter(offering => offering.id);
      
      // Store offerings for node label lookup
      this.currentOfferings = transformedOfferings;
      
      await webviewPanel.webview.postMessage({
        command: 'updateOfferingsData',
        data: {
          offerings: transformedOfferings
        }
      });
    } catch (error) {
      this.logger.error('Visual Editor: Critical error in handleRequestOfferingsForCatalog', { error, catalogId }, 'visualEditor');
      
      await webviewPanel.webview.postMessage({
        command: 'updateOfferingsData',
        data: {
          offerings: [],
          error: 'Unable to load offerings for selected catalog. Please try again later.'
        }
      });
    }
  }

  private async handleRequestOfferingsData(webviewPanel: vscode.WebviewPanel): Promise<void> {
    try {
      // Try to get IBM Cloud service - it may not be available if no API key is set
      const ibmCloudService = await this.getIBMCloudService();
      if (!ibmCloudService) {
        this.logger.warn('Visual Editor: IBM Cloud service not available - no API key', {}, 'visualEditor');
        await webviewPanel.webview.postMessage({
          command: 'updateOfferingsData',
          data: {
            offerings: [],
            error: 'IBM Cloud authentication required to load offerings'
          }
        });
        return;
      }

      // Fetch available offerings for the DA Library with proper error handling
      // Use cache-first approach to reduce API calls
      let allCatalogs;
      try {
        allCatalogs = await ibmCloudService.getAvailableCatalogs();
      } catch (catalogError) {
        this.logger.error('Visual Editor: Failed to retrieve catalogs', { error: catalogError }, 'visualEditor');
        await webviewPanel.webview.postMessage({
          command: 'updateOfferingsData',
          data: {
            offerings: [],
            error: 'Failed to retrieve catalogs. Please check your IBM Cloud permissions.'
          }
        });
        return;
      }

      if (!allCatalogs || allCatalogs.length === 0) {
        this.logger.warn('Visual Editor: No catalogs available', {}, 'visualEditor');
        await webviewPanel.webview.postMessage({
          command: 'updateOfferingsData',
          data: {
            offerings: [],
            error: 'No catalogs available'
          }
        });
        return;
      }

      // Send all available catalogs to the UI for user selection
      await webviewPanel.webview.postMessage({
        command: 'updateAvailableCatalogs',
        data: {
          catalogs: allCatalogs.map(catalog => ({
            id: catalog.id,
            label: catalog.label,
            shortDescription: catalog.shortDescription,
            isPublic: catalog.isPublic
          }))
        }
      });

      // Default to IBM Cloud Catalog if available, otherwise use first public catalog
      const ibmCloudCatalog = allCatalogs.find(catalog => catalog.label === 'IBM Cloud Catalog');
      const defaultCatalog = ibmCloudCatalog || allCatalogs.find(catalog => catalog.isPublic) || allCatalogs[0];
      
      if (!defaultCatalog) {
        this.logger.error('Visual Editor: No default catalog found', {
          availableCatalogs: allCatalogs.map(c => ({ id: c.id, label: c.label }))
        }, 'visualEditor');
        
        await webviewPanel.webview.postMessage({
          command: 'updateOfferingsData',
          data: {
            offerings: [],
            error: 'No catalogs available in your account'
          }
        });
        return;
      }
      
      const catalogId = defaultCatalog.id;
      let offerings;
      try {
        // Use cache-first approach (skipCache: false) to avoid rate limiting
        offerings = await ibmCloudService.getOfferingsForCatalog(catalogId, false);
      } catch (offeringsError) {
        this.logger.error('Visual Editor: Failed to retrieve offerings for catalog', { 
          error: offeringsError, 
          catalogId 
        }, 'visualEditor');
        await webviewPanel.webview.postMessage({
          command: 'updateOfferingsData',
          data: {
            offerings: [],
            error: 'Failed to retrieve offerings. Please check your IBM Cloud permissions.'
          }
        });
        return;
      }
      
      this.logger.debug('Visual Editor: Retrieved offerings from IBM Cloud', {
        count: offerings.length,
        firstFew: offerings.slice(0, 3).map(o => ({ id: o.id, name: o.name }))
      }, 'visualEditor');
      
      // Transform offerings with error handling for malformed data
      const transformedOfferings = offerings.map(offering => {
        try {
          // Extract versions from the first kind (typically terraform)
          const versions = offering.kinds?.[0]?.versions?.map(v => v.version) || [];
          
          // Extract unique flavors with both name and label
          const flavorMap = new Map();
          offering.kinds?.[0]?.versions?.forEach(v => {
            if (v.flavor?.name) {
              flavorMap.set(v.flavor.name, {
                name: v.flavor.name,
                label: v.flavor.label || v.flavor.name
              });
            }
          });
          const flavors = Array.from(flavorMap.values());
          
          return {
            id: offering.id || `unknown-${Date.now()}`,
            name: offering.name || offering.id || 'Unknown Offering',
            label: offering.label || offering.name || 'Unknown Offering',
            description: offering.shortDescription || offering.label || 'No description available',
            versions: versions,
            flavors: flavors.length > 0 ? flavors : [{ name: 'standard', label: 'Standard' }],
            catalogId: catalogId,
            catalogLabel: defaultCatalog.label
          };
        } catch (transformError) {
          this.logger.warn('Visual Editor: Failed to transform offering', { 
            error: transformError, 
            offeringId: offering.id 
          }, 'visualEditor');
          
          // Return a fallback offering object to prevent UI crashes
          return {
            id: offering.id || `fallback-${Date.now()}`,
            name: offering.name || 'Unknown Offering',
            label: offering.label || offering.name || 'Unknown Offering',
            description: 'Error loading offering details',
            versions: [],
            flavors: [{ name: 'standard', label: 'Standard' }],
            catalogId: catalogId,
            catalogLabel: defaultCatalog.label
          };
        }
      }).filter(offering => offering.id); // Remove any null/undefined offerings
      
      // Store offerings for node label lookup
      this.currentOfferings = transformedOfferings;
      
      await webviewPanel.webview.postMessage({
        command: 'updateOfferingsData',
        data: {
          offerings: transformedOfferings
        }
      });
    } catch (error) {
      this.logger.error('Visual Editor: Critical error in handleRequestOfferingsData', { error }, 'visualEditor');
      
      // Send a user-friendly error message that doesn't crash the UI
      await webviewPanel.webview.postMessage({
        command: 'updateOfferingsData',
        data: {
          offerings: [],
          error: 'Unable to load offerings. Please try again later.'
        }
      });
    }
  }

  private getWebviewContent(webview: vscode.Webview): string {
    // Generate URIs for the React app bundle
    const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'visual-editor-react.js');
    const scriptUri = webview.asWebviewUri(scriptPath);
    
    const stylePath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'visual-editor.css');
    const styleUri = webview.asWebviewUri(stylePath);

    this.logger.debug('Visual Editor: Generated webview resource URIs', {
      scriptPath: scriptPath.toString(),
      scriptUri: scriptUri.toString(),
      stylePath: stylePath.toString(),
      styleUri: styleUri.toString()
    }, 'visualEditor');

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline'; font-src ${webview.cspSource};">
        <link href="${styleUri}" rel="stylesheet">
        <title>IBM Catalog Visual Editor</title>
        <style>
          :root {
            --vscode-font-family: var(--vscode-font-family);
            --vscode-editor-background: var(--vscode-editor-background);
            --vscode-editor-foreground: var(--vscode-editor-foreground);
            --vscode-panel-background: var(--vscode-panel-background);
            --vscode-panel-border: var(--vscode-panel-border);
            --vscode-button-background: var(--vscode-button-background);
            --vscode-button-foreground: var(--vscode-button-foreground);
            --vscode-button-hoverBackground: var(--vscode-button-hoverBackground);
          }
          
          body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            padding: 0;
            height: 100vh;
            overflow: hidden;
          }
          
          #visual-editor-root {
            width: 100%;
            height: 100vh;
          }
        </style>
    </head>
    <body>
        <div id="visual-editor-root"></div>
        <script nonce="${nonce}">
          // Inject VS Code API
          const vscode = acquireVsCodeApi();
          window.vscode = vscode;
          console.log('Visual Editor HTML: VS Code API injected:', !!vscode);
        </script>
        <script nonce="${nonce}">
          console.log('Visual Editor HTML: Page loading started');
          console.log('Visual Editor HTML: Script URI:', '${scriptUri}');
          console.log('Visual Editor HTML: Style URI:', '${styleUri}');
          
          // Check if root element exists
          const rootElement = document.getElementById('visual-editor-root');
          console.log('Visual Editor HTML: Root element found:', !!rootElement);
          
          // Add error listener for script loading
          window.addEventListener('error', function(e) {
            console.error('Visual Editor HTML: Resource loading error:', e.filename, e.message);
          });
          
          // Add unhandled rejection listener
          window.addEventListener('unhandledrejection', function(e) {
            console.error('Visual Editor HTML: Unhandled promise rejection:', e.reason);
          });
        </script>
        <script nonce="${nonce}" src="${scriptUri}" id="react-script"></script>
        <script nonce="${nonce}">
          // Add event listeners for script loading
          const reactScript = document.getElementById('react-script');
          reactScript.addEventListener('load', function() {
            console.log('Visual Editor HTML: React script loaded successfully');
          });
          reactScript.addEventListener('error', function() {
            console.error('Visual Editor HTML: Failed to load React script');
          });
        </script>
    </body>
    </html>`;
  }


  /**
   * Analyze input mappings to determine which ports should be exposed as connectors
   * Enhanced to support all mapping types with metadata
   */
  private analyzeInputMappings(dependencies: any[]): {
    rootInputPorts: Set<string>;
    rootOutputPorts: Set<string>;
    dependencyPorts: Map<string, { inputs: Set<string>; outputs: Set<string> }>;
    portMetadata: Map<string, { 
      mappingTypes: string[], 
      isConnector: boolean, 
      description?: string,
      required?: boolean,
      type?: string
    }>;
  } {
    const rootInputPorts = new Set<string>();
    const rootOutputPorts = new Set<string>();
    const dependencyPorts = new Map<string, { inputs: Set<string>; outputs: Set<string> }>();
    const portMetadata = new Map<string, { 
      mappingTypes: string[], 
      isConnector: boolean, 
      description?: string,
      required?: boolean,
      type?: string
    }>();

    this.logger.debug('Visual Editor: Analyzing input mappings', {
      dependencyCount: dependencies.length
    }, 'visualEditor');
    
    // Helper function to add port metadata
    const addPortMetadata = (portName: string, mappingType: string, isConnector: boolean, description?: string, required?: boolean, type?: string) => {
      const existing = portMetadata.get(portName);
      if (existing) {
        existing.mappingTypes.push(mappingType);
        existing.isConnector = existing.isConnector || isConnector;
      } else {
        portMetadata.set(portName, {
          mappingTypes: [mappingType],
          isConnector,
          description,
          required,
          type
        });
      }
    };
    
    // Add common root-level inputs that are typically used in input_mapping
    const commonRootInputs = [
      { name: 'region', description: 'IBM Cloud region', required: true, type: 'string' },
      { name: 'resource_group_name', description: 'Resource group name', required: false, type: 'string' },
      { name: 'resource_group_id', description: 'Resource group ID', required: false, type: 'string' },
      { name: 'prefix', description: 'Prefix for resource names', required: true, type: 'string' },
      { name: 'tags', description: 'Tags to apply to resources', required: false, type: 'list(string)' },
      { name: 'existing_kms_instance_crn', description: 'Existing KMS instance CRN', required: false, type: 'string' },
      { name: 'existing_secrets_manager_crn', description: 'Existing Secrets Manager CRN', required: false, type: 'string' },
      { name: 'vpc_id', description: 'VPC ID', required: false, type: 'string' },
      { name: 'subnet_ids', description: 'Subnet IDs', required: false, type: 'list(string)' },
      { name: 'security_group_ids', description: 'Security group IDs', required: false, type: 'list(string)' }
    ];
    
    // Add common root-level outputs that are typically exposed
    const commonRootOutputs = [
      { name: 'resource_group_id', description: 'Resource group ID output', type: 'string' },
      { name: 'vpc_id', description: 'VPC ID output', type: 'string' },
      { name: 'subnet_ids', description: 'Subnet IDs output', type: 'list(string)' },
      { name: 'security_group_ids', description: 'Security group IDs output', type: 'list(string)' },
      { name: 'kms_key_id', description: 'KMS key ID output', type: 'string' },
      { name: 'secrets_manager_crn', description: 'Secrets Manager CRN output', type: 'string' },
      { name: 'compliance_report', description: 'Compliance report output', type: 'object' }
    ];
    
    // Pre-populate with common inputs and outputs (these will be connectors if used in mappings)
    commonRootInputs.forEach(input => {
      rootInputPorts.add(input.name);
      addPortMetadata(input.name, 'version_input', false, input.description, input.required, input.type);
    });
    commonRootOutputs.forEach(output => {
      rootOutputPorts.add(output.name);
      addPortMetadata(output.name, 'dependency_output', false, output.description, false, output.type);
    });

    dependencies.forEach((dep, index) => {
      const depId = `dep-${index}`;
      
      if (!dependencyPorts.has(depId)) {
        dependencyPorts.set(depId, {
          inputs: new Set<string>(),
          outputs: new Set<string>()
        });
      }
      
      const depPorts = dependencyPorts.get(depId)!;

      // Add common dependency inputs and outputs based on dependency type
      this.addCommonDependencyPorts(dep, depPorts);

      // For any dependency input that's a common pass-through port, 
      // also add it as a root output port so it can be used as a source handle
      const commonPassThroughPorts = ['region', 'resource_group_name', 'prefix', 'tags', 'enable_platform_metrics', 'logs_routing_tenant_regions', 'existing_kms_instance_crn'];
      commonPassThroughPorts.forEach(port => {
        if (depPorts.inputs.has(port)) {
          rootInputPorts.add(port);
          rootOutputPorts.add(port); // Add as output for pass-through
        }
      });

      if (dep.input_mapping && Array.isArray(dep.input_mapping)) {
        dep.input_mapping.forEach((mapping: any) => {
          // Root input connected to dependency input (dependency_input mapping)
          if (mapping.version_input && mapping.dependency_input) {
            rootInputPorts.add(mapping.version_input);
            // Mark as connector and add metadata
            addPortMetadata(mapping.version_input, 'dependency_input', true, 
              `Input mapped to ${dep.name}.${mapping.dependency_input}`, false, 'string');
            
            // Also add as output port so it can be used as a source handle for pass-through
            rootOutputPorts.add(mapping.version_input);
            addPortMetadata(mapping.version_input, 'pass_through', true, 
              `Pass-through for ${mapping.dependency_input}`, false, 'string');
            
            depPorts.inputs.add(mapping.dependency_input);
          }
          
          // Dependency output connected to root input (dependency_output mapping)
          if (mapping.dependency_output && mapping.version_input) {
            depPorts.outputs.add(mapping.dependency_output);
            rootInputPorts.add(mapping.version_input);
            
            // Mark both ends as connectors with metadata
            addPortMetadata(mapping.version_input, 'dependency_output', true, 
              `Receives output from ${dep.name}.${mapping.dependency_output}`, false, 'string');
          }
          
          // Static value mapping (no connector needed, but track metadata)
          if (mapping.version_input && !mapping.dependency_input && !mapping.dependency_output) {
            rootInputPorts.add(mapping.version_input);
            addPortMetadata(mapping.version_input, 'static_value', false, 
              `Static value input for ${dep.name}`, false, 'string');
          }
        });
      }
    });

    this.logger.debug('Visual Editor: Input mapping analysis complete', {
      rootInputPorts: Array.from(rootInputPorts),
      rootOutputPorts: Array.from(rootOutputPorts),
      dependencyPortsCount: dependencyPorts.size,
      portMetadataCount: portMetadata.size,
      connectorPorts: Array.from(portMetadata.entries())
        .filter(([_, meta]) => meta.isConnector)
        .map(([name, _]) => name)
    }, 'visualEditor');

    return { rootInputPorts, rootOutputPorts, dependencyPorts, portMetadata };
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }

  /**
   * Add common dependency inputs and outputs based on dependency type
   */
  private addCommonDependencyPorts(dep: any, depPorts: { inputs: Set<string>; outputs: Set<string> }): void {
    const depName = dep.name?.toLowerCase() || dep.id?.toLowerCase() || '';
    
    // Common inputs that most dependencies need
    const commonInputs = ['region', 'resource_group_name', 'prefix', 'tags'];
    commonInputs.forEach(input => depPorts.inputs.add(input));
    
    // Type-specific inputs and outputs based on dependency name patterns
    if (depName.includes('vpc') || depName.includes('network')) {
      // VPC-related dependencies
      depPorts.inputs.add('vpc_name');
      depPorts.inputs.add('subnet_count');
      depPorts.inputs.add('enable_public_gateway');
      depPorts.outputs.add('vpc_id');
      depPorts.outputs.add('subnet_ids');
      depPorts.outputs.add('security_group_ids');
    }
    
    if (depName.includes('kms') || depName.includes('key')) {
      // Key management dependencies
      depPorts.inputs.add('kms_instance_name');
      depPorts.inputs.add('key_name');
      depPorts.outputs.add('kms_instance_crn');
      depPorts.outputs.add('kms_key_id');
      depPorts.outputs.add('kms_key_crn');
    }
    
    if (depName.includes('secrets') || depName.includes('secret')) {
      // Secrets Manager dependencies
      depPorts.inputs.add('sm_instance_name');
      depPorts.inputs.add('service_plan');
      depPorts.outputs.add('secrets_manager_crn');
      depPorts.outputs.add('secrets_manager_guid');
    }
    
    if (depName.includes('observability') || depName.includes('monitoring') || depName.includes('logging')) {
      // Observability dependencies
      depPorts.inputs.add('log_analysis_instance_name');
      depPorts.inputs.add('cloud_monitoring_instance_name');
      depPorts.outputs.add('log_analysis_crn');
      depPorts.outputs.add('cloud_monitoring_crn');
    }
    
    if (depName.includes('security') || depName.includes('compliance')) {
      // Security/Compliance dependencies
      depPorts.inputs.add('scc_instance_name');
      depPorts.inputs.add('compliance_profile');
      depPorts.outputs.add('scc_instance_crn');
      depPorts.outputs.add('compliance_report');
    }
    
    if (depName.includes('app') || depName.includes('application') || depName.includes('code-engine')) {
      // Application dependencies
      depPorts.inputs.add('app_name');
      depPorts.inputs.add('memory_limit');
      depPorts.inputs.add('cpu_limit');
      depPorts.outputs.add('app_url');
      depPorts.outputs.add('app_id');
    }
    
    if (depName.includes('database') || depName.includes('db')) {
      // Database dependencies
      depPorts.inputs.add('db_name');
      depPorts.inputs.add('db_version');
      depPorts.inputs.add('service_plan');
      depPorts.outputs.add('db_connection_string');
      depPorts.outputs.add('db_hostname');
      depPorts.outputs.add('db_port');
    }
    
    // Add some generic outputs for all dependencies
    depPorts.outputs.add('resource_id');
    depPorts.outputs.add('resource_crn');
    depPorts.outputs.add('resource_name');
    
    this.logger.debug('Visual Editor: Added common ports for dependency', {
      depName,
      inputCount: depPorts.inputs.size,
      outputCount: depPorts.outputs.size,
      inputs: Array.from(depPorts.inputs),
      outputs: Array.from(depPorts.outputs)
    }, 'visualEditor');
  }

  private handleDebugMessage(message: WebviewMessage): void {
    const { data } = message;
    if (data && data.level && data.message) {
      switch (data.level) {
        case 'error':
          this.logger.error(`React Flow Debug: ${data.message}`, data.details || {}, 'visualEditor');
          break;
        case 'warn':
          this.logger.warn(`React Flow Debug: ${data.message}`, data.details || {}, 'visualEditor');
          break;
        case 'info':
          this.logger.info(`React Flow Debug: ${data.message}`, data.details || {}, 'visualEditor');
          break;
        case 'debug':
        default:
          this.logger.debug(`React Flow Debug: ${data.message}`, data.details || {}, 'visualEditor');
          break;
      }
    }
  }
}