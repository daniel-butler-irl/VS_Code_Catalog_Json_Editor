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

interface OfferingData {
  id: string;
  name: string;
  description: string;
  versions: string[];
  flavors: string[];
}

interface CanvasProps {
  graphModel: GraphModel;
  selectedNode: GraphNode | null;
  onNodeSelect: (node: GraphNode | null) => void;
  onAddConnection: (connection: Omit<GraphConnection, 'id'>) => void;
  onRemoveConnection: (connectionId: string) => void;
  onAddDependency: (offering: OfferingData, position: { x: number; y: number }) => void;
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

export const Canvas: React.FC<CanvasProps> = ({
  graphModel,
  selectedNode,
  onNodeSelect,
  onAddConnection,
  onRemoveConnection,
  onAddDependency
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<NodeEditor<Schemes> | null>(null);
  const [area, setArea] = useState<AreaPlugin<Schemes, AreaExtra> | null>(null);
  const [nodeMap, setNodeMap] = useState<Map<string, RootNodeClass | DependencyNodeClass>>(new Map());

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
        }
      };

      const dragOverHandler = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Canvas: Drag over event');
      };

      const dragEnterHandler = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Canvas: Drag enter event');
      };

      const dragLeaveHandler = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Canvas: Drag leave event');
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

      // Configure connection plugin with socket compatibility
      connectionPlugin.addPreset(ConnectionPresets.classic.setup({
        canMakeConnection(from, to) {
          // Allow connections between compatible socket types
          const fromSocket = from.socket;
          const toSocket = to.socket;
          
          // Same type connections are always allowed
          if (fromSocket.name === toSocket.name) return true;
          
          // 'any' socket can connect to anything
          if (fromSocket.name === 'any' || toSocket.name === 'any') return true;
          
          // Prevent connecting output to output or input to input
          return true; // For now, allow all connections
        }
      }));

      // Configure React plugin with custom components
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
          },
          socket(context) {
            return ReactPresets.classic.Socket;
          },
          connection(context) {
            return ReactPresets.classic.Connection;
          }
        }
      }));

      // Configure area plugin
      AreaExtensions.selectableNodes(areaPlugin, AreaExtensions.selector(), {
        accumulating: AreaExtensions.accumulateOnCtrl()
      });

      // Listen for node selection changes
      areaPlugin.addPipe(context => {
        if (context.type === 'nodeselected') {
          const reteNode = context.data.id && newEditor.getNode(context.data.id);
          if (reteNode instanceof RootNodeClass || reteNode instanceof DependencyNodeClass) {
            onNodeSelect(reteNode.graphNode);
            reteNode.selected = true;
          }
        } else if (context.type === 'nodeunselected') {
          const reteNode = context.data.id && newEditor.getNode(context.data.id);
          if (reteNode instanceof RootNodeClass || reteNode instanceof DependencyNodeClass) {
            reteNode.selected = false;
          }
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
  }, [editor, onNodeSelect, onAddConnection, onRemoveConnection, onAddDependency]);

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
            area.selector.pick({ id: reteNode.id, label: reteNode.label }, true);
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
        <button onClick={() => area && AreaExtensions.zoomAt(area, editor?.getNodes() || [])}>
          Fit
        </button>
        <button onClick={() => area && area.area.zoom(area.area.transform.k * 1.2)}>
          +
        </button>
        <span>{area ? Math.round(area.area.transform.k * 100) : 100}%</span>
        <button onClick={() => area && area.area.zoom(area.area.transform.k / 1.2)}>
          -
        </button>
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