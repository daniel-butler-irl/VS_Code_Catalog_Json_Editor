import React, { useRef, useEffect, useState, useCallback } from 'react';
import { NodeEditor, GetSchemes, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { ReactPlugin, Presets as ReactPresets } from 'rete-react-plugin';
import { RootNode, DependencyNode, RootNodeClass, DependencyNodeClass } from '../nodes';

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

interface FlavorData {
  name: string;
  label?: string;
}

interface OfferingData {
  id: string;
  name: string;
  label?: string;
  description: string;
  versions: string[];
  flavors: FlavorData[];
}

interface CanvasProps {
  graphModel: GraphModel;
  selectedNode: GraphNode | null;
  onNodeSelect: (node: GraphNode | null) => void;
  onAddConnection: (connection: Omit<GraphConnection, 'id'>) => void;
  onRemoveConnection: (connectionId: string) => void;
  onAddDependency: (offering: OfferingData, position: { x: number; y: number }) => void;
  onValidationChange?: (errors: string[]) => void;
}

type Schemes = GetSchemes<
  RootNodeClass | DependencyNodeClass,
  ClassicPreset.Connection<RootNodeClass | DependencyNodeClass, RootNodeClass | DependencyNodeClass>
>;

type AreaExtra = ReactPlugin<Schemes, {}>;

// Create socket selector based on socket type
const createSocketSelector = (socket: ClassicPreset.Socket) => {
  return socket.name === 'string' ? 'string' :
         socket.name === 'number' ? 'number' :
         socket.name === 'object' ? 'object' :
         socket.name === 'boolean' ? 'boolean' : 'any';
};

// Port validation utility
const validatePortConnection = (fromSocket: ClassicPreset.Socket, toSocket: ClassicPreset.Socket): { valid: boolean; reason?: string } => {
  // Same type connections are always allowed
  if (fromSocket.name === toSocket.name) {
    return { valid: true };
  }
  
  // 'any' socket can connect to anything
  if (fromSocket.name === 'any' || toSocket.name === 'any') {
    return { valid: true };
  }
  
  // Type compatibility matrix
  const compatibilityMatrix: { [key: string]: string[] } = {
    'string': ['string', 'any'],
    'number': ['number', 'string', 'any'], // Numbers can be converted to strings
    'boolean': ['boolean', 'string', 'any'], // Booleans can be converted to strings
    'object': ['object', 'any']
  };
  
  const fromType = fromSocket.name;
  const toType = toSocket.name;
  
  if (compatibilityMatrix[fromType]?.includes(toType)) {
    return { valid: true };
  }
  
  return {
    valid: false,
    reason: `Cannot connect ${fromType} to ${toType}. Incompatible types.`
  };
};

// Visual feedback for port connections
const getPortHighlightClass = (socket: ClassicPreset.Socket, isHovered: boolean, isConnectable: boolean): string => {
  let baseClass = 'port-highlight';
  
  if (isHovered) {
    baseClass += isConnectable ? ' port-connectable' : ' port-incompatible';
  }
  
  return baseClass;
};

export const Canvas: React.FC<CanvasProps> = ({
  graphModel,
  selectedNode,
  onNodeSelect,
  onAddConnection,
  onRemoveConnection,
  onAddDependency,
  onValidationChange
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<NodeEditor<Schemes> | null>(null);
  const [area, setArea] = useState<AreaPlugin<Schemes, AreaExtra> | null>(null);
  const [nodeMap, setNodeMap] = useState<Map<string, RootNodeClass | DependencyNodeClass>>(new Map());
  const selectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced selection handler to prevent rapid selection changes
  const handleDebouncedSelection = useCallback((graphNode: GraphNode) => {
    // Clear any existing timeout
    if (selectionTimeoutRef.current) {
      clearTimeout(selectionTimeoutRef.current);
    }
    
    // Set a new timeout to debounce the selection
    selectionTimeoutRef.current = setTimeout(() => {
      // Validate the node data before calling onNodeSelect
      if (graphNode && graphNode.id && graphNode.type && graphNode.data) {
        console.log('Canvas: Debounced selection for node:', graphNode.id);
        onNodeSelect(graphNode);
      } else {
        console.warn('Canvas: Invalid node data for selection:', graphNode);
      }
    }, 100); // 100ms debounce delay
  }, [onNodeSelect]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current);
      }
    };
  }, []);

  // Initialize Rete.js editor
  const initializeEditor = useCallback(async () => {
    if (!canvasRef.current || editor) return;

    console.log('Canvas: Initializing Rete.js editor');

    try {
      // Create editor first
      const newEditor = new NodeEditor<Schemes>();
      console.log('Canvas: NodeEditor created successfully');

      // Create and register AreaPlugin first (must be parent for other plugins)
      const areaPlugin = new AreaPlugin<Schemes, AreaExtra>(canvasRef.current);
      console.log('Canvas: AreaPlugin created, registering with editor');
      await newEditor.use(areaPlugin);
      console.log('Canvas: AreaPlugin registered successfully');

      // Create and register ConnectionPlugin (needs AreaPlugin as parent)
      const connectionPlugin = new ConnectionPlugin<Schemes, AreaExtra>();
      console.log('Canvas: ConnectionPlugin created, registering with area plugin');
      await areaPlugin.use(connectionPlugin);
      console.log('Canvas: ConnectionPlugin registered successfully');

      // Create and register ReactPlugin (needs AreaPlugin as parent)
      const reactPlugin = new ReactPlugin<Schemes, AreaExtra>();
      console.log('Canvas: ReactPlugin created, registering with area plugin');
      await areaPlugin.use(reactPlugin);
      console.log('Canvas: ReactPlugin registered successfully');

      // Add comprehensive drag and drop logging and handling
      console.log('Canvas: Setting up drag and drop. Area content:', areaPlugin.area.content);
      console.log('Canvas: Canvas ref current:', canvasRef.current);
      
      // Multiple approaches to handle drag and drop
      const dropHandler = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Canvas: Drop event triggered!', {
          clientX: e.clientX,
          clientY: e.clientY,
          target: e.target,
          dataTransfer: e.dataTransfer,
          types: e.dataTransfer?.types
        });
        
        try {
          const data = e.dataTransfer?.getData('application/json');
          console.log('Canvas: Drag data:', data);
          
          if (data) {
            const offering = JSON.parse(data);
            
            // Validate offering data
            if (!offering || typeof offering !== 'object' || !offering.id) {
              console.error('Canvas: Invalid offering data:', offering);
              return;
            }
            
            // Convert screen coordinates to area coordinates
            const rect = canvasRef.current?.getBoundingClientRect();
            const canvasPoint = rect ? {
              x: e.clientX - rect.left,
              y: e.clientY - rect.top
            } : { x: e.clientX, y: e.clientY };
            
            console.log('Canvas: Drop offering at position:', offering, canvasPoint);
            
            // Call the parent callback to handle adding the dependency
            onAddDependency(offering, canvasPoint);
          } else {
            console.warn('Canvas: No drag data found');
          }
        } catch (error) {
          console.error('Canvas: Error handling drop:', error);
          // Don't crash the UI - just log the error
        }
      };

      const dragOverHandler = (e: DragEvent) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          console.log('Canvas: Drag over event');
        } catch (error) {
          console.error('Canvas: Error in drag over handler:', error);
        }
      };

      const dragEnterHandler = (e: DragEvent) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          console.log('Canvas: Drag enter event');
        } catch (error) {
          console.error('Canvas: Error in drag enter handler:', error);
        }
      };

      const dragLeaveHandler = (e: DragEvent) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          console.log('Canvas: Drag leave event');
        } catch (error) {
          console.error('Canvas: Error in drag leave handler:', error);
        }
      };

      // Add event listeners to the main container element only
      const containerElement = canvasRef.current;
      if (containerElement) {
        console.log('Canvas: Setting up drag handlers on container element');
        containerElement.addEventListener('drop', dropHandler);
        containerElement.addEventListener('dragover', dragOverHandler);
        containerElement.addEventListener('dragenter', dragEnterHandler);
        containerElement.addEventListener('dragleave', dragLeaveHandler);
      }

      // Configure connection plugin with enhanced socket compatibility
      connectionPlugin.addPreset(ConnectionPresets.classic.setup());

      // Configure React plugin with custom components and enhanced socket rendering
      reactPlugin.addPreset(ReactPresets.classic.setup({
        customize: {
          node(context) {
            if (context.payload instanceof RootNodeClass) {
              return RootNode;
            }
            if (context.payload instanceof DependencyNodeClass) {
              return DependencyNode;
            }
            return ReactPresets.classic.Node;
          }
        }
      }));

      // Configure area plugin
      AreaExtensions.selectableNodes(areaPlugin, AreaExtensions.selector(), {
        accumulating: AreaExtensions.accumulateOnCtrl()
      });

      // Listen for node selection changes with enhanced error handling
      areaPlugin.addPipe(context => {
        try {
          if (context.type === 'nodeselected') {
            console.log('Canvas: Node selected event:', context.data);
            
            // Validate context data
            if (!context.data || !context.data.id) {
              console.warn('Canvas: Invalid selection event data:', context.data);
              return context;
            }
            
            const reteNode = newEditor.getNode(context.data.id);
            console.log('Canvas: Found Rete node:', reteNode);
            
            if (reteNode instanceof RootNodeClass || reteNode instanceof DependencyNodeClass) {
              // Validate that the node has required graph data
              if (!reteNode.graphNode) {
                console.error('Canvas: Selected node missing graphNode data:', reteNode);
                return context;
              }
              
              console.log('Canvas: Valid node instance, graphNode data:', {
                id: reteNode.graphNode.id,
                type: reteNode.graphNode.type,
                name: reteNode.graphNode.name,
                data: reteNode.graphNode.data,
                hasInputs: !!reteNode.graphNode.data?.inputs,
                inputsLength: reteNode.graphNode.data?.inputs?.length || 0,
                hasOutputs: !!reteNode.graphNode.data?.outputs,
                outputsLength: reteNode.graphNode.data?.outputs?.length || 0
              });
              
              // Update selection state
              reteNode.selected = true;
              handleDebouncedSelection(reteNode.graphNode);
              
            } else {
              console.warn('Canvas: Selected node is not a valid RootNodeClass or DependencyNodeClass:', reteNode);
            }
          } else if (context.type === 'nodeunselected') {
            console.log('Canvas: Node unselected event:', context.data);
            
            // Validate context data
            if (!context.data || !context.data.id) {
              console.warn('Canvas: Invalid unselection event data:', context.data);
              return context;
            }
            
            const reteNode = newEditor.getNode(context.data.id);
            if (reteNode instanceof RootNodeClass || reteNode instanceof DependencyNodeClass) {
              reteNode.selected = false;
              // Don't clear selection here - let the user explicitly select another node
            }
          }
        } catch (error) {
          console.error('Canvas: Error in selection event handler:', error);
        }
        return context;
      });

      // Listen for connection changes
      newEditor.addPipe(context => {
        if (context.type === 'connectioncreated') {
          const connection = context.data;
          console.log('Canvas: Connection created', connection);
          
          // Convert Rete connection to our format
          const graphConnection = {
            source: connection.source,
            target: connection.target,
            sourceHandle: connection.sourceOutput,
            targetHandle: connection.targetInput
          };
          onAddConnection(graphConnection);
        } else if (context.type === 'connectionremoved') {
          const connection = context.data;
          console.log('Canvas: Connection removed', connection);
          onRemoveConnection(connection.id);
        }
        return context;
      });

      setEditor(newEditor);
      setArea(areaPlugin);

      console.log('Canvas: Rete.js editor initialized successfully');
    } catch (error) {
      console.error('Canvas: Error initializing Rete.js editor:', error);
      // Reset states in case of error
      setEditor(null);
      setArea(null);
      throw error;
    }
  }, [editor, handleDebouncedSelection, onAddConnection, onRemoveConnection, onAddDependency]);

  // Update editor content when graph model changes
  const updateEditorContent = useCallback(async () => {
    if (!editor || !area) {
      console.warn('Canvas: updateEditorContent called but editor or area not ready', { 
        hasEditor: !!editor, 
        hasArea: !!area 
      });
      return;
    }

    console.log('Canvas: Starting updateEditorContent with graph model:', {
      nodeCount: graphModel.nodes.length,
      connectionCount: graphModel.connections.length,
      nodes: graphModel.nodes,
      selectedProduct: graphModel.selectedProduct,
      selectedFlavor: graphModel.selectedFlavor
    });

    try {
      // Clear existing nodes and connections
      console.log('Canvas: Clearing existing editor content');
      editor.clear();
      const newNodeMap = new Map<string, RootNodeClass | DependencyNodeClass>();

      console.log('Canvas: Processing', graphModel.nodes.length, 'nodes');
      
      // Add nodes
      for (const [index, graphNode] of graphModel.nodes.entries()) {
        console.log(`Canvas: Processing node ${index + 1}/${graphModel.nodes.length}:`, {
          id: graphNode.id,
          type: graphNode.type,
          name: graphNode.name,
          position: graphNode.position,
          data: graphNode.data
        });

        let reteNode: RootNodeClass | DependencyNodeClass;
        
        try {
          if (graphNode.type === 'root') {
            console.log('Canvas: Creating RootNodeClass instance');
            reteNode = new RootNodeClass(graphNode);
          } else {
            console.log('Canvas: Creating DependencyNodeClass instance');
            reteNode = new DependencyNodeClass(graphNode);
          }

          console.log('Canvas: Node class created successfully:', {
            nodeId: reteNode.id,
            nodeLabel: reteNode.label,
            nodeInputs: reteNode.inputs.size,
            nodeOutputs: reteNode.outputs.size
          });

          console.log('Canvas: Adding node to editor');
          await editor.addNode(reteNode);
          
          console.log('Canvas: Node added to editor successfully');
          newNodeMap.set(graphNode.id, reteNode);

          // Position the node
          console.log('Canvas: Positioning node at:', graphNode.position);
          await area.translate(reteNode.id, {
            x: graphNode.position.x,
            y: graphNode.position.y
          });
          console.log('Canvas: Node positioned successfully');

          // Set selection state
          if (selectedNode?.id === graphNode.id) {
            console.log('Canvas: Setting node as selected');
            reteNode.selected = true;
          }

          console.log(`Canvas: Successfully processed node ${graphNode.id}`);
        } catch (nodeError) {
          console.error(`Canvas: Error processing node ${graphNode.id}:`, nodeError);
          throw nodeError;
        }
      }

      console.log('Canvas: All nodes processed. Processing connections...');

      // Add connections
      for (const [index, graphConnection] of graphModel.connections.entries()) {
        console.log(`Canvas: Processing connection ${index + 1}/${graphModel.connections.length}:`, graphConnection);
        
        const sourceNode = newNodeMap.get(graphConnection.source);
        const targetNode = newNodeMap.get(graphConnection.target);

        if (sourceNode && targetNode) {
          const sourceOutput = sourceNode.outputs.get(graphConnection.sourceHandle);
          const targetInput = targetNode.inputs.get(graphConnection.targetHandle);

          if (sourceOutput && targetInput) {
            const connection = new ClassicPreset.Connection(
              sourceNode,
              graphConnection.sourceHandle,
              targetNode,
              graphConnection.targetHandle
            );
            connection.id = graphConnection.id;
            await editor.addConnection(connection);
            console.log(`Canvas: Connection ${graphConnection.id} added successfully`);
          } else {
            console.warn(`Canvas: Could not find ports for connection ${graphConnection.id}`, {
              hasSourceOutput: !!sourceOutput,
              hasTargetInput: !!targetInput,
              sourceOutputs: Array.from(sourceNode.outputs.keys()),
              targetInputs: Array.from(targetNode.inputs.keys())
            });
          }
        } else {
          console.warn(`Canvas: Could not find nodes for connection ${graphConnection.id}`, {
            hasSourceNode: !!sourceNode,
            hasTargetNode: !!targetNode,
            availableNodes: Array.from(newNodeMap.keys())
          });
        }
      }

      setNodeMap(newNodeMap);

      console.log('Canvas: All content processed. Editor nodes:', editor.getNodes().length);
      
      // Fit view to content
      try {
        console.log('Canvas: Fitting view to content');
        AreaExtensions.zoomAt(area, editor.getNodes());
        console.log('Canvas: View fitted successfully');
      } catch (zoomError) {
        console.error('Canvas: Error fitting view:', zoomError);
      }

      console.log('Canvas: Editor content updated successfully. Final state:', {
        editorNodes: editor.getNodes().length,
        nodeMapSize: newNodeMap.size,
        areaTransform: area.area.transform
      });
    } catch (error) {
      console.error('Canvas: Error updating editor content:', error);
      console.error('Canvas: Error stack:', error.stack);
    }
  }, [editor, area, graphModel, selectedNode]);


  // Initialize editor when component mounts
  useEffect(() => {
    initializeEditor();
  }, [initializeEditor]);

  // Update content when graph model changes
  useEffect(() => {
    if (editor && area) {
      updateEditorContent();
    }
  }, [updateEditorContent]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedNode && selectedNode.type !== 'root') {
        if (window.confirm(`Remove dependency "${selectedNode.name}"?`)) {
          console.log('Canvas: Delete node:', selectedNode.id);
          // This will be handled by the parent component
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
        className="rete-area"
        style={{ width: '100%', height: '100%' }}
      />

      {/* Canvas controls */}
      <div className="canvas-controls">
        <div className="control-group">
          <button 
            className="canvas-control-btn"
            onClick={() => area && AreaExtensions.zoomAt(area, editor?.getNodes() || [])}
            title="Fit to Screen"
          >
            ⚏
          </button>
          <button 
            className="canvas-control-btn"
            onClick={() => area && area.area.zoom(area.area.transform.k * 1.2)}
            title="Zoom In"
          >
            +
          </button>
          <span className="zoom-level">
            {area ? Math.round(area.area.transform.k * 100) : 100}%
          </span>
          <button 
            className="canvas-control-btn"
            onClick={() => area && area.area.zoom(area.area.transform.k / 1.2)}
            title="Zoom Out"
          >
            -
          </button>
        </div>
        
        <div className="control-group">
          <button 
            className="canvas-control-btn"
            onClick={() => {
              if (editor && area) {
                // Auto-arrange nodes
                const nodes = editor.getNodes();
                nodes.forEach((node, index) => {
                  const x = 100 + (index % 3) * 250;
                  const y = 100 + Math.floor(index / 3) * 200;
                  area.translate(node.id, { x, y });
                });
              }
            }}
            title="Auto Layout"
          >
            🎯
          </button>
        </div>
      </div>

      {/* Enhanced info overlay */}
      <div className="canvas-info">
        <div className="info-section">
          <div className="info-label">Flavor:</div>
          <div className="info-value">{graphModel.selectedFlavor || 'None'}</div>
        </div>
        <div className="info-section">
          <div className="info-label">Nodes:</div>
          <div className="info-value">{graphModel.nodes.length}</div>
        </div>
        <div className="info-section">
          <div className="info-label">Connections:</div>
          <div className="info-value">{graphModel.connections.length}</div>
        </div>
        {selectedNode && (
          <div className="info-section selected-node-info">
            <div className="info-label">Selected:</div>
            <div className="info-value">{selectedNode.name}</div>
          </div>
        )}
      </div>
      
      {/* Port type legend */}
      <div className="port-legend">
        <div className="legend-title">Port Types</div>
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-port string-port"></div>
            <span>String</span>
          </div>
          <div className="legend-item">
            <div className="legend-port number-port"></div>
            <span>Number</span>
          </div>
          <div className="legend-item">
            <div className="legend-port boolean-port"></div>
            <span>Boolean</span>
          </div>
          <div className="legend-item">
            <div className="legend-port object-port"></div>
            <span>Object</span>
          </div>
          <div className="legend-item">
            <div className="legend-port any-port"></div>
            <span>Any</span>
          </div>
        </div>
      </div>
    </div>
  );
};