# ReactFlow Visual Editor Implementation Guide

## Overview
This document provides a step-by-step plan to rebuild the IBM Catalog Visual Editor using ReactFlow, starting from a basic working example and incrementally adding functionality. Each stage is self-contained and testable.

## Project Context
- **Project**: IBM Catalog JSON Editor VS Code Extension
- **Current ReactFlow Version**: 11.11.4 (already installed)
- **Target**: Visual editor for `ibm_catalog.json` files showing dependency graphs
- **Build System**: esbuild with separate webview bundle at `dist/media/visual-editor-react.js`
- **Framework**: React TypeScript running in VS Code webview

## Why Rebuild?
The current implementation has complex issues with node interactions, edge connections, and layout management. Starting from ReactFlow's proven patterns will give us a solid, maintainable foundation.

## Implementation Strategy

### Development Approach
1. **Start Fresh**: Replace current Canvas.tsx entirely at each stage
2. **Test Each Stage**: Ensure each stage works before moving to next
3. **Keep It Simple**: Avoid over-engineering, focus on core functionality
4. **Use ReactFlow Patterns**: Follow official examples and best practices

### Key Files to Work With
- `src/webview/visual-editor/components/Canvas.tsx` - Main component (replace entirely)
- `src/webview/visual-editor/index.tsx` - App entry point (minimal changes)
- `package.json` - ReactFlow 11.11.4 already installed
- Build with `npm run build` after each change

---

## Stage 1: Basic ReactFlow Foundation
**Goal**: Replace current complex implementation with a minimal working ReactFlow example

### What to Implement
Create a completely new Canvas.tsx with basic ReactFlow setup:

```tsx
// Stage 1: src/webview/visual-editor/components/Canvas.tsx
import React from 'react';
import { ReactFlow, Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';

const initialNodes = [
  {
    id: 'root-1',
    position: { x: 100, y: 100 },
    data: { label: 'Cloud Automation for Secrets Manager' },
    type: 'input',
  },
  {
    id: 'dep-1',
    position: { x: 400, y: 100 },
    data: { label: 'VPC Module' },
  },
  {
    id: 'dep-2',
    position: { x: 400, y: 200 },
    data: { label: 'Security Group Module' },
  }
];

const initialEdges = [
  {
    id: 'root-dep1',
    source: 'root-1',
    target: 'dep-1',
  },
  {
    id: 'root-dep2',
    source: 'root-1',
    target: 'dep-2',
  }
];

interface CanvasProps {
  graphModel?: any;
  onNodeSelect?: (node: any) => void;
}

export const Canvas: React.FC<CanvasProps> = () => {
  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow 
        nodes={initialNodes} 
        edges={initialEdges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};
```

### Success Criteria
- ✅ Visual editor loads without errors
- ✅ Shows 3 static nodes with 2 connections
- ✅ Pan, zoom, and background controls work
- ✅ Nodes are draggable
- ✅ No console errors

### Build and Test
```bash
npm run build
```
Open VS Code extension and navigate to an `ibm_catalog.json` file, open with Visual Editor.

---

## Stage 2: Basic Custom Nodes
**Goal**: Create simple custom node components for Root and Dependency types

### What to Implement
Add custom node components with basic styling:

```tsx
// Stage 2: Add to Canvas.tsx after imports
import React from 'react';
import { ReactFlow, Background, Controls, NodeTypes } from 'reactflow';
import 'reactflow/dist/style.css';

// Custom Root Node Component
const RootNode: React.FC<{ data: any }> = ({ data }) => (
  <div style={{
    padding: '12px',
    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
    color: 'white',
    borderRadius: '8px',
    minWidth: '140px',
    textAlign: 'center',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    border: '2px solid #6366f1',
  }}>
    <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
      {data.label}
    </div>
    <div style={{ fontSize: '11px', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      Root Architecture
    </div>
  </div>
);

// Custom Dependency Node Component  
const DependencyNode: React.FC<{ data: any }> = ({ data }) => (
  <div style={{
    padding: '10px',
    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
    color: 'white',
    borderRadius: '6px',
    minWidth: '120px',
    textAlign: 'center',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #34d399',
  }}>
    <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' }}>
      {data.label}
    </div>
    <div style={{ fontSize: '10px', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      External Module
    </div>
  </div>
);

// Register custom node types
const nodeTypes: NodeTypes = {
  rootNode: RootNode,
  dependencyNode: DependencyNode,
};

// Update initial nodes to use custom types
const initialNodes = [
  {
    id: 'root-1',
    type: 'rootNode',
    position: { x: 100, y: 100 },
    data: { label: 'Cloud Automation for Secrets Manager' },
  },
  {
    id: 'dep-1',
    type: 'dependencyNode',
    position: { x: 400, y: 50 },
    data: { label: 'VPC Module' },
  },
  {
    id: 'dep-2',
    type: 'dependencyNode',
    position: { x: 400, y: 150 },
    data: { label: 'Security Group Module' },
  }
];

// Update ReactFlow component
export const Canvas: React.FC<CanvasProps> = () => {
  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow 
        nodes={initialNodes} 
        edges={initialEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};
```

### Success Criteria
- ✅ Root node appears purple with "Root Architecture" subtitle
- ✅ Dependency nodes appear green with "External Module" subtitle
- ✅ Nodes are draggable and selectable
- ✅ Custom styling is applied correctly
- ✅ Professional appearance

---

## Stage 3: Dynamic Data Integration
**Goal**: Connect to actual catalog data from the extension

### Data Structures to Support
First, define the interfaces we need:

```tsx
// Stage 3: Add interfaces at top of Canvas.tsx
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
```

### What to Implement
Update Canvas to use dynamic data:

```tsx
// Stage 3: Update Canvas component
export const Canvas: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  // Convert graphModel to ReactFlow format
  const nodes = React.useMemo(() => {
    if (!graphModel?.nodes?.length) {
      // Fallback to demo data when no graphModel
      return initialNodes;
    }

    return graphModel.nodes.map(node => ({
      id: node.id,
      type: node.type === 'root' ? 'rootNode' : 'dependencyNode',
      position: node.position,
      data: { 
        label: node.name,
        description: node.data?.description,
        version: node.data?.version,
        inputs: node.data?.inputs || [],
        outputs: node.data?.outputs || [],
      }
    }));
  }, [graphModel]);

  const edges = React.useMemo(() => {
    if (!graphModel?.connections?.length) {
      // Fallback to demo data when no graphModel
      return initialEdges;
    }

    return graphModel.connections.map(conn => ({
      id: conn.id,
      source: conn.source,
      target: conn.target,
      sourceHandle: conn.sourceHandle,
      targetHandle: conn.targetHandle,
    }));
  }, [graphModel]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow 
        nodes={nodes} 
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};
```

### Success Criteria
- ✅ Nodes populate from actual catalog data when available
- ✅ Falls back to demo data when graphModel is empty
- ✅ Node names come from catalog structure
- ✅ Edges connect based on dependencies
- ✅ Handles empty/missing data gracefully

---

## Stage 4: Custom Handles for Inputs/Outputs
**Goal**: Add proper input/output connection points to nodes

### What to Implement
Add ReactFlow Handle components to custom nodes:

```tsx
// Stage 4: Update node components with handles
import React from 'react';
import { ReactFlow, Background, Controls, NodeTypes, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';

const RootNode: React.FC<{ data: any }> = ({ data }) => {
  const inputs = data.inputs || [];
  const outputs = data.outputs || [];

  return (
    <div style={{
      padding: '12px',
      background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
      color: 'white',
      borderRadius: '8px',
      minWidth: '140px',
      textAlign: 'center',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      border: '2px solid #6366f1',
      position: 'relative',
    }}>
      {/* Input handles on left */}
      {inputs.map((input, index) => (
        <Handle
          key={`input-${index}`}
          type="target"
          position={Position.Left}
          id={`input-${input.name || index}`}
          style={{
            top: `${30 + index * 15}px`,
            background: '#10b981',
            width: '8px',
            height: '8px',
            border: '2px solid white',
          }}
          title={input.description || input.name}
        />
      ))}

      <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
        {data.label}
      </div>
      <div style={{ fontSize: '11px', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Root Architecture
      </div>
      {data.version && (
        <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>
          v{data.version}
        </div>
      )}

      {/* Output handles on right */}
      {outputs.map((output, index) => (
        <Handle
          key={`output-${index}`}
          type="source"
          position={Position.Right}
          id={`output-${output.name || index}`}
          style={{
            top: `${30 + index * 15}px`,
            background: '#f59e0b',
            width: '8px',
            height: '8px',
            border: '2px solid white',
          }}
          title={output.description || output.name}
        />
      ))}
    </div>
  );
};

const DependencyNode: React.FC<{ data: any }> = ({ data }) => {
  const inputs = data.inputs || [];
  const outputs = data.outputs || [];

  return (
    <div style={{
      padding: '10px',
      background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
      color: 'white',
      borderRadius: '6px',
      minWidth: '120px',
      textAlign: 'center',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
      border: '1px solid #34d399',
      position: 'relative',
    }}>
      {/* Input handles on left */}
      {inputs.map((input, index) => (
        <Handle
          key={`input-${index}`}
          type="target"
          position={Position.Left}
          id={`input-${input.name || index}`}
          style={{
            top: `${25 + index * 12}px`,
            background: '#10b981',
            width: '6px',
            height: '6px',
            border: '2px solid white',
          }}
          title={input.description || input.name}
        />
      ))}

      <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' }}>
        {data.label}
      </div>
      <div style={{ fontSize: '10px', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        External Module
      </div>
      {data.version && (
        <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '1px' }}>
          v{data.version}
        </div>
      )}

      {/* Output handles on right */}
      {outputs.map((output, index) => (
        <Handle
          key={`output-${index}`}
          type="source"
          position={Position.Right}
          id={`output-${output.name || index}`}
          style={{
            top: `${25 + index * 12}px`,
            background: '#f59e0b',
            width: '6px',
            height: '6px',
            border: '2px solid white',
          }}
          title={output.description || output.name}
        />
      ))}
    </div>
  );
};
```

### Success Criteria
- ✅ Nodes show input ports on left (green circles)
- ✅ Nodes show output ports on right (orange circles)
- ✅ Handles connect to actual catalog input/output definitions
- ✅ Hovering over handles shows tooltips with descriptions
- ✅ Handles are properly positioned and sized

---

## Stage 5: Node Interactions
**Goal**: Add click, selection, and basic editing functionality

### What to Implement
Add event handlers for node interactions:

```tsx
// Stage 5: Add interaction handlers to Canvas
import React, { useCallback } from 'react';
import { ReactFlow, Background, Controls, NodeTypes, Handle, Position, useNodesState, useEdgesState } from 'reactflow';

export const Canvas: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  // Use ReactFlow state management
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when graphModel changes
  React.useEffect(() => {
    if (!graphModel?.nodes?.length) return;
    
    const newNodes = graphModel.nodes.map(node => ({
      id: node.id,
      type: node.type === 'root' ? 'rootNode' : 'dependencyNode',
      position: node.position,
      data: { 
        label: node.name,
        description: node.data?.description,
        version: node.data?.version,
        inputs: node.data?.inputs || [],
        outputs: node.data?.outputs || [],
      }
    }));
    setNodes(newNodes);
  }, [graphModel, setNodes]);

  // Update edges when graphModel changes
  React.useEffect(() => {
    if (!graphModel?.connections?.length) return;
    
    const newEdges = graphModel.connections.map(conn => ({
      id: conn.id,
      source: conn.source,
      target: conn.target,
      sourceHandle: conn.sourceHandle,
      targetHandle: conn.targetHandle,
    }));
    setEdges(newEdges);
  }, [graphModel, setEdges]);

  // Handle node selection
  const onNodeClick = useCallback((event: React.MouseEvent, node: any) => {
    console.log('Node selected:', node);
    if (onNodeSelect) {
      // Convert back to GraphNode format for compatibility
      const graphNode = {
        id: node.id,
        type: node.type === 'rootNode' ? 'root' : 'dependency',
        name: node.data.label,
        position: node.position,
        data: node.data,
      };
      onNodeSelect(graphNode);
    }
  }, [onNodeSelect]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow 
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodesDraggable={true}
        nodesConnectable={true}
        elementsSelectable={true}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};
```

### Success Criteria
- ✅ Clicking nodes triggers selection in Properties panel
- ✅ Dragging nodes updates positions smoothly
- ✅ Node selection state is visible (highlighted border)
- ✅ Console logging shows interaction events
- ✅ Multiple nodes can be selected with Ctrl+click

---

## Stage 6: Edge Creation and Management
**Goal**: Enable creating/deleting connections between nodes

### What to Implement
Add connection handling:

```tsx
// Stage 6: Add connection management
import { ReactFlow, Background, Controls, NodeTypes, Handle, Position, useNodesState, useEdgesState, addEdge, Connection, ConnectionMode } from 'reactflow';

export const Canvas: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  // ... existing code ...

  // Handle new connections
  const onConnect = useCallback((connection: Connection) => {
    console.log('New connection:', connection);
    
    // Create new edge
    const newEdge = {
      id: `${connection.source}-${connection.target}-${Date.now()}`,
      source: connection.source!,
      target: connection.target!,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      type: 'smoothstep',
      style: { stroke: '#6366f1', strokeWidth: 2 },
    };

    setEdges((edges) => addEdge(newEdge, edges));
    
    // TODO: Update backend data model
    console.log('Would update backend with new connection');
  }, [setEdges]);

  // Handle edge changes (including deletions)
  const handleEdgesChange = useCallback((changes: any[]) => {
    console.log('Edge changes:', changes);
    onEdgesChange(changes);
    
    // Handle deletions
    const removedEdges = changes.filter(change => change.type === 'remove');
    if (removedEdges.length > 0) {
      console.log('Edges removed:', removedEdges);
      // TODO: Update backend data model
    }
  }, [onEdgesChange]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow 
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodesDraggable={true}
        nodesConnectable={true}
        elementsSelectable={true}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};
```

### Success Criteria
- ✅ Dragging from output handle to input handle creates edge
- ✅ New connections appear with smooth styling
- ✅ Existing connections can be selected and deleted (Delete key)
- ✅ Invalid connections are rejected (same node, wrong handle types)
- ✅ Console logging shows connection events

---

## Stage 7: Advanced Features
**Goal**: Add expand/collapse, minimap, and professional polish

### What to Implement
Add advanced UI features:

```tsx
// Stage 7: Add advanced features
import { ReactFlow, Background, Controls, NodeTypes, Handle, Position, useNodesState, useEdgesState, addEdge, Connection, ConnectionMode, MiniMap } from 'reactflow';

// Enhanced Root Node with expand/collapse
const RootNode: React.FC<{ data: any }> = ({ data }) => {
  const [expanded, setExpanded] = React.useState(data.expanded ?? false);
  const inputs = data.inputs || [];
  const outputs = data.outputs || [];
  
  // Show only connected handles when collapsed
  const visibleInputs = expanded ? inputs : inputs.slice(0, 2);
  const visibleOutputs = expanded ? outputs : outputs.slice(0, 2);

  return (
    <div style={{
      padding: '12px',
      background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
      color: 'white',
      borderRadius: '8px',
      minWidth: '140px',
      textAlign: 'center',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      border: '2px solid #6366f1',
      position: 'relative',
    }}>
      {/* Expand/Collapse Button */}
      {(inputs.length > 2 || outputs.length > 2) && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            background: 'rgba(255,255,255,0.2)',
            border: 'none',
            color: 'white',
            borderRadius: '3px',
            width: '16px',
            height: '16px',
            fontSize: '10px',
            cursor: 'pointer',
          }}
        >
          {expanded ? '−' : '+'}
        </button>
      )}

      {/* Input handles */}
      {visibleInputs.map((input, index) => (
        <Handle
          key={`input-${index}`}
          type="target"
          position={Position.Left}
          id={`input-${input.name || index}`}
          style={{
            top: `${30 + index * 15}px`,
            background: '#10b981',
            width: '8px',
            height: '8px',
            border: '2px solid white',
          }}
          title={input.description || input.name}
        />
      ))}

      <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
        {data.label}
      </div>
      <div style={{ fontSize: '11px', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Root Architecture
      </div>
      {data.version && (
        <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>
          v{data.version}
        </div>
      )}

      {/* Port count indicator */}
      <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '4px' }}>
        {inputs.length} inputs • {outputs.length} outputs
      </div>

      {/* Output handles */}
      {visibleOutputs.map((output, index) => (
        <Handle
          key={`output-${index}`}
          type="source"
          position={Position.Right}
          id={`output-${output.name || index}`}
          style={{
            top: `${30 + index * 15}px`,
            background: '#f59e0b',
            width: '8px',
            height: '8px',
            border: '2px solid white',
          }}
          title={output.description || output.name}
        />
      ))}
    </div>
  );
};

// Add MiniMap and enhanced styling
export const Canvas: React.FC<CanvasProps> = ({ graphModel, onNodeSelect }) => {
  // ... existing code ...

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow 
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodesDraggable={true}
        nodesConnectable={true}
        elementsSelectable={true}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Background 
          gap={20} 
          size={1} 
          color="#e5e7eb" 
        />
        <Controls 
          position="bottom-left"
          showZoom={true}
          showFitView={true}
          showInteractive={true}
        />
        <MiniMap 
          position="bottom-right"
          nodeStrokeWidth={2}
          nodeColor="#6366f1"
          maskColor="rgba(0, 0, 0, 0.2)"
          style={{
            backgroundColor: '#f9fafb',
            border: '1px solid #d1d5db',
          }}
        />
      </ReactFlow>
    </div>
  );
};
```

### Success Criteria
- ✅ Nodes can expand/collapse to show all vs limited ports
- ✅ MiniMap shows overview of full graph in bottom-right
- ✅ Smooth animations and transitions
- ✅ Professional appearance matching VS Code theme
- ✅ Port count indicators show total inputs/outputs
- ✅ Expand/collapse state persists during interactions

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

### Common Issues and Solutions

**Issue**: "Module not found" errors
- **Solution**: Ensure ReactFlow import paths are correct for version 11.11.4

**Issue**: Nodes not appearing
- **Solution**: Check that nodeTypes are registered correctly and node data has required fields

**Issue**: Handles not connecting
- **Solution**: Verify Handle components have correct `type` (source/target) and `position` props

**Issue**: Webview shows old version
- **Solution**: Run `npm run clean && npm run build` to clear cache

**Issue**: TypeScript errors
- **Solution**: Add type imports: `import type { Node, Edge } from 'reactflow';`

## Next Steps After Implementation

Once all 7 stages are complete, consider these enhancements:

1. **Auto-layout**: Integrate ELK.js for automatic node positioning
2. **Persistence**: Save node positions and expand states
3. **Validation**: Highlight invalid connections or missing dependencies
4. **Search**: Add node search and filtering capabilities
5. **Themes**: Match VS Code dark/light theme preferences
6. **Performance**: Optimize for large graphs (100+ nodes)

## Conclusion

This incremental approach ensures you always have a working visual editor. Each stage builds upon the previous one, and you can stop at any point with a functional solution. The final implementation will be professional, maintainable, and follow ReactFlow best practices.