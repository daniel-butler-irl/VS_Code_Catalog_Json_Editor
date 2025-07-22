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
} from 'reactflow';
import 'reactflow/dist/style.css';

// Simple test data - basic React Flow example
const initialNodes: Node[] = [
  {
    id: '1',
    position: { x: 0, y: 0 },
    data: { label: 'Node 1' },
  },
  {
    id: '2',
    position: { x: 200, y: 100 },
    data: { label: 'Node 2' },
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