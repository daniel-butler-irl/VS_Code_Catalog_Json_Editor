// ELK.js layout service for automatic node positioning and edge routing

import ELK from 'elkjs/lib/elk.bundled.js';
import {
  LayoutAlgorithm,
  LayoutGraph,
  LayoutNode,
  LayoutEdge,
  LayoutOptions,
  LayoutResult,
  ElkGraphData,
  ElkNode,
  ElkEdge,
  CanvasLayoutNode,
  CanvasLayoutEdge,
  LayoutState,
  LayoutPosition
} from '../types/LayoutTypes';
import { CollisionDetectionService } from './CollisionDetectionService';

export class LayoutService {
  private elk: ELK;
  private layoutState: LayoutState;
  private collisionService: CollisionDetectionService;

  // Available layout algorithms with enhanced overlap prevention
  public static readonly ALGORITHMS: LayoutAlgorithm[] = [
    {
      id: 'hierarchical',
      name: 'Hierarchical',
      description: 'Top-down layered layout ideal for dependency trees',
      elkId: 'org.eclipse.elk.layered',
      options: {
        'org.eclipse.elk.direction': 'DOWN',
        'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': 100, // Increased for better separation
        'org.eclipse.elk.spacing.nodeNode': 80, // Increased minimum spacing
        'org.eclipse.elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', // Better node placement
        'org.eclipse.elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'org.eclipse.elk.nodeSize.constraints': 'NODE_LABELS',
        'org.eclipse.elk.nodeSize.options': 'DEFAULT_MINIMUM_SIZE COMPUTE_PADDING',
        'org.eclipse.elk.separateConnectedComponents': true,
        'org.eclipse.elk.spacing.componentComponent': 120
      }
    },
    {
      id: 'force',
      name: 'Force-Directed',
      description: 'Physics-based layout for balanced node distribution',
      elkId: 'org.eclipse.elk.force',
      options: {
        'org.eclipse.elk.force.repulsivePower': 3, // Increased repulsive force
        'org.eclipse.elk.force.iterations': 400, // More iterations for better positioning
        'org.eclipse.elk.spacing.nodeNode': 100, // Increased spacing
        'org.eclipse.elk.force.repelsFactor': 3.0, // Stronger repulsion between nodes
        'org.eclipse.elk.nodeSize.constraints': 'NODE_LABELS',
        'org.eclipse.elk.nodeSize.options': 'DEFAULT_MINIMUM_SIZE COMPUTE_PADDING',
        'org.eclipse.elk.separateConnectedComponents': true,
        'org.eclipse.elk.spacing.componentComponent': 140
      }
    },
    {
      id: 'organic',
      name: 'Organic',
      description: 'Organic layout for compact circular visualization',
      elkId: 'org.eclipse.elk.stress',
      options: {
        'org.eclipse.elk.stress.iterations': 300, // More iterations
        'org.eclipse.elk.spacing.nodeNode': 90, // Increased spacing
        'org.eclipse.elk.stress.epsilon': 0.0005, // Better convergence
        'org.eclipse.elk.nodeSize.constraints': 'NODE_LABELS',
        'org.eclipse.elk.nodeSize.options': 'DEFAULT_MINIMUM_SIZE COMPUTE_PADDING',
        'org.eclipse.elk.separateConnectedComponents': true,
        'org.eclipse.elk.spacing.componentComponent': 110
      }
    },
    {
      id: 'radial',
      name: 'Radial',
      description: 'Radial layout with root node at center',
      elkId: 'org.eclipse.elk.radial',
      options: {
        'org.eclipse.elk.radial.radius': 180, // Increased radius
        'org.eclipse.elk.spacing.nodeNode': 80, // Increased spacing
        'org.eclipse.elk.radial.compaction': false, // Disable compaction to prevent overlaps
        'org.eclipse.elk.nodeSize.constraints': 'NODE_LABELS',
        'org.eclipse.elk.nodeSize.options': 'DEFAULT_MINIMUM_SIZE COMPUTE_PADDING',
        'org.eclipse.elk.separateConnectedComponents': true,
        'org.eclipse.elk.spacing.componentComponent': 130
      }
    }
  ];

  constructor() {
    this.elk = new ELK();
    this.collisionService = new CollisionDetectionService();
    this.layoutState = {
      isAutoLayout: false,
      algorithm: 'hierarchical',
      isAnimating: false,
      originalPositions: new Map<string, LayoutPosition>()
    };
  }

  /**
   * Get available layout algorithms
   */
  public getAlgorithms(): LayoutAlgorithm[] {
    return LayoutService.ALGORITHMS;
  }

  /**
   * Get current layout state
   */
  public getLayoutState(): LayoutState {
    return { ...this.layoutState };
  }

  /**
   * Set layout algorithm
   */
  public setAlgorithm(algorithmId: string): void {
    const algorithm = LayoutService.ALGORITHMS.find(a => a.id === algorithmId);
    if (algorithm) {
      this.layoutState.algorithm = algorithmId;
    }
  }

  /**
   * Convert Canvas nodes and edges to ELK format
   */
  private convertToElkFormat(
    nodes: CanvasLayoutNode[], 
    edges: CanvasLayoutEdge[],
    options: LayoutOptions
  ): ElkGraphData {
    // Convert nodes to ELK format
    const elkNodes: ElkNode[] = nodes.map(node => ({
      id: node.id,
      width: node.width,
      height: node.height,
      x: node.x,
      y: node.y,
      layoutOptions: {
        'org.eclipse.elk.nodeSize.constraints': 'NODE_LABELS',
        'org.eclipse.elk.nodeLabels.placement': 'INSIDE V_CENTER H_CENTER'
      }
    }));

    // Convert edges to ELK format
    const elkEdges: ElkEdge[] = edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourcePort: edge.sourceHandle,
      targetPort: edge.targetHandle
    }));

    // Get algorithm configuration
    const algorithm = LayoutService.ALGORITHMS.find(a => a.id === options.algorithm);
    const algorithmOptions = algorithm?.options || {};

    // Calculate minimum spacing to prevent overlaps - more aggressive spacing
    const minSpacing = Math.max(options.spacing?.node || 120, 120);
    const layerSpacing = Math.max(minSpacing * 1.5, 150);
    
    return {
      id: 'root',
      children: elkNodes,
      edges: elkEdges,
      layoutOptions: {
        'org.eclipse.elk.algorithm': algorithm?.elkId || 'org.eclipse.elk.layered',
        'org.eclipse.elk.spacing.nodeNode': minSpacing,
        'org.eclipse.elk.padding': `[top=${options.padding?.top || 50},left=${options.padding?.left || 50},bottom=${options.padding?.bottom || 50},right=${options.padding?.right || 50}]`,
        'org.eclipse.elk.edgeRouting': 'SPLINES',
        'org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers': layerSpacing,
        'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': layerSpacing,
        // Enhanced node size handling for accurate dimensions
        'org.eclipse.elk.nodeSize.constraints': 'NODE_LABELS MINIMUM_SIZE',
        'org.eclipse.elk.nodeSize.options': 'DEFAULT_MINIMUM_SIZE COMPUTE_PADDING APPLY_ADDITIONAL_PADDING',
        'org.eclipse.elk.separateConnectedComponents': true,
        'org.eclipse.elk.spacing.componentComponent': Math.max(minSpacing * 2, 200),
        'org.eclipse.elk.nodeSize.minimum': `(${minSpacing * 2},${minSpacing})`,
        // Aggressive overlap prevention
        'org.eclipse.elk.overlaps.remove': true,
        'org.eclipse.elk.overlaps.removeOverlaps': true,
        'org.eclipse.elk.spacing.individualOverride': true,
        // Force minimum distances
        'org.eclipse.elk.spacing.edgeEdge': 20,
        'org.eclipse.elk.spacing.edgeNode': 30,
        'org.eclipse.elk.spacing.portPort': 15,
        ...algorithmOptions
      }
    };
  }

  /**
   * Convert ELK result back to Canvas format
   */
  private convertFromElkFormat(elkResult: ElkGraphData): LayoutGraph {
    const nodes: LayoutNode[] = (elkResult.children || []).map(elkNode => ({
      id: elkNode.id,
      position: { x: elkNode.x || 0, y: elkNode.y || 0 },
      size: { width: elkNode.width || 240, height: elkNode.height || 100 }
    }));

    const edges: LayoutEdge[] = (elkResult.edges || []).map(elkEdge => {
      const edge: LayoutEdge = {
        id: elkEdge.id,
        source: elkEdge.source,
        target: elkEdge.target
      };

      // Add edge routing points if available
      if (elkEdge.sections && elkEdge.sections.length > 0) {
        const section = elkEdge.sections[0];
        edge.points = [
          section.startPoint,
          ...(section.bendPoints || []),
          section.endPoint
        ];
      }

      return edge;
    });

    return { nodes, edges };
  }

  /**
   * Resolve any remaining overlaps after ELK layout
   */
  private resolvePostLayoutOverlaps(layoutGraph: LayoutGraph): LayoutGraph {
    // Convert to collision service format
    const collisionNodes = layoutGraph.nodes.map(node => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: node.size.width,
      height: node.size.height
    }));

    // Use collision service to resolve overlaps
    const resolvedNodes = this.collisionService.resolveAllOverlaps(collisionNodes, {
      margin: 30, // Generous margin for post-layout cleanup
      enableBoundaryCheck: false // Don't restrict to canvas bounds during layout
    });

    // Convert back to layout format
    const updatedNodes: LayoutNode[] = layoutGraph.nodes.map(node => {
      const resolved = resolvedNodes.find(r => r.id === node.id);
      if (resolved) {
        return {
          ...node,
          position: { x: resolved.x, y: resolved.y }
        };
      }
      return node;
    });

    return {
      ...layoutGraph,
      nodes: updatedNodes
    };
  }

  /**
   * Store original positions before layout
   */
  private storeOriginalPositions(nodes: CanvasLayoutNode[]): void {
    nodes.forEach(node => {
      if (!this.layoutState.originalPositions.has(node.id)) {
        this.layoutState.originalPositions.set(node.id, { x: node.x, y: node.y });
      }
    });
  }

  /**
   * Apply automatic layout to nodes and edges
   */
  public async applyLayout(
    nodes: CanvasLayoutNode[], 
    edges: CanvasLayoutEdge[], 
    options: Partial<LayoutOptions> = {}
  ): Promise<LayoutResult> {
    const startTime = performance.now();
    
    try {
      // Store original positions if not already stored
      this.storeOriginalPositions(nodes);

      // Set default options
      const layoutOptions: LayoutOptions = {
        algorithm: this.layoutState.algorithm,
        direction: 'DOWN',
        spacing: { node: 60, layer: 80, port: 10 },
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        animate: true,
        animationDuration: 300,
        preventOverlap: true,
        minimizeEdgeCrossings: true,
        ...options
      };

      // Convert to ELK format
      const elkGraph = this.convertToElkFormat(nodes, edges, layoutOptions);

      // Apply layout using ELK
      const elkResult = await this.elk.layout(elkGraph);

      // Convert back to our format
      let layoutGraph = this.convertFromElkFormat(elkResult);

      // Apply post-layout overlap resolution to ensure no overlaps remain
      layoutGraph = this.resolvePostLayoutOverlaps(layoutGraph);

      // Update layout state
      this.layoutState.isAutoLayout = true;
      this.layoutState.lastLayoutTime = Date.now();

      const duration = performance.now() - startTime;
      
      return {
        success: true,
        graph: layoutGraph,
        duration
      };

    } catch (error) {
      console.error('Layout service error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown layout error',
        duration: performance.now() - startTime
      };
    }
  }

  /**
   * Apply incremental layout update for node expansion
   */
  public async applyIncrementalLayout(
    nodes: CanvasLayoutNode[],
    edges: CanvasLayoutEdge[],
    expandedNodeId: string,
    isExpanding: boolean
  ): Promise<LayoutResult> {
    if (!this.layoutState.isAutoLayout) {
      return { success: false, error: 'Not in auto-layout mode' };
    }

    try {
      // Find the expanded node
      const expandedNode = nodes.find(n => n.id === expandedNodeId);
      if (!expandedNode) {
        return { success: false, error: 'Expanded node not found' };
      }

      // Calculate space needed for expansion
      const baseHeight = 100; // Base node height
      const expandedHeight = expandedNode.height;
      const heightDelta = expandedHeight - baseHeight;

      // Create a modified layout that pushes other nodes away
      const modifiedNodes = nodes.map(node => {
        if (node.id === expandedNodeId) {
          return node; // Keep the expanded node as-is
        }

        // Push nodes below the expanded node down
        if (node.y > expandedNode.y) {
          return {
            ...node,
            y: node.y + (isExpanding ? heightDelta : -heightDelta)
          };
        }

        return node;
      });

      // Apply a gentle layout adjustment
      const layoutOptions: LayoutOptions = {
        algorithm: this.layoutState.algorithm,
        spacing: { node: 40, layer: 60, port: 10 }, // Tighter spacing for incremental
        animate: true,
        animationDuration: 200 // Faster animation for incremental updates
      };

      return await this.applyLayout(modifiedNodes, edges, layoutOptions);

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Incremental layout error'
      };
    }
  }

  /**
   * Reset to original manual positions
   */
  public resetToOriginalPositions(nodes: CanvasLayoutNode[]): LayoutGraph {
    const resetNodes: LayoutNode[] = nodes.map(node => {
      const originalPos = this.layoutState.originalPositions.get(node.id);
      return {
        id: node.id,
        position: originalPos || { x: node.x, y: node.y },
        size: { width: node.width, height: node.height },
        isManuallyPositioned: true
      };
    });

    // Reset layout state
    this.layoutState.isAutoLayout = false;

    return {
      nodes: resetNodes,
      edges: [] // Edges don't need position reset
    };
  }

  /**
   * Check if position was manually modified
   */
  public isPositionManuallyModified(nodeId: string, currentPos: LayoutPosition): boolean {
    if (!this.layoutState.isAutoLayout) {
      return true; // All positions are manual if not in auto-layout mode
    }

    const originalPos = this.layoutState.originalPositions.get(nodeId);
    if (!originalPos) {
      return false;
    }

    // Consider position manually modified if moved more than 10 pixels
    const threshold = 10;
    const dx = Math.abs(currentPos.x - originalPos.x);
    const dy = Math.abs(currentPos.y - originalPos.y);

    return dx > threshold || dy > threshold;
  }

  /**
   * Toggle auto-layout mode
   */
  public toggleAutoLayout(): boolean {
    this.layoutState.isAutoLayout = !this.layoutState.isAutoLayout;
    return this.layoutState.isAutoLayout;
  }

  /**
   * Clear stored positions (useful when starting fresh)
   */
  public clearStoredPositions(): void {
    this.layoutState.originalPositions.clear();
    this.layoutState.isAutoLayout = false;
    this.layoutState.lastLayoutTime = undefined;
  }

  /**
   * Get recommended algorithm based on graph characteristics
   */
  public getRecommendedAlgorithm(nodeCount: number, edgeCount: number, hasRootNode: boolean): string {
    if (hasRootNode && edgeCount > 0) {
      return nodeCount > 10 ? 'hierarchical' : 'radial';
    }
    
    if (nodeCount <= 5) {
      return 'organic';
    }
    
    if (edgeCount / nodeCount > 1.5) {
      return 'force'; // Dense graphs work better with force-directed
    }
    
    return 'hierarchical'; // Default for most cases
  }
}