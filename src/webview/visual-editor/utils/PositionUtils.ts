// Position utility functions for node positioning and validation

export interface NodeBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionConstraints {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  snapToGrid?: boolean;
  gridSize?: number;
}

export class PositionUtils {
  /**
   * Snap position to grid if enabled
   */
  public static snapToGrid(position: { x: number; y: number }, gridSize: number = 20): { x: number; y: number } {
    return {
      x: Math.round(position.x / gridSize) * gridSize,
      y: Math.round(position.y / gridSize) * gridSize
    };
  }

  /**
   * Constrain position to boundaries
   */
  public static constrainToBounds(
    position: { x: number; y: number },
    nodeSize: { width: number; height: number },
    constraints: PositionConstraints
  ): { x: number; y: number } {
    let { x, y } = position;

    // Apply boundary constraints
    x = Math.max(constraints.minX, Math.min(x, constraints.maxX - nodeSize.width));
    y = Math.max(constraints.minY, Math.min(y, constraints.maxY - nodeSize.height));

    // Apply grid snapping if enabled
    if (constraints.snapToGrid && constraints.gridSize) {
      const snapped = this.snapToGrid({ x, y }, constraints.gridSize);
      x = snapped.x;
      y = snapped.y;
    }

    return { x, y };
  }

  /**
   * Calculate the center point of a node
   */
  public static getNodeCenter(node: NodeBounds): { x: number; y: number } {
    return {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2
    };
  }

  /**
   * Calculate distance between two points
   */
  public static calculateDistance(point1: { x: number; y: number }, point2: { x: number; y: number }): number {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Find the closest node to a given position
   */
  public static findClosestNode(
    position: { x: number; y: number },
    nodes: NodeBounds[],
    excludeId?: string
  ): NodeBounds | null {
    let closestNode: NodeBounds | null = null;
    let minDistance = Infinity;

    for (const node of nodes) {
      if (excludeId && node.id === excludeId) {continue;}

      const nodeCenter = this.getNodeCenter(node);
      const distance = this.calculateDistance(position, nodeCenter);

      if (distance < minDistance) {
        minDistance = distance;
        closestNode = node;
      }
    }

    return closestNode;
  }

  /**
   * Calculate optimal positioning to avoid overlaps
   */
  public static calculateAvoidancePosition(
    targetNode: { width: number; height: number },
    obstacleNode: NodeBounds,
    preferredDirection: 'left' | 'right' | 'top' | 'bottom' | 'auto' = 'auto',
    margin: number = 20
  ): { x: number; y: number } {
    const positions = {
      left: { x: obstacleNode.x - targetNode.width - margin, y: obstacleNode.y },
      right: { x: obstacleNode.x + obstacleNode.width + margin, y: obstacleNode.y },
      top: { x: obstacleNode.x, y: obstacleNode.y - targetNode.height - margin },
      bottom: { x: obstacleNode.x, y: obstacleNode.y + obstacleNode.height + margin }
    };

    if (preferredDirection !== 'auto') {
      return positions[preferredDirection];
    }

    // Choose the position that keeps the node closest to its original preferred location
    const obstacleCenter = this.getNodeCenter(obstacleNode);
    const candidates = Object.entries(positions).map(([direction, pos]) => ({
      direction,
      position: pos,
      distance: this.calculateDistance(pos, obstacleCenter)
    }));

    // Sort by distance and return the closest position
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0].position;
  }

  /**
   * Check if two rectangles intersect
   */
  public static rectanglesIntersect(
    rect1: NodeBounds,
    rect2: NodeBounds,
    margin: number = 0
  ): boolean {
    return !(
      rect1.x + rect1.width + margin <= rect2.x ||
      rect2.x + rect2.width + margin <= rect1.x ||
      rect1.y + rect1.height + margin <= rect2.y ||
      rect2.y + rect2.height + margin <= rect1.y
    );
  }

  /**
   * Get all nodes that intersect with a given rectangle
   */
  public static getIntersectingNodes(
    targetRect: { x: number; y: number; width: number; height: number },
    nodes: NodeBounds[],
    margin: number = 0,
    excludeId?: string
  ): NodeBounds[] {
    return nodes.filter(node => {
      if (excludeId && node.id === excludeId) {return false;}
      return this.rectanglesIntersect(targetRect, node, margin);
    });
  }

  /**
   * Calculate bounding box for multiple nodes
   */
  public static calculateBoundingBox(nodes: NodeBounds[]): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (nodes.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    nodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Distribute nodes evenly in a grid pattern
   */
  public static distributeInGrid(
    nodes: NodeBounds[],
    constraints: {
      startX: number;
      startY: number;
      spacingX: number;
      spacingY: number;
      maxColumns?: number;
    }
  ): NodeBounds[] {
    const maxColumns = constraints.maxColumns || Math.ceil(Math.sqrt(nodes.length));
    
    return nodes.map((node, index) => {
      const column = index % maxColumns;
      const row = Math.floor(index / maxColumns);
      
      return {
        ...node,
        x: constraints.startX + column * constraints.spacingX,
        y: constraints.startY + row * constraints.spacingY
      };
    });
  }

  /**
   * Apply force-based separation to prevent overlaps
   */
  public static applyForceSeparation(
    nodes: NodeBounds[],
    iterations: number = 10,
    repulsionStrength: number = 100,
    margin: number = 20
  ): NodeBounds[] {
    const result = nodes.map(node => ({ ...node }));
    
    for (let iter = 0; iter < iterations; iter++) {
      const forces = result.map(() => ({ x: 0, y: 0 }));
      
      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const node1 = result[i];
          const node2 = result[j];
          
          // Check if nodes are overlapping or too close
          if (this.rectanglesIntersect(node1, node2, margin)) {
            const center1 = this.getNodeCenter(node1);
            const center2 = this.getNodeCenter(node2);
            
            const dx = center2.x - center1.x;
            const dy = center2.y - center1.y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1; // Avoid division by zero
            
            const force = repulsionStrength / (distance * distance);
            const forceX = (dx / distance) * force;
            const forceY = (dy / distance) * force;
            
            forces[i].x -= forceX;
            forces[i].y -= forceY;
            forces[j].x += forceX;
            forces[j].y += forceY;
          }
        }
      }
      
      // Apply forces with damping
      const damping = 0.1;
      result.forEach((node, i) => {
        node.x += forces[i].x * damping;
        node.y += forces[i].y * damping;
      });
    }
    
    return result;
  }

  /**
   * Find optimal canvas size to fit all nodes
   */
  public static calculateOptimalCanvasSize(
    nodes: NodeBounds[],
    padding: number = 50
  ): { width: number; height: number } {
    if (nodes.length === 0) {
      return { width: 800, height: 600 };
    }

    const bounds = this.calculateBoundingBox(nodes);
    
    return {
      width: bounds.width + 2 * padding,
      height: bounds.height + 2 * padding
    };
  }

  /**
   * Validate if a position is suitable for a node
   */
  public static isValidPosition(
    position: { x: number; y: number },
    nodeSize: { width: number; height: number },
    existingNodes: NodeBounds[],
    constraints: PositionConstraints,
    margin: number = 20,
    excludeId?: string
  ): boolean {
    // Check boundary constraints
    if (position.x < constraints.minX || 
        position.y < constraints.minY ||
        position.x + nodeSize.width > constraints.maxX ||
        position.y + nodeSize.height > constraints.maxY) {
      return false;
    }

    // Check for overlaps with existing nodes
    const targetRect = {
      id: 'temp',
      x: position.x,
      y: position.y,
      width: nodeSize.width,
      height: nodeSize.height
    };

    const intersecting = this.getIntersectingNodes(targetRect, existingNodes, margin, excludeId);
    return intersecting.length === 0;
  }
}