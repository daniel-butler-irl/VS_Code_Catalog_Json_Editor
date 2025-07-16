import React from 'react';
import { ClassicPreset } from 'rete';
// Socket size constant (replacing non-exported $socketSize from rete-react-plugin)
const SOCKET_SIZE = 12;
import { DependencyNodeClass } from './NodeClasses';

interface DependencyNodeProps {
  data: DependencyNodeClass;
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

export const DependencyNode: React.FC<DependencyNodeProps> = ({ data, emit }) => {
  const inputs = Object.entries(data.inputs);
  const outputs = Object.entries(data.outputs);
  const isSelected = data.selected;
  const isOptional = data.isOptional();
  const dependencyInfo = data.getDependencyInfo();
  
  // Filter to only show connector ports
  const connectorInputs = inputs.filter(([key]) => {
    const inputData = data.graphNode.data?.inputs?.find((input: any) => input.name === key);
    return inputData?.connector === true;
  });
  
  const connectorOutputs = outputs.filter(([key]) => {
    const outputData = data.graphNode.data?.outputs?.find((output: any) => output.name === key);
    return outputData?.connector === true;
  });

  // Get background color based on dependency type
  const getNodeBackground = () => {
    if (isOptional) {
      return 'linear-gradient(135deg, #059669 0%, #10b981 100%)'; // Green for optional
    }
    return 'linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%)'; // Purple for required
  };

  const getBorderColor = () => {
    if (isSelected) return '#fbbf24';
    if (isOptional) return '#059669';
    return '#7c3aed';
  };

  return (
    <div
      className={`dependency-node ${isSelected ? 'selected' : ''} ${isOptional ? 'optional' : 'required'}`}
      style={{
        background: getNodeBackground(),
        border: `2px solid ${getBorderColor()}`,
        borderRadius: '8px',
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'var(--vscode-font-family)',
        minWidth: '160px',
        minHeight: '100px',
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
              backgroundColor: isOptional ? '#10b981' : '#f59e0b',
              borderRadius: '50%',
              boxShadow: `0 0 4px ${isOptional ? 'rgba(16, 185, 129, 0.6)' : 'rgba(245, 158, 11, 0.6)'}`
            }}
          />
          <div style={{ 
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '160px'
          }}>
            {data.label}
          </div>
        </div>
        
        {/* Dependency Metadata */}
        <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>
          {isOptional ? 'Optional Dependency' : 'Required Dependency'}
        </div>
        
        {/* Version and Flavor Info */}
        {(dependencyInfo.version || dependencyInfo.flavors) && (
          <div style={{ 
            fontSize: '9px', 
            opacity: 0.7, 
            marginTop: '2px',
            display: 'flex',
            justifyContent: 'center',
            gap: '4px'
          }}>
            {dependencyInfo.version && (
              <span style={{ 
                background: 'rgba(255, 255, 255, 0.1)',
                padding: '1px 4px',
                borderRadius: '2px'
              }}>
{dependencyInfo.version}
              </span>
            )}
            {dependencyInfo.flavors && dependencyInfo.flavors.length > 0 && (
              <span style={{ 
                background: 'rgba(255, 255, 255, 0.1)',
                padding: '1px 4px',
                borderRadius: '2px'
              }}>
                {dependencyInfo.flavors[0]}
              </span>
            )}
          </div>
        )}
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
                    <Socket data={input.socket} />
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
                      {input.label || key}
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
                      {output.label || key}
                    </div>
                  </div>
                  <div style={{ flex: '0 0 auto' }}>
                    <Socket data={output.socket} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Status Badges */}
      <div style={{ position: 'absolute', top: '-6px', right: '-6px', display: 'flex', gap: '2px' }}>
        {/* Dependency Type Badge */}
        <div
          style={{
            background: isOptional ? '#10b981' : '#f59e0b',
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
          title={isOptional ? 'Optional dependency' : 'Required dependency'}
        >
          {isOptional ? 'O' : 'R'}
        </div>
      </div>

      {/* Connection Count Indicator */}
      {data.getInputMappings().length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '-6px',
            left: '-6px',
            background: '#3b82f6',
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
          title={`${data.getInputMappings().length} connections`}
        >
          {data.getInputMappings().length}
        </div>
      )}

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