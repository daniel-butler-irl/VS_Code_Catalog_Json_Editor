// Layout-specific type definitions for ELK.js integration

export interface LayoutAlgorithm {
  id: string;
  name: string;
  description: string;
  elkId: string;
  options?: Record<string, any>;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

export interface LayoutSize {
  width: number;
  height: number;
}

export interface LayoutNode {
  id: string;
  position: LayoutPosition;
  size: LayoutSize;
  isExpanded?: boolean;
  isRoot?: boolean;
  originalPosition?: LayoutPosition;
  isManuallyPositioned?: boolean;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  points?: LayoutPosition[];
}

export interface LayoutGraph {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface LayoutOptions {
  algorithm: string;
  direction?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
  spacing?: {
    node: number;
    layer: number;
    port: number;
  };
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  animate?: boolean;
  animationDuration?: number;
  preventOverlap?: boolean;
  minimizeEdgeCrossings?: boolean;
  collision?: CollisionOptions;
}

export interface CollisionOptions {
  enabled: boolean;
  margin: number;
  enableBoundaryCheck: boolean;
  enableSmartPositioning: boolean;
  enableVisualFeedback: boolean;
  snapToGrid?: boolean;
  gridSize?: number;
}

export interface CollisionState {
  isDragging: boolean;
  hasCollision: boolean;
  conflictingNodes: string[];
  suggestedPosition?: LayoutPosition;
}

export interface LayoutResult {
  success: boolean;
  graph?: LayoutGraph;
  error?: string;
  duration?: number;
}

export interface LayoutState {
  isAutoLayout: boolean;
  algorithm: string;
  isAnimating: boolean;
  originalPositions: Map<string, LayoutPosition>;
  lastLayoutTime?: number;
}

// ELK.js specific types
export interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  labels?: ElkLabel[];
  ports?: ElkPort[];
  layoutOptions?: Record<string, any>;
}

export interface ElkEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  sections?: ElkEdgeSection[];
  labels?: ElkLabel[];
}

export interface ElkPort {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  labels?: ElkLabel[];
}

export interface ElkLabel {
  id: string;
  text: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ElkEdgeSection {
  id: string;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints?: { x: number; y: number }[];
}

export interface ElkGraphData {
  id: string;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, any>;
}

// Canvas integration types
export interface CanvasLayoutNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expanded?: boolean;
  data?: any;
  ports?: any[];
}

export interface CanvasLayoutEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// Layout event types
export type LayoutEventType = 
  | 'layout-start'
  | 'layout-complete'
  | 'layout-error'
  | 'node-expand'
  | 'node-collapse'
  | 'manual-move'
  | 'auto-layout-toggle';

export interface LayoutEvent {
  type: LayoutEventType;
  data?: any;
  timestamp: number;
}