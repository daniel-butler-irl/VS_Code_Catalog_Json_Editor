import React, { useRef, useEffect, useCallback } from 'react';
import { LayoutService } from '../services/LayoutService';
import { CollisionDetectionService } from '../services/CollisionDetectionService';
import { PositionUtils } from '../utils/PositionUtils';
import { LayoutState, CanvasLayoutNode, CanvasLayoutEdge, CollisionState, CollisionOptions } from '../types/LayoutTypes';

interface NodePort {
  id: string;
  name: string;
  type: 'input' | 'output';
  x: number;
  y: number;
  description?: string;
  isConnected?: boolean;
}

interface CanvasNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: {
    inputs?: Array<{ name: string; display_name?: string; description?: string; defaultValue?: any }>;
    outputs?: Array<{ name: string; display_name?: string; description?: string; defaultValue?: any }>;
    version?: string;
    description?: string;
    flavor?: string;
    label?: string;
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
  dragStartPosition: { x: number; y: number } | null;
  mousePos: { x: number; y: number };
  hoveredPort: NodePort | null;
  showTooltip: boolean;
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

// Constants for node layout
const HEADER_HEIGHT = 60;
const BASE_CONTENT_HEIGHT = 30; // Minimum content area height
const PORT_SPACING = 15; // Height per port

// Calculate dynamic node height based on expansion state and actual visible ports
const calculateDynamicHeight = (node: CanvasNode, edges: CanvasEdge[], expanded: boolean = false): number => {
  const inputs = node.data?.inputs || [];
  const outputs = node.data?.outputs || [];
  
  // Replicate the exact connection detection logic from calculateNodePorts
  const connectedInputs = new Set<number>();
  const connectedOutputs = new Set<number>();

  edges.forEach(edge => {
    // Check for connections using sourceHandle/targetHandle if available
    if (edge.source === node.id && edge.sourceHandle) {
      const match = edge.sourceHandle.match(/-output-(\d+)$/);
      if (match) {
        connectedOutputs.add(parseInt(match[1], 10));
      }
    } else if (edge.source === node.id) {
      // For simple edges without handles, mark first output as connected
      if (outputs.length > 0) {
        connectedOutputs.add(0);
      }
    }
    
    if (edge.target === node.id && edge.targetHandle) {
      const match = edge.targetHandle.match(/-input-(\d+)$/);
      if (match) {
        connectedInputs.add(parseInt(match[1], 10));
      }
    } else if (edge.target === node.id) {
      // For simple edges without handles, mark first input as connected
      if (inputs.length > 0) {
        connectedInputs.add(0);
      }
    }
  });

  let visiblePortCount = 0;
  if (expanded) {
    // Show all ports when expanded
    visiblePortCount = Math.max(inputs.length, outputs.length);
  } else {
    // Show only connected ports when collapsed (exact same logic as calculateNodePorts)
    const visibleInputs = inputs.filter((_, index) => connectedInputs.has(index));
    const visibleOutputs = outputs.filter((_, index) => connectedOutputs.has(index));
    visiblePortCount = Math.max(visibleInputs.length, visibleOutputs.length);
  }
  
  const contentHeight = Math.max(BASE_CONTENT_HEIGHT, visiblePortCount * PORT_SPACING + 20);
  
  // Add space for expand/collapse button if node has expandable content
  const totalInputs = node.data?.inputs?.length || 0;
  const totalOutputs = node.data?.outputs?.length || 0;
  const hasExpandableContent = totalInputs > 3 || totalOutputs > 3;
  const buttonSpace = hasExpandableContent ? 36 : 8; // 20px button + 8px gap + 8px bottom margin, or just 8px margin
  
  return HEADER_HEIGHT + contentHeight + buttonSpace;
};

const initialNodes: CanvasNode[] = [
  {
    id: 'root-1',
    type: 'root',
    name: 'Cloud Automation for Secrets Manager',
    label: 'Secrets Manager Architecture',
    x: 100,
    y: 100,
    width: 240,
    height: 0, // Will be calculated dynamically
    data: {
      label: 'Secrets Manager Architecture',
      flavor: 'Standard Configuration',
      version: 'v1.2.3',
      inputs: [
        { name: 'region', display_name: 'Deploy Region', description: 'Target region for deployment', defaultValue: 'us-south' },
        { name: 'resource_group', display_name: 'Resource Group', description: 'Resource group ID' }
      ],
      outputs: [
        { name: 'vpc_id', display_name: 'VPC ID', description: 'VPC identifier' },
        { name: 'security_group_id', display_name: 'Security Group', description: 'Security group identifier' }
      ]
    }
  },
  {
    id: 'dep-1',
    type: 'dependency',
    name: 'VPC Module',
    label: 'IBM VPC Foundation',
    x: 450,
    y: 50,
    width: 240,
    height: 0, // Will be calculated dynamically
    data: {
      label: 'IBM VPC Foundation',
      flavor: 'Multi-zone',
      version: '>=1.0.0',
      inputs: [
        { name: 'region', display_name: 'Region', description: 'Target region', defaultValue: 'us-south' }
      ],
      outputs: [
        { name: 'vpc_id', display_name: 'VPC ID', description: 'VPC identifier' },
        { name: 'subnet_ids', display_name: 'Subnet IDs', description: 'List of subnet identifiers' }
      ]
    }
  },
  {
    id: 'dep-2',
    type: 'dependency',
    name: 'Security Group Module',
    label: 'Network Security Controls',
    x: 450,
    y: 150,
    width: 240,
    height: 0, // Will be calculated dynamically
    data: {
      label: 'Network Security Controls',
      flavor: 'Standard Rules',
      version: '~>2.1.0',
      inputs: [
        { name: 'vpc_id', display_name: 'VPC ID', description: 'VPC identifier for security group' }
      ],
      outputs: [
        { name: 'security_group_id', display_name: 'Security Group ID', description: 'Security group identifier' }
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
  
  // Initialize nodes with calculated ports and dynamic heights
  const [nodes, setNodes] = React.useState<CanvasNode[]>(() => {
    return initialNodes.map(node => ({
      ...node,
      height: calculateDynamicHeight(node, initialEdges, false), // Start collapsed
      ports: []
    }));
  });
  
  const [edges, setEdges] = React.useState<CanvasEdge[]>(initialEdges);
  const [state, setState] = React.useState<CanvasState>({
    selectedNode: null,
    draggedNode: null,
    dragOffset: { x: 0, y: 0 },
    dragStartPosition: null,
    mousePos: { x: 0, y: 0 },
    hoveredPort: null,
    showTooltip: false
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

  // Layout service and state
  const [layoutService] = React.useState(() => new LayoutService());
  const [layoutState, setLayoutState] = React.useState<LayoutState>(() => layoutService.getLayoutState());
  const [selectedAlgorithm, setSelectedAlgorithm] = React.useState<string>('hierarchical');
  const [isAnimatingLayout, setIsAnimatingLayout] = React.useState(false);

  // Collision detection service and state
  const [collisionService] = React.useState(() => new CollisionDetectionService());
  const [collisionState, setCollisionState] = React.useState<CollisionState>({
    isDragging: false,
    hasCollision: false,
    conflictingNodes: []
  });
  const [collisionOptions, setCollisionOptions] = React.useState<CollisionOptions>({
    enabled: true,
    margin: 20,
    enableBoundaryCheck: true,
    enableSmartPositioning: true,
    enableVisualFeedback: true,
    snapToGrid: false,
    gridSize: 20
  });

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

  // Calculate all ports for tooltip detection (ignores expansion state)
  const calculateAllNodePorts = useCallback((node: CanvasNode, edges: CanvasEdge[]): NodePort[] => {
    const ports: NodePort[] = [];
    const inputs = node.data?.inputs || [];
    const outputs = node.data?.outputs || [];

    // Find connected port indices
    const connectedInputs = new Set<number>();
    const connectedOutputs = new Set<number>();

    edges.forEach(edge => {
      // Check for connections using sourceHandle/targetHandle if available
      if (edge.source === node.id && edge.sourceHandle) {
        const match = edge.sourceHandle.match(/-output-(\d+)$/);
        if (match) {
          connectedOutputs.add(parseInt(match[1], 10));
        }
      } else if (edge.source === node.id) {
        // For simple edges without handles, mark first output as connected
        if (outputs.length > 0) {
          connectedOutputs.add(0);
        }
      }
      
      if (edge.target === node.id && edge.targetHandle) {
        const match = edge.targetHandle.match(/-input-(\d+)$/);
        if (match) {
          connectedInputs.add(parseInt(match[1], 10));
        }
      } else if (edge.target === node.id) {
        // For simple edges without handles, mark first input as connected
        if (inputs.length > 0) {
          connectedInputs.add(0);
        }
      }
    });

    // Always show all ports for tooltip detection
    const allInputs = inputs.map((input, index) => ({ 
      input, 
      index, 
      isConnected: connectedInputs.has(index) 
    }));
    const allOutputs = outputs.map((output, index) => ({ 
      output, 
      index, 
      isConnected: connectedOutputs.has(index) 
    }));

    // Create input ports (left side, positioned inside node boundary)
    allInputs.forEach(({ input, index, isConnected }, displayIndex) => {
      ports.push({
        id: `${node.id}-input-${index}`,
        name: input.name,
        type: 'input',
        x: node.x + 6, // Moved inside the node
        y: node.y + HEADER_HEIGHT + 10 + (displayIndex * 15),
        description: input.description,
        isConnected // Add connection status to port data
      });
    });

    // Create output ports (right side, positioned inside node boundary)
    allOutputs.forEach(({ output, index, isConnected }, displayIndex) => {
      ports.push({
        id: `${node.id}-output-${index}`,
        name: output.name,
        type: 'output',
        x: node.x + node.width - 6, // Moved inside the node
        y: node.y + HEADER_HEIGHT + 10 + (displayIndex * 15),
        description: output.description,
        isConnected // Add connection status to port data
      });
    });

    return ports;
  }, []);

  // Calculate ports based on expansion state and connection status
  const calculateNodePorts = useCallback((node: CanvasNode, edges: CanvasEdge[]): NodePort[] => {
    const ports: NodePort[] = [];
    const inputs = node.data?.inputs || [];
    const outputs = node.data?.outputs || [];
    const expanded = node.expanded ?? false;

    // Find connected port indices - improved logic to handle both simple and handle-based edges
    const connectedInputs = new Set<number>();
    const connectedOutputs = new Set<number>();

    edges.forEach(edge => {
      // Check for connections using sourceHandle/targetHandle if available
      if (edge.source === node.id && edge.sourceHandle) {
        const match = edge.sourceHandle.match(/-output-(\d+)$/);
        if (match) {
          connectedOutputs.add(parseInt(match[1], 10));
        }
      } else if (edge.source === node.id) {
        // For simple edges without handles, mark first output as connected
        if (outputs.length > 0) {
          connectedOutputs.add(0);
        }
      }
      
      if (edge.target === node.id && edge.targetHandle) {
        const match = edge.targetHandle.match(/-input-(\d+)$/);
        if (match) {
          connectedInputs.add(parseInt(match[1], 10));
        }
      } else if (edge.target === node.id) {
        // For simple edges without handles, mark first input as connected
        if (inputs.length > 0) {
          connectedInputs.add(0);
        }
      }
    });

    // Determine which ports to show
    let visibleInputs: Array<{ input: any; index: number; isConnected: boolean }> = [];
    let visibleOutputs: Array<{ output: any; index: number; isConnected: boolean }> = [];

    if (expanded) {
      // Show all ports when expanded
      visibleInputs = inputs.map((input, index) => ({ 
        input, 
        index, 
        isConnected: connectedInputs.has(index) 
      }));
      visibleOutputs = outputs.map((output, index) => ({ 
        output, 
        index, 
        isConnected: connectedOutputs.has(index) 
      }));
    } else {
      // Show only connected ports when collapsed
      visibleInputs = inputs
        .map((input, index) => ({ input, index, isConnected: connectedInputs.has(index) }))
        .filter(({ isConnected }) => isConnected);
      visibleOutputs = outputs
        .map((output, index) => ({ output, index, isConnected: connectedOutputs.has(index) }))
        .filter(({ isConnected }) => isConnected);
    }

    // Create input ports (left side, positioned inside node boundary)
    visibleInputs.forEach(({ input, index, isConnected }, displayIndex) => {
      ports.push({
        id: `${node.id}-input-${index}`,
        name: input.name,
        type: 'input',
        x: node.x + 6, // Moved inside the node
        y: node.y + HEADER_HEIGHT + 10 + (displayIndex * 15),
        description: input.description,
        isConnected // Add connection status to port data
      });
    });

    // Create output ports (right side, positioned inside node boundary)
    visibleOutputs.forEach(({ output, index, isConnected }, displayIndex) => {
      ports.push({
        id: `${node.id}-output-${index}`,
        name: output.name,
        type: 'output',
        x: node.x + node.width - 6, // Moved inside the node
        y: node.y + HEADER_HEIGHT + 10 + (displayIndex * 15),
        description: output.description,
        isConnected // Add connection status to port data
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
        label: node.label || node.name,
        x: node.position.x,
        y: node.position.y,
        width: 240, // Same width for all nodes
        height: calculateDynamicHeight({ id: node.id, type: node.type, name: node.name, x: 0, y: 0, width: 0, height: 0, data: node.data }, edges, node.expanded ?? false),
        data: node.data,
        expanded: node.expanded
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
        if (distance <= 8) { // Increased radius for better detection
          return port;
        }
      }
    }
    return null;
  }, [nodes]);

  // Find port at position from specific nodes array (for up-to-date port positions)
  const getPortAtPositionFromNodes = useCallback((x: number, y: number, nodeList: CanvasNode[]): NodePort | null => {
    for (const node of nodeList) {
      // Use all ports for tooltip detection (not just visible ports)
      // Pass the current node state to ensure accurate positions
      const allPorts = calculateAllNodePorts(node, edges);
      for (const port of allPorts) {
        // Check port circle area
        const circleDistance = Math.sqrt(Math.pow(x - port.x, 2) + Math.pow(y - port.y, 2));
        if (circleDistance <= 8) {
          return port;
        }
        
        // Check port text label area
        const labelX = port.type === 'input' ? port.x + 8 : port.x - 8;
        const labelY = port.y + 3;
        
        // Create a rectangular area around the text label (estimated 60px width, 16px height)
        const textWidth = 60;
        const textHeight = 16;
        const textLeft = port.type === 'input' ? labelX : labelX - textWidth;
        const textTop = labelY - textHeight / 2;
        const textRight = textLeft + textWidth;
        const textBottom = textTop + textHeight;
        
        if (x >= textLeft && x <= textRight && y >= textTop && y <= textBottom) {
          return port;
        }
      }
    }
    return null;
  }, [calculateAllNodePorts, edges]);

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

  // Layout functions
  const convertToLayoutFormat = useCallback((canvasNodes: CanvasNode[], canvasEdges: CanvasEdge[]): { nodes: CanvasLayoutNode[], edges: CanvasLayoutEdge[] } => {
    const layoutNodes: CanvasLayoutNode[] = canvasNodes.map(node => ({
      id: node.id,
      type: node.type,
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      expanded: node.expanded,
      data: node.data,
      ports: node.ports
    }));

    const layoutEdges: CanvasLayoutEdge[] = canvasEdges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle
    }));

    return { nodes: layoutNodes, edges: layoutEdges };
  }, []);

  const applyLayoutToNodes = useCallback((layoutNodes: CanvasLayoutNode[], animate: boolean = true) => {
    if (!animate) {
      // Apply immediately without animation
      setNodes(prevNodes => 
        prevNodes.map(node => {
          const layoutNode = layoutNodes.find(ln => ln.id === node.id);
          if (layoutNode) {
            return {
              ...node,
              x: layoutNode.x,
              y: layoutNode.y,
              ports: calculateNodePorts({
                ...node,
                x: layoutNode.x,
                y: layoutNode.y
              }, edges)
            };
          }
          return node;
        })
      );
      return;
    }

    setIsAnimatingLayout(true);
    
    // Store start positions for animation
    const startPositions = new Map<string, { x: number; y: number }>();
    nodes.forEach(node => {
      startPositions.set(node.id, { x: node.x, y: node.y });
    });

    // Animation duration in milliseconds
    const animationDuration = 300;
    const frameRate = 60;
    const totalFrames = Math.ceil((animationDuration / 1000) * frameRate);
    let currentFrame = 0;

    const animateFrame = () => {
      currentFrame++;
      const progress = Math.min(currentFrame / totalFrames, 1);
      
      // Easing function for smooth animation
      const easeProgress = 1 - Math.pow(1 - progress, 3); // Ease-out cubic

      setNodes(prevNodes => 
        prevNodes.map(node => {
          const layoutNode = layoutNodes.find(ln => ln.id === node.id);
          const startPos = startPositions.get(node.id);
          
          if (layoutNode && startPos) {
            // Interpolate between start and end positions
            const x = startPos.x + (layoutNode.x - startPos.x) * easeProgress;
            const y = startPos.y + (layoutNode.y - startPos.y) * easeProgress;
            
            return {
              ...node,
              x,
              y,
              ports: calculateNodePorts({
                ...node,
                x,
                y
              }, edges)
            };
          }
          return node;
        })
      );

      if (progress < 1) {
        requestAnimationFrame(animateFrame);
      } else {
        setIsAnimatingLayout(false);
      }
    };

    requestAnimationFrame(animateFrame);
  }, [calculateNodePorts, edges, nodes]);

  const applyAutoLayout = useCallback(async (algorithm?: string) => {
    if (nodes.length === 0) return;

    const algorithmToUse = algorithm || selectedAlgorithm;
    layoutService.setAlgorithm(algorithmToUse);

    const { nodes: layoutNodes, edges: layoutEdges } = convertToLayoutFormat(nodes, edges);
    
    try {
      const result = await layoutService.applyLayout(layoutNodes, layoutEdges, {
        algorithm: algorithmToUse,
        animate: true,
        animationDuration: 300
      });

      if (result.success && result.graph) {
        applyLayoutToNodes(result.graph.nodes.map(ln => ({
          id: ln.id,
          type: nodes.find(n => n.id === ln.id)?.type || 'dependency',
          name: nodes.find(n => n.id === ln.id)?.name || '',
          x: ln.position.x,
          y: ln.position.y,
          width: ln.size.width,
          height: ln.size.height,
          expanded: nodes.find(n => n.id === ln.id)?.expanded,
          data: nodes.find(n => n.id === ln.id)?.data,
          ports: nodes.find(n => n.id === ln.id)?.ports
        })));

        setLayoutState(layoutService.getLayoutState());
        console.log(`Layout applied successfully using ${algorithmToUse} algorithm in ${result.duration?.toFixed(2)}ms`);
      } else {
        console.error('Layout failed:', result.error);
      }
    } catch (error) {
      console.error('Layout error:', error);
    }
  }, [nodes, edges, selectedAlgorithm, layoutService, convertToLayoutFormat, applyLayoutToNodes]);

  const resetLayout = useCallback(() => {
    const { nodes: layoutNodes } = convertToLayoutFormat(nodes, edges);
    const resetResult = layoutService.resetToOriginalPositions(layoutNodes);
    
    if (resetResult.nodes.length > 0) {
      applyLayoutToNodes(resetResult.nodes.map(ln => ({
        id: ln.id,
        type: nodes.find(n => n.id === ln.id)?.type || 'dependency',
        name: nodes.find(n => n.id === ln.id)?.name || '',
        x: ln.position.x,
        y: ln.position.y,
        width: ln.size.width,
        height: ln.size.height,
        expanded: nodes.find(n => n.id === ln.id)?.expanded,
        data: nodes.find(n => n.id === ln.id)?.data,
        ports: nodes.find(n => n.id === ln.id)?.ports
      })));
    }

    setLayoutState(layoutService.getLayoutState());
    console.log('Layout reset to original positions');
  }, [nodes, edges, layoutService, convertToLayoutFormat, applyLayoutToNodes]);

  const handleNodeExpansion = useCallback(async (nodeId: string, isExpanding: boolean) => {
    if (layoutState.isAutoLayout) {
      const { nodes: layoutNodes, edges: layoutEdges } = convertToLayoutFormat(nodes, edges);
      
      try {
        const result = await layoutService.applyIncrementalLayout(
          layoutNodes, 
          layoutEdges, 
          nodeId, 
          isExpanding
        );

        if (result.success && result.graph) {
          applyLayoutToNodes(result.graph.nodes.map(ln => ({
            id: ln.id,
            type: nodes.find(n => n.id === ln.id)?.type || 'dependency',
            name: nodes.find(n => n.id === ln.id)?.name || '',
            x: ln.position.x,
            y: ln.position.y,
            width: ln.size.width,
            height: ln.size.height,
            expanded: nodes.find(n => n.id === ln.id)?.expanded,
            data: nodes.find(n => n.id === ln.id)?.data,
            ports: nodes.find(n => n.id === ln.id)?.ports
          })));
        }
      } catch (error) {
        console.error('Incremental layout error:', error);
      }
    }
  }, [layoutState.isAutoLayout, nodes, edges, layoutService, convertToLayoutFormat, applyLayoutToNodes]);

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
        
        // Position button below the port area, not within it
        // Use the same visible port calculation logic as calculateDynamicHeight
        const inputs = node.data?.inputs || [];
        const outputs = node.data?.outputs || [];
        const expanded = node.expanded ?? false;
        
        // Find connected port indices (same logic as calculateDynamicHeight)
        const connectedInputs = new Set<number>();
        const connectedOutputs = new Set<number>();
        
        edges.forEach(edge => {
          if (edge.source === node.id) {
            if (edge.sourceHandle) {
              const handleIndex = parseInt(edge.sourceHandle.replace('output-', ''));
              if (!isNaN(handleIndex)) {
                connectedOutputs.add(handleIndex);
              }
            } else {
              // Simple edge without specific handle - assume first output
              if (outputs.length > 0) {
                connectedOutputs.add(0);
              }
            }
          }
          if (edge.target === node.id) {
            if (edge.targetHandle) {
              const handleIndex = parseInt(edge.targetHandle.replace('input-', ''));
              if (!isNaN(handleIndex)) {
                connectedInputs.add(handleIndex);
              }
            } else {
              // Simple edge without specific handle - assume first input
              if (inputs.length > 0) {
                connectedInputs.add(0);
              }
            }
          }
        });

        let visiblePortCount = 0;
        if (expanded) {
          // Show all ports when expanded
          visiblePortCount = Math.max(inputs.length, outputs.length);
        } else {
          // Show only connected ports when collapsed
          const visibleInputs = inputs.filter((_, index) => connectedInputs.has(index));
          const visibleOutputs = outputs.filter((_, index) => connectedOutputs.has(index));
          visiblePortCount = Math.max(visibleInputs.length, visibleOutputs.length);
        }
        
        const portAreaHeight = Math.max(BASE_CONTENT_HEIGHT, visiblePortCount * PORT_SPACING + 20);
        const buttonY = node.y + HEADER_HEIGHT + portAreaHeight + 8; // 8px gap below ports
        
        const distance = Math.sqrt(
          Math.pow(coords.x - (buttonX + buttonSize / 2), 2) + 
          Math.pow(coords.y - (buttonY + buttonSize / 2), 2)
        );
        
        if (distance <= buttonSize / 2) {
          // Toggle expand/collapse with dynamic height calculation
          const newExpanded = !(node.expanded ?? false);
          
          setNodes(prevNodes => 
            prevNodes.map(n => {
              if (n.id === node.id) {
                const updatedNode = { 
                  ...n, 
                  expanded: newExpanded,
                  height: calculateDynamicHeight(n, edges, newExpanded)
                };
                // Recalculate ports with new expansion state
                updatedNode.ports = calculateNodePorts(updatedNode, edges);
                return updatedNode;
              }
              return n;
            })
          );

          // Apply incremental layout if in auto-layout mode
          handleNodeExpansion(node.id, newExpanded);
          
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
      console.log('Starting drag for node:', clickedNode.id, 'in mode:', interactionMode);
      setState(prev => ({
        ...prev,
        selectedNode: clickedNode.id,
        draggedNode: clickedNode.id,
        dragOffset: {
          x: coords.x - clickedNode.x,
          y: coords.y - clickedNode.y
        },
        dragStartPosition: { x: clickedNode.x, y: clickedNode.y },
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
        draggedNode: null,
        dragStartPosition: null
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
    
    // Check for port hover for tooltip (uses calculateAllNodePorts internally)
    // Ensure we use the most current node state with updated port positions
    const updatedNodes = nodes.map(node => ({
      ...node,
      ports: calculateNodePorts(node, edges) // Ensure ports are current
    }));
    const hoveredPort = getPortAtPositionFromNodes(coords.x, coords.y, updatedNodes);
    
    // Debug logging for drag investigation
    if (state.draggedNode) {
      console.log('Drag in progress:', {
        draggedNodeId: state.draggedNode,
        interactionMode,
        coords,
        dragOffset: state.dragOffset
      });
    }
    
    setState(prev => ({ 
      ...prev, 
      mousePos: coords,
      hoveredPort,
      showTooltip: !!hoveredPort
    }));

    // Lock mode - disable all interactions
    if (interactionMode === 'lock') {
      console.log('Mouse move blocked: lock mode');
      return;
    }

    // Move mode - no node dragging or connection creation, only panning
    if (interactionMode === 'move') {
      console.log('Mouse move blocked: move mode');
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
      const rawX = coords.x - state.dragOffset.x;
      const rawY = coords.y - state.dragOffset.y;
      
      let finalX = rawX;
      let finalY = rawY;
      let hasCollision = false;
      let conflictingNodes: string[] = [];

      // Apply grid snapping if enabled (before collision check)
      if (collisionOptions.snapToGrid && collisionOptions.gridSize) {
        const snapped = PositionUtils.snapToGrid(
          { x: finalX, y: finalY }, 
          collisionOptions.gridSize
        );
        finalX = snapped.x;
        finalY = snapped.y;
      }

      // Check for collision for visual feedback only - don't prevent movement
      if (collisionOptions.enabled) {
        const draggedNode = nodes.find(n => n.id === state.draggedNode);
        if (draggedNode) {
          // Prepare nodes for collision detection (excluding the dragged node)
          const otherNodes = nodes
            .filter(n => n.id !== state.draggedNode)
            .map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));

          // Check collision at the preferred position
          const validation = collisionService.validatePosition(
            state.draggedNode,
            { x: finalX, y: finalY },
            { width: draggedNode.width, height: draggedNode.height },
            otherNodes,
            {
              margin: collisionOptions.margin,
              enableBoundaryCheck: collisionOptions.enableBoundaryCheck,
              canvasBounds: { x: 0, y: 0, width: 4000, height: 3000 }
            }
          );

          hasCollision = !validation.isValid;
          conflictingNodes = validation.conflicts;
        }
      }

      // Update collision state for visual feedback
      setCollisionState({
        isDragging: true,
        hasCollision,
        conflictingNodes
      });

      // Check if this is manual movement that should disable auto-layout
      if (layoutState.isAutoLayout) {
        const isManualMove = layoutService.isPositionManuallyModified(state.draggedNode, { x: finalX, y: finalY });
        if (isManualMove) {
          // Disable auto-layout when user manually moves nodes
          layoutService.toggleAutoLayout();
          setLayoutState(layoutService.getLayoutState());
          console.log('Manual node movement detected - auto-layout disabled');
        }
      }
      
      // Always allow movement during drag, regardless of collision
      setNodes(prevNodes => 
        prevNodes.map(node => 
          node.id === state.draggedNode
            ? {
                ...node,
                x: finalX,
                y: finalY,
                ports: calculateNodePorts({
                  ...node,
                  x: finalX,
                  y: finalY
                }, edges)
              }
            : node
        )
      );
    }
  }, [viewport.isPanning, getCanvasCoordinates, connectionState, state.draggedNode, state.dragOffset, calculateNodePorts, interactionMode, getPortAtPosition, layoutState.isAutoLayout, layoutService, collisionOptions, collisionService, nodes]);

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

    // Handle drag completion with collision validation
    if (state.draggedNode && state.dragStartPosition) {
      const draggedNode = nodes.find(n => n.id === state.draggedNode);
      
      if (draggedNode && collisionOptions.enabled) {
        // Final collision check at drop position
        const otherNodes = nodes
          .filter(n => n.id !== state.draggedNode)
          .map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));

        const validation = collisionService.validatePosition(
          state.draggedNode,
          { x: draggedNode.x, y: draggedNode.y },
          { width: draggedNode.width, height: draggedNode.height },
          otherNodes,
          {
            margin: collisionOptions.margin,
            enableBoundaryCheck: collisionOptions.enableBoundaryCheck,
            canvasBounds: { x: 0, y: 0, width: 4000, height: 3000 }
          }
        );

        // If invalid position, revert to original position with animation
        if (!validation.isValid) {
          console.log('Invalid drop position detected, reverting to original position');
          
          // Animate back to original position
          const startPos = { x: draggedNode.x, y: draggedNode.y };
          const endPos = state.dragStartPosition;
          const animationDuration = 200; // 200ms animation
          const startTime = performance.now();

          const animateRevert = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / animationDuration, 1);
            
            // Ease-out animation
            const easeProgress = 1 - Math.pow(1 - progress, 2);
            
            const currentX = startPos.x + (endPos.x - startPos.x) * easeProgress;
            const currentY = startPos.y + (endPos.y - startPos.y) * easeProgress;

            setNodes(prevNodes => 
              prevNodes.map(node => 
                node.id === state.draggedNode
                  ? {
                      ...node,
                      x: currentX,
                      y: currentY,
                      ports: calculateNodePorts({
                        ...node,
                        x: currentX,
                        y: currentY
                      }, edges)
                    }
                  : node
              )
            );

            if (progress < 1) {
              requestAnimationFrame(animateRevert);
            }
          };

          requestAnimationFrame(animateRevert);
        }
      }
    }

    // Reset drag state
    setState(prev => ({ 
      ...prev, 
      draggedNode: null,
      dragStartPosition: null 
    }));
    
    // Reset collision state
    setCollisionState({
      isDragging: false,
      hasCollision: false,
      conflictingNodes: []
    });
  }, [connectionState, getCanvasCoordinates, getPortAtPosition, isValidConnection, interactionMode, state.draggedNode, state.dragStartPosition, nodes, collisionOptions, collisionService, calculateNodePorts, edges]);

  const drawNode = useCallback((ctx: CanvasRenderingContext2D, node: CanvasNode) => {
    const isSelected = state.selectedNode === node.id;
    const expanded = node.expanded ?? false;
    const totalInputs = node.data?.inputs?.length || 0;
    const totalOutputs = node.data?.outputs?.length || 0;
    const hasExpandableContent = totalInputs > 3 || totalOutputs > 3;

    // Check if this node is in collision
    const isConflicting = collisionState.conflictingNodes.includes(node.id);

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
      ctx.strokeStyle = isConflicting ? '#ef4444' : (isSelected ? '#fbbf24' : '#6366f1');
      ctx.lineWidth = isConflicting ? 4 : (isSelected ? 3 : 2);
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
      ctx.strokeStyle = isConflicting ? '#ef4444' : (isSelected ? '#fbbf24' : '#34d399');
      ctx.lineWidth = isConflicting ? 4 : (isSelected ? 2 : 1);
    }

    // Draw main node body rounded rectangle
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

    // Draw header section
    ctx.save();
    // Create header background with slightly different gradient
    if (node.type === 'root') {
      const headerGradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + HEADER_HEIGHT);
      headerGradient.addColorStop(0, '#5b21b6');
      headerGradient.addColorStop(1, '#4f46e5');
      ctx.fillStyle = headerGradient;
    } else {
      const headerGradient = ctx.createLinearGradient(node.x, node.y, node.x, node.y + HEADER_HEIGHT);
      headerGradient.addColorStop(0, '#047857');
      headerGradient.addColorStop(1, '#059669');
      ctx.fillStyle = headerGradient;
    }
    
    // Draw header background with rounded top corners only
    ctx.beginPath();
    ctx.moveTo(node.x + radius, node.y);
    ctx.lineTo(node.x + node.width - radius, node.y);
    ctx.arcTo(node.x + node.width, node.y, node.x + node.width, node.y + radius, radius);
    ctx.lineTo(node.x + node.width, node.y + HEADER_HEIGHT);
    ctx.lineTo(node.x, node.y + HEADER_HEIGHT);
    ctx.lineTo(node.x, node.y + radius);
    ctx.arcTo(node.x, node.y, node.x + radius, node.y, radius);
    ctx.closePath();
    ctx.fill();

    // Draw separator line between header and content
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(node.x, node.y + HEADER_HEIGHT);
    ctx.lineTo(node.x + node.width, node.y + HEADER_HEIGHT);
    ctx.stroke();
    
    ctx.restore();

    // Expand/collapse button (only if node has expandable content)
    if (hasExpandableContent) {
      const buttonSize = 20;
      const buttonX = node.x + node.width / 2 - buttonSize / 2;
      
      // Position button below the port area, not within it
      // Use the same visible port calculation logic as calculateDynamicHeight
      const inputs = node.data?.inputs || [];
      const outputs = node.data?.outputs || [];
      
      // Find connected port indices (same logic as calculateDynamicHeight)
      const connectedInputs = new Set<number>();
      const connectedOutputs = new Set<number>();
      
      edges.forEach(edge => {
        if (edge.source === node.id) {
          if (edge.sourceHandle) {
            const handleIndex = parseInt(edge.sourceHandle.replace('output-', ''));
            if (!isNaN(handleIndex)) {
              connectedOutputs.add(handleIndex);
            }
          } else {
            // Simple edge without specific handle - assume first output
            if (outputs.length > 0) {
              connectedOutputs.add(0);
            }
          }
        }
        if (edge.target === node.id) {
          if (edge.targetHandle) {
            const handleIndex = parseInt(edge.targetHandle.replace('input-', ''));
            if (!isNaN(handleIndex)) {
              connectedInputs.add(handleIndex);
            }
          } else {
            // Simple edge without specific handle - assume first input
            if (inputs.length > 0) {
              connectedInputs.add(0);
            }
          }
        }
      });

      let visiblePortCount = 0;
      if (expanded) {
        // Show all ports when expanded
        visiblePortCount = Math.max(inputs.length, outputs.length);
      } else {
        // Show only connected ports when collapsed
        const visibleInputs = inputs.filter((_, index) => connectedInputs.has(index));
        const visibleOutputs = outputs.filter((_, index) => connectedOutputs.has(index));
        visiblePortCount = Math.max(visibleInputs.length, visibleOutputs.length);
      }
      
      const portAreaHeight = Math.max(BASE_CONTENT_HEIGHT, visiblePortCount * PORT_SPACING + 20);
      const buttonY = node.y + HEADER_HEIGHT + portAreaHeight + 8; // 8px gap below ports

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

    // Draw header text (title, flavor, and version all in header)
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    // Header Line 1: Offering/Dependency name (prefer label over name) - with text scaling
    const displayName = node.data?.label || node.label || node.name;
    const availableWidth = node.width - 16; // 8px padding on each side
    
    // Start with base font size and scale down if needed
    let fontSize = node.type === 'root' ? 14 : 13;
    ctx.font = `bold ${fontSize}px sans-serif`;
    let textWidth = ctx.measureText(displayName).width;
    
    // Scale down font if text is too wide (minimum font size of 8px)
    while (textWidth > availableWidth && fontSize > 8) {
      fontSize -= 0.5;
      ctx.font = `bold ${fontSize}px sans-serif`;
      textWidth = ctx.measureText(displayName).width;
    }
    
    ctx.fillText(
      displayName, 
      node.x + 8, 
      node.y + 16
    );

    // Header Line 2: Flavor label (if available) - with text scaling
    if (node.data?.flavor) {
      ctx.globalAlpha = 0.9;
      
      // Start with base font size for flavor and scale down if needed
      let flavorFontSize = 12;
      ctx.font = `${flavorFontSize}px sans-serif`;
      let flavorTextWidth = ctx.measureText(node.data.flavor).width;
      
      // Scale down font if text is too wide (minimum font size of 8px)
      while (flavorTextWidth > availableWidth && flavorFontSize > 8) {
        flavorFontSize -= 0.5;
        ctx.font = `${flavorFontSize}px sans-serif`;
        flavorTextWidth = ctx.measureText(node.data.flavor).width;
      }
      
      ctx.fillText(
        node.data.flavor,
        node.x + 8,
        node.y + 32
      );
      ctx.globalAlpha = 1;
    }
    
    // Header Line 3: Version (if available) - with text scaling
    if (node.data?.version) {
      ctx.globalAlpha = 0.8;
      
      // Start with base font size for version and scale down if needed
      let versionFontSize = 11;
      ctx.font = `${versionFontSize}px sans-serif`;
      let versionTextWidth = ctx.measureText(node.data.version).width;
      
      // Scale down font if text is too wide (minimum font size of 7px)
      while (versionTextWidth > availableWidth && versionFontSize > 7) {
        versionFontSize -= 0.5;
        ctx.font = `${versionFontSize}px sans-serif`;
        versionTextWidth = ctx.measureText(node.data.version).width;
      }
      
      ctx.fillText(
        node.data.version, // Use exact version, no forced "v" prefix
        node.x + 8,
        node.y + 48
      );
      ctx.globalAlpha = 1;
    }
  }, [state.selectedNode]);

  const drawNodePorts = useCallback((ctx: CanvasRenderingContext2D, node: CanvasNode) => {
    if (!node.ports) return;

    node.ports.forEach(port => {
      // Port circle
      ctx.beginPath();
      ctx.arc(port.x, port.y, 4, 0, 2 * Math.PI);
      
      // Choose color based on connection status and port type
      if (port.isConnected === false) {
        ctx.fillStyle = '#6b7280'; // Grey for unconnected ports
      } else if (port.type === 'input') {
        ctx.fillStyle = '#10b981'; // Green for connected inputs
      } else {
        ctx.fillStyle = '#f59e0b'; // Orange for connected outputs
      }
      
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw port labels inside the node
      ctx.fillStyle = 'white';
      ctx.font = '12px sans-serif';
      ctx.globalAlpha = 0.9;

      // Find the corresponding input/output data to get display_name
      const portData = port.type === 'input' 
        ? node.data?.inputs?.find(input => input.name === port.name || input.display_name === port.name)
        : node.data?.outputs?.find(output => output.name === port.name || output.display_name === port.name);

      const fullLabelText = portData?.display_name || port.name;
      
      // Calculate available space: half node width minus padding for port circle and margins
      const availableWidth = (node.width / 2) - 20; // 20px for port circle + margins
      
      // Measure actual text width and truncate based on available space
      let labelText = fullLabelText;
      let textWidth = ctx.measureText(labelText).width;
      
      if (textWidth > availableWidth) {
        // Iteratively truncate until text fits
        while (textWidth > availableWidth && labelText.length > 3) {
          const truncatedLength = Math.max(3, labelText.length - 1);
          labelText = fullLabelText.substring(0, truncatedLength - 2) + '..';
          textWidth = ctx.measureText(labelText).width;
        }
      }
      
      if (port.type === 'input') {
        // Input labels inside node, left side
        ctx.textAlign = 'left';
        ctx.fillText(labelText, port.x + 8, port.y + 3);
      } else {
        // Output labels inside node, right side
        ctx.textAlign = 'right';
        ctx.fillText(labelText, port.x - 8, port.y + 3);
      }

      ctx.globalAlpha = 1;
    });
  }, []);

  // Draw tooltip for hovered port
  const drawTooltip = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!state.showTooltip || !state.hoveredPort) return;

    const port = state.hoveredPort;
    
    // Find the corresponding port data to get description and default value
    const node = nodes.find(n => n.ports?.some(p => p.id === port.id));
    if (!node) return;

    const portData = port.type === 'input' 
      ? node.data?.inputs?.find(input => input.name === port.name || input.display_name === port.name)
      : node.data?.outputs?.find(output => output.name === port.name || output.display_name === port.name);

    const fullPortName = portData?.display_name || port.name;
    
    // Build tooltip content
    const lines = [];
    
    // Always show the full port name at the top
    lines.push(`${fullPortName}`);
    
    // Add description if available
    if (portData?.description) {
      lines.push(`Description: ${portData.description}`);
    }
    
    // Add default value if available
    if (portData?.defaultValue !== undefined && portData.defaultValue !== null && portData.defaultValue !== '') {
      lines.push(`Default: ${portData.defaultValue}`);
    }

    // Always show tooltip if we have at least the port name
    if (lines.length === 0) {
      lines.push(port.name); // Fallback to port name if no display name
    }

    // Calculate tooltip dimensions
    ctx.font = '11px sans-serif';
    const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width)) + 16;
    const lineHeight = 16;
    const tooltipHeight = lines.length * lineHeight + 12;

    // Position tooltip near the mouse, but keep it on screen
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Convert world coordinates to screen coordinates for tooltip positioning
    const screenX = state.mousePos.x * viewport.zoom + viewport.panX;
    const screenY = state.mousePos.y * viewport.zoom + viewport.panY;
    
    let tooltipX = screenX + 10;
    let tooltipY = screenY - tooltipHeight - 10;

    // Keep tooltip on screen
    if (tooltipX + maxWidth > canvas.clientWidth) {
      tooltipX = canvas.clientWidth - maxWidth - 10;
    }
    if (tooltipY < 10) {
      tooltipY = screenY + 20;
    }

    // Draw tooltip background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tooltipX, tooltipY, maxWidth, tooltipHeight, 4);
    ctx.fill();
    ctx.stroke();

    // Draw tooltip text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    lines.forEach((line, index) => {
      if (index === 0) {
        // First line is the port name - make it bold and slightly larger
        ctx.fillStyle = '#93c5fd'; // Light blue for port name
        ctx.font = 'bold 12px sans-serif';
      } else {
        // Other lines are description/default - normal styling
        ctx.fillStyle = 'white';
        ctx.font = '11px sans-serif';
      }
      
      ctx.fillText(
        line,
        tooltipX + 8,
        tooltipY + 12 + index * lineHeight
      );
    });
  }, [state.showTooltip, state.hoveredPort, state.mousePos, nodes, viewport]);

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

    // Use specific port positions for Y coordinates, but connect to node edges for X
    const sourcePort = sourceNode.ports?.find(p => p.type === 'output');
    const targetPort = targetNode.ports?.find(p => p.type === 'input');

    if (sourcePort) {
      startX = sourceNode.x + sourceNode.width; // Keep at node edge
      startY = sourcePort.y;
    }
    if (targetPort) {
      endX = targetNode.x; // Keep at node edge
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

    // Draw tooltip (outside of viewport transform so it stays fixed on screen)
    drawTooltip(ctx);
  }, [nodes, edges, drawNode, drawNodePorts, drawEdgeWithPorts, drawPreviewConnection, drawTooltip, viewport]);

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
        {interactionMode !== 'select' && (
          <span style={{ 
            fontSize: '9px', 
            color: '#ef4444', 
            marginLeft: '4px',
            fontWeight: 'bold'
          }}>
            (Press S to drag nodes)
          </span>
        )}
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

      {/* Layout Controls */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        borderTop: '1px solid #e5e7eb',
        paddingTop: '8px',
        marginTop: '4px'
      }}>
        <div style={{ fontSize: '10px', color: '#6b7280', textAlign: 'center', marginBottom: '2px' }}>
          Layout
        </div>
        
        {/* Algorithm Selection */}
        <select
          value={selectedAlgorithm}
          onChange={(e) => setSelectedAlgorithm(e.target.value)}
          style={{
            padding: '2px 4px',
            fontSize: '9px',
            border: '1px solid #d1d5db',
            borderRadius: '3px',
            background: 'white',
            cursor: 'pointer'
          }}
          title="Select layout algorithm"
        >
          {LayoutService.ALGORITHMS.map(algo => (
            <option key={algo.id} value={algo.id}>
              {algo.name}
            </option>
          ))}
        </select>

        {/* Auto Layout Button */}
        <button
          onClick={() => applyAutoLayout()}
          disabled={isAnimatingLayout || nodes.length === 0}
          style={{
            padding: '4px 6px',
            fontSize: '10px',
            border: '1px solid #d1d5db',
            background: layoutState.isAutoLayout ? '#8b5cf6' : 'white',
            color: layoutState.isAutoLayout ? 'white' : '#374151',
            borderRadius: '3px',
            cursor: nodes.length === 0 || isAnimatingLayout ? 'not-allowed' : 'pointer',
            opacity: nodes.length === 0 || isAnimatingLayout ? 0.5 : 1,
            fontWeight: layoutState.isAutoLayout ? 'bold' : 'normal'
          }}
          title="Apply automatic layout"
        >
          {isAnimatingLayout ? '⏳' : '🎯'} Auto Layout
        </button>

        {/* Reset Layout Button */}
        <button
          onClick={resetLayout}
          disabled={!layoutState.isAutoLayout || isAnimatingLayout}
          style={{
            padding: '4px 6px',
            fontSize: '10px',
            border: '1px solid #d1d5db',
            background: 'white',
            color: '#374151',
            borderRadius: '3px',
            cursor: (!layoutState.isAutoLayout || isAnimatingLayout) ? 'not-allowed' : 'pointer',
            opacity: (!layoutState.isAutoLayout || isAnimatingLayout) ? 0.5 : 1
          }}
          title="Reset to manual positions"
        >
          🔄 Reset
        </button>

        {/* Layout Status Indicator */}
        <div style={{
          fontSize: '8px',
          color: '#6b7280',
          textAlign: 'center',
          padding: '2px 4px',
          background: layoutState.isAutoLayout ? '#f3f4f6' : 'transparent',
          borderRadius: '2px'
        }}>
          {layoutState.isAutoLayout ? `Auto (${selectedAlgorithm})` : 'Manual'}
        </div>
      </div>

      {/* Collision Detection Controls */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        borderTop: '1px solid #e5e7eb',
        paddingTop: '8px',
        marginTop: '4px'
      }}>
        <div style={{ fontSize: '10px', color: '#6b7280', textAlign: 'center', marginBottom: '2px' }}>
          Collision
        </div>
        
        {/* Collision Detection Toggle */}
        <button
          onClick={() => setCollisionOptions(prev => ({ ...prev, enabled: !prev.enabled }))}
          style={{
            padding: '4px 6px',
            fontSize: '10px',
            border: '1px solid #d1d5db',
            background: collisionOptions.enabled ? '#10b981' : 'white',
            color: collisionOptions.enabled ? 'white' : '#374151',
            borderRadius: '3px',
            cursor: 'pointer',
            fontWeight: collisionOptions.enabled ? 'bold' : 'normal'
          }}
          title="Toggle collision detection"
        >
          {collisionOptions.enabled ? '🛡️' : '⚠️'} Detection
        </button>

        {/* Collision Margin Control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '8px', color: '#6b7280', minWidth: '35px' }}>Margin:</span>
          <input
            type="range"
            min="5"
            max="50"
            value={collisionOptions.margin}
            onChange={(e) => setCollisionOptions(prev => ({ ...prev, margin: parseInt(e.target.value) }))}
            style={{
              flex: 1,
              height: '12px',
              cursor: 'pointer'
            }}
            title={`Collision margin: ${collisionOptions.margin}px`}
          />
          <span style={{ fontSize: '8px', color: '#6b7280', minWidth: '20px' }}>
            {collisionOptions.margin}
          </span>
        </div>

        {/* Smart Positioning Toggle */}
        <button
          onClick={() => setCollisionOptions(prev => ({ ...prev, enableSmartPositioning: !prev.enableSmartPositioning }))}
          disabled={!collisionOptions.enabled}
          style={{
            padding: '3px 6px',
            fontSize: '9px',
            border: '1px solid #d1d5db',
            background: (collisionOptions.enabled && collisionOptions.enableSmartPositioning) ? '#8b5cf6' : 'white',
            color: (collisionOptions.enabled && collisionOptions.enableSmartPositioning) ? 'white' : '#374151',
            borderRadius: '3px',
            cursor: collisionOptions.enabled ? 'pointer' : 'not-allowed',
            opacity: collisionOptions.enabled ? 1 : 0.5
          }}
          title="Automatically find valid positions when collision detected"
        >
          🧠 Smart Position
        </button>

        {/* Grid Snap Toggle */}
        <button
          onClick={() => setCollisionOptions(prev => ({ ...prev, snapToGrid: !prev.snapToGrid }))}
          disabled={!collisionOptions.enabled}
          style={{
            padding: '3px 6px',
            fontSize: '9px',
            border: '1px solid #d1d5db',
            background: (collisionOptions.enabled && collisionOptions.snapToGrid) ? '#f59e0b' : 'white',
            color: (collisionOptions.enabled && collisionOptions.snapToGrid) ? 'white' : '#374151',
            borderRadius: '3px',
            cursor: collisionOptions.enabled ? 'pointer' : 'not-allowed',
            opacity: collisionOptions.enabled ? 1 : 0.5
          }}
          title="Snap nodes to grid when moving"
        >
          🔲 Grid Snap
        </button>

        {/* Collision Status Indicator */}
        {collisionState.isDragging && (
          <div style={{
            fontSize: '8px',
            color: collisionState.hasCollision ? '#ef4444' : '#10b981',
            textAlign: 'center',
            padding: '2px 4px',
            background: collisionState.hasCollision ? '#fef2f2' : '#f0fdf4',
            borderRadius: '2px',
            border: `1px solid ${collisionState.hasCollision ? '#fecaca' : '#bbf7d0'}`
          }}>
            {collisionState.hasCollision ? 
              `⚠️ ${collisionState.conflictingNodes.length} conflict${collisionState.conflictingNodes.length !== 1 ? 's' : ''}` : 
              '✅ Valid position'
            }
          </div>
        )}
      </div>
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
                  state.draggedNode ? (collisionState.hasCollision ? 'not-allowed' : 'grabbing') :
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