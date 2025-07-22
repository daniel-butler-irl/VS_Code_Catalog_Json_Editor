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
  ClassicPreset.Node & { graphNode?: GraphNode },
  ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>
>;

type AreaExtra = ReactPlugin<Schemes, any>;

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
  
  // Alternative selection mechanism - direct node mapping
  const nodeIdToGraphNodeMap = useRef<Map<string, GraphNode>>(new Map());

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
      await (areaPlugin as any).use(connectionPlugin);
      console.log('Canvas: ConnectionPlugin registered successfully');

      // Create and register ReactPlugin (needs AreaPlugin as parent)
      const reactPlugin = new ReactPlugin<Schemes, AreaExtra>();
      console.log('Canvas: ReactPlugin created, registering with area plugin');
      await (areaPlugin as any).use(reactPlugin);
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
        
        // Add click listener to debug all clicks
        const debugClickHandler = (e: MouseEvent) => {
          console.log('Canvas: Click event detected:', {
            clientX: e.clientX,
            clientY: e.clientY,
            target: e.target,
            targetTagName: (e.target as HTMLElement)?.tagName,
            targetClass: (e.target as HTMLElement)?.className,
            timestamp: Date.now()
          });
        };
        containerElement.addEventListener('click', debugClickHandler);
      }

      // Configure connection plugin with enhanced socket compatibility
      connectionPlugin.addPreset(ConnectionPresets.classic.setup() as any);

      // Configure React plugin with custom components and enhanced socket rendering
      reactPlugin.addPreset(ReactPresets.classic.setup({
        customize: {
          node(context: any) {
            // Check if the node has our custom graphNode property
            if (context.payload && context.payload.graphNode) {
              if (context.payload.graphNode.type === 'root') {
                return RootNode as any;
              }
              if (context.payload.graphNode.type === 'dependency') {
                return DependencyNode as any;
              }
            }
            return ReactPresets.classic.Node;
          }
        }
      }) as any);

      // Configure area plugin with enhanced debugging
      console.log('Canvas: Setting up selectableNodes extension');
      AreaExtensions.selectableNodes(areaPlugin, AreaExtensions.selector(), {
        accumulating: AreaExtensions.accumulateOnCtrl()
      });
      console.log('Canvas: selectableNodes extension configured');

      // Listen for ALL area plugin events to debug selection
      areaPlugin.addPipe((context: any) => {
        console.log('Canvas: AreaPlugin event:', {
          type: context.type,
          data: context.data,
          timestamp: Date.now()
        });
        return context;
      });

      // Listen for node selection changes with enhanced error handling
      areaPlugin.addPipe((context: any) => {
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
            
            // Cast to our custom node types and check for graphNode
            const customNode = reteNode as any;
            if (customNode && customNode.graphNode) {
              console.log('Canvas: Valid node instance, graphNode data:', {
                id: customNode.graphNode.id,
                type: customNode.graphNode.type,
                name: customNode.graphNode.name,
                data: customNode.graphNode.data,
                hasInputs: !!customNode.graphNode.data?.inputs,
                inputsLength: customNode.graphNode.data?.inputs?.length || 0,
                hasOutputs: !!customNode.graphNode.data?.outputs,
                outputsLength: customNode.graphNode.data?.outputs?.length || 0
              });
              
              // Update selection state
              customNode.selected = true;
              handleDebouncedSelection(customNode.graphNode);
              
            } else {
              console.warn('Canvas: Selected node missing graphNode data, trying alternative access:', reteNode);
              
              // Try alternative method - direct mapping lookup
              const graphNodeFromMap = nodeIdToGraphNodeMap.current.get(context.data.id);
              if (graphNodeFromMap) {
                console.log('Canvas: Found graphNode via direct mapping:', graphNodeFromMap);
                if (customNode) {
                  customNode.selected = true;
                }
                handleDebouncedSelection(graphNodeFromMap);
              } else {
                console.error('Canvas: Could not find graphNode data for selected node:', context.data.id);
                console.error('Canvas: Available mappings:', Array.from(nodeIdToGraphNodeMap.current.keys()));
              }
            }
          } else if (context.type === 'nodeunselected') {
            console.log('Canvas: Node unselected event:', context.data);
            
            // Validate context data
            if (!context.data || !context.data.id) {
              console.warn('Canvas: Invalid unselection event data:', context.data);
              return context;
            }
            
            const reteNode = newEditor.getNode(context.data.id);
            const customNode = reteNode as any;
            if (customNode && customNode.graphNode) {
              customNode.selected = false;
              // Don't clear selection here - let the user explicitly select another node
            }
          }
        } catch (error) {
          console.error('Canvas: Error in selection event handler:', error);
        }
        return context;
      });

      // Listen for ALL editor events to debug
      newEditor.addPipe((context: any) => {
        console.log('Canvas: Editor event:', {
          type: context.type,
          data: context.data,
          timestamp: Date.now()
        });
        return context;
      });
      
      // Listen for custom nodeclick events from React components
      reactPlugin.addPipe((context: any) => {
        console.log('Canvas: React plugin event:', {
          type: context.type,
          data: context.data,
          timestamp: Date.now()
        });
        
        if (context.type === 'nodeclick') {
          console.log('Canvas: React nodeclick event detected:', context.data);
          if (context.data && context.data.id) {
            console.log('Canvas: Processing React nodeclick for node:', context.data.id);
            handleDebouncedSelection(context.data);
          }
        }
        
        return context;
      });

      // Listen for connection changes
      newEditor.addPipe((context: any) => {
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
      
      // Add a test to verify node accessibility after initialization
      setTimeout(() => {
        console.log('Canvas: Post-initialization node verification:');
        const editorNodes = newEditor.getNodes();
        console.log('Canvas: Editor nodes count:', editorNodes.length);
        editorNodes.forEach((node, index) => {
          console.log(`Canvas: Node ${index}:`, {
            id: node.id,
            label: node.label,
            hasGraphNode: !!(node as any).graphNode,
            graphNodeId: (node as any).graphNode?.id,
            graphNodeType: (node as any).graphNode?.type
          });
        });
      }, 100);
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

          // Ensure graphNode property is accessible
          console.log('Canvas: Verifying graphNode property on reteNode:', {
            hasGraphNode: !!reteNode.graphNode,
            graphNodeId: reteNode.graphNode?.id,
            graphNodeType: reteNode.graphNode?.type,
            reteNodeId: reteNode.id
          });

          // Position the node
          console.log('Canvas: Positioning node at:', graphNode.position);
          await area.translate(reteNode.id, {
            x: graphNode.position.x,
            y: graphNode.position.y
          });
          console.log('Canvas: Node positioned successfully');
          
          // Store direct mapping for alternative selection
          nodeIdToGraphNodeMap.current.set(graphNode.id, graphNode);
          console.log('Canvas: Stored graphNode mapping for direct access');

          // Set selection state
          if (selectedNode?.id === graphNode.id) {
            console.log('Canvas: Setting node as selected');
            reteNode.selected = true;
          } else {
            reteNode.selected = false;
          }
          
          // Add direct click handler to node element (alternative method)
          setTimeout(() => {
            const nodeElement = canvasRef.current?.querySelector(`[data-node-id="${graphNode.id}"]`);
            if (nodeElement) {
              console.log('Canvas: Adding direct click handler to node element');
              nodeElement.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('Canvas: Direct node click detected:', graphNode.id);
                handleDebouncedSelection(graphNode);
              });
            } else {
              console.warn('Canvas: Could not find node element for direct click handler');
            }
          }, 50);

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
          const sourceOutput = (sourceNode as any).outputs.get(graphConnection.sourceHandle);
          const targetInput = (targetNode as any).inputs.get(graphConnection.targetHandle);

          if (sourceOutput && targetInput) {
            const connection = new ClassicPreset.Connection(
              sourceNode as any,
              graphConnection.sourceHandle,
              targetNode as any,
              graphConnection.targetHandle
            );
            (connection as any).id = graphConnection.id;
            await editor.addConnection(connection);
            console.log(`Canvas: Connection ${graphConnection.id} added successfully`);
          } else {
            console.warn(`Canvas: Could not find ports for connection ${graphConnection.id}`, {
              hasSourceOutput: !!sourceOutput,
              hasTargetInput: !!targetInput,
              sourceOutputs: Array.from((sourceNode as any).outputs.keys()),
              targetInputs: Array.from((targetNode as any).inputs.keys())
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
      console.error('Canvas: Error stack:', (error as Error).stack);
    }
  }, [editor, area, graphModel]);

  // Update individual node properties without full rebuild
  const updateNodeIncremental = useCallback(async (nodeId: string, updatedGraphNode: GraphNode) => {
    if (!editor || !area || !nodeMap.has(nodeId)) {
      console.warn('Canvas: Cannot update node incrementally - editor, area, or node not found', {
        hasEditor: !!editor,
        hasArea: !!area,
        hasNode: nodeMap.has(nodeId)
      });
      return false;
    }

    try {
      console.log('Canvas: Updating node incrementally:', nodeId, updatedGraphNode);
      
      const reteNode = nodeMap.get(nodeId);
      if (!reteNode) {
        console.warn('Canvas: Cannot find Rete node for incremental update:', nodeId);
        return false;
      }

      // Update the graphNode property on the Rete node
      (reteNode as any).graphNode = updatedGraphNode;
      
      // Update the node data and ports based on the updated graph node
      if (updatedGraphNode.type === 'root') {
        // For root nodes, update inputs and outputs
        if (updatedGraphNode.data.inputs) {
          // Clear existing inputs
          Object.keys(reteNode.inputs || {}).forEach(key => {
            (reteNode as any).removeInput(key);
          });
          
          updatedGraphNode.data.inputs.forEach((input: any) => {
            if (input.connector) {
              const socket = new ClassicPreset.Socket(input.type || 'string');
              const inputInstance = new ClassicPreset.Input(socket, input.name);
              (reteNode as any).addInput(input.name, inputInstance);
            }
          });
        }
        
        if (updatedGraphNode.data.outputs) {
          // Clear existing outputs
          Object.keys(reteNode.outputs || {}).forEach(key => {
            (reteNode as any).removeOutput(key);
          });
          
          updatedGraphNode.data.outputs.forEach((output: any) => {
            if (output.connector) {
              const socket = new ClassicPreset.Socket(output.type || 'string');
              const outputInstance = new ClassicPreset.Output(socket, output.name);
              (reteNode as any).addOutput(output.name, outputInstance);
            }
          });
        }
      } else if (updatedGraphNode.type === 'dependency') {
        // For dependency nodes, update ports similarly
        if (updatedGraphNode.data.inputs) {
          // Clear existing inputs
          Object.keys(reteNode.inputs || {}).forEach(key => {
            (reteNode as any).removeInput(key);
          });
          
          updatedGraphNode.data.inputs.forEach((input: any) => {
            if (input.connector) {
              const socket = new ClassicPreset.Socket(input.type || 'string');
              const inputInstance = new ClassicPreset.Input(socket, input.name);
              (reteNode as any).addInput(input.name, inputInstance);
            }
          });
        }
        
        if (updatedGraphNode.data.outputs) {
          // Clear existing outputs
          Object.keys(reteNode.outputs || {}).forEach(key => {
            (reteNode as any).removeOutput(key);
          });
          
          updatedGraphNode.data.outputs.forEach((output: any) => {
            if (output.connector) {
              const socket = new ClassicPreset.Socket(output.type || 'string');
              const outputInstance = new ClassicPreset.Output(socket, output.name);
              (reteNode as any).addOutput(output.name, outputInstance);
            }
          });
        }
      }

      // Update the node in the area to trigger re-render
      await area.update('node', nodeId);
      
      console.log('Canvas: Successfully updated node incrementally:', nodeId);
      return true;
      
    } catch (error) {
      console.error('Canvas: Error updating node incrementally:', error);
      return false;
    }
  }, [editor, area, nodeMap]);

  // Track previous graph model for incremental updates
  const prevGraphModelRef = useRef<GraphModel | null>(null);

  // Detect if this is an incremental update (only node properties changed)
  const isIncrementalUpdate = useCallback((prev: GraphModel | null, current: GraphModel): { isIncremental: boolean; changedNodeId?: string } => {
    if (!prev || !current) return { isIncremental: false };
    
    // Check if the structure is the same (same number of nodes and connections)
    if (prev.nodes.length !== current.nodes.length || 
        prev.connections.length !== current.connections.length) {
      return { isIncremental: false };
    }
    
    // Check if any node IDs changed (structural change)
    const prevNodeIds = new Set(prev.nodes.map(n => n.id));
    const currentNodeIds = new Set(current.nodes.map(n => n.id));
    if (prevNodeIds.size !== currentNodeIds.size) {
      return { isIncremental: false };
    }
    
    for (const id of prevNodeIds) {
      if (!currentNodeIds.has(id)) {
        return { isIncremental: false };
      }
    }
    
    // Check if connections changed
    const prevConnections = prev.connections.map(c => `${c.source}-${c.target}-${c.sourceHandle}-${c.targetHandle}`);
    const currentConnections = current.connections.map(c => `${c.source}-${c.target}-${c.sourceHandle}-${c.targetHandle}`);
    if (prevConnections.length !== currentConnections.length) {
      return { isIncremental: false };
    }
    
    for (const conn of prevConnections) {
      if (!currentConnections.includes(conn)) {
        return { isIncremental: false };
      }
    }
    
    // Find which node(s) changed
    const changedNodes: string[] = [];
    for (let i = 0; i < prev.nodes.length; i++) {
      const prevNode = prev.nodes[i];
      const currentNode = current.nodes[i];
      
      if (prevNode.id === currentNode.id) {
        // Deep compare node data
        if (JSON.stringify(prevNode.data) !== JSON.stringify(currentNode.data)) {
          changedNodes.push(prevNode.id);
        }
      }
    }
    
    // For now, only support single node updates
    if (changedNodes.length === 1) {
      return { isIncremental: true, changedNodeId: changedNodes[0] };
    }
    
    return { isIncremental: false };
  }, []);


  // Initialize editor when component mounts
  useEffect(() => {
    initializeEditor();
  }, [initializeEditor]);

  // Update content when graph model changes
  useEffect(() => {
    if (editor && area) {
      const previous = prevGraphModelRef.current;
      const current = graphModel;
      
      // Check if this is an incremental update
      const updateInfo = isIncrementalUpdate(previous, current);
      
      if (updateInfo.isIncremental && updateInfo.changedNodeId) {
        console.log('Canvas: Detected incremental update for node:', updateInfo.changedNodeId);
        
        // Find the updated node
        const updatedNode = current?.nodes.find(n => n.id === updateInfo.changedNodeId);
        if (updatedNode) {
          // Try incremental update first
          updateNodeIncremental(updateInfo.changedNodeId, updatedNode).then(success => {
            if (!success) {
              console.warn('Canvas: Incremental update failed, falling back to full rebuild');
              updateEditorContent();
            }
          });
        } else {
          console.warn('Canvas: Could not find updated node for incremental update');
          updateEditorContent();
        }
      } else {
        console.log('Canvas: Detected structural change, performing full rebuild');
        updateEditorContent();
      }
      
      // Update the previous graph model reference
      prevGraphModelRef.current = current;
    }
  }, [updateEditorContent, graphModel, isIncrementalUpdate, updateNodeIncremental]);

  // Handle selection state changes without re-rendering the entire canvas
  useEffect(() => {
    if (!editor || !nodeMap.size) return;
    
    console.log('Canvas: Updating selection state for selectedNode:', selectedNode?.id);
    
    // Update selection state for all nodes
    nodeMap.forEach((reteNode, nodeId) => {
      const shouldBeSelected = selectedNode?.id === nodeId;
      if (reteNode.selected !== shouldBeSelected) {
        console.log(`Canvas: Updating selection state for node ${nodeId}:`, shouldBeSelected);
        reteNode.selected = shouldBeSelected;
        
        // Force re-render of the node to update visual state
        if (area) {
          area.update('node', nodeId);
        }
      }
    });
  }, [selectedNode, editor, area, nodeMap]);

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
          <button 
            className="canvas-control-btn"
            onClick={() => {
              console.log('Canvas: Manual selection test');
              if (editor) {
                const nodes = editor.getNodes();
                if (nodes.length > 0) {
                  const firstNode = nodes[0];
                  console.log('Canvas: Testing selection of first node:', firstNode.id);
                  const graphNode = nodeIdToGraphNodeMap.current.get(firstNode.id);
                  if (graphNode) {
                    console.log('Canvas: Found graphNode for manual selection:', graphNode);
                    handleDebouncedSelection(graphNode);
                  } else {
                    console.error('Canvas: No graphNode found for manual selection');
                  }
                }
              }
            }}
            title="Test Selection"
          >
            🔍
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