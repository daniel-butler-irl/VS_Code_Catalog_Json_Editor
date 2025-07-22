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
  isInput: boolean;
  portMetadata?: {
    mappingTypes?: string[];
    isConnector?: boolean;
    description?: string;
    required?: boolean;
    type?: string;
    isFromTerraform?: boolean;
  };
}

const Socket: React.FC<SocketProps> = ({ data, isInput, portMetadata }) => {
  const getSocketColor = (isInput: boolean, mappingTypes?: string[]) => {
    // Enhanced colors based on mapping types for better input_mapping visibility
    if (mappingTypes && mappingTypes.length > 0) {
      // Different colors for different mapping types
      if (mappingTypes.includes('dependency_output')) return '#8b5cf6'; // Purple for dependency outputs
      if (mappingTypes.includes('dependency_input')) return '#3b82f6'; // Blue for dependency inputs  
      if (mappingTypes.includes('static_value')) return '#6b7280'; // Gray for static values
      if (mappingTypes.includes('pass_through')) return '#f59e0b'; // Amber for pass-through
    }
    // Default colors: green for inputs, amber for outputs
    return isInput ? '#10b981' : '#f59e0b';
  };

  const getSocketGlow = (isInput: boolean, mappingTypes?: string[]) => {
    const color = getSocketColor(isInput, mappingTypes);
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return `rgba(${r}, ${g}, ${b}, 0.4)`;
  };

  const getTooltip = () => {
    const type = isInput ? 'Input' : 'Output';
    let tooltip = `${type} socket - Click to connect`;
    
    if (portMetadata?.description) {
      tooltip += `\n${portMetadata.description}`;
    }
    
    if (portMetadata?.type) {
      tooltip += `\nType: ${portMetadata.type}`;
    }
    
    if (portMetadata?.mappingTypes && portMetadata.mappingTypes.length > 0) {
      tooltip += `\nMapping: ${portMetadata.mappingTypes.join(', ')}`;
    }
    
    if (portMetadata?.required) {
      tooltip += '\n⚠️ Required';
    }
    
    if (portMetadata?.isFromTerraform === false) {
      tooltip += '\n📋 From input mapping';
    } else if (portMetadata?.isFromTerraform === true) {
      tooltip += '\n🔧 From Terraform';
    }
    
    return tooltip;
  };

  return (
    <div
      className="socket"
      style={{
        width: SOCKET_SIZE + 2, // Slightly larger for better visibility
        height: SOCKET_SIZE + 2,
        backgroundColor: getSocketColor(isInput, portMetadata?.mappingTypes),
        borderRadius: '50%',
        border: portMetadata?.isConnector ? '2px solid #fff' : '2px solid rgba(255, 255, 255, 0.5)', // Different border for non-connectors
        cursor: 'crosshair',
        boxShadow: `0 0 6px ${getSocketGlow(isInput, portMetadata?.mappingTypes)}, 0 2px 4px rgba(0, 0, 0, 0.1)`,
        transition: 'all 0.2s ease',
        position: 'relative',
        opacity: portMetadata?.isConnector ? 1.0 : 0.7 // Slightly faded for non-connectors
      }}
      title={getTooltip()}
    >
      {/* Type indicator */}
      {portMetadata?.mappingTypes && portMetadata.mappingTypes.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '-2px',
            right: '-2px',
            width: '6px',
            height: '6px',
            backgroundColor: '#fff',
            borderRadius: '50%',
            fontSize: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            color: getSocketColor(isInput, portMetadata.mappingTypes),
            border: '1px solid #ccc'
          }}
        />
      )}
    </div>
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
  
  // Direct click handler for node selection
  const handleNodeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('DependencyNode: Direct click handler triggered for node:', data.graphNode.id);
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
      data-node-id={data.graphNode.id}
      onClick={handleNodeClick}
      style={{
        background: getNodeBackground(),
        border: `2px solid ${getBorderColor()}`,
        borderRadius: '8px',
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'var(--vscode-font-family)',
        minWidth: '180px', // Increased for better port spacing
        minHeight: '120px', // Increased for better content layout
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
      <div style={{ padding: '10px' }}> {/* Increased padding for better spacing */}
        {/* Connector Inputs Only */}
        {connectorInputs.length > 0 && (
          <div style={{ marginBottom: '10px' }}> {/* Increased section spacing */}
            <div style={{ 
              fontSize: '9px', 
              fontWeight: '600', 
              marginBottom: '6px', // Increased label spacing 
              opacity: 0.8,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <div style={{ 
                width: '6px', 
                height: '6px', 
                backgroundColor: '#10b981', 
                borderRadius: '50%',
                opacity: 0.6
              }} />
              Inputs ({connectorInputs.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}> {/* Increased port spacing */}
              {connectorInputs.map(([key, input]) => {
                // Get enhanced metadata from graphNode data
                const inputMetadata = data.graphNode.data?.inputs?.find((inp: any) => inp.name === key);
                
                return (
                  <div key={key} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', // Increased gap for better port accessibility
                    padding: '2px',
                    borderRadius: '3px',
                    transition: 'background-color 0.2s ease'
                  }}>
                    <div style={{ flex: '0 0 auto' }}>
                      {input?.socket && (
                        <Socket 
                          data={input.socket} 
                          isInput={true} 
                          portMetadata={{
                            mappingTypes: inputMetadata?.mappingTypes,
                            isConnector: inputMetadata?.connector,
                            description: inputMetadata?.description,
                            required: inputMetadata?.required,
                            type: inputMetadata?.type,
                            isFromTerraform: inputMetadata?.isFromTerraform
                          }}
                        />
                      )}
                    </div>
                    <div style={{ flex: '1', minWidth: 0 }}>
                      <div style={{ 
                        fontSize: '10px', 
                        fontWeight: '400',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        opacity: 0.9,
                        lineHeight: '1.2'
                      }}>
                        {input?.label || key}
                        {/* Type indicator next to label */}
                        {inputMetadata?.type && (
                          <span style={{ 
                            fontSize: '8px', 
                            opacity: 0.6, 
                            marginLeft: '4px',
                            fontStyle: 'italic' 
                          }}>
                            {inputMetadata.type}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Connector Outputs Only */}
        {connectorOutputs.length > 0 && (
          <div>
            <div style={{ 
              fontSize: '9px', 
              fontWeight: '600', 
              marginBottom: '6px', // Increased label spacing
              opacity: 0.8,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end', // Right-align for outputs
              gap: '4px'
            }}>
              Outputs ({connectorOutputs.length})
              <div style={{ 
                width: '6px', 
                height: '6px', 
                backgroundColor: '#f59e0b', 
                borderRadius: '50%',
                opacity: 0.6
              }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}> {/* Increased port spacing */}
              {connectorOutputs.map(([key, output]) => {
                // Get enhanced metadata from graphNode data
                const outputMetadata = data.graphNode.data?.outputs?.find((out: any) => out.name === key);
                
                return (
                  <div key={key} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', // Increased gap for better port accessibility
                    justifyContent: 'flex-end',
                    padding: '2px',
                    borderRadius: '3px',
                    transition: 'background-color 0.2s ease'
                  }}>
                    <div style={{ flex: '1', textAlign: 'right' }}>
                      <div style={{ 
                        fontSize: '10px', 
                        fontWeight: '400',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        opacity: 0.9,
                        lineHeight: '1.2'
                      }}>
                        {output?.label || key}
                        {/* Type indicator next to label */}
                        {outputMetadata?.type && (
                          <span style={{ 
                            fontSize: '8px', 
                            opacity: 0.6, 
                            marginLeft: '4px',
                            fontStyle: 'italic' 
                          }}>
                            {outputMetadata.type}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ flex: '0 0 auto' }}>
                      {output?.socket && (
                        <Socket 
                          data={output.socket} 
                          isInput={false} 
                          portMetadata={{
                            mappingTypes: outputMetadata?.mappingTypes,
                            isConnector: outputMetadata?.connector,
                            description: outputMetadata?.description,
                            required: outputMetadata?.required,
                            type: outputMetadata?.type,
                            isFromTerraform: outputMetadata?.isFromTerraform
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
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