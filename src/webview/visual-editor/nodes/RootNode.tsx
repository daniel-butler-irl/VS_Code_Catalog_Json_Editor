import React from 'react';
import { ClassicPreset } from 'rete';
// Socket size constant (replacing non-exported $socketSize from rete-react-plugin)
const SOCKET_SIZE = 12;
import { RootNodeClass } from './NodeClasses';

interface RootNodeProps {
  data: RootNodeClass;
  emit: (data: any) => void;
}

interface SocketProps {
  data: ClassicPreset.Socket;
}

const Socket: React.FC<SocketProps> = ({ data }) => {
  const getSocketColor = (socketType: string) => {
    switch (socketType) {
      case 'string':
        return '#3b82f6'; // blue
      case 'number':
        return '#10b981'; // green
      case 'boolean':
        return '#f59e0b'; // amber
      case 'object':
        return '#8b5cf6'; // purple
      default:
        return '#6b7280'; // gray
    }
  };

  return (
    <div
      className="socket"
      style={{
        width: SOCKET_SIZE,
        height: SOCKET_SIZE,
        backgroundColor: getSocketColor(data.name),
        borderRadius: '50%',
        border: '2px solid #fff',
        cursor: 'crosshair'
      }}
      title={`${data.name} socket`}
    />
  );
};

interface ControlProps {
  data: ClassicPreset.InputControl<'text'>;
  emit: (data: any) => void;
}

const Control: React.FC<ControlProps> = ({ data, emit }) => {
  return (
    <input
      type="text"
      value={data.value || ''}
      onChange={(e) => {
        data.setValue(e.target.value);
        emit({ type: 'controlchange', data });
      }}
      readOnly={data.readonly}
      placeholder={data.readonly ? 'Connected' : 'Enter value...'}
      className="node-input-control"
      style={{
        width: '100%',
        padding: '2px 6px',
        fontSize: '12px',
        border: '1px solid #d1d5db',
        borderRadius: '3px',
        backgroundColor: data.readonly ? '#f3f4f6' : '#fff',
        color: data.readonly ? '#6b7280' : '#374151'
      }}
    />
  );
};

export const RootNode: React.FC<RootNodeProps> = ({ data, emit }) => {
  const inputs = Object.entries(data.inputs);
  const outputs = Object.entries(data.outputs);
  const isSelected = data.selected;
  
  // Direct click handler for node selection
  const handleNodeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('RootNode: Direct click handler triggered for node:', data.graphNode.id);
    emit({ type: 'nodeclick', data: data.graphNode });
  };
  
  // Filter to only show connector ports
  const connectorInputs = inputs.filter(([key]) => {
    const inputData = data.graphNode.data?.inputs?.find((input: any) => input.name === key);
    return inputData?.connector === true;
  });
  
  const connectorOutputs = outputs.filter(([key]) => {
    const outputData = data.graphNode.data?.outputs?.find((output: any) => output.name === key);
    return outputData?.connector === true;
  });

  return (
    <div
      className={`root-node ${isSelected ? 'selected' : ''}`}
      data-node-id={data.graphNode.id}
      onClick={handleNodeClick}
      style={{
        background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
        border: isSelected ? '2px solid #fbbf24' : '2px solid #1e40af',
        borderRadius: '8px',
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'var(--vscode-font-family)',
        minWidth: '180px',
        minHeight: '120px',
        position: 'relative',
        boxShadow: isSelected ? '0 4px 12px rgba(251, 191, 36, 0.3)' : '0 2px 8px rgba(0, 0, 0, 0.15)'
      }}
    >
      {/* Header */}
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.1)',
          padding: '8px 12px',
          borderRadius: '6px 6px 0 0',
          fontWeight: '600',
          fontSize: '13px',
          textAlign: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#10b981',
              borderRadius: '50%',
              boxShadow: '0 0 4px rgba(16, 185, 129, 0.6)'
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
              Inputs
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {connectorInputs.map(([key, input]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ flex: '0 0 auto' }}>
                    {input?.socket && <Socket data={input.socket} />}
                  </div>
                  <div style={{ flex: '1', minWidth: 0 }}>
                    <div style={{ 
                      fontSize: '10px', 
                      fontWeight: '400',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      opacity: 0.9
                    }}>
                      {input?.label || key}
                    </div>
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
              Outputs
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {connectorOutputs.map(([key, output]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                  <div style={{ flex: '1', textAlign: 'right' }}>
                    <div style={{ 
                      fontSize: '10px', 
                      fontWeight: '400',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      opacity: 0.9
                    }}>
                      {output?.label || key}
                    </div>
                  </div>
                  <div style={{ flex: '0 0 auto' }}>
                    {output?.socket && <Socket data={output.socket} />}
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
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
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
          opacity: 0.7
        }}
      />
    </div>
  );
};