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

interface OfferingData {
  id: string;
  name: string;
  description: string;
  versions: string[];
  flavors: string[];
}

interface WebviewMessage {
  command: string;
  data?: any;
  error?: string;
}

export const VisualEditorApp: React.FC = () => {
  const [graphModel, setGraphModel] = useState<GraphModel | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [availableOfferings, setAvailableOfferings] = useState<OfferingData[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [selectedFlavor, setSelectedFlavor] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Message handler for VS Code communication
  const handleMessage = useCallback((event: MessageEvent) => {
    const message: WebviewMessage = event.data;
    console.log('Visual Editor App: Received message:', message.command, message);
    
    switch (message.command) {
      case 'initializeGraph':
        console.log('Visual Editor App: Initializing graph with data:', message.data);
        setGraphModel(message.data);
        // Set default product and flavor from the graph model
        if (message.data?.products?.length > 0) {
          const firstProduct = message.data.products[0];
          setSelectedProduct(message.data.selectedProduct || firstProduct.name);
          setSelectedFlavor(message.data.selectedFlavor || firstProduct.flavors?.[0]?.name || '');
        }
        setIsLoading(false);
        setError(null);
        break;
        
      case 'updateGraph':
        console.log('Visual Editor App: Updating graph with data:', message.data);
        setGraphModel(message.data);
        // Update selected product/flavor if they changed
        if (message.data?.selectedProduct) {
          setSelectedProduct(message.data.selectedProduct);
        }
        if (message.data?.selectedFlavor) {
          setSelectedFlavor(message.data.selectedFlavor);
        }
        setError(null);
        break;
        
      case 'updateOfferingsData':
        console.log('Visual Editor App: Updating offerings data:', message.data?.offerings?.length || 0, 'offerings');
        setAvailableOfferings(message.data.offerings || []);
        break;
        
      case 'showError':
        console.error('Visual Editor App: Received error:', message.error);
        setError(message.error || 'An error occurred');
        setIsLoading(false);
        break;
        
      default:
        console.warn('Visual Editor App: Unknown message command:', message.command);
    }
  }, []);

  // Set up message listener and mock data
  useEffect(() => {
    console.log('Visual Editor App: Setting up message listener');
    window.addEventListener('message', handleMessage);
    
    // Set up mock offerings data for development
    const mockOfferings: OfferingData[] = [
      {
        id: 'terraform-sample-vpc',
        name: 'VPC Infrastructure',
        description: 'Basic VPC with subnets, security groups, and network ACLs for IBM Cloud',
        versions: ['1.0.0', '1.1.0', '1.2.0'],
        flavors: ['standard', 'small', 'large']
      },
      {
        id: 'terraform-sample-iks',
        name: 'IKS Cluster',
        description: 'IBM Kubernetes Service cluster with worker nodes and load balancer',
        versions: ['1.0.0', '1.1.0'],
        flavors: ['standard', 'minimal']
      },
      {
        id: 'terraform-sample-cos',
        name: 'Cloud Object Storage',
        description: 'IBM Cloud Object Storage bucket with encryption and access controls',
        versions: ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        flavors: ['standard', 'cold', 'vault']
      },
      {
        id: 'terraform-sample-iam',
        name: 'IAM Resources',
        description: 'Identity and Access Management policies, service IDs, and access groups',
        versions: ['1.0.0'],
        flavors: ['standard']
      },
      {
        id: 'terraform-sample-database',
        name: 'Database Service',
        description: 'IBM Cloud Databases with backup and monitoring configuration',
        versions: ['1.0.0', '1.1.0'],
        flavors: ['postgresql', 'mongodb', 'redis']
      }
    ];
    
    console.log('Visual Editor App: Setting mock offerings data:', mockOfferings.length, 'offerings');
    setAvailableOfferings(mockOfferings);
    
    // Signal that the webview is ready
    if (window.vscode) {
      console.log('Visual Editor App: VS Code API available, sending ready message');
      window.vscode.postMessage({ command: 'ready' });
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
    setSelectedNode(node);
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

  // Handle updating node properties
  const handleUpdateNodeProperty = useCallback((nodeId: string, property: string, value: any) => {
    if (window.vscode) {
      window.vscode.postMessage({
        command: 'updateNodeProperty',
        nodeId,
        property,
        value
      });
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
            onAddDependency={handleAddDependency}
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