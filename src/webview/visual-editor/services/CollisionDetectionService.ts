// Collision detection service for preventing node overlaps

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface CollisionOptions {
  margin: number;
  enableBoundaryCheck: boolean;
  canvasBounds?: Rectangle;
}

export interface ValidationResult {
  isValid: boolean;
  conflicts: string[];
  nearestValidPosition?: Position;
}

export class CollisionDetectionService {
  private defaultMargin: number = 20;
  private defaultCanvasBounds: Rectangle = { x: 0, y: 0, width: 4000, height: 3000 };

  /**
   * Check if two rectangles overlap with optional margin
   */
  public checkRectangleOverlap(rect1: Rectangle, rect2: Rectangle, margin: number = 0): boolean {
    // Two rectangles overlap if they are NOT separated by at least margin pixels
    // For rectangles to be separated by margin, one of these must be true:
    // - rect1 is to the left of rect2 with margin: rect1.x + rect1.width + margin <= rect2.x
    // - rect2 is to the left of rect1 with margin: rect2.x + rect2.width + margin <= rect1.x  
    // - rect1 is above rect2 with margin: rect1.y + rect1.height + margin <= rect2.y
    // - rect2 is above rect1 with margin: rect2.y + rect2.height + margin <= rect1.y
    return !(
      rect1.x + rect1.width + margin <= rect2.x ||
      rect2.x + rect2.width + margin <= rect1.x ||
      rect1.y + rect1.height + margin <= rect2.y ||
      rect2.y + rect2.height + margin <= rect1.y
    );
  }

  /**
   * Check if a node at a specific position would overlap with other nodes
   */
  public validatePosition(
    targetNodeId: string,
    position: Position,
    nodeSize: { width: number; height: number },
    allNodes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
    options: Partial<CollisionOptions> = {}
  ): ValidationResult {
    const margin = options.margin ?? this.defaultMargin;
    const enableBoundaryCheck = options.enableBoundaryCheck ?? true;
    const canvasBounds = options.canvasBounds ?? this.defaultCanvasBounds;

    const targetRect: Rectangle = {
      x: position.x,
      y: position.y,
      width: nodeSize.width,
      height: nodeSize.height
    };

    const conflicts: string[] = [];

    console.log('=== ValidatePosition Debug ===');
    console.log('Target node ID:', targetNodeId);
    console.log('Target rect:', targetRect);
    console.log('Margin:', margin);
    console.log('All nodes count:', allNodes.length);

    // Check collision with other nodes
    for (const node of allNodes) {
      if (node.id === targetNodeId) {
        console.log(`Skipping self: ${node.id}`);
        continue;
      }

      const nodeRect: Rectangle = {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height
      };

      const overlaps = this.checkRectangleOverlap(targetRect, nodeRect, margin);
      console.log(`Checking ${node.id}:`, {nodeRect, overlaps});

      if (overlaps) {
        conflicts.push(node.id);
        console.log(`  -> Added to conflicts: ${node.id}`);
      }
    }

    console.log('Final conflicts:', conflicts);
    console.log('=== End ValidatePosition Debug ===');

    // Check canvas boundaries
    let boundsValid = true;
    if (enableBoundaryCheck) {
      boundsValid = (
        position.x >= canvasBounds.x + margin &&
        position.y >= canvasBounds.y + margin &&
        position.x + nodeSize.width <= canvasBounds.x + canvasBounds.width - margin &&
        position.y + nodeSize.height <= canvasBounds.y + canvasBounds.height - margin
      );
    }

    const isValid = conflicts.length === 0 && boundsValid;

    return {
      isValid,
      conflicts,
      nearestValidPosition: isValid ? undefined : this.findNearestValidPosition(
        targetNodeId,
        position,
        nodeSize,
        allNodes,
        options
      )
    };
  }

  /**
   * Find the nearest valid position for a node that doesn't overlap with others
   */
  public findNearestValidPosition(
    targetNodeId: string,
    preferredPosition: Position,
    nodeSize: { width: number; height: number },
    allNodes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
    options: Partial<CollisionOptions> = {}
  ): Position {
    const margin = options.margin ?? this.defaultMargin;
    const maxAttempts = 100;
    const spiralStep = 10;

    // Try the preferred position first
    const validation = this.validatePosition(targetNodeId, preferredPosition, nodeSize, allNodes, options);
    if (validation.isValid) {
      return preferredPosition;
    }

    // Spiral outward from the preferred position
    for (let radius = spiralStep; radius < maxAttempts * spiralStep; radius += spiralStep) {
      const positions = this.generateSpiralPositions(preferredPosition, radius, 8);
      
      for (const position of positions) {
        const validation = this.validatePosition(targetNodeId, position, nodeSize, allNodes, options);
        if (validation.isValid) {
          return position;
        }
      }
    }

    // If no valid position found, try to push other nodes away
    return this.findPositionWithPushAway(targetNodeId, preferredPosition, nodeSize, allNodes, options);
  }

  /**
   * Generate positions in a spiral pattern around a center point
   */
  private generateSpiralPositions(center: Position, radius: number, points: number): Position[] {
    const positions: Position[] = [];
    const angleStep = (2 * Math.PI) / points;

    for (let i = 0; i < points; i++) {
      const angle = i * angleStep;
      positions.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }

    return positions;
  }

  /**
   * Find a position by considering pushing other nodes away
   */
  private findPositionWithPushAway(
    targetNodeId: string,
    preferredPosition: Position,
    nodeSize: { width: number; height: number },
    allNodes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
    options: Partial<CollisionOptions> = {}
  ): Position {
    const margin = options.margin ?? this.defaultMargin;
    
    // Find the closest non-overlapping position by examining each conflicting node
    let bestPosition = preferredPosition;
    let minDistance = Infinity;

    const validation = this.validatePosition(targetNodeId, preferredPosition, nodeSize, allNodes, options);
    
    for (const conflictId of validation.conflicts) {
      const conflictNode = allNodes.find(n => n.id === conflictId);
      if (!conflictNode) {continue;}

      // Try positions around the conflicting node
      const positions = [
        // Left of conflicting node
        { x: conflictNode.x - nodeSize.width - margin, y: conflictNode.y },
        // Right of conflicting node
        { x: conflictNode.x + conflictNode.width + margin, y: conflictNode.y },
        // Above conflicting node
        { x: conflictNode.x, y: conflictNode.y - nodeSize.height - margin },
        // Below conflicting node
        { x: conflictNode.x, y: conflictNode.y + conflictNode.height + margin }
      ];

      for (const position of positions) {
        const posValidation = this.validatePosition(targetNodeId, position, nodeSize, allNodes, options);
        if (posValidation.isValid) {
          const distance = this.calculateDistance(preferredPosition, position);
          if (distance < minDistance) {
            minDistance = distance;
            bestPosition = position;
          }
        }
      }
    }

    return bestPosition;
  }

  /**
   * Calculate Euclidean distance between two positions
   */
  private calculateDistance(pos1: Position, pos2: Position): number {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Check if a position is within canvas bounds
   */
  public isWithinBounds(
    position: Position,
    nodeSize: { width: number; height: number },
    canvasBounds: Rectangle,
    margin: number = 0
  ): boolean {
    return (
      position.x >= canvasBounds.x + margin &&
      position.y >= canvasBounds.y + margin &&
      position.x + nodeSize.width <= canvasBounds.x + canvasBounds.width - margin &&
      position.y + nodeSize.height <= canvasBounds.y + canvasBounds.height - margin
    );
  }

  /**
   * Get collision-free layout for all nodes
   */
  public resolveAllOverlaps(
    nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
    options: Partial<CollisionOptions> = {}
  ): Array<{ id: string; x: number; y: number; width: number; height: number }> {
    const margin = options.margin ?? this.defaultMargin;
    const resolvedNodes = [...nodes];

    // Sort nodes by position (top-left to bottom-right) to maintain relative positioning
    resolvedNodes.sort((a, b) => {
      const aScore = a.y * 10000 + a.x;
      const bScore = b.y * 10000 + b.x;
      return aScore - bScore;
    });

    // Resolve overlaps iteratively
    for (let i = 0; i < resolvedNodes.length; i++) {
      const node = resolvedNodes[i];
      const otherNodes = resolvedNodes.filter((_, index) => index !== i);
      
      const validation = this.validatePosition(
        node.id,
        { x: node.x, y: node.y },
        { width: node.width, height: node.height },
        otherNodes,
        options
      );

      if (!validation.isValid && validation.nearestValidPosition) {
        resolvedNodes[i] = {
          ...node,
          x: validation.nearestValidPosition.x,
          y: validation.nearestValidPosition.y
        };
      }
    }

    return resolvedNodes;
  }

  /**
   * Set default collision margin
   */
  public setDefaultMargin(margin: number): void {
    this.defaultMargin = Math.max(0, margin);
  }

  /**
   * Set default canvas bounds
   */
  public setCanvasBounds(bounds: Rectangle): void {
    this.defaultCanvasBounds = bounds;
  }
}