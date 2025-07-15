import * as vscode from 'vscode';
import { CatalogService } from '../services/CatalogService';
import { IBMCloudService } from '../services/IBMCloudService';
import { AuthService } from '../services/AuthService';
import { SchemaService } from '../services/SchemaService';
import { LoggingService } from '../services/core/LoggingService';
import { Dependency } from '../types/catalog';
import { JsonPathService } from '../services/core/JsonPathService';
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
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    context: vscode.ExtensionContext,
    logger: LoggingService,
    catalogService: CatalogService,
    ibmCloudService: IBMCloudService | null,
    schemaService: SchemaService,
    jsonPathService: JsonPathService
  ) {
    this.context = context;
    this.logger = logger;
    this.catalogService = catalogService;
    this.ibmCloudService = ibmCloudService;
    this.schemaService = schemaService;
    this.jsonPathService = jsonPathService;
  }

  public static initialize(
    context: vscode.ExtensionContext,
    logger: LoggingService,
    catalogService: CatalogService,
    ibmCloudService: IBMCloudService | null,
    schemaService: SchemaService,
    jsonPathService: JsonPathService
  ): CatalogVisualEditorProvider {
    if (!CatalogVisualEditorProvider.instance) {
      CatalogVisualEditorProvider.instance = new CatalogVisualEditorProvider(
        context,
        logger,
        catalogService,
        ibmCloudService,
        schemaService,
        jsonPathService
      );
    }
    return CatalogVisualEditorProvider.instance;
  }

  public static getInstance(): CatalogVisualEditorProvider | undefined {
    return CatalogVisualEditorProvider.instance;
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
      const graphModel = await this.buildGraphModel(parsedCatalog);
      
      this.logger.debug('Visual Editor: Built graph model', {
        nodeCount: graphModel.nodes.length,
        connectionCount: graphModel.connections.length,
        selectedFlavor: graphModel.selectedFlavor
      }, 'visualEditor');

      // Send initial data to webview
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

  private async buildGraphModel(catalogData: any, selectedProduct?: string, selectedFlavor?: string): Promise<GraphModel> {
    this.logger.debug('Visual Editor: Building graph model from catalog data', {
      hasProducts: !!catalogData.products,
      productCount: catalogData.products?.length || 0,
      selectedProduct,
      selectedFlavor
    }, 'visualEditor');

    const nodes: GraphNode[] = [];
    const connections: GraphConnection[] = [];

    // Check if we have products array
    if (!catalogData.products || catalogData.products.length === 0) {
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

    this.logger.debug('Visual Editor: Processing product and flavor', {
      productName: product.name,
      productLabel: product.label,
      flavorName: flavor?.name,
      flavorLabel: flavor?.label
    }, 'visualEditor');

    if (!flavor) {
      throw new Error(`No flavor found for product ${product.name}`);
    }
    
    // Create root node
    const rootNode: GraphNode = {
      id: 'root',
      type: 'root',
      name: flavor.label || flavor.name || 'Root',
      data: {
        flavor: flavor.name,
        label: flavor.label,
        description: flavor.description,
        inputs: [], // Will be populated from Terraform parsing
        outputs: [] // Will be populated from Terraform parsing
      },
      position: { x: 400, y: 200 }
    };
    
    this.logger.debug('Visual Editor: Created root node', {
      rootNode,
      flavorData: {
        name: flavor.name,
        label: flavor.label,
        description: flavor.description
      }
    }, 'visualEditor');
    
    nodes.push(rootNode);

    // Create dependency nodes
    const dependencies = flavor.dependencies || [];
    dependencies.forEach((dep: Dependency, index: number) => {
      const depNode: GraphNode = {
        id: `dep-${index}`,
        type: 'dependency',
        name: dep.name || dep.id || `Dependency ${index + 1}`,
        data: {
          ...dep,
          inputs: [], // Will be populated from module analysis
          outputs: [] // Will be populated from module analysis
        },
        position: { 
          x: 100, 
          y: 100 + (index * 150) 
        }
      };
      nodes.push(depNode);

      // Create connections from input mappings
      if (dep.input_mapping) {
        dep.input_mapping.forEach((mapping, mappingIndex) => {
          const connectionId = `connection-${index}-${mappingIndex}`;
          
          if (mapping.dependency_output && mapping.version_input) {
            // Output from dependency to root input
            connections.push({
              id: connectionId,
              source: depNode.id,
              target: rootNode.id,
              sourceHandle: mapping.dependency_output,
              targetHandle: mapping.version_input
            });
          } else if (mapping.dependency_input && mapping.version_input && mapping.reference_version) {
            // Input from root to dependency
            connections.push({
              id: connectionId,
              source: rootNode.id,
              target: depNode.id,
              sourceHandle: mapping.version_input,
              targetHandle: mapping.dependency_input
            });
          }
        });
      }
    });

    const graphModel = {
      nodes,
      connections,
      selectedFlavor: targetFlavorName,
      products,
      selectedProduct: targetProductName
    };

    this.logger.debug('Visual Editor: Built complete graph model', {
      nodeCount: graphModel.nodes.length,
      connectionCount: graphModel.connections.length,
      selectedProduct: graphModel.selectedProduct,
      selectedFlavor: graphModel.selectedFlavor,
      nodeTypes: graphModel.nodes.map(n => ({ id: n.id, type: n.type, name: n.name }))
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
        const graphModel = await this.buildGraphModel(parsedCatalog);
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
    switch (message.command) {
      case 'addDependency':
        await this.handleAddDependency(message, document);
        break;
      case 'removeDependency':
        await this.handleRemoveDependency(message, document);
        break;
      case 'updateNodeProperty':
        await this.handleUpdateNodeProperty(message, document);
        break;
      case 'addConnection':
        await this.handleAddConnection(message, document);
        break;
      case 'removeConnection':
        await this.handleRemoveConnection(message, document);
        break;
      case 'requestOfferingsData':
        // Using mock data in React app, no need to fetch from API
        this.logger.debug('Visual Editor: Ignoring requestOfferingsData - using mock data', {}, 'visualEditor');
        break;
      case 'changeProductFlavor':
        await this.handleChangeProductFlavor(message, webviewPanel, document);
        break;
      case 'ready':
        // Webview is ready, send initial data
        this.logger.info('Visual Editor: Received ready message from webview, initializing...', {}, 'visualEditor');
        await this.initializeEditor(webviewPanel, document);
        break;
      default:
        this.logger.warn('Unknown message command', { command: message.command }, 'visualEditor');
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
        flavors: offering.selectedFlavor ? [offering.selectedFlavor] : (offering.flavors?.slice(0, 1) || ['standard']),
        install_type: 'extension', // Default to extension for new dependencies
        catalog_id: 'public', // Default to public catalog
        input_mapping: [] // Will be configured later
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
    // Implementation for removing a dependency
    this.logger.debug('Removing dependency', { nodeId: message.nodeId }, 'visualEditor');
  }

  private async handleUpdateNodeProperty(message: WebviewMessage, document: vscode.TextDocument): Promise<void> {
    // Implementation for updating node properties
    this.logger.debug('Updating node property', { 
      nodeId: message.nodeId, 
      property: message.property, 
      value: message.value 
    }, 'visualEditor');
  }

  private async handleAddConnection(message: WebviewMessage, document: vscode.TextDocument): Promise<void> {
    // Implementation for adding a connection (input mapping)
    this.logger.debug('Adding connection', { data: message.data }, 'visualEditor');
  }

  private async handleRemoveConnection(message: WebviewMessage, document: vscode.TextDocument): Promise<void> {
    // Implementation for removing a connection
    this.logger.debug('Removing connection', { connectionId: message.connectionId }, 'visualEditor');
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
      const graphModel = await this.buildGraphModel(parsedCatalog, selectedProduct, selectedFlavor);

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
      this.ibmCloudService = new IBMCloudService(apiKey);
      return this.ibmCloudService;
    } catch (error) {
      this.logger.error('Failed to create IBM Cloud service', { error }, 'visualEditor');
      return null;
    }
  }

  private async handleRequestOfferingsData(webviewPanel: vscode.WebviewPanel): Promise<void> {
    try {
      // Try to get IBM Cloud service - it may not be available if no API key is set
      const ibmCloudService = await this.getIBMCloudService();
      if (!ibmCloudService) {
        await webviewPanel.webview.postMessage({
          command: 'updateOfferingsData',
          data: {
            offerings: [],
            error: 'IBM Cloud authentication required to load offerings'
          }
        });
        return;
      }

      // Fetch available offerings for the DA Library
      const catalogId = 'public'; // Default to public catalog
      const offerings = await ibmCloudService.getOfferingsForCatalog(catalogId);
      
      await webviewPanel.webview.postMessage({
        command: 'updateOfferingsData',
        data: {
          offerings: offerings.map(offering => ({
            id: offering.id,
            name: offering.name,
            description: offering.short_description,
            versions: offering.kinds?.[0]?.versions || [],
            flavors: offering.kinds?.[0]?.versions?.[0]?.flavor || []
          }))
        }
      });
    } catch (error) {
      this.logger.error('Failed to fetch offerings data', { error }, 'visualEditor');
      await webviewPanel.webview.postMessage({
        command: 'showError',
        error: 'Failed to load available offerings'
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
}