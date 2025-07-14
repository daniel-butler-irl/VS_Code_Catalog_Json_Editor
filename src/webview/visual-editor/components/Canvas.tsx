import React, { useRef, useEffect, useState } from 'react';

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
}

interface CanvasProps {
  graphModel: GraphModel;
  selectedNode: GraphNode | null;
  onNodeSelect: (node: GraphNode | null) => void;
  onAddConnection: (connection: Omit<GraphConnection, 'id'>) => void;
  onRemoveConnection: (connectionId: string) => void;
}

// Simple node component for now (will be replaced with Rete.js)
const SimpleNode: React.FC<{
  node: GraphNode;
  isSelected: boolean;
  onClick: (node: GraphNode) => void;
  onDragStart: (e: React.DragEvent, node: GraphNode) => void;
}> = ({ node, isSelected, onClick, onDragStart }) => {
  const nodeClass = `simple-node ${node.type} ${isSelected ? 'selected' : ''}`;
  
  return (
    <div
      className={nodeClass}
      style={{
        position: 'absolute',
        left: node.position.x,
        top: node.position.y,
        transform: 'translate(-50%, -50%)'
      }}
      onClick={() => onClick(node)}
      draggable
      onDragStart={(e) => onDragStart(e, node)}
    >
      <div className="node-header">
        <div className="node-title">{node.name}</div>
        <div className="node-type-badge">{node.type}</div>
      </div>
      
      <div className="node-content">
        {node.type === 'dependency' && (
          <>
            <div className="node-info">Version: {node.data.version || 'Latest'}</div>
            <div className="node-info">Flavor: {node.data.flavors?.join(', ') || 'Default'}</div>
            {node.data.optional && <div className="node-badge optional">Optional</div>}
          </>
        )}
        
        {node.type === 'root' && (
          <div className="node-info">Flavor: {node.data.flavor || 'Default'}</div>
        )}
      </div>
      
      {/* Input/Output ports placeholder */}
      <div className="node-ports">
        <div className="input-ports">
          {/* Will be replaced with actual input ports */}
          <div className="port input" title="Inputs"></div>
        </div>
        <div className="output-ports">
          {/* Will be replaced with actual output ports */}
          <div className="port output" title="Outputs"></div>
        </div>
      </div>
    </div>
  );
};

// Simple connection line component (will be replaced with Rete.js)
const SimpleConnection: React.FC<{
  connection: GraphConnection;
  nodes: GraphNode[];
  onRemove: (connectionId: string) => void;
}> = ({ connection, nodes, onRemove }) => {
  const sourceNode = nodes.find(n => n.id === connection.source);
  const targetNode = nodes.find(n => n.id === connection.target);
  
  if (!sourceNode || !targetNode) {
    return null;
  }
  
  const x1 = sourceNode.position.x + 100; // Offset for output port
  const y1 = sourceNode.position.y;
  const x2 = targetNode.position.x - 100; // Offset for input port
  const y2 = targetNode.position.y;
  
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--vscode-charts-blue)"
        strokeWidth="2"
        markerEnd="url(#arrowhead)"
      />
      <circle
        cx={(x1 + x2) / 2}
        cy={(y1 + y2) / 2}
        r="6"
        fill="var(--vscode-charts-blue)"
        className="connection-handle"
        onClick={() => onRemove(connection.id)}
        style={{ cursor: 'pointer' }}
        title="Click to remove connection"
      />
    </g>
  );
};

export const Canvas: React.FC<CanvasProps> = ({
  graphModel,
  selectedNode,
  onNodeSelect,
  onAddConnection,
  onRemoveConnection
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDraggingNode, setIsDraggingNode] = useState<GraphNode | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Handle canvas drag drop for adding new dependencies
  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    
    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const offering = JSON.parse(data);
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const position = {
            x: (e.clientX - rect.left - pan.x) / zoom,
            y: (e.clientY - rect.top - pan.y) / zoom
          };
          
          // This will be handled by the parent App component
          console.log('Drop offering at position:', offering, position);
        }
      }
    } catch (error) {
      console.error('Error handling canvas drop:', error);
    }
  };

  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleNodeClick = (node: GraphNode) => {
    onNodeSelect(node);
  };

  const handleNodeDragStart = (e: React.DragEvent, node: GraphNode) => {
    setIsDraggingNode(node);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left - node.position.x * zoom - pan.x,
        y: e.clientY - rect.top - node.position.y * zoom - pan.y
      });
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current) {
      onNodeSelect(null);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedNode && selectedNode.type !== 'root') {
        if (window.confirm(`Remove dependency "${selectedNode.name}"?`)) {
          // This will be handled by the parent component
          console.log('Delete node:', selectedNode.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNode]);

  return (
    <div className="canvas-container">
      <div
        ref={canvasRef}
        className="canvas"
        onDrop={handleCanvasDrop}
        onDragOver={handleCanvasDragOver}
        onClick={handleCanvasClick}
        style={{
          transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
          transformOrigin: '0 0'
        }}
      >
        {/* SVG for connections */}
        <svg
          ref={svgRef}
          className="connections-layer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none'
          }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="var(--vscode-charts-blue)"
              />
            </marker>
          </defs>
          
          {graphModel.connections.map(connection => (
            <SimpleConnection
              key={connection.id}
              connection={connection}
              nodes={graphModel.nodes}
              onRemove={onRemoveConnection}
            />
          ))}
        </svg>

        {/* Nodes layer */}
        <div className="nodes-layer">
          {graphModel.nodes.map(node => (
            <SimpleNode
              key={node.id}
              node={node}
              isSelected={selectedNode?.id === node.id}
              onClick={handleNodeClick}
              onDragStart={handleNodeDragStart}
            />
          ))}
        </div>

        {/* Grid background */}
        <div className="grid-background"></div>
      </div>

      {/* Canvas controls */}
      <div className="canvas-controls">
        <button onClick={() => setZoom(z => Math.min(z * 1.2, 3))}>+</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.max(z / 1.2, 0.1))}>-</button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</button>
      </div>

      {/* Info overlay */}
      <div className="canvas-info">
        <div>Flavor: {graphModel.selectedFlavor}</div>
        <div>Nodes: {graphModel.nodes.length}</div>
        <div>Connections: {graphModel.connections.length}</div>
      </div>
    </div>
  );
};