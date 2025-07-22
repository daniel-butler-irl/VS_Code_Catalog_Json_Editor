import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

interface RootNodeData {
  label: string;
  graphNode: {
    id: string;
    type: 'root';
    name: string;
    data: {
      inputs?: Array<{ name: string; connector?: boolean; type?: string }>;
      outputs?: Array<{ name: string; connector?: boolean; type?: string }>;
    };
  };
  selected?: boolean;
}

const RootNodeReactFlow: React.FC<NodeProps<RootNodeData>> = ({ data, selected }) => {
  const { graphNode } = data;
  const isSelected = selected || data.selected;
  
  // Get all inputs and outputs (not just connectors)
  const allInputs = graphNode.data?.inputs || [];
  const allOutputs = graphNode.data?.outputs || [];
  
  // Also keep connector-only lists for display purposes
  const connectorInputs = allInputs.filter(input => input.connector);
  const connectorOutputs = allOutputs.filter(output => output.connector);

  // Log handle IDs being created for debugging React Flow edge issues
  React.useEffect(() => {
    const inputHandleIds = allInputs.map(input => input.name);
    const outputHandleIds = allOutputs.map(output => output.name);
    
    console.log(`RootNode ${graphNode.id} RENDERING:`, {
      nodeId: graphNode.id,
      nodeName: graphNode.name,
      isSelected,
      position: 'Should be visible',
      styling: 'Blue gradient background'
    });
    
    if (window.vscode) {
      window.vscode.postMessage({
        command: 'debug',
        data: {
          level: 'info',
          message: `RootNode ${graphNode.id} handles created`,
          details: {
            nodeId: graphNode.id,
            nodeName: graphNode.name,
            inputHandles: inputHandleIds,
            outputHandles: outputHandleIds,
            totalInputs: allInputs.length,
            totalOutputs: allOutputs.length,
            connectorInputs: connectorInputs.length,
            connectorOutputs: connectorOutputs.length,
            renderInfo: {
              isSelected,
              componentRendering: true,
              expectedBackground: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)'
            }
          }
        }
      });
    }
  }, [graphNode.id, allInputs, allOutputs, connectorInputs.length, connectorOutputs.length, isSelected]);

  return (
    <div
      className={`root-node-reactflow ${isSelected ? 'selected' : ''}`}
      style={{
        background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
        border: isSelected ? '3px solid #fbbf24' : '3px solid #ff0000', // BRIGHT RED BORDER FOR DEBUGGING
        borderRadius: '8px',
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'var(--vscode-font-family, monospace)',
        minWidth: '200px',
        minHeight: '120px',
        position: 'relative',
        boxShadow: isSelected ? '0 4px 12px rgba(251, 191, 36, 0.3)' : '0 2px 8px rgba(255, 0, 0, 0.5)', // RED SHADOW
        // DEBUGGING STYLES TO ENSURE VISIBILITY
        zIndex: 999,
        opacity: 1,
        visibility: 'visible',
        display: 'block',
        overflow: 'visible',
        transform: 'scale(1)', // Ensure no scaling issues
      }}
    >
      {/* Input Handles - Create handles for ALL inputs */}
      {allInputs.map((input, index) => (
        <Handle
          key={`input-${input.name}`}
          type="target"
          position={Position.Left}
          id={input.name}
          style={{
            top: `${30 + index * 25}px`,
            left: '-6px',
            width: '12px',
            height: '12px',
            backgroundColor: '#10b981',
            border: '2px solid #fff',
          }}
          title={`Input: ${input.name}`}
        />
      ))}

      {/* Output Handles - Create handles for ALL outputs */}
      {allOutputs.map((output, index) => (
        <Handle
          key={`output-${output.name}`}
          type="source"
          position={Position.Right}
          id={output.name}
          style={{
            top: `${30 + index * 25}px`,
            right: '-6px',
            width: '12px',
            height: '12px',
            backgroundColor: '#f59e0b',
            border: '2px solid #fff',
          }}
          title={`Output: ${output.name}`}
        />
      ))}

      {/* Header */}
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.1)',
          padding: '8px 12px',
          borderRadius: '6px 6px 0 0',
          fontWeight: '600',
          fontSize: '13px',
          textAlign: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#10b981',
              borderRadius: '50%',
              boxShadow: '0 0 4px rgba(16, 185, 129, 0.6)',
            }}
          />
          {data.label}
        </div>
        <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>
          Root Architecture
        </div>
      </div>

      {/* Content Area */}
      <div style={{ padding: '8px' }}>
        {/* Connector Inputs Only */}
        {connectorInputs.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ 
              fontSize: '9px', 
              fontWeight: '600', 
              marginBottom: '4px', 
              opacity: 0.8,
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Inputs ({connectorInputs.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {connectorInputs.map((input) => (
                <div key={input.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ 
                    fontSize: '10px', 
                    fontWeight: '400',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    opacity: 0.9,
                    paddingLeft: '12px', // Space for handle
                  }}>
                    {input.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connector Outputs Only */}
        {connectorOutputs.length > 0 && (
          <div>
            <div style={{ 
              fontSize: '9px', 
              fontWeight: '600', 
              marginBottom: '4px', 
              opacity: 0.8,
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Outputs ({connectorOutputs.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {connectorOutputs.map((output) => (
                <div key={output.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                  <div style={{ 
                    fontSize: '10px', 
                    fontWeight: '400',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    opacity: 0.9,
                    textAlign: 'right',
                    paddingRight: '12px', // Space for handle
                  }}>
                    {output.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Node Info Badge */}
      <div
        style={{
          position: 'absolute',
          top: '-6px',
          right: '-6px',
          background: '#10b981',
          color: '#fff',
          borderRadius: '50%',
          width: '16px',
          height: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: '700',
          border: '2px solid #fff',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
        }}
        title="Root node"
      >
        R
      </div>

      {/* Resize Handle */}
      <div
        style={{
          position: 'absolute',
          bottom: '2px',
          right: '2px',
          width: '8px',
          height: '8px',
          background: 'rgba(255, 255, 255, 0.3)',
          borderRadius: '2px',
          cursor: 'se-resize',
          opacity: 0.7,
        }}
      />
    </div>
  );
};

export { RootNodeReactFlow };