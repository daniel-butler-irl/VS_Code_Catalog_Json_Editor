import React, { useCallback } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';

// Import our custom node components
import { RootNodeReactFlow } from '../nodes/RootNodeReactFlow';
import { DependencyNodeReactFlow } from '../nodes/DependencyNodeReactFlow';

// Node types registration
const nodeTypes: NodeTypes = {
  rootNode: RootNodeReactFlow,
  dependencyNode: DependencyNodeReactFlow,
};

// Enhanced test data - using our custom node types with more fields
const initialNodes: Node[] = [
  {
    id: '1',
    type: 'rootNode',
    position: { x: 0, y: 0 },
    data: { 
      label: 'Cloud Platform',
      description: 'Main infrastructure deployment',
      version: '1.2.0'
    },
  },
  {
    id: '2',
    type: 'dependencyNode', 
    position: { x: 200, y: 100 },
    data: { 
      label: 'Security Module',
      description: 'IAM and security configurations',
      version: '2.1.3',
      installType: 'extension'
    },
  },
];

const initialEdges: Edge[] = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
  },
];

// Simplified props - keeping interface for compatibility
interface CanvasProps {
  graphModel?: any;
  selectedNode?: any;
  onNodeSelect?: (node: any) => void;
  onAddConnection?: (connection: any) => void;
  onRemoveConnection?: (connectionId: string) => void;
  onAddDependency?: (offering: any, position: any) => void;
  onValidationChange?: (errors: string[]) => void;
}

const CanvasContent: React.FC<CanvasProps> = () => {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  console.log('Canvas: Rendering basic React Flow example with', nodes.length, 'nodes and', edges.length, 'edges');

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      />
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