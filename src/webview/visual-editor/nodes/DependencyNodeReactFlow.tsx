import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

interface DependencyNodeData {
  label: string;
  graphNode: {
    id: string;
    type: 'dependency';
    name: string;
    data: {
      inputs?: Array<{ name: string; connector?: boolean; type?: string }>;
      outputs?: Array<{ name: string; connector?: boolean; type?: string }>;
      version?: string;
      description?: string;
    };
  };
  selected?: boolean;
}

const DependencyNodeReactFlow: React.FC<NodeProps<DependencyNodeData>> = ({ data, selected }) => {
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
    
    if (window.vscode) {
      window.vscode.postMessage({
        command: 'debug',
        data: {
          level: 'info',
          message: `DependencyNode ${graphNode.id} handles created`,
          details: {
            nodeId: graphNode.id,
            nodeName: graphNode.name,
            inputHandles: inputHandleIds,
            outputHandles: outputHandleIds,
            totalInputs: allInputs.length,
            totalOutputs: allOutputs.length,
            connectorInputs: connectorInputs.length,
            connectorOutputs: connectorOutputs.length
          }
        }
      });
    }
  }, [graphNode.id, allInputs, allOutputs, connectorInputs.length, connectorOutputs.length]);

  return (
    <div
      className={`dependency-node-reactflow ${isSelected ? 'selected' : ''}`}
      style={{
        background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
        border: isSelected ? '3px solid #fbbf24' : '3px solid #00ff00', // BRIGHT GREEN BORDER FOR DEBUGGING
        borderRadius: '8px',
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'var(--vscode-font-family, monospace)',
        minWidth: '180px',
        minHeight: '100px',
        position: 'relative',
        boxShadow: isSelected ? '0 4px 12px rgba(251, 191, 36, 0.3)' : '0 2px 8px rgba(0, 255, 0, 0.5)', // GREEN SHADOW
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
            top: `${30 + index * 20}px`,
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
            top: `${30 + index * 20}px`,
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
          padding: '6px 10px',
          borderRadius: '6px 6px 0 0',
          fontWeight: '600',
          fontSize: '12px',
          textAlign: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              backgroundColor: '#f59e0b',
              borderRadius: '50%',
              boxShadow: '0 0 4px rgba(245, 158, 11, 0.6)',
            }}
          />
          <span style={{ 
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '140px',
          }}>
            {data.label}
          </span>
        </div>
        {graphNode.data.version && (
          <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '1px' }}>
            v{graphNode.data.version}
          </div>
        )}
      </div>

      {/* Content Area */}
      <div style={{ padding: '6px' }}>
        {/* Connector Inputs Only */}
        {connectorInputs.length > 0 && (
          <div style={{ marginBottom: '6px' }}>
            <div style={{ 
              fontSize: '8px', 
              fontWeight: '600', 
              marginBottom: '3px', 
              opacity: 0.8,
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Inputs ({connectorInputs.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {connectorInputs.slice(0, 3).map((input) => (
                <div key={input.name} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ 
                    fontSize: '9px', 
                    fontWeight: '400',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    opacity: 0.9,
                    paddingLeft: '10px', // Space for handle
                    maxWidth: '120px',
                  }}>
                    {input.name}
                  </div>
                </div>
              ))}
              {connectorInputs.length > 3 && (
                <div style={{ fontSize: '8px', opacity: 0.6, paddingLeft: '10px' }}>
                  +{connectorInputs.length - 3} more...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Connector Outputs Only */}
        {connectorOutputs.length > 0 && (
          <div>
            <div style={{ 
              fontSize: '8px', 
              fontWeight: '600', 
              marginBottom: '3px', 
              opacity: 0.8,
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Outputs ({connectorOutputs.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {connectorOutputs.slice(0, 3).map((output) => (
                <div key={output.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                  <div style={{ 
                    fontSize: '9px', 
                    fontWeight: '400',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    opacity: 0.9,
                    textAlign: 'right',
                    paddingRight: '10px', // Space for handle
                    maxWidth: '120px',
                  }}>
                    {output.name}
                  </div>
                </div>
              ))}
              {connectorOutputs.length > 3 && (
                <div style={{ fontSize: '8px', opacity: 0.6, paddingRight: '10px', textAlign: 'right' }}>
                  +{connectorOutputs.length - 3} more...
                </div>
              )}
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
          background: '#f59e0b',
          color: '#000',
          borderRadius: '50%',
          width: '14px',
          height: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '9px',
          fontWeight: '700',
          border: '2px solid #fff',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
        }}
        title="Dependency node"
      >
        D
      </div>

      {/* Resize Handle */}
      <div
        style={{
          position: 'absolute',
          bottom: '2px',
          right: '2px',
          width: '6px',
          height: '6px',
          background: 'rgba(255, 255, 255, 0.3)',
          borderRadius: '2px',
          cursor: 'se-resize',
          opacity: 0.7,
        }}
      />
    </div>
  );
};

export { DependencyNodeReactFlow };