import React, { useRef, useEffect, useCallback } from 'react';

interface NodePort {
  id: string;
  name: string;
  type: 'input' | 'output';
  x: number;
  y: number;
  description?: string;
}

interface CanvasNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: {
    inputs?: Array<{ name: string; description?: string }>;
    outputs?: Array<{ name: string; description?: string }>;
    version?: string;
    description?: string;
  };
  ports?: NodePort[];
  expanded?: boolean;
}

interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string; // Specific port ID
  targetHandle?: string; // Specific port ID
}

interface ConnectionState {
  isCreating: boolean;
  sourcePort: NodePort | null;
  targetPort: NodePort | null;
  previewConnection: { startX: number; startY: number; endX: number; endY: number } | null;
}

type InteractionMode = 'select' | 'move' | 'lock';

interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  isPanning: boolean;
  panStart: { x: number; y: number };
}

interface CanvasState {
  selectedNode: string | null;
  draggedNode: string | null;
  dragOffset: { x: number; y: number };
  mousePos: { x: number; y: number };
}

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

const initialNodes: CanvasNode[] = [
  {
    id: 'root-1',
    type: 'root',
    name: 'Cloud Automation for Secrets Manager',
    x: 100,
    y: 100,
    width: 200,
    height: 80,
    data: {
      inputs: [
        { name: 'region', description: 'Target region for deployment' },
        { name: 'resource_group', description: 'Resource group ID' }
      ],
      outputs: [
        { name: 'vpc_id', description: 'VPC identifier' },
        { name: 'security_group_id', description: 'Security group identifier' }
      ]
    }
  },
  {
    id: 'dep-1',
    type: 'dependency',
    name: 'VPC Module',
    x: 400,
    y: 50,
    width: 150,
    height: 60,
    data: {
      version: '1.0.0',
      inputs: [
        { name: 'region', description: 'AWS region' }
      ],
      outputs: [
        { name: 'vpc_id', description: 'VPC ID' },
        { name: 'subnet_ids', description: 'Subnet IDs' }
      ]
    }
  },
  {
    id: 'dep-2',
    type: 'dependency',
    name: 'Security Group Module',
    x: 400,
    y: 150,
    width: 150,
    height: 60,
    data: {
      version: '2.1.0',
      inputs: [
        { name: 'vpc_id', description: 'VPC identifier' }
      ],
      outputs: [
        { name: 'security_group_id', description: 'Security group ID' }
      ]
    }
  }
];

const initialEdges: CanvasEdge[] = [
  { id: 'root-dep1', source: 'root-1', target: 'dep-1' },
  { id: 'root-dep2', source: 'root-1', target: 'dep-2' }
];

export const Canvas: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Initialize nodes with calculated ports
  const [nodes, setNodes] = React.useState<CanvasNode[]>(() => {
    return initialNodes.map(node => ({
      ...node,
      ports: []
    }));
  });
  
  const [edges, setEdges] = React.useState<CanvasEdge[]>(initialEdges);
  const [state, setState] = React.useState<CanvasState>({
    selectedNode: null,
    draggedNode: null,
    dragOffset: { x: 0, y: 0 },
    mousePos: { x: 0, y: 0 }
  });

  // Add connection state
  const [connectionState, setConnectionState] = React.useState<ConnectionState>({
    isCreating: false,
    sourcePort: null,
    targetPort: null,
    previewConnection: null
  });

  // Add viewport state
  const [viewport, setViewport] = React.useState<ViewportState>({
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStart: { x: 0, y: 0 }
  });

  // Add interaction mode state
  const [interactionMode, setInteractionMode] = React.useState<InteractionMode>('select');

  // Handle keyboard shortcuts for mode switching and editor actions
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle keys when canvas is focused or no input is focused
      if (document.activeElement?.tagName === 'INPUT' || 
          document.activeElement?.tagName === 'TEXTAREA' ||
          document.activeElement?.tagName === 'SELECT') {
        return;
      }

      switch (event.key.toLowerCase()) {
        // Interaction mode switching
        case 'm':
          event.preventDefault();
          setInteractionMode('move');
          break;
        case 'l':
          event.preventDefault();
          setInteractionMode('lock');
          break;
        case 'escape':
          event.preventDefault();
          setInteractionMode('select');
          break;
        case 's':
          if (!event.ctrlKey && !event.metaKey) { // Avoid conflicts with Ctrl+S
            event.preventDefault();
            setInteractionMode('select');
          }
          break;
        
        // Node deletion
        case 'delete':
        case 'backspace':
          if (state.selectedNode) {
            event.preventDefault();
            // Remove selected node and its connections
            setNodes(prev => prev.filter(n => n.id !== state.selectedNode));
            setEdges(prev => prev.filter(e => 
              e.source !== state.selectedNode && e.target !== state.selectedNode
            ));
            setState(prev => ({ ...prev, selectedNode: null }));
            console.log('Deleted node:', state.selectedNode);
          }
          break;
        
        // Fit to view
        case 'f':
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            // Inline fit to view logic
            if (nodes.length === 0) break;

            const padding = 50;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            nodes.forEach(node => {
              minX = Math.min(minX, node.x);
              minY = Math.min(minY, node.y);
              maxX = Math.max(maxX, node.x + node.width);
              maxY = Math.max(maxY, node.y + node.height);
            });

            const canvas = canvasRef.current;
            if (!canvas) break;

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
          }
          break;
        
        // Reset zoom and pan
        case '0':
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            setViewport(prev => ({ 
              ...prev, 
              zoom: 1, 
              panX: 0, 
              panY: 0 
            }));
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.selectedNode, nodes]);

  // Calculate ports based on expansion state and connection status
  const calculateNodePorts = useCallback((node: CanvasNode, edges: CanvasEdge[]): NodePort[] => {
    const ports: NodePort[] = [];
    const inputs = node.data?.inputs || [];
    const outputs = node.data?.outputs || [];
    const expanded = node.expanded ?? false;

    // Find connected port indices
    const connectedInputs = new Set<number>();
    const connectedOutputs = new Set<number>();

    edges.forEach(edge => {
      if (edge.source === node.id && edge.sourceHandle) {
        // Extract port index from sourceHandle (format: nodeId-output-index)
        const match = edge.sourceHandle.match(/-output-(\d+)$/);
        if (match) {
          connectedOutputs.add(parseInt(match[1], 10));
        }
      }
      if (edge.target === node.id && edge.targetHandle) {
        // Extract port index from targetHandle (format: nodeId-input-index)
        const match = edge.targetHandle.match(/-input-(\d+)$/);
        if (match) {
          connectedInputs.add(parseInt(match[1], 10));
        }
      }
    });

    // Determine which ports to show
    let visibleInputs: Array<{ input: any; index: number }> = [];
    let visibleOutputs: Array<{ output: any; index: number }> = [];

    if (expanded) {
      // Show all ports when expanded
      visibleInputs = inputs.map((input, index) => ({ input, index }));
      visibleOutputs = outputs.map((output, index) => ({ output, index }));
    } else {
      // Show only connected ports when collapsed
      visibleInputs = inputs
        .map((input, index) => ({ input, index }))
        .filter(({ index }) => connectedInputs.has(index));
      visibleOutputs = outputs
        .map((output, index) => ({ output, index }))
        .filter(({ index }) => connectedOutputs.has(index));
    }

    // Create input ports (left side)
    visibleInputs.forEach(({ input, index }, displayIndex) => {
      ports.push({
        id: `${node.id}-input-${index}`,
        name: input.name,
        type: 'input',
        x: node.x - 6,
        y: node.y + 25 + (displayIndex * 15),
        description: input.description
      });
    });

    // Create output ports (right side)
    visibleOutputs.forEach(({ output, index }, displayIndex) => {
      ports.push({
        id: `${node.id}-output-${index}`,
        name: output.name,
        type: 'output',
        x: node.x + node.width + 6,
        y: node.y + 25 + (displayIndex * 15),
        description: output.description
      });
    });

    return ports;
  }, []);

  // Convert GraphModel to internal CanvasNode format
  const convertNodes = useCallback((graphNodes: GraphNode[]): CanvasNode[] => {
    return graphNodes.map(node => {
      const canvasNode: CanvasNode = {
        id: node.id,
        type: node.type,
        name: node.name,
        x: node.position.x,
        y: node.position.y,
        width: node.type === 'root' ? 200 : 150,
        height: node.type === 'root' ? 80 : 60,
        data: node.data
      };
      canvasNode.ports = calculateNodePorts(canvasNode, edges);
      return canvasNode;
    });
  }, [calculateNodePorts, edges]);

  const convertEdges = useCallback((connections: GraphConnection[]): CanvasEdge[] => {
    return connections.map(conn => ({
      id: conn.id,
      source: conn.source,
      target: conn.target
    }));
  }, []);

  // Update nodes when graphModel changes
  React.useEffect(() => {
    if (graphModel?.nodes?.length) {
      setNodes(convertNodes(graphModel.nodes));
    }
  }, [graphModel?.nodes, convertNodes]);

  // Update edges when graphModel changes
  React.useEffect(() => {
    if (graphModel?.connections?.length) {
      setEdges(convertEdges(graphModel.connections));
    }
  }, [graphModel?.connections, convertEdges]);

  // Calculate ports for initial nodes
  React.useEffect(() => {
    setNodes(prevNodes => 
      prevNodes.map(node => ({
        ...node,
        ports: calculateNodePorts(node, edges)
      }))
    );
  }, [calculateNodePorts, edges]);

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

  // Find port at position
  const getPortAtPosition = useCallback((x: number, y: number): NodePort | null => {
    for (const node of nodes) {
      if (!node.ports) continue;
      for (const port of node.ports) {
        const distance = Math.sqrt(Math.pow(x - port.x, 2) + Math.pow(y - port.y, 2));
        if (distance <= 6) { // Port radius + tolerance
          return port;
        }
      }
    }
    return null;
  }, [nodes]);

  // Validate connection between two ports
  const isValidConnection = useCallback((sourcePort: NodePort, targetPort: NodePort): boolean => {
    // Prevent self-connection (same node)
    if (sourcePort.id.split('-')[0] === targetPort.id.split('-')[0]) {
      return false;
    }

    // Valid connections: Output→Input, Input→Input
    // Invalid connections: Input→Output, Output→Output
    if (sourcePort.type === 'input' && targetPort.type === 'output') {
      return false; // Input→Output is invalid
    }
    if (sourcePort.type === 'output' && targetPort.type === 'output') {
      return false; // Output→Output is invalid
    }
    
    return true; // Output→Input and Input→Input are valid
  }, []);

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

  // Handle mouse wheel for zoom
  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    
    // Lock mode - disable zoom
    if (interactionMode === 'lock') {
      return;
    }
    
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
  }, [viewport, screenToWorld, worldToScreen, interactionMode]);

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

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    // Lock mode - disable all interactions
    if (interactionMode === 'lock') {
      return;
    }

    // Move mode - only allow panning
    if (interactionMode === 'move') {
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

    // Select mode - original behavior
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

    const coords = getCanvasCoordinates(event);
    
    // Check for expand/collapse button clicks first
    for (const node of nodes) {
      const totalInputs = node.data?.inputs?.length || 0;
      const totalOutputs = node.data?.outputs?.length || 0;
      const hasExpandableContent = totalInputs > 3 || totalOutputs > 3;
      
      if (hasExpandableContent) {
        const buttonSize = 20;
        const buttonX = node.x + node.width / 2 - buttonSize / 2;
        const buttonY = node.y + node.height - buttonSize - 4;
        
        const distance = Math.sqrt(
          Math.pow(coords.x - (buttonX + buttonSize / 2), 2) + 
          Math.pow(coords.y - (buttonY + buttonSize / 2), 2)
        );
        
        if (distance <= buttonSize / 2) {
          // Toggle expand/collapse
          setNodes(prevNodes => 
            prevNodes.map(n => 
              n.id === node.id 
                ? { ...n, expanded: !(n.expanded ?? false) }
                : n
            )
          );
          return;
        }
      }
    }
    
    // Check if clicking on a port
    const clickedPort = getPortAtPosition(coords.x, coords.y);
    
    if (clickedPort) {
      // Start connection creation from any port
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

    // Regular node selection logic
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
          position: { x: clickedNode.x, y: clickedNode.y },
          data: clickedNode.data || {}
        });
      }
    } else {
      setState(prev => ({
        ...prev,
        selectedNode: null,
        draggedNode: null
      }));
    }
  }, [interactionMode, getCanvasCoordinates, getPortAtPosition, getNodeAtPosition, onNodeSelect, nodes]);

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

    const coords = getCanvasCoordinates(event);
    
    setState(prev => ({ ...prev, mousePos: coords }));

    // Lock mode - disable all interactions
    if (interactionMode === 'lock') {
      return;
    }

    // Move mode - no node dragging or connection creation, only panning
    if (interactionMode === 'move') {
      return;
    }

    // Select mode - original behavior
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
      setNodes(prevNodes => 
        prevNodes.map(node => 
          node.id === state.draggedNode
            ? {
                ...node,
                x: coords.x - state.dragOffset.x,
                y: coords.y - state.dragOffset.y,
                ports: calculateNodePorts({
                  ...node,
                  x: coords.x - state.dragOffset.x,
                  y: coords.y - state.dragOffset.y
                }, edges)
              }
            : node
        )
      );
    }
  }, [viewport.isPanning, getCanvasCoordinates, connectionState, state.draggedNode, state.dragOffset, calculateNodePorts, interactionMode]);

  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    setViewport(prev => ({ ...prev, isPanning: false }));

    // Lock mode - disable all interactions
    if (interactionMode === 'lock') {
      return;
    }

    // Move mode - only panning allowed, no connections or node dragging
    if (interactionMode === 'move') {
      return;
    }

    // Select mode - original behavior
    if (connectionState.isCreating) {
      const coords = getCanvasCoordinates(event);
      const targetPort = getPortAtPosition(coords.x, coords.y);
      
      if (targetPort && 
          connectionState.sourcePort &&
          isValidConnection(connectionState.sourcePort, targetPort)) {
        
        // Create new edge with proper port handles
        const newEdge: CanvasEdge = {
          id: `${connectionState.sourcePort.id}-${targetPort.id}-${Date.now()}`,
          source: connectionState.sourcePort.id.split('-')[0],
          target: targetPort.id.split('-')[0],
          sourceHandle: connectionState.sourcePort.id,
          targetHandle: targetPort.id
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
  }, [connectionState, getCanvasCoordinates, getPortAtPosition, isValidConnection, interactionMode]);

  const drawNode = useCallback((ctx: CanvasRenderingContext2D, node: CanvasNode) => {
    const isSelected = state.selectedNode === node.id;
    const expanded = node.expanded ?? false;
    const totalInputs = node.data?.inputs?.length || 0;
    const totalOutputs = node.data?.outputs?.length || 0;
    const hasExpandableContent = totalInputs > 3 || totalOutputs > 3;

    // Selection highlight is now handled in the main node styling

    // Enhanced node styling with shadow and professional gradients
    if (node.type === 'root') {
      // Drop shadow for root nodes
      ctx.shadowColor = 'rgba(79, 70, 229, 0.3)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      
      const gradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + node.height);
      gradient.addColorStop(0, '#4f46e5');
      gradient.addColorStop(0.5, '#6366f1');
      gradient.addColorStop(1, '#7c3aed');
      ctx.fillStyle = gradient;
      ctx.strokeStyle = isSelected ? '#fbbf24' : '#6366f1';
      ctx.lineWidth = isSelected ? 3 : 2;
    } else {
      // Drop shadow for dependency nodes
      ctx.shadowColor = 'rgba(5, 150, 105, 0.2)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;
      
      const gradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + node.height);
      gradient.addColorStop(0, '#059669');
      gradient.addColorStop(0.5, '#10b981');
      gradient.addColorStop(1, '#34d399');
      ctx.fillStyle = gradient;
      ctx.strokeStyle = isSelected ? '#fbbf24' : '#34d399';
      ctx.lineWidth = isSelected ? 2 : 1;
    }

    // Draw rounded rectangle
    const radius = node.type === 'root' ? 8 : 6;
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.width, node.height, radius);
    ctx.fill();
    ctx.stroke();
    
    // Clear shadow for other elements
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Expand/collapse button (only if node has expandable content)
    if (hasExpandableContent) {
      const buttonSize = 20;
      const buttonX = node.x + node.width / 2 - buttonSize / 2;
      const buttonY = node.y + node.height - buttonSize - 4;

      // Button background - subtle circular background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.arc(buttonX + buttonSize / 2, buttonY + buttonSize / 2, buttonSize / 2, 0, 2 * Math.PI);
      ctx.fill();

      // Button border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Chevron arrow icon
      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      
      const centerX = buttonX + buttonSize / 2;
      const centerY = buttonY + buttonSize / 2;
      const arrowSize = 4;

      ctx.beginPath();
      if (expanded) {
        // Up chevron (▲) - node is expanded
        ctx.moveTo(centerX - arrowSize, centerY + 2);
        ctx.lineTo(centerX, centerY - 2);
        ctx.lineTo(centerX + arrowSize, centerY + 2);
      } else {
        // Down chevron (▼) - node is collapsed
        ctx.moveTo(centerX - arrowSize, centerY - 2);
        ctx.lineTo(centerX, centerY + 2);
        ctx.lineTo(centerX + arrowSize, centerY - 2);
      }
      ctx.stroke();
    }

    // Draw node text
    ctx.fillStyle = 'white';
    ctx.font = node.type === 'root' ? 'bold 14px sans-serif' : 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Main label (truncate if too long)
    const maxNameLength = hasExpandableContent ? 15 : 18; // Less space if expand button present
    const displayName = node.name.length > maxNameLength ? 
      node.name.substring(0, maxNameLength - 3) + '...' : 
      node.name;
    
    ctx.fillText(
      displayName, 
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
    
    // Version and port count info
    ctx.font = '9px sans-serif';
    ctx.globalAlpha = 0.7;
    const infoItems = [];
    
    if (node.data?.version) {
      infoItems.push(`v${node.data.version}`);
    }
    
    if (totalInputs > 0 || totalOutputs > 0) {
      infoItems.push(`${totalInputs}→${totalOutputs}`);
    }
    
    if (infoItems.length > 0) {
      ctx.fillText(
        infoItems.join(' • '),
        node.x + node.width / 2,
        node.y + node.height / 2 + 14
      );
    }
    
    ctx.globalAlpha = 1;
  }, [state.selectedNode]);

  const drawNodePorts = useCallback((ctx: CanvasRenderingContext2D, node: CanvasNode) => {
    if (!node.ports) return;

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
  }, []);

  // Draw preview connection
  const drawPreviewConnection = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!connectionState.previewConnection) return;

    const { startX, startY, endX, endY } = connectionState.previewConnection;

    // Check if we're hovering over a valid target port
    const targetPort = getPortAtPosition(endX, endY);
    const isValidTarget = targetPort && connectionState.sourcePort && 
                         isValidConnection(connectionState.sourcePort, targetPort);

    ctx.strokeStyle = isValidTarget ? '#10b981' : '#94a3b8'; // Green if valid, gray if invalid
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); // Dashed line for preview
    
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    
    const controlX1 = startX + (endX - startX) / 3;
    const controlX2 = startX + (2 * (endX - startX)) / 3;
    ctx.bezierCurveTo(controlX1, startY, controlX2, endY, endX, endY);
    ctx.stroke();
    
    ctx.setLineDash([]); // Reset dash
  }, [connectionState.previewConnection, getPortAtPosition, connectionState.sourcePort, isValidConnection]);

  const drawEdgeWithPorts = useCallback((ctx: CanvasRenderingContext2D, edge: CanvasEdge, nodes: CanvasNode[]) => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    
    if (!sourceNode || !targetNode) return;

    // Find actual port positions if available
    let startX = sourceNode.x + sourceNode.width;
    let startY = sourceNode.y + sourceNode.height / 2;
    let endX = targetNode.x;
    let endY = targetNode.y + targetNode.height / 2;

    // Use specific port positions if available
    const sourcePort = sourceNode.ports?.find(p => p.type === 'output');
    const targetPort = targetNode.ports?.find(p => p.type === 'input');

    if (sourcePort) {
      startX = sourcePort.x;
      startY = sourcePort.y;
    }
    if (targetPort) {
      endX = targetPort.x;
      endY = targetPort.y;
    }

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
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get device pixel ratio for high-DPI displays
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Get the display size (CSS size)
    const rect = canvas.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;

    // Set the actual canvas size (physical pixels)
    canvas.width = displayWidth * pixelRatio;
    canvas.height = displayHeight * pixelRatio;

    // Scale the canvas back down using CSS
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    // Scale the drawing context so everything draws at the correct size
    ctx.scale(pixelRatio, pixelRatio);

    // Clear canvas
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // Apply viewport transformation
    ctx.save();
    ctx.translate(viewport.panX, viewport.panY);
    ctx.scale(viewport.zoom, viewport.zoom);

    // Draw edges first (behind nodes)
    edges.forEach(edge => drawEdgeWithPorts(ctx, edge, nodes));

    // Draw preview connection
    drawPreviewConnection(ctx);

    // Draw nodes and their ports (recalculate ports with current edges)
    nodes.forEach(node => {
      // Recalculate ports with current edges for accurate display
      const nodeWithPorts = {
        ...node,
        ports: calculateNodePorts(node, edges)
      };
      drawNode(ctx, nodeWithPorts);
      drawNodePorts(ctx, nodeWithPorts);
    });

    ctx.restore();
  }, [nodes, edges, drawNode, drawNodePorts, drawEdgeWithPorts, drawPreviewConnection, viewport]);

  useEffect(() => {
    render();
  }, [render]);

  // Handle canvas resize
  useEffect(() => {
    const handleResize = () => render();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  // Status bar component
  const StatusBar = () => (
    <div style={{
      position: 'absolute',
      top: '10px',
      left: '10px',
      display: 'flex',
      gap: '12px',
      background: 'rgba(255, 255, 255, 0.95)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(0, 0, 0, 0.1)',
      borderRadius: '8px',
      padding: '8px 12px',
      fontSize: '11px',
      color: '#64748b',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      userSelect: 'none'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: '#3b82f6' }}>🔍</span>
        <span>{Math.round(viewport.zoom * 100)}%</span>
      </div>
      <div style={{ width: '1px', height: '14px', background: '#e2e8f0' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: '#10b981' }}>📦</span>
        <span>{nodes.length} nodes</span>
      </div>
      <div style={{ width: '1px', height: '14px', background: '#e2e8f0' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: '#f59e0b' }}>🔗</span>
        <span>{edges.length} connections</span>
      </div>
      {state.selectedNode && (
        <>
          <div style={{ width: '1px', height: '14px', background: '#e2e8f0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: '#ef4444' }}>🎯</span>
            <span>{nodes.find(n => n.id === state.selectedNode)?.name || 'Selected'}</span>
          </div>
        </>
      )}
      <div style={{ width: '1px', height: '14px', background: '#e2e8f0' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ 
          color: interactionMode === 'select' ? '#3b82f6' : 
                interactionMode === 'move' ? '#10b981' : '#ef4444' 
        }}>
          {interactionMode === 'select' ? '🎯' : interactionMode === 'move' ? '✋' : '🔒'}
        </span>
        <span style={{ textTransform: 'capitalize' }}>{interactionMode}</span>
      </div>
    </div>
  );

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
      {/* Interaction Mode Controls */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        borderBottom: '1px solid #e5e7eb',
        paddingBottom: '8px',
        marginBottom: '4px'
      }}>
        <div style={{ fontSize: '10px', color: '#6b7280', textAlign: 'center', marginBottom: '2px' }}>
          Mode
        </div>
        <button
          onClick={() => setInteractionMode('select')}
          style={{
            padding: '4px 6px',
            fontSize: '11px',
            border: '1px solid #d1d5db',
            background: interactionMode === 'select' ? '#3b82f6' : 'white',
            color: interactionMode === 'select' ? 'white' : '#374151',
            borderRadius: '3px',
            cursor: 'pointer',
            fontWeight: interactionMode === 'select' ? 'bold' : 'normal'
          }}
          title="Select Mode (S or Esc) - Select and drag nodes, create connections"
        >
          🎯
        </button>
        <button
          onClick={() => setInteractionMode('move')}
          style={{
            padding: '4px 6px',
            fontSize: '11px',
            border: '1px solid #d1d5db',
            background: interactionMode === 'move' ? '#10b981' : 'white',
            color: interactionMode === 'move' ? 'white' : '#374151',
            borderRadius: '3px',
            cursor: 'pointer',
            fontWeight: interactionMode === 'move' ? 'bold' : 'normal'
          }}
          title="Move Mode (M) - Pan and zoom only, nodes locked"
        >
          ✋
        </button>
        <button
          onClick={() => setInteractionMode('lock')}
          style={{
            padding: '4px 6px',
            fontSize: '11px',
            border: '1px solid #d1d5db',
            background: interactionMode === 'lock' ? '#ef4444' : 'white',
            color: interactionMode === 'lock' ? 'white' : '#374151',
            borderRadius: '3px',
            cursor: 'pointer',
            fontWeight: interactionMode === 'lock' ? 'bold' : 'normal'
          }}
          title="Lock Mode (L) - All interactions disabled"
        >
          🔒
        </button>
      </div>

      {/* Zoom Controls */}
      <button
        onClick={() => setViewport(prev => ({ ...prev, zoom: Math.min(3, prev.zoom * 1.2) }))}
        style={{ 
          padding: '6px 8px', 
          fontSize: '16px', 
          border: '1px solid #d1d5db',
          background: 'white',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
        title="Zoom In"
      >
        +
      </button>
      <button
        onClick={() => setViewport(prev => ({ ...prev, zoom: Math.max(0.1, prev.zoom * 0.8) }))}
        style={{ 
          padding: '6px 8px', 
          fontSize: '16px',
          border: '1px solid #d1d5db',
          background: 'white',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
        title="Zoom Out"
      >
        −
      </button>
      <button
        onClick={fitToView}
        style={{ 
          padding: '4px 8px', 
          fontSize: '10px',
          border: '1px solid #d1d5db',
          background: 'white',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
        title="Fit to View"
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
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)',
          cursor: viewport.isPanning ? 'grabbing' :
                  connectionState.isCreating ? 'crosshair' : 
                  state.draggedNode ? 'grabbing' :
                  interactionMode === 'move' ? 'grab' :
                  interactionMode === 'lock' ? 'not-allowed' :
                  'default'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      <StatusBar />
      <ControlsPanel />
    </div>
  );
};