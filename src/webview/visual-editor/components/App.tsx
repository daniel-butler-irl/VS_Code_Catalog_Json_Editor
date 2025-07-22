import React, { useState, useEffect, useCallback } from 'react';
import { Canvas } from './Canvas';
import { DALibrary } from './DALibrary';
import { PropertiesPanel } from './PropertiesPanel';
import { Toolbar } from './Toolbar';
import { ErrorBoundary } from './ErrorBoundary';

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

interface FlavorData {
  name: string;
  label?: string;
}

interface OfferingData {
  id: string;
  name: string;
  label?: string;
  description: string;
  versions: string[];
  flavors: FlavorData[];
  catalogId?: string;
  catalogLabel?: string;
}

interface CatalogData {
  id: string;
  label: string;
  shortDescription?: string;
  isPublic: boolean;
}

interface WebviewMessage {
  command: string;
  data?: any;
  error?: string;
  nodeId?: string;
  property?: string;
  value?: any;
}

export const VisualEditorApp: React.FC = () => {
  const [graphModel, setGraphModel] = useState<GraphModel | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [availableOfferings, setAvailableOfferings] = useState<OfferingData[]>([]);
  const [availableCatalogs, setAvailableCatalogs] = useState<CatalogData[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(true);
  const [offeringsError, setOfferingsError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [selectedFlavor, setSelectedFlavor] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Message handler for VS Code communication
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebviewMessage = event.data;
      console.log('Visual Editor App: Received message:', message.command, message);
      
      // Validate message structure
      if (!message || typeof message !== 'object' || !message.command) {
        console.warn('Visual Editor App: Invalid message format:', message);
        return;
      }
      
      switch (message.command) {
        case 'initializeGraph':
          console.log('Visual Editor App: Initializing graph with data:', message.data);
          try {
            if (message.data && typeof message.data === 'object') {
              setGraphModel(message.data);
              // Set default product and flavor from the graph model
              if (message.data?.products?.length > 0) {
                const firstProduct = message.data.products[0];
                setSelectedProduct(message.data.selectedProduct || firstProduct.name);
                setSelectedFlavor(message.data.selectedFlavor || firstProduct.flavors?.[0]?.name || '');
              }
              setIsLoading(false);
              setError(null);
            } else {
              console.error('Visual Editor App: Invalid graph data in initializeGraph');
              setError('Invalid graph data received');
              setIsLoading(false);
            }
          } catch (initError) {
            console.error('Visual Editor App: Error initializing graph:', initError);
            setError('Failed to initialize graph');
            setIsLoading(false);
          }
          break;
          
        case 'updateGraph':
          console.log('Visual Editor App: Updating graph with data:', message.data);
          try {
            if (message.data && typeof message.data === 'object') {
              setGraphModel(message.data);
              // Update selected product/flavor if they changed
              if (message.data?.selectedProduct) {
                setSelectedProduct(message.data.selectedProduct);
              }
              if (message.data?.selectedFlavor) {
                setSelectedFlavor(message.data.selectedFlavor);
              }
              setError(null);
            } else {
              console.error('Visual Editor App: Invalid graph data in updateGraph');
            }
          } catch (updateError) {
            console.error('Visual Editor App: Error updating graph:', updateError);
            setError('Failed to update graph');
          }
          break;
          
        case 'updateNodeIncremental':
          console.log('Visual Editor App: Received incremental node update:', {
            nodeId: message.nodeId,
            property: message.property,
            value: message.value
          });
          
          // Update the graph model incrementally
          if (graphModel && message.nodeId) {
            const updatedGraphModel = { ...graphModel };
            
            // Find and update the specific node
            const nodeIndex = updatedGraphModel.nodes.findIndex(node => node.id === message.nodeId);
            if (nodeIndex !== -1) {
              const updatedNode = { ...updatedGraphModel.nodes[nodeIndex] };
              
              // Update the specific property
              if (updatedNode.data && message.property) {
                updatedNode.data = { ...updatedNode.data };
                updatedNode.data[message.property] = message.value;
                
                // Update the nodes array
                updatedGraphModel.nodes = [...updatedGraphModel.nodes];
                updatedGraphModel.nodes[nodeIndex] = updatedNode;
                
                // Update the graph model state
                setGraphModel(updatedGraphModel);
                
                console.log('Visual Editor App: Successfully updated node incrementally:', {
                  nodeId: message.nodeId,
                  property: message.property,
                  updated: true
                });
                
                // If the updated node is currently selected, update the selected node state
                if (selectedNode && selectedNode.id === message.nodeId) {
                  setSelectedNode(updatedNode);
                }
              } else {
                console.warn('Visual Editor App: Could not update node property - invalid node data structure');
              }
            } else {
              console.warn('Visual Editor App: Could not find node to update incrementally:', message.nodeId);
            }
          } else {
            console.warn('Visual Editor App: Cannot update node incrementally - no graph model or node ID');
          }
          break;
          
        case 'updateAvailableCatalogs':
          console.log('Visual Editor App: Updating available catalogs:', message.data?.catalogs?.length || 0, 'catalogs');
          try {
            if (message.data && Array.isArray(message.data.catalogs)) {
              setAvailableCatalogs(message.data.catalogs);
              // Set default catalog if none selected
              if (!selectedCatalogId && message.data.catalogs.length > 0) {
                const defaultCatalog = message.data.catalogs.find((c: CatalogData) => c.label === 'IBM Cloud Catalog') || message.data.catalogs[0];
                setSelectedCatalogId(defaultCatalog.id);
              }
            }
          } catch (error) {
            console.error('Visual Editor App: Error updating catalogs:', error);
          }
          break;
          
        case 'updateOfferingsData':
          console.log('Visual Editor App: Updating offerings data:', message.data?.offerings?.length || 0, 'offerings');
          try {
            if (message.data && typeof message.data === 'object') {
              setAvailableOfferings(Array.isArray(message.data.offerings) ? message.data.offerings : []);
              setOfferingsLoading(false);
              
              // Handle case where no offerings are available due to auth issues
              if (message.data?.error) {
                console.warn('Visual Editor App: Offerings data error:', message.data.error);
                setOfferingsError(message.data.error);
              } else {
                setOfferingsError(null);
              }
            } else {
              console.error('Visual Editor App: Invalid offerings data format');
              setAvailableOfferings([]);
              setOfferingsLoading(false);
              setOfferingsError('Invalid offerings data format');
            }
          } catch (offeringsError) {
            console.error('Visual Editor App: Error updating offerings:', offeringsError);
            setAvailableOfferings([]);
            setOfferingsLoading(false);
            setOfferingsError('Failed to update offerings');
          }
          break;
          
        case 'showError':
          console.error('Visual Editor App: Received error:', message.error);
          setError(message.error || 'An error occurred');
          setIsLoading(false);
          break;
          
        default:
          console.warn('Visual Editor App: Unknown message command:', message.command);
      }
    } catch (error) {
      console.error('Visual Editor App: Critical error handling message:', error);
      setError('Critical error in message handling');
      setIsLoading(false);
    }
  }, []);

  // Set up message listener and request real data
  useEffect(() => {
    console.log('Visual Editor App: Setting up message listener');
    window.addEventListener('message', handleMessage);
    
    // Signal that the webview is ready
    if (window.vscode) {
      console.log('Visual Editor App: VS Code API available, sending ready message');
      window.vscode.postMessage({ command: 'ready' });
      
      // Request real offerings data from the extension
      console.log('Visual Editor App: Requesting offerings data from extension');
      window.vscode.postMessage({ command: 'requestOfferingsData' });
    } else {
      console.error('Visual Editor App: VS Code API not available');
    }

    return () => {
      console.log('Visual Editor App: Cleaning up message listener');
      window.removeEventListener('message', handleMessage);
    };
  }, [handleMessage]);

  // Handle node selection
  const handleNodeSelect = useCallback((node: GraphNode | null) => {
    console.log('App: handleNodeSelect called with:', {
      hasNode: !!node,
      nodeId: node?.id,
      nodeType: node?.type,
      nodeName: node?.name,
      hasData: !!node?.data,
      hasInputs: !!node?.data?.inputs,
      inputsLength: node?.data?.inputs?.length || 0,
      hasOutputs: !!node?.data?.outputs,
      outputsLength: node?.data?.outputs?.length || 0,
      fullNode: node
    });
    
    setSelectedNode(node);
    
    console.log('App: selectedNode state should be updated');
  }, []);

  // Handle adding a new dependency
  const handleAddDependency = useCallback((offering: OfferingData, position: { x: number; y: number }) => {
    console.log('Visual Editor App: Adding dependency', offering, position);
    if (window.vscode) {
      window.vscode.postMessage({
        command: 'addDependency',
        data: {
          offering,
          position
        }
      });
    }
  }, []);

  // Handle removing a dependency
  const handleRemoveDependency = useCallback((nodeId: string) => {
    if (window.vscode) {
      window.vscode.postMessage({
        command: 'removeDependency',
        nodeId
      });
    }
  }, []);

  // Classify update type based on property and value
  const classifyUpdateType = (nodeId: string, property: string, value: any): 'incremental' | 'structural' => {
    // Root node updates
    if (nodeId === 'root') {
      if (property === 'inputs' || property === 'outputs') {
        // Check if this is just a connector toggle (incremental) or structural change
        if (Array.isArray(value) && value.length > 0) {
          // For now, treat inputs/outputs updates as incremental for connector toggles
          // TODO: Add more sophisticated logic to detect structural changes
          return 'incremental';
        }
        return 'structural';
      }
      // Other root properties like name, label, description are incremental
      return 'incremental';
    }
    
    // Dependency node updates
    if (nodeId.startsWith('dep-')) {
      // Most dependency property updates are incremental
      if (property === 'name' || property === 'version' || property === 'flavors' || 
          property === 'optional' || property === 'on_by_default') {
        return 'incremental';
      }
      // Adding/removing dependencies is structural
      return 'structural';
    }
    
    // Default to incremental for safety
    return 'incremental';
  };

  // Handle updating node properties
  const handleUpdateNodeProperty = useCallback((nodeId: string, property: string, value: any) => {
    if (window.vscode) {
      const updateType = classifyUpdateType(nodeId, property, value);
      
      // Log the classification for debugging
      console.log('App: Classified update as:', updateType, { nodeId, property, value });
      
      if (updateType === 'incremental') {
        window.vscode.postMessage({
          command: 'updateNodePropertyIncremental',
          nodeId,
          property,
          value
        });
      } else {
        // Use the existing structural update path
        window.vscode.postMessage({
          command: 'updateNodeProperty',
          nodeId,
          property,
          value
        });
      }
    }
  }, []);

  // Handle adding a connection
  const handleAddConnection = useCallback((connection: Omit<GraphConnection, 'id'>) => {
    if (window.vscode) {
      window.vscode.postMessage({
        command: 'addConnection',
        data: connection
      });
    }
  }, []);

  // Handle removing a connection
  const handleRemoveConnection = useCallback((connectionId: string) => {
    if (window.vscode) {
      window.vscode.postMessage({
        command: 'removeConnection',
        connectionId
      });
    }
  }, []);

  // Handle product selection change
  const handleProductChange = useCallback((productName: string) => {
    console.log('Visual Editor App: Product changed to:', productName);
    setSelectedProduct(productName);
    
    // Find the new product and default to its first flavor
    const newProduct = graphModel?.products?.find(p => p.name === productName);
    if (newProduct && newProduct.flavors.length > 0) {
      const firstFlavor = newProduct.flavors[0].name;
      setSelectedFlavor(firstFlavor);
      
      // Notify VS Code about the change
      if (window.vscode) {
        window.vscode.postMessage({
          command: 'changeProductFlavor',
          data: {
            product: productName,
            flavor: firstFlavor
          }
        });
      }
    }
  }, [graphModel]);

  // Handle flavor selection change
  const handleFlavorChange = useCallback((flavorName: string) => {
    console.log('Visual Editor App: Flavor changed to:', flavorName);
    setSelectedFlavor(flavorName);
    
    // Notify VS Code about the change
    if (window.vscode) {
      window.vscode.postMessage({
        command: 'changeProductFlavor',
        data: {
          product: selectedProduct,
          flavor: flavorName
        }
      });
    }
  }, [selectedProduct]);

  // Handle catalog selection change
  const handleCatalogChange = useCallback((catalogId: string) => {
    console.log('Visual Editor App: Catalog changed to:', catalogId);
    setSelectedCatalogId(catalogId);
    setOfferingsLoading(true);
    setOfferingsError(null);
    
    // Notify VS Code about the change
    if (window.vscode) {
      window.vscode.postMessage({
        command: 'requestOfferingsForCatalog',
        data: { catalogId }
      });
    }
  }, []);

  console.log('Visual Editor App: Render state - isLoading:', isLoading, 'error:', error, 'graphModel:', !!graphModel);

  if (isLoading) {
    console.log('Visual Editor App: Rendering loading state');
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <div className="loading-text">Loading Visual Editor...</div>
      </div>
    );
  }

  if (error) {
    console.log('Visual Editor App: Rendering error state:', error);
    return (
      <div className="error-container">
        <div className="error-icon">⚠️</div>
        <div className="error-text">{error}</div>
        <button 
          className="retry-button"
          onClick={() => {
            console.log('Visual Editor App: Retry button clicked');
            setError(null);
            setIsLoading(true);
            if (window.vscode) {
              window.vscode.postMessage({ command: 'ready' });
            }
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!graphModel) {
    console.log('Visual Editor App: Rendering empty state - no graph model');
    return (
      <div className="empty-state">
        <div className="empty-state-text">No graph data available</div>
      </div>
    );
  }

  console.log('Visual Editor App: Rendering main interface with graph model');

  return (
    <ErrorBoundary>
      <div className="visual-editor">
        <Toolbar 
          products={graphModel?.products || []}
          selectedProduct={selectedProduct}
          selectedFlavor={selectedFlavor}
          onProductChange={handleProductChange}
          onFlavorChange={handleFlavorChange}
        />
        
        <div className="editor-content">
          <DALibrary 
            offerings={availableOfferings}
            catalogs={availableCatalogs}
            selectedCatalogId={selectedCatalogId || undefined}
            onAddDependency={handleAddDependency}
            onCatalogChange={handleCatalogChange}
            loading={offeringsLoading}
            error={offeringsError}
          />
          
          <Canvas
            graphModel={graphModel}
            selectedNode={selectedNode}
            onNodeSelect={handleNodeSelect}
            onAddConnection={handleAddConnection}
            onRemoveConnection={handleRemoveConnection}
            onAddDependency={handleAddDependency}
          />
          
          <PropertiesPanel
            selectedNode={selectedNode}
            onUpdateProperty={handleUpdateNodeProperty}
            onRemoveNode={handleRemoveDependency}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
};

// Global type extensions
declare global {
  interface Window {
    vscode: {
      postMessage(message: any): void;
      getState(): any;
      setState(state: any): void;
    };
  }
}