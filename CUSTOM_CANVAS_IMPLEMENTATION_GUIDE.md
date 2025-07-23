# Custom Canvas Visual Editor Implementation Guide

## Overview
This document provides a step-by-step plan to rebuild the IBM Catalog Visual Editor using a custom Canvas/SVG approach, avoiding ReactFlow compatibility issues with VS Code webviews. This approach is based on ActionForge's proven methodology for graph editors in VS Code extensions.

## Project Context
- **Project**: IBM Catalog JSON Editor VS Code Extension
- **Target**: Visual editor for `ibm_catalog.json` files showing dependency graphs
- **Build System**: esbuild with separate webview bundle at `dist/media/visual-editor-react.js`
- **Framework**: React TypeScript with custom Canvas/SVG rendering in VS Code webview
- **Approach**: Custom implementation avoiding ReactFlow's webview compatibility issues

## Why Custom Canvas Instead of ReactFlow?
ReactFlow has fundamental compatibility issues with VS Code webviews:
- VS Code disables pointer events during drag operations
- Webview sandboxing interferes with mouse event handling
- Content Security Policy restrictions block ReactFlow functionality
- ActionForge successfully implemented graph editors using custom Canvas/SVG approach

## Implementation Strategy

### Development Approach
1. **Start with Native DOM**: Use HTML5 Canvas and SVG for rendering
2. **Custom Event Handling**: Implement mouse/touch events compatible with webview sandboxing
3. **Incremental Features**: Build each feature independently and test thoroughly
4. **VS Code Integration**: Leverage webview message passing for extension communication

### Key Files to Work With
- `src/webview/visual-editor/components/Canvas.tsx` - Main component (replace entirely)
- `src/webview/visual-editor/index.tsx` - App entry point (minimal changes)
- `src/webview/visual-editor/lib/` - New directory for canvas utilities
- Build with `npm run build` after each change

---

## Stage 1: Basic Canvas Foundation
**Goal**: Replace ReactFlow with a basic HTML5 Canvas that renders static nodes and connections

### What to Implement
Create a completely new Canvas.tsx with basic canvas setup:

```tsx
// Stage 1: src/webview/visual-editor/components/Canvas.tsx
import React, { useRef, useEffect, useCallback } from 'react';

interface CanvasNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

interface CanvasProps {
  graphModel?: any;
  onNodeSelect?: (node: any) => void;
}

const initialNodes: CanvasNode[] = [
  {
    id: 'root-1',
    type: 'root',
    name: 'Cloud Automation for Secrets Manager',
    x: 100,
    y: 100,
    width: 200,
    height: 80,
  },
  {
    id: 'dep-1',
    type: 'dependency',
    name: 'VPC Module',
    x: 400,
    y: 50,
    width: 150,
    height: 60,
  },
  {
    id: 'dep-2',
    type: 'dependency',
    name: 'Security Group Module',
    x: 400,
    y: 150,
    width: 150,
    height: 60,
  }
];

const initialEdges: CanvasEdge[] = [
  { id: 'root-dep1', source: 'root-1', target: 'dep-1' },
  { id: 'root-dep2', source: 'root-1', target: 'dep-2' }
];

export const Canvas: React.FC<CanvasProps> = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes] = React.useState<CanvasNode[]>(initialNodes);
  const [edges] = React.useState<CanvasEdge[]>(initialEdges);

  const drawNode = useCallback((ctx: CanvasRenderingContext2D, node: CanvasNode) => {
    // Root node styling (purple gradient)
    if (node.type === 'root') {
      const gradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + node.height);
      gradient.addColorStop(0, '#4f46e5');
      gradient.addColorStop(1, '#7c3aed');
      ctx.fillStyle = gradient;
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
    } else {
      // Dependency node styling (green gradient)
      const gradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + node.height);
      gradient.addColorStop(0, '#059669');
      gradient.addColorStop(1, '#10b981');
      ctx.fillStyle = gradient;
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1;
    }

    // Draw rounded rectangle
    const radius = node.type === 'root' ? 8 : 6;
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.width, node.height, radius);
    ctx.fill();
    ctx.stroke();

    // Draw node text
    ctx.fillStyle = 'white';
    ctx.font = node.type === 'root' ? 'bold 14px sans-serif' : 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Main label
    ctx.fillText(
      node.name, 
      node.x + node.width / 2, 
      node.y + node.height / 2 - 8
    );

    // Subtitle
    ctx.font = '11px sans-serif';
    ctx.globalAlpha = 0.9;
    const subtitle = node.type === 'root' ? 'ROOT ARCHITECTURE' : 'EXTERNAL MODULE';
    ctx.fillText(
      subtitle,
      node.x + node.width / 2,
      node.y + node.height / 2 + 8
    );
    ctx.globalAlpha = 1;
  }, []);

  const drawEdge = useCallback((ctx: CanvasRenderingContext2D, edge: CanvasEdge, nodes: CanvasNode[]) => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    
    if (!sourceNode || !targetNode) return;

    // Calculate connection points
    const startX = sourceNode.x + sourceNode.width;
    const startY = sourceNode.y + sourceNode.height / 2;
    const endX = targetNode.x;
    const endY = targetNode.y + targetNode.height / 2;

    // Draw smooth curve
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    
    // Bezier curve for smooth connection
    const controlX1 = startX + (endX - startX) / 3;
    const controlX2 = startX + (2 * (endX - startX)) / 3;
    ctx.bezierCurveTo(controlX1, startY, controlX2, endY, endX, endY);
    ctx.stroke();

    // Draw arrowhead
    const angle = Math.atan2(endY - startY, endX - startX);
    const arrowLength = 10;
    const arrowAngle = Math.PI / 6;

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - arrowLength * Math.cos(angle - arrowAngle),
      endY - arrowLength * Math.sin(angle - arrowAngle)
    );
    ctx.lineTo(
      endX - arrowLength * Math.cos(angle + arrowAngle),
      endY - arrowLength * Math.sin(angle + arrowAngle)
    );
    ctx.closePath();
    ctx.fillStyle = '#6366f1';
    ctx.fill();
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set canvas size to match container
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Draw edges first (behind nodes)
    edges.forEach(edge => drawEdge(ctx, edge, nodes));

    // Draw nodes
    nodes.forEach(node => drawNode(ctx, node));
  }, [nodes, edges, drawNode, drawEdge]);

  useEffect(() => {
    render();
  }, [render]);

  // Handle canvas resize
  useEffect(() => {
    const handleResize = () => render();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#f9fafb',
          cursor: 'default'
        }}
      />
    </div>
  );
};
```

### Success Criteria
- ✅ Visual editor loads without errors
- ✅ Shows 3 static nodes with 2 connections
- ✅ Root node appears purple with gradient
- ✅ Dependency nodes appear green with gradient
- ✅ Smooth curved connections between nodes
- ✅ Professional appearance with proper text rendering

---

## Stage 2: Interactive Node Selection and Dragging
**Goal**: Add mouse interaction for node selection and dragging

### What to Implement
Add mouse event handling and drag functionality:

```tsx
// Stage 2: Add interaction state and handlers
interface CanvasState {
  selectedNode: string | null;
  draggedNode: string | null;
  dragOffset: { x: number; y: number };
  mousePos: { x: number; y: number };
}

export const Canvas: React.FC<CanvasProps> = ({ onNodeSelect }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = React.useState<CanvasNode[]>(initialNodes);
  const [edges] = React.useState<CanvasEdge[]>(initialEdges);
  const [state, setState] = React.useState<CanvasState>({
    selectedNode: null,
    draggedNode: null,
    dragOffset: { x: 0, y: 0 },
    mousePos: { x: 0, y: 0 }
  });

  const getNodeAtPosition = useCallback((x: number, y: number): CanvasNode | null => {
    // Check nodes in reverse order (top to bottom)
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (x >= node.x && x <= node.x + node.width &&
          y >= node.y && y <= node.y + node.height) {
        return node;
      }
    }
    return null;
  }, [nodes]);

  const getCanvasCoordinates = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(event);
    const clickedNode = getNodeAtPosition(coords.x, coords.y);
    
    if (clickedNode) {
      setState(prev => ({
        ...prev,
        selectedNode: clickedNode.id,
        draggedNode: clickedNode.id,
        dragOffset: {
          x: coords.x - clickedNode.x,
          y: coords.y - clickedNode.y
        },
        mousePos: coords
      }));

      // Notify parent component of selection
      if (onNodeSelect) {
        onNodeSelect({
          id: clickedNode.id,
          type: clickedNode.type,
          name: clickedNode.name,
          position: { x: clickedNode.x, y: clickedNode.y }
        });
      }
    } else {
      setState(prev => ({
        ...prev,
        selectedNode: null,
        draggedNode: null
      }));
    }
  }, [getCanvasCoordinates, getNodeAtPosition, onNodeSelect]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(event);
    
    setState(prev => ({ ...prev, mousePos: coords }));

    if (state.draggedNode) {
      setNodes(prevNodes => 
        prevNodes.map(node => 
          node.id === state.draggedNode
            ? {
                ...node,
                x: coords.x - state.dragOffset.x,
                y: coords.y - state.dragOffset.y
              }
            : node
        )
      );
    }
  }, [getCanvasCoordinates, state.draggedNode, state.dragOffset]);

  const handleMouseUp = useCallback(() => {
    setState(prev => ({
      ...prev,
      draggedNode: null
    }));
  }, []);

  // Enhanced drawNode with selection highlight
  const drawNode = useCallback((ctx: CanvasRenderingContext2D, node: CanvasNode) => {
    const isSelected = state.selectedNode === node.id;

    // Selection highlight
    if (isSelected) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(node.x - 2, node.y - 2, node.width + 4, node.height + 4, 10);
      ctx.stroke();
    }

    // Draw node (same as Stage 1)
    if (node.type === 'root') {
      const gradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + node.height);
      gradient.addColorStop(0, '#4f46e5');
      gradient.addColorStop(1, '#7c3aed');
      ctx.fillStyle = gradient;
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
    } else {
      const gradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + node.height);
      gradient.addColorStop(0, '#059669');
      gradient.addColorStop(1, '#10b981');
      ctx.fillStyle = gradient;
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1;
    }

    const radius = node.type === 'root' ? 8 : 6;
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.width, node.height, radius);
    ctx.fill();
    ctx.stroke();

    // Draw text (same as Stage 1)
    ctx.fillStyle = 'white';
    ctx.font = node.type === 'root' ? 'bold 14px sans-serif' : 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.fillText(
      node.name, 
      node.x + node.width / 2, 
      node.y + node.height / 2 - 8
    );

    ctx.font = '11px sans-serif';
    ctx.globalAlpha = 0.9;
    const subtitle = node.type === 'root' ? 'ROOT ARCHITECTURE' : 'EXTERNAL MODULE';
    ctx.fillText(
      subtitle,
      node.x + node.width / 2,
      node.y + node.height / 2 + 8
    );
    ctx.globalAlpha = 1;
  }, [state.selectedNode]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#f9fafb',
          cursor: state.draggedNode ? 'grabbing' : 'default'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
};
```

### Success Criteria
- ✅ Clicking nodes selects them (yellow highlight border)
- ✅ Dragging nodes moves them smoothly
- ✅ Selection events trigger onNodeSelect callback
- ✅ Cursor changes during drag operations
- ✅ Connections update as nodes move

---

## Stage 3: Dynamic Data Integration
**Goal**: Connect to actual catalog data from the extension

### Data Structures to Support
First, define the interfaces we need:

```tsx
// Stage 3: Add interfaces and data integration
interface GraphNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  position: { x: number; y: number };
  data: {
    inputs?: Array<{ name: string; description?: string }>;
    outputs?: Array<{ name: string; description?: string }>;
    version?: string;
    description?: string;
  };
  expanded?: boolean;
}

interface GraphConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface GraphModel {
  nodes: GraphNode[];
  connections: GraphConnection[];
  selectedFlavor: string;
  products: any[];
  selectedProduct: string;
}

interface CanvasProps {
  graphModel?: GraphModel;
  onNodeSelect?: (node: any) => void;
}

export const Canvas: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  // Convert GraphModel to internal CanvasNode format
  const convertNodes = useCallback((graphNodes: GraphNode[]): CanvasNode[] => {
    return graphNodes.map(node => ({
      id: node.id,
      type: node.type,
      name: node.name,
      x: node.position.x,
      y: node.position.y,
      width: node.type === 'root' ? 200 : 150,
      height: node.type === 'root' ? 80 : 60,
      data: node.data
    }));
  }, []);

  const convertEdges = useCallback((connections: GraphConnection[]): CanvasEdge[] => {
    return connections.map(conn => ({
      id: conn.id,
      source: conn.source,
      target: conn.target
    }));
  }, []);

  // Initialize nodes and edges from graphModel or fallback to demo data
  const [nodes, setNodes] = React.useState<CanvasNode[]>(() => {
    if (graphModel?.nodes?.length) {
      return convertNodes(graphModel.nodes);
    }
    return initialNodes;
  });

  const [edges, setEdges] = React.useState<CanvasEdge[]>(() => {
    if (graphModel?.connections?.length) {
      return convertEdges(graphModel.connections);
    }
    return initialEdges;
  });

  // Update nodes when graphModel changes
  useEffect(() => {
    if (graphModel?.nodes?.length) {
      setNodes(convertNodes(graphModel.nodes));
    }
  }, [graphModel?.nodes, convertNodes]);

  // Update edges when graphModel changes
  useEffect(() => {
    if (graphModel?.connections?.length) {
      setEdges(convertEdges(graphModel.connections));
    }
  }, [graphModel?.connections, convertEdges]);

  // Rest of component implementation same as Stage 2...
};
```

### Success Criteria
- ✅ Nodes populate from actual catalog data when available
- ✅ Falls back to demo data when graphModel is empty
- ✅ Node names come from catalog structure
- ✅ Edges connect based on dependencies
- ✅ Handles empty/missing data gracefully

---

## Stage 4: Input/Output Connection Points
**Goal**: Add visual input/output ports to nodes for precise connections

### What to Implement
Add port rendering and connection logic:

```tsx
// Stage 4: Enhanced nodes with input/output ports
interface NodePort {
  id: string;
  name: string;
  type: 'input' | 'output';
  x: number;
  y: number;
  description?: string;
}

interface EnhancedCanvasNode extends CanvasNode {
  ports: NodePort[];
}

const calculateNodePorts = (node: CanvasNode): NodePort[] => {
  const ports: NodePort[] = [];
  const inputs = node.data?.inputs || [];
  const outputs = node.data?.outputs || [];

  // Input ports (left side)
  inputs.forEach((input, index) => {
    ports.push({
      id: `${node.id}-input-${index}`,
      name: input.name,
      type: 'input',
      x: node.x - 6, // Slightly outside node
      y: node.y + 20 + (index * 15),
      description: input.description
    });
  });

  // Output ports (right side)
  outputs.forEach((output, index) => {
    ports.push({
      id: `${node.id}-output-${index}`,
      name: output.name,
      type: 'output',
      x: node.x + node.width + 6,
      y: node.y + 20 + (index * 15),
      description: output.description
    });
  });

  return ports;
};

const drawNodePorts = (ctx: CanvasRenderingContext2D, node: EnhancedCanvasNode) => {
  node.ports.forEach(port => {
    // Port circle
    ctx.beginPath();
    ctx.arc(port.x, port.y, 4, 0, 2 * Math.PI);
    
    if (port.type === 'input') {
      ctx.fillStyle = '#10b981'; // Green for inputs
    } else {
      ctx.fillStyle = '#f59e0b'; // Orange for outputs
    }
    
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
};

// Enhanced edge drawing with port connections
const drawEdgeWithPorts = (
  ctx: CanvasRenderingContext2D, 
  edge: CanvasEdge, 
  nodes: EnhancedCanvasNode[]
) => {
  const sourceNode = nodes.find(n => n.id === edge.source);
  const targetNode = nodes.find(n => n.id === edge.target);
  
  if (!sourceNode || !targetNode) return;

  // Find actual port positions if specified
  let startX = sourceNode.x + sourceNode.width;
  let startY = sourceNode.y + sourceNode.height / 2;
  let endX = targetNode.x;
  let endY = targetNode.y + targetNode.height / 2;

  // Use specific port positions if available
  const sourcePort = sourceNode.ports.find(p => p.type === 'output');
  const targetPort = targetNode.ports.find(p => p.type === 'input');

  if (sourcePort) {
    startX = sourcePort.x;
    startY = sourcePort.y;
  }
  if (targetPort) {
    endX = targetPort.x;
    endY = targetPort.y;
  }

  // Draw smooth curve (same as before)
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  
  const controlX1 = startX + (endX - startX) / 3;
  const controlX2 = startX + (2 * (endX - startX)) / 3;
  ctx.bezierCurveTo(controlX1, startY, controlX2, endY, endX, endY);
  ctx.stroke();

  // Draw arrowhead at target port
  const angle = Math.atan2(endY - startY, endX - startX);
  const arrowLength = 8;
  const arrowAngle = Math.PI / 6;

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - arrowLength * Math.cos(angle - arrowAngle),
    endY - arrowLength * Math.sin(angle - arrowAngle)
  );
  ctx.lineTo(
    endX - arrowLength * Math.cos(angle + arrowAngle),
    endY - arrowLength * Math.sin(angle + arrowAngle)
  );
  ctx.closePath();
  ctx.fillStyle = '#6366f1';
  ctx.fill();
};

// Enhanced render function
const render = useCallback(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  // Calculate ports for all nodes
  const enhancedNodes: EnhancedCanvasNode[] = nodes.map(node => ({
    ...node,
    ports: calculateNodePorts(node)
  }));

  // Draw edges with port connections
  edges.forEach(edge => drawEdgeWithPorts(ctx, edge, enhancedNodes));

  // Draw nodes and their ports
  enhancedNodes.forEach(node => {
    drawNode(ctx, node);
    drawNodePorts(ctx, node);
  });
}, [nodes, edges, drawNode, state.selectedNode]);
```

### Success Criteria
- ✅ Nodes show input ports on left (green circles)
- ✅ Nodes show output ports on right (orange circles)
- ✅ Ports connect to actual catalog input/output definitions
- ✅ Connections anchor to specific ports
- ✅ Port tooltips show on hover (implement in Stage 5)

---

## Stage 5: Connection Creation and Management
**Goal**: Enable creating/deleting connections by dragging between ports

### What to Implement
Add interactive connection creation:

```tsx
// Stage 5: Interactive connection management
interface ConnectionState {
  isCreating: boolean;
  sourcePort: NodePort | null;
  targetPort: NodePort | null;
  previewConnection: { startX: number; startY: number; endX: number; endY: number } | null;
}

export const Canvas: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  // Add connection state
  const [connectionState, setConnectionState] = React.useState<ConnectionState>({
    isCreating: false,
    sourcePort: null,
    targetPort: null,
    previewConnection: null
  });

  // Find port at position
  const getPortAtPosition = useCallback((x: number, y: number, nodes: EnhancedCanvasNode[]): NodePort | null => {
    for (const node of nodes) {
      for (const port of node.ports) {
        const distance = Math.sqrt(Math.pow(x - port.x, 2) + Math.pow(y - port.y, 2));
        if (distance <= 6) { // Port radius + tolerance
          return port;
        }
      }
    }
    return null;
  }, []);

  // Enhanced mouse down handler for ports
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(event);
    const enhancedNodes: EnhancedCanvasNode[] = nodes.map(node => ({
      ...node,
      ports: calculateNodePorts(node)
    }));

    // Check if clicking on a port
    const clickedPort = getPortAtPosition(coords.x, coords.y, enhancedNodes);
    
    if (clickedPort && clickedPort.type === 'output') {
      // Start connection creation from output port
      setConnectionState({
        isCreating: true,
        sourcePort: clickedPort,
        targetPort: null,
        previewConnection: {
          startX: clickedPort.x,
          startY: clickedPort.y,
          endX: coords.x,
          endY: coords.y
        }
      });
      return;
    }

    // Regular node selection logic (same as Stage 2)
    const clickedNode = getNodeAtPosition(coords.x, coords.y);
    if (clickedNode) {
      setState(prev => ({
        ...prev,
        selectedNode: clickedNode.id,
        draggedNode: clickedNode.id,
        dragOffset: {
          x: coords.x - clickedNode.x,
          y: coords.y - clickedNode.y
        }
      }));

      if (onNodeSelect) {
        onNodeSelect({
          id: clickedNode.id,
          type: clickedNode.type,
          name: clickedNode.name,
          position: { x: clickedNode.x, y: clickedNode.y }
        });
      }
    }
  }, [getCanvasCoordinates, getNodeAtPosition, getPortAtPosition, nodes, onNodeSelect]);

  // Enhanced mouse move for connection preview
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(event);
    
    if (connectionState.isCreating && connectionState.sourcePort) {
      // Update preview connection
      setConnectionState(prev => ({
        ...prev,
        previewConnection: {
          startX: prev.sourcePort!.x,
          startY: prev.sourcePort!.y,
          endX: coords.x,
          endY: coords.y
        }
      }));
    } else if (state.draggedNode) {
      // Node dragging logic (same as Stage 2)
      setNodes(prevNodes => 
        prevNodes.map(node => 
          node.id === state.draggedNode
            ? {
                ...node,
                x: coords.x - state.dragOffset.x,
                y: coords.y - state.dragOffset.y
              }
            : node
        )
      );
    }
  }, [getCanvasCoordinates, connectionState, state]);

  // Enhanced mouse up for connection completion
  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (connectionState.isCreating) {
      const coords = getCanvasCoordinates(event);
      const enhancedNodes: EnhancedCanvasNode[] = nodes.map(node => ({
        ...node,
        ports: calculateNodePorts(node)
      }));

      const targetPort = getPortAtPosition(coords.x, coords.y, enhancedNodes);
      
      if (targetPort && 
          targetPort.type === 'input' && 
          connectionState.sourcePort &&
          !targetPort.id.startsWith(connectionState.sourcePort.id.split('-')[0])) { // Prevent self-connection
        
        // Create new edge
        const newEdge: CanvasEdge = {
          id: `${connectionState.sourcePort.id}-${targetPort.id}`,
          source: connectionState.sourcePort.id.split('-')[0],
          target: targetPort.id.split('-')[0]
        };

        setEdges(prev => [...prev, newEdge]);
        console.log('Created connection:', newEdge);
      }
      
      // Reset connection state
      setConnectionState({
        isCreating: false,
        sourcePort: null,
        targetPort: null,
        previewConnection: null
      });
    }

    // Reset drag state
    setState(prev => ({ ...prev, draggedNode: null }));
  }, [connectionState, getCanvasCoordinates, getPortAtPosition, nodes]);

  // Draw preview connection
  const drawPreviewConnection = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!connectionState.previewConnection) return;

    const { startX, startY, endX, endY } = connectionState.previewConnection;

    ctx.strokeStyle = '#94a3b8'; // Gray for preview
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); // Dashed line
    
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    
    const controlX1 = startX + (endX - startX) / 3;
    const controlX2 = startX + (2 * (endX - startX)) / 3;
    ctx.bezierCurveTo(controlX1, startY, controlX2, endY, endX, endY);
    ctx.stroke();
    
    ctx.setLineDash([]); // Reset dash
  }, [connectionState.previewConnection]);

  // Enhanced render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const enhancedNodes: EnhancedCanvasNode[] = nodes.map(node => ({
      ...node,
      ports: calculateNodePorts(node)
    }));

    // Draw existing edges
    edges.forEach(edge => drawEdgeWithPorts(ctx, edge, enhancedNodes));

    // Draw preview connection
    drawPreviewConnection(ctx);

    // Draw nodes and ports
    enhancedNodes.forEach(node => {
      drawNode(ctx, node);
      drawNodePorts(ctx, node);
    });
  }, [nodes, edges, drawNode, drawPreviewConnection, state.selectedNode]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#f9fafb',
          cursor: connectionState.isCreating ? 'crosshair' : 
                  state.draggedNode ? 'grabbing' : 'default'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
};
```

### Success Criteria
- ✅ Dragging from output port shows preview connection
- ✅ Dropping on valid input port creates edge
- ✅ Invalid connections are rejected (same node, wrong port types)
- ✅ Preview connection follows mouse cursor
- ✅ Console logging shows connection events

---

## Stage 6: Canvas Controls and Navigation
**Goal**: Add zoom, pan, fit-to-view, and minimap functionality

### What to Implement
Add canvas transformation and navigation controls:

```tsx
// Stage 6: Canvas controls and navigation
interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  isPanning: boolean;
  panStart: { x: number; y: number };
}

export const Canvas: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  // Add viewport state
  const [viewport, setViewport] = React.useState<ViewportState>({
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStart: { x: 0, y: 0 }
  });

  // Transform screen coordinates to world coordinates
  const screenToWorld = useCallback((screenX: number, screenY: number) => {
    return {
      x: (screenX - viewport.panX) / viewport.zoom,
      y: (screenY - viewport.panY) / viewport.zoom
    };
  }, [viewport]);

  // Transform world coordinates to screen coordinates
  const worldToScreen = useCallback((worldX: number, worldY: number) => {
    return {
      x: worldX * viewport.zoom + viewport.panX,
      y: worldY * viewport.zoom + viewport.panY
    };
  }, [viewport]);

  // Enhanced coordinate calculation with viewport transform
  const getCanvasCoordinates = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    return screenToWorld(screenX, screenY);
  }, [screenToWorld]);

  // Handle mouse wheel for zoom
  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    const worldPos = screenToWorld(mouseX, mouseY);
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(3, viewport.zoom * zoomFactor));
    
    const newScreenPos = worldToScreen(worldPos.x, worldPos.y);
    const deltaX = mouseX - newScreenPos.x;
    const deltaY = mouseY - newScreenPos.y;
    
    setViewport(prev => ({
      ...prev,
      zoom: newZoom,
      panX: prev.panX + deltaX,
      panY: prev.panY + deltaY
    }));
  }, [viewport, screenToWorld, worldToScreen]);

  // Enhanced mouse handlers with panning
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (event.button === 1 || (event.button === 0 && event.ctrlKey)) {
      // Middle click or Ctrl+click for panning
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      setViewport(prev => ({
        ...prev,
        isPanning: true,
        panStart: {
          x: event.clientX - rect.left - prev.panX,
          y: event.clientY - rect.top - prev.panY
        }
      }));
      return;
    }

    // Regular interaction logic (same as Stage 5)
    const coords = getCanvasCoordinates(event);
    // ... rest of existing mouse down logic
  }, [getCanvasCoordinates]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (viewport.isPanning) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      setViewport(prev => ({
        ...prev,
        panX: event.clientX - rect.left - prev.panStart.x,
        panY: event.clientY - rect.top - prev.panStart.y
      }));
      return;
    }

    // Regular interaction logic (same as Stage 5)
    // ... existing mouse move logic
  }, [viewport.isPanning]);

  const handleMouseUp = useCallback(() => {
    setViewport(prev => ({ ...prev, isPanning: false }));
    // ... existing mouse up logic
  }, []);

  // Fit to view function
  const fitToView = useCallback(() => {
    if (nodes.length === 0) return;

    const padding = 50;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    nodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });

    const canvas = canvasRef.current;
    if (!canvas) return;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;

    const scaleX = (canvasWidth - 2 * padding) / contentWidth;
    const scaleY = (canvasHeight - 2 * padding) / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const panX = canvasWidth / 2 - centerX * scale;
    const panY = canvasHeight / 2 - centerY * scale;

    setViewport(prev => ({
      ...prev,
      zoom: scale,
      panX,
      panY
    }));
  }, [nodes]);

  // Enhanced render with viewport transforms
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Apply viewport transformation
    ctx.save();
    ctx.translate(viewport.panX, viewport.panY);
    ctx.scale(viewport.zoom, viewport.zoom);

    const enhancedNodes: EnhancedCanvasNode[] = nodes.map(node => ({
      ...node,
      ports: calculateNodePorts(node)
    }));

    // Draw all content (same as Stage 5)
    edges.forEach(edge => drawEdgeWithPorts(ctx, edge, enhancedNodes));
    drawPreviewConnection(ctx);
    enhancedNodes.forEach(node => {
      drawNode(ctx, node);
      drawNodePorts(ctx, node);
    });

    ctx.restore();
  }, [nodes, edges, viewport, drawNode, drawPreviewConnection]);

  // Control buttons component
  const ControlsPanel = () => (
    <div style={{
      position: 'absolute',
      bottom: '20px',
      left: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      background: 'white',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      padding: '8px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      <button
        onClick={() => setViewport(prev => ({ ...prev, zoom: Math.min(3, prev.zoom * 1.2) }))}
        style={{ padding: '4px 8px', fontSize: '16px' }}
      >
        +
      </button>
      <button
        onClick={() => setViewport(prev => ({ ...prev, zoom: Math.max(0.1, prev.zoom * 0.8) }))}
        style={{ padding: '4px 8px', fontSize: '16px' }}
      >
        −
      </button>
      <button
        onClick={fitToView}
        style={{ padding: '4px 8px', fontSize: '10px' }}
      >
        Fit
      </button>
    </div>
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#f9fafb',
          cursor: viewport.isPanning ? 'grabbing' :
                  connectionState.isCreating ? 'crosshair' : 
                  state.draggedNode ? 'grabbing' : 'default'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      <ControlsPanel />
    </div>
  );
};
```

### Success Criteria
- ✅ Mouse wheel zooms in/out centered on cursor
- ✅ Middle-click or Ctrl+click enables panning
- ✅ Zoom controls in bottom-left corner work
- ✅ Fit to view centers and scales all nodes appropriately
- ✅ All interactions work correctly at different zoom levels

---

## Stage 7: Advanced Features and Polish
**Goal**: Add expand/collapse, keyboard shortcuts, and professional styling

### What to Implement
Add final polish and advanced features:

```tsx
// Stage 7: Advanced features and professional polish
interface AdvancedCanvasNode extends EnhancedCanvasNode {
  expanded: boolean;
  collapsedPorts?: NodePort[];
  fullPorts?: NodePort[];
}

export const Canvas: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  // Add keyboard handling
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Delete':
        case 'Backspace':
          if (state.selectedNode) {
            // Remove selected node and its connections
            setNodes(prev => prev.filter(n => n.id !== state.selectedNode));
            setEdges(prev => prev.filter(e => 
              e.source !== state.selectedNode && e.target !== state.selectedNode
            ));
            setState(prev => ({ ...prev, selectedNode: null }));
          }
          break;
        case 'f':
        case 'F':
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            fitToView();
          }
          break;
        case '0':
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            setViewport(prev => ({ ...prev, zoom: 1, panX: 0, panY: 0 }));
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.selectedNode, fitToView]);

  // Enhanced node rendering with expand/collapse
  const drawAdvancedNode = useCallback((ctx: CanvasRenderingContext2D, node: AdvancedCanvasNode) => {
    const isSelected = state.selectedNode === node.id;

    // Selection highlight
    if (isSelected) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(node.x - 2, node.y - 2, node.width + 4, node.height + 4, 10);
      ctx.stroke();
    }

    // Node background with enhanced styling
    if (node.type === 'root') {
      const gradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + node.height);
      gradient.addColorStop(0, '#4f46e5');
      gradient.addColorStop(1, '#7c3aed');
      ctx.fillStyle = gradient;
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
    } else {
      const gradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + node.height);
      gradient.addColorStop(0, '#059669');
      gradient.addColorStop(1, '#10b981');
      ctx.fillStyle = gradient;
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1;
    }

    const radius = node.type === 'root' ? 8 : 6;
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.width, node.height, radius);
    ctx.fill();
    ctx.stroke();

    // Expand/collapse button
    if ((node.data?.inputs?.length || 0) > 2 || (node.data?.outputs?.length || 0) > 2) {
      const buttonSize = 16;
      const buttonX = node.x + node.width - buttonSize - 4;
      const buttonY = node.y + 4;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.beginPath();
      ctx.roundRect(buttonX, buttonY, buttonSize, buttonSize, 3);
      ctx.fill();

      ctx.fillStyle = 'white';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        node.expanded ? '−' : '+',
        buttonX + buttonSize / 2,
        buttonY + buttonSize / 2
      );
    }

    // Node text with version info
    ctx.fillStyle = 'white';
    ctx.font = node.type === 'root' ? 'bold 14px sans-serif' : 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.fillText(
      node.name.length > 20 ? node.name.substring(0, 17) + '...' : node.name,
      node.x + node.width / 2,
      node.y + node.height / 2 - 12
    );

    // Subtitle
    ctx.font = '11px sans-serif';
    ctx.globalAlpha = 0.9;
    const subtitle = node.type === 'root' ? 'ROOT ARCHITECTURE' : 'EXTERNAL MODULE';
    ctx.fillText(
      subtitle,
      node.x + node.width / 2,
      node.y + node.height / 2 + 2
    );

    // Version and port count
    if (node.data?.version || node.ports.length > 0) {
      ctx.font = '9px sans-serif';
      ctx.globalAlpha = 0.7;
      const info = [
        node.data?.version ? `v${node.data.version}` : '',
        node.ports.length > 0 ? `${node.ports.filter(p => p.type === 'input').length}→${node.ports.filter(p => p.type === 'output').length}` : ''
      ].filter(Boolean).join(' • ');
      
      if (info) {
        ctx.fillText(info, node.x + node.width / 2, node.y + node.height / 2 + 14);
      }
    }
    
    ctx.globalAlpha = 1;
  }, [state.selectedNode]);

  // Enhanced port calculation with expand/collapse
  const calculateAdvancedPorts = (node: CanvasNode): NodePort[] => {
    const inputs = node.data?.inputs || [];
    const outputs = node.data?.outputs || [];
    const expanded = (node as any).expanded ?? false;
    
    // Show limited ports when collapsed
    const visibleInputs = expanded ? inputs : inputs.slice(0, 2);
    const visibleOutputs = expanded ? outputs : outputs.slice(0, 2);
    
    const ports: NodePort[] = [];

    visibleInputs.forEach((input, index) => {
      ports.push({
        id: `${node.id}-input-${index}`,
        name: input.name,
        type: 'input',
        x: node.x - 6,
        y: node.y + 25 + (index * 12),
        description: input.description
      });
    });

    visibleOutputs.forEach((output, index) => {
      ports.push({
        id: `${node.id}-output-${index}`,
        name: output.name,
        type: 'output',
        x: node.x + node.width + 6,
        y: node.y + 25 + (index * 12),
        description: output.description
      });
    });

    return ports;
  };

  // Handle expand/collapse clicks
  const handleExpandCollapse = useCallback((nodeId: string) => {
    setNodes(prev => prev.map(node => 
      node.id === nodeId 
        ? { ...node, expanded: !(node as any).expanded } as CanvasNode
        : node
    ));
  }, []);

  // Enhanced mouse down with expand/collapse detection
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(event);
    
    // Check for expand/collapse button clicks
    for (const node of nodes) {
      if ((node.data?.inputs?.length || 0) > 2 || (node.data?.outputs?.length || 0) > 2) {
        const buttonX = node.x + node.width - 20;
        const buttonY = node.y + 4;
        
        if (coords.x >= buttonX && coords.x <= buttonX + 16 &&
            coords.y >= buttonY && coords.y <= buttonY + 16) {
          handleExpandCollapse(node.id);
          return;
        }
      }
    }

    // Regular interaction logic (same as Stage 6)
    // ... existing mouse down logic
  }, [getCanvasCoordinates, nodes, handleExpandCollapse]);

  // Add minimap
  const MiniMap = () => (
    <div style={{
      position: 'absolute',
      bottom: '20px',
      right: '20px',
      width: '200px',
      height: '150px',
      background: 'white',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      overflow: 'hidden',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      <canvas
        width={200}
        height={150}
        style={{ width: '100%', height: '100%' }}
        ref={minimapCanvasRef}
      />
    </div>
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%)',
          cursor: viewport.isPanning ? 'grabbing' :
                  connectionState.isCreating ? 'crosshair' : 
                  state.draggedNode ? 'grabbing' : 'default'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      <ControlsPanel />
      <MiniMap />
      
      {/* Status bar */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(255, 255, 255, 0.9)',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        color: '#6b7280'
      }}>
        Zoom: {Math.round(viewport.zoom * 100)}% | Nodes: {nodes.length} | Connections: {edges.length}
      </div>
    </div>
  );
};
```

### Success Criteria
- ✅ Nodes can expand/collapse to show all vs limited ports
- ✅ Minimap shows overview in bottom-right corner
- ✅ Keyboard shortcuts work (Delete, Cmd/Ctrl+F, Cmd/Ctrl+0)
- ✅ Status bar shows zoom level and graph statistics
- ✅ Professional gradient background and enhanced styling
- ✅ Smooth animations and polished interactions

---

## Build and Testing Instructions

### After Each Stage
1. **Build the webview bundle**:
   ```bash
   npm run build
   ```

2. **Test in VS Code**:
   - Open VS Code with the extension loaded
   - Navigate to an `ibm_catalog.json` file
   - Right-click → "Open With..." → "IBM Catalog Visual Editor"
   - Verify the stage's success criteria

3. **Debug Issues**:
   - Open VS Code Developer Tools (Help → Toggle Developer Tools)
   - Check Console tab for JavaScript errors
   - Check Network tab to ensure `visual-editor-react.js` loads
   - Use Elements tab to inspect the webview DOM

### Performance Optimization

For large graphs (100+ nodes), consider these optimizations:

```tsx
// Viewport culling - only render visible nodes
const getVisibleNodes = useCallback((nodes: CanvasNode[], viewport: ViewportState, canvasSize: { width: number; height: number }) => {
  const worldBounds = {
    left: -viewport.panX / viewport.zoom,
    top: -viewport.panY / viewport.zoom,
    right: (-viewport.panX + canvasSize.width) / viewport.zoom,
    bottom: (-viewport.panY + canvasSize.height) / viewport.zoom
  };

  return nodes.filter(node => 
    node.x + node.width >= worldBounds.left &&
    node.x <= worldBounds.right &&
    node.y + node.height >= worldBounds.top &&
    node.y <= worldBounds.bottom
  );
}, []);

// Throttled rendering for smooth interactions
const throttledRender = useCallback(
  throttle(() => render(), 16), // 60fps
  [render]
);
```

## Integration with Existing Extension

### Message Passing
The canvas communicates with the extension through VS Code's webview message API:

```tsx
// Send node selection to extension
const notifyNodeSelection = useCallback((node: CanvasNode) => {
  if (vscode) {
    vscode.postMessage({
      type: 'nodeSelected',
      payload: {
        id: node.id,
        type: node.type,
        name: node.name,
        position: { x: node.x, y: node.y },
        data: node.data
      }
    });
  }
}, []);

// Listen for messages from extension
useEffect(() => {
  const handleMessage = (event: MessageEvent) => {
    const { type, payload } = event.data;
    
    switch (type) {
      case 'updateGraphModel':
        // Update canvas with new data from extension
        break;
      case 'selectNode':
        // Programmatically select a node
        break;
    }
  };

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, []);
```

## Conclusion

This custom Canvas approach provides the same visual editor functionality as ReactFlow but with full compatibility with VS Code webviews. The implementation is:

- **Compatible**: Works reliably in VS Code webview environment
- **Performant**: Optimized for large graphs with viewport culling
- **Feature-Complete**: Includes all interactive features (drag, zoom, connections)
- **Professional**: Polished UI matching VS Code design patterns
- **Maintainable**: Clear separation of concerns and well-documented code

Each stage builds incrementally, ensuring you always have a working solution while adding new capabilities.