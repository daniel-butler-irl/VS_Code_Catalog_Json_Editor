import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ReactFlowProvider,
  NodeTypes,
  Controls,
} from 'reactflow';
import 'reactflow/dist/style.css';

// Import our custom node components
import { RootNodeReactFlow } from '../nodes/RootNodeReactFlow';
import { DependencyNodeReactFlow } from '../nodes/DependencyNodeReactFlow';

// GraphModel interfaces for VS Code extension data
interface GraphNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  data: any;
  position: { x: number; y: number };
  // Single expand/collapse state
  expanded?: boolean;
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
  products: any[];
  selectedProduct: string;
}

// Node types registration
const nodeTypes: NodeTypes = {
  rootNode: RootNodeReactFlow,
  dependencyNode: DependencyNodeReactFlow,
};

// Enhanced edge styling based on mapping types
const getEdgeStyle = (mappingType?: string) => {
  const styles = {
    dependency_output: { 
      stroke: '#8b5cf6', // Purple for dependency outputs
      strokeWidth: 2,
      strokeDasharray: undefined
    },
    dependency_input: { 
      stroke: '#3b82f6', // Blue for dependency inputs
      strokeWidth: 2,
      strokeDasharray: undefined
    },
    static_value: { 
      stroke: '#6b7280', // Gray for static values
      strokeWidth: 2,
      strokeDasharray: '5,5' // Dashed line for static
    },
    pass_through: { 
      stroke: '#f59e0b', // Amber for pass-through
      strokeWidth: 2,
      strokeDasharray: undefined
    },
    default: { 
      stroke: '#10b981', // Green for default/untyped
      strokeWidth: 1,
      strokeDasharray: undefined
    }
  };
  
  return styles[mappingType as keyof typeof styles] || styles.default;
};

const getEdgeLabel = (mappingType?: string, description?: string) => {
  const labels = {
    dependency_output: 'dep_out',
    dependency_input: 'dep_in',
    static_value: 'static',
    pass_through: 'pass',
    default: 'conn'
  };
  
  return labels[mappingType as keyof typeof labels] || 'conn';
};

// Helper function to analyze connected handles for a node
const analyzeConnectedHandles = (nodeId: string, connections: GraphConnection[]): string[] => {
  const connectedHandles: string[] = [];
  
  connections.forEach(conn => {
    if (conn.source === nodeId && conn.sourceHandle) {
      connectedHandles.push(conn.sourceHandle);
    }
    if (conn.target === nodeId && conn.targetHandle) {
      connectedHandles.push(conn.targetHandle);
    }
  });
  
  return connectedHandles;
};

// Conversion functions for GraphModel to ReactFlow format
const convertGraphNodeToReactFlowNode = (graphNode: GraphNode, connections: GraphConnection[] = []): Node => {
  console.log('Canvas: Converting GraphNode to ReactFlow Node:', {
    graphNodeId: graphNode.id,
    graphNodeType: graphNode.type,
    graphNodeName: graphNode.name,
    hasData: !!graphNode.data,
    position: graphNode.position,
    dataKeys: graphNode.data ? Object.keys(graphNode.data) : []
  });

  // Calculate dynamic height based on port count and expand state
  const inputs = graphNode.data?.inputs || [];
  const outputs = graphNode.data?.outputs || [];
  
  // Analyze connected handles for this node
  const connectedHandles = analyzeConnectedHandles(graphNode.id, connections);
  
  // Get expand state (default to collapsed)
  const expanded = graphNode.expanded || false;
  
  // Filter visible ports based on expand state and connections
  const connectedInputs = inputs.filter(input => 
    connectedHandles.includes(`input-${input.name}`) || input.connector);
  const connectedOutputs = outputs.filter(output => 
    connectedHandles.includes(`output-${output.name}`) || output.connector);
  
  const visibleInputs = expanded ? inputs : connectedInputs;
  const visibleOutputs = expanded ? outputs : connectedOutputs;
  const maxPorts = Math.max(visibleInputs.length, visibleOutputs.length);
  
  // Port spacing and base height calculations
  const portSpacing = 10;
  const baseHeight = graphNode.type === 'root' ? 80 : 70;
  const expandButtonHeight = 15; // Height for expand/collapse controls
  const dynamicHeight = Math.max(baseHeight, baseHeight + (maxPorts * portSpacing) + expandButtonHeight);
  
  // Explicit width based on node type
  const nodeWidth = graphNode.type === 'root' ? 120 : 100;

  console.log('Canvas: Calculated dimensions:', {
    nodeType: graphNode.type,
    inputCount: inputs.length,
    outputCount: outputs.length,
    connectedInputs: connectedInputs.length,
    connectedOutputs: connectedOutputs.length,
    visibleInputs: visibleInputs.length,
    visibleOutputs: visibleOutputs.length,
    expanded,
    maxPorts,
    dynamicHeight,
    nodeWidth,
    connectedHandles
  });

  return {
    id: graphNode.id,
    type: graphNode.type === 'root' ? 'rootNode' : 'dependencyNode',
    position: graphNode.position,
    // Explicitly set ReactFlow node dimensions to override DOM measurement
    width: nodeWidth,
    height: dynamicHeight,
    style: {
      width: nodeWidth,
      height: dynamicHeight
    },
    data: {
      label: graphNode.name,
      description: graphNode.data?.description || '',
      version: graphNode.data?.version || '',
      inputs: inputs,
      outputs: outputs,
      connectedHandles: connectedHandles,
      expanded: expanded,
      onToggleExpand: null, // Will be set by the provider
      ...graphNode.data // Include all the original data from GraphNode
    }
  };
};

const convertGraphConnectionToReactFlowEdge = (graphConnection: GraphConnection, nodes: GraphNode[]): Edge => {
  console.log('Canvas: Converting GraphConnection to ReactFlow Edge:', {
    connectionId: graphConnection.id,
    source: graphConnection.source,
    target: graphConnection.target,
    sourceHandle: graphConnection.sourceHandle,
    targetHandle: graphConnection.targetHandle
  });

  // Validate that source and target handles exist on their respective nodes
  const sourceNode = nodes.find(n => n.id === graphConnection.source);
  const targetNode = nodes.find(n => n.id === graphConnection.target);
  
  let isBroken = false;
  let errorMessage = '';
  
  // Check if source handle exists
  const sourceHandleName = graphConnection.sourceHandle?.replace(/^(input-|output-)/, '');
  const hasSourceHandle = sourceNode?.data?.outputs?.some((output: any) => output.name === sourceHandleName) ||
                         sourceNode?.data?.inputs?.some((input: any) => input.name === sourceHandleName);
  
  // Check if target handle exists  
  const targetHandleName = graphConnection.targetHandle?.replace(/^(input-|output-)/, '');
  const hasTargetHandle = targetNode?.data?.inputs?.some((input: any) => input.name === targetHandleName) ||
                         targetNode?.data?.outputs?.some((output: any) => output.name === targetHandleName);

  if (!hasSourceHandle) {
    isBroken = true;
    errorMessage += `Source handle "${graphConnection.sourceHandle}" not found on ${sourceNode?.name || graphConnection.source}. `;
  }
  
  if (!hasTargetHandle) {
    isBroken = true;
    errorMessage += `Target handle "${graphConnection.targetHandle}" not found on ${targetNode?.name || graphConnection.target}. `;
  }

  // Determine mapping type from connection data or handle names
  const mappingType = graphConnection.sourceHandle?.includes('dependency_output') ? 'dependency_output' :
                     graphConnection.sourceHandle?.includes('dependency_input') ? 'dependency_input' :
                     graphConnection.sourceHandle?.includes('static_value') ? 'static_value' :
                     graphConnection.sourceHandle?.includes('pass_through') ? 'pass_through' :
                     'default';

  // Style broken edges differently
  const edgeStyle = isBroken ? {
    stroke: '#ef4444', // Red color for broken edges
    strokeWidth: 2,
    strokeDasharray: '10,5', // Dashed pattern for broken edges
    opacity: 0.8
  } : getEdgeStyle(mappingType);

  const edgeLabel = isBroken ? 'BROKEN' : getEdgeLabel(mappingType);
  const labelStyle = {
    fontSize: '10px',
    fontWeight: '500',
    fill: isBroken ? '#ef4444' : '#6b7280',
    backgroundColor: isBroken ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.8)',
    padding: '2px 4px',
    borderRadius: '3px',
    border: isBroken ? '1px solid #ef4444' : 'none'
  };

  return {
    id: graphConnection.id,
    source: graphConnection.source,
    target: graphConnection.target,
    sourceHandle: graphConnection.sourceHandle,
    targetHandle: graphConnection.targetHandle,
    type: 'smoothstep',
    style: edgeStyle,
    label: edgeLabel,
    labelStyle: labelStyle,
    data: {
      mappingType,
      isBroken,
      errorMessage: errorMessage.trim(),
      description: isBroken ? 
        `BROKEN: ${errorMessage.trim()}` : 
        `Connection from ${graphConnection.sourceHandle} to ${graphConnection.targetHandle}`
    }
  };
};

// Default fallback data when no GraphModel is available
const getDefaultNodes = (): Node[] => [
  {
    id: 'placeholder',
    type: 'rootNode',
    position: { x: 250, y: 100 },
    data: { 
      label: 'No Data Available',
      description: 'Select an offering and flavor to view nodes',
      version: ''
    },
  }
];

const getDefaultEdges = (): Edge[] => [];

// Canvas props interface
interface CanvasProps {
  graphModel?: GraphModel;
  selectedNode?: any;
  onNodeSelect?: (node: any) => void;
  onAddConnection?: (connection: any) => void;
  onRemoveConnection?: (connectionId: string) => void;
  onAddDependency?: (offering: any, position: any) => void;
  onValidationChange?: (errors: string[]) => void;
}

const CanvasContent: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  // Convert GraphModel to ReactFlow format using useMemo for performance
  const { initialNodes, initialEdges } = useMemo(() => {
    console.log('===== Canvas: GraphModel Analysis =====');
    console.log('Canvas: Raw GraphModel received:', {
      graphModel: graphModel,
      hasGraphModel: !!graphModel,
      graphModelType: typeof graphModel,
      graphModelKeys: graphModel ? Object.keys(graphModel) : 'N/A'
    });

    if (graphModel) {
      console.log('Canvas: GraphModel detailed analysis:', {
        hasNodes: !!graphModel.nodes,
        nodeCount: graphModel.nodes?.length || 0,
        hasConnections: !!graphModel.connections,
        connectionCount: graphModel.connections?.length || 0,
        selectedProduct: graphModel.selectedProduct,
        selectedFlavor: graphModel.selectedFlavor,
        products: graphModel.products?.length || 0
      });

      if (graphModel.nodes && graphModel.nodes.length > 0) {
        console.log('Canvas: Individual nodes analysis:', 
          graphModel.nodes.map((node, index) => ({
            index,
            id: node.id,
            type: node.type,
            name: node.name,
            position: node.position,
            hasData: !!node.data,
            dataKeys: node.data ? Object.keys(node.data) : 'N/A',
            dataInputsCount: node.data?.inputs?.length || 0,
            dataOutputsCount: node.data?.outputs?.length || 0
          }))
        );
      }

      if (graphModel.connections && graphModel.connections.length > 0) {
        console.log('Canvas: Individual connections analysis:', 
          graphModel.connections.map((conn, index) => ({
            index,
            id: conn.id,
            source: conn.source,
            target: conn.target,
            sourceHandle: conn.sourceHandle,
            targetHandle: conn.targetHandle
          }))
        );
      }
    }

    if (!graphModel || !graphModel.nodes || graphModel.nodes.length === 0) {
      console.log('Canvas: No valid GraphModel data, using default nodes');
      console.log('Canvas: Reason for fallback:', {
        noGraphModel: !graphModel,
        noNodes: !graphModel?.nodes,
        emptyNodes: graphModel?.nodes?.length === 0
      });
      return {
        initialNodes: getDefaultNodes(),
        initialEdges: getDefaultEdges()
      };
    }

    console.log('Canvas: Starting node conversion...');
    const convertedNodes = graphModel.nodes.map((node, index) => {
      console.log(`Canvas: Converting node ${index}:`, {
        originalNode: {
          id: node.id,
          type: node.type,
          name: node.name,
          position: node.position
        }
      });
      const converted = convertGraphNodeToReactFlowNode(node, graphModel.connections || []);
      console.log(`Canvas: Converted node ${index}:`, {
        convertedNode: {
          id: converted.id,
          type: converted.type,
          position: converted.position,
          dataLabel: converted.data?.label
        }
      });
      return converted;
    });

    console.log('Canvas: Starting edge conversion...');
    const convertedEdges = graphModel.connections?.map((conn, index) => {
      console.log(`Canvas: Converting connection ${index}:`, conn);
      const converted = convertGraphConnectionToReactFlowEdge(conn, graphModel.nodes);
      console.log(`Canvas: Converted connection ${index}:`, converted);
      return converted;
    }) || [];

    // Collect broken handles from edges and update node data
    const brokenHandlesByNode = new Map<string, string[]>();
    convertedEdges.forEach(edge => {
      if (edge.data?.isBroken) {
        // Add broken source handle
        if (!brokenHandlesByNode.has(edge.source)) {
          brokenHandlesByNode.set(edge.source, []);
        }
        brokenHandlesByNode.get(edge.source)!.push(edge.sourceHandle!);
        
        // Add broken target handle
        if (!brokenHandlesByNode.has(edge.target)) {
          brokenHandlesByNode.set(edge.target, []);
        }
        brokenHandlesByNode.get(edge.target)!.push(edge.targetHandle!);
      }
    });

    // Update converted nodes with broken handle information
    const nodesWithBrokenHandles = convertedNodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        brokenHandles: brokenHandlesByNode.get(node.id) || []
      }
    }));

    console.log('Canvas: Final conversion results:', {
      originalNodes: graphModel.nodes.length,
      convertedNodes: nodesWithBrokenHandles.length,
      originalConnections: graphModel.connections?.length || 0,
      convertedEdges: convertedEdges.length,
      brokenEdges: convertedEdges.filter(e => e.data?.isBroken).length,
      brokenHandlesByNode: Object.fromEntries(brokenHandlesByNode)
    });
    console.log('===== End Canvas Analysis =====');

    return {
      initialNodes: nodesWithBrokenHandles,
      initialEdges: convertedEdges
    };
  }, [graphModel]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when GraphModel changes
  useEffect(() => {
    console.log('Canvas: GraphModel changed, updating nodes and edges');
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Handle expand/collapse toggle for node ports
  const handleToggleExpand = useCallback((nodeId: string) => {
    console.log('Canvas: Toggling expand for node:', nodeId);
    
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id === nodeId) {
          const newExpandState = { ...node.data, expanded: !node.data.expanded };
          
          // Recalculate height based on new expand state
          const inputs = node.data.inputs || [];
          const outputs = node.data.outputs || [];
          const connectedHandles = node.data.connectedHandles || [];
          
          const connectedInputs = inputs.filter((input: any) => 
            connectedHandles.includes(`input-${input.name}`) || input.connector);
          const connectedOutputs = outputs.filter((output: any) => 
            connectedHandles.includes(`output-${output.name}`) || output.connector);
          
          const visibleInputs = newExpandState.expanded ? inputs : connectedInputs;
          const visibleOutputs = newExpandState.expanded ? outputs : connectedOutputs;
          const maxPorts = Math.max(visibleInputs.length, visibleOutputs.length);
          
          const portSpacing = 10;
          const baseHeight = node.type === 'rootNode' ? 80 : 70;
          const expandButtonHeight = 15;
          const dynamicHeight = Math.max(baseHeight, baseHeight + (maxPorts * portSpacing) + expandButtonHeight);
          
          console.log('Canvas: Updated node dimensions:', {
            nodeId,
            newExpandState: newExpandState.expanded,
            visibleInputs: visibleInputs.length,
            visibleOutputs: visibleOutputs.length,
            dynamicHeight
          });
          
          return {
            ...node,
            height: dynamicHeight,
            style: { ...node.style, height: dynamicHeight },
            data: {
              ...newExpandState,
              onToggleExpand: handleToggleExpand // Update the handler reference
            }
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Update nodes with the toggle handler after initial setup
  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onToggleExpand: handleToggleExpand
        }
      }))
    );
  }, [handleToggleExpand, setNodes]);

  // Handle node selection - convert ReactFlow node back to GraphNode format for consistency
  const handleNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    console.log('Canvas: Node clicked:', {
      nodeId: node.id,
      nodeType: node.type,
      nodeData: node.data
    });

    if (onNodeSelect && graphModel) {
      // Find the original GraphNode from GraphModel
      const originalGraphNode = graphModel.nodes.find(gn => gn.id === node.id);
      
      if (originalGraphNode) {
        console.log('Canvas: Found original GraphNode, calling onNodeSelect');
        onNodeSelect(originalGraphNode);
      } else {
        console.warn('Canvas: Could not find original GraphNode for clicked node:', node.id);
        // Create a compatible node object from ReactFlow node
        const compatibleNode = {
          id: node.id,
          type: node.type === 'rootNode' ? 'root' : 'dependency',
          name: node.data?.label || node.id,
          data: node.data,
          position: node.position
        };
        onNodeSelect(compatibleNode);
      }
    }
  }, [onNodeSelect, graphModel]);

  const onConnect = useCallback(
    (params: Connection) => {
      console.log('Canvas: Attempting to create connection:', params);
      
      // Validate connection before creating
      const sourceNode = nodes.find(n => n.id === params.source);
      const targetNode = nodes.find(n => n.id === params.target);
      
      if (!sourceNode || !targetNode) {
        console.error('Canvas: Cannot create connection - source or target node not found', {
          sourceFound: !!sourceNode,
          targetFound: !!targetNode,
          params
        });
        return;
      }
      
      // Check if handles exist
      const sourceHandleName = params.sourceHandle?.replace(/^(input-|output-)/, '');
      const targetHandleName = params.targetHandle?.replace(/^(input-|output-)/, '');
      
      const hasSourceHandle = sourceNode.data?.outputs?.some((output: any) => output.name === sourceHandleName) ||
                             sourceNode.data?.inputs?.some((input: any) => input.name === sourceHandleName);
      
      const hasTargetHandle = targetNode.data?.inputs?.some((input: any) => input.name === targetHandleName) ||
                             targetNode.data?.outputs?.some((output: any) => output.name === targetHandleName);
      
      if (!hasSourceHandle || !hasTargetHandle) {
        console.error('Canvas: Cannot create connection - handles do not exist', {
          sourceHandle: params.sourceHandle,
          targetHandle: params.targetHandle,
          hasSourceHandle,
          hasTargetHandle,
          sourceNodeOutputs: sourceNode.data?.outputs?.map((o: any) => o.name),
          sourceNodeInputs: sourceNode.data?.inputs?.map((i: any) => i.name),
          targetNodeInputs: targetNode.data?.inputs?.map((i: any) => i.name),
          targetNodeOutputs: targetNode.data?.outputs?.map((o: any) => o.name)
        });
        
        // Show user-friendly error message
        console.warn(`Connection failed: ${!hasSourceHandle ? `Source handle "${params.sourceHandle}" not found` : ''} ${!hasTargetHandle ? `Target handle "${params.targetHandle}" not found` : ''}`);
        return;
      }

      // Enhanced connection with mapping type detection and styling
      const enhancedEdge = {
        ...params,
        id: `user-connection-${params.source}-${params.target}-${Date.now()}`, // Unique ID for user-created connections
        type: 'smoothstep', // Better visual flow
        style: getEdgeStyle('dependency_output'), // Default to dependency_output
        label: getEdgeLabel('dependency_output'),
        labelStyle: { 
          fontSize: '10px', 
          fontWeight: '500',
          fill: '#6b7280',
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          padding: '2px 4px',
          borderRadius: '3px'
        },
        data: {
          mappingType: 'dependency_output',
          description: 'Connection created by user',
          timestamp: Date.now(),
          isUserCreated: true
        }
      };
      
      console.log('Canvas: Creating valid connection:', enhancedEdge);
      setEdges((eds) => addEdge(enhancedEdge, eds));
    },
    [setEdges, nodes]
  );

  console.log('Canvas: Rendering ReactFlow with real catalog data:', {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    nodeTypes: nodes.map(n => ({ id: n.id, type: n.type, label: n.data?.label })),
    hasGraphModel: !!graphModel,
    graphModelNodeCount: graphModel?.nodes?.length || 0
  });

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        defaultControls={false}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        panOnScroll
        zoomOnScroll={true}
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectionMode="full"
        proOptions={{
          hideAttribution: true
        }}
      >
        <Controls 
          position="bottom-right"
          style={{
            background: 'var(--vscode-editor-background, #1e1e1e)',
            border: '1px solid var(--vscode-panel-border, #3c3c3c)',
            borderRadius: '8px',
            padding: '4px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          }}
          showZoom={true}
          showFitView={true}
          showInteractive={false}
        />
      </ReactFlow>
      
      {/* Connection Legend */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        right: '180px',
        backgroundColor: 'var(--vscode-sideBar-background, #252526)',
        border: '1px solid var(--vscode-panel-border, #3c3c3c)',
        borderRadius: '6px',
        padding: '12px',
        fontSize: '11px',
        color: 'var(--vscode-foreground, #cccccc)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        minWidth: '140px',
        zIndex: 10
      }}>
        <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '10px', opacity: 0.8 }}>
          CONNECTION TYPES
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ 
              width: '20px', 
              height: '2px', 
              backgroundColor: '#8b5cf6',
              borderRadius: '1px'
            }} />
            <span style={{ fontSize: '10px' }}>dependency_output</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ 
              width: '20px', 
              height: '2px', 
              backgroundColor: '#3b82f6',
              borderRadius: '1px'
            }} />
            <span style={{ fontSize: '10px' }}>dependency_input</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ 
              width: '20px', 
              height: '2px', 
              backgroundColor: '#6b7280',
              borderRadius: '1px',
              background: 'repeating-linear-gradient(to right, #6b7280, #6b7280 3px, transparent 3px, transparent 6px)'
            }} />
            <span style={{ fontSize: '10px' }}>static_value</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ 
              width: '20px', 
              height: '2px', 
              backgroundColor: '#f59e0b',
              borderRadius: '1px'
            }} />
            <span style={{ fontSize: '10px' }}>pass_through</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ 
              width: '20px', 
              height: '2px', 
              backgroundColor: '#10b981',
              borderRadius: '1px'
            }} />
            <span style={{ fontSize: '10px' }}>default</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ 
              width: '20px', 
              height: '2px', 
              backgroundColor: '#ef4444',
              borderRadius: '1px',
              background: 'repeating-linear-gradient(to right, #ef4444, #ef4444 5px, transparent 5px, transparent 10px)'
            }} />
            <span style={{ fontSize: '10px' }}>BROKEN</span>
          </div>
        </div>
      </div>
      
      {/* Custom CSS for ReactFlow controls */}
      <style>{`
        .react-flow__controls {
          background: var(--vscode-editor-background, #1e1e1e) !important;
          border: 1px solid var(--vscode-panel-border, #3c3c3c) !important;
          border-radius: 8px !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        }
        
        .react-flow__controls-button {
          background: var(--vscode-button-secondaryBackground, #3c3c3c) !important;
          color: var(--vscode-button-secondaryForeground, #cccccc) !important;
          border: 1px solid var(--vscode-button-border, #464647) !important;
          border-radius: 4px !important;
          margin: 2px !important;
          width: 24px !important;
          height: 24px !important;
          font-size: 12px !important;
          transition: all 0.2s ease !important;
        }
        
        .react-flow__controls-button:hover {
          background: var(--vscode-button-hoverBackground, #505050) !important;
          border-color: var(--vscode-focusBorder, #007fd4) !important;
          transform: scale(1.05) !important;
        }
        
        .react-flow__controls-button:active {
          background: var(--vscode-button-background, #0e639c) !important;
          transform: scale(0.95) !important;
        }
        
        .react-flow__controls-button svg {
          fill: var(--vscode-button-secondaryForeground, #cccccc) !important;
          width: 12px !important;
          height: 12px !important;
        }
        
        .react-flow__controls-button:hover svg {
          fill: var(--vscode-button-foreground, #ffffff) !important;
        }
      `}</style>
    </div>
  );
};

// Main Canvas component with ReactFlowProvider
export const Canvas: React.FC<CanvasProps> = (props) => {
  return (
    <ReactFlowProvider>
      <CanvasContent {...props} />
    </ReactFlowProvider>
  );
};