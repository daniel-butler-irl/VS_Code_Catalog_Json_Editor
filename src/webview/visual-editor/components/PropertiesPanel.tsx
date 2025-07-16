import React, { useState } from 'react';

interface GraphNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  data: any;
  position: { x: number; y: number };
}

interface NodeInput {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  defaultValue?: any;
  connector?: boolean;
  virtual?: boolean;
  sensitive?: boolean;
}

interface NodeOutput {
  name: string;
  type?: string;
  description?: string;
  value?: string;
  sensitive?: boolean;
  connector?: boolean;
}

interface PropertiesPanelProps {
  selectedNode: GraphNode | null;
  onUpdateProperty: (nodeId: string, property: string, value: any) => void;
  onRemoveNode: (nodeId: string) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedNode,
  onUpdateProperty,
  onRemoveNode
}) => {
  console.log('PropertiesPanel: Render with selectedNode:', {
    hasNode: !!selectedNode,
    nodeId: selectedNode?.id,
    nodeType: selectedNode?.type,
    nodeName: selectedNode?.name,
    hasData: !!selectedNode?.data,
    hasInputs: !!selectedNode?.data?.inputs,
    inputsLength: selectedNode?.data?.inputs?.length || 0,
    hasOutputs: !!selectedNode?.data?.outputs,
    outputsLength: selectedNode?.data?.outputs?.length || 0,
    fullData: selectedNode?.data
  });

  if (!selectedNode) {
    console.log('PropertiesPanel: No node selected, showing empty state');
    return (
      <div className="properties-panel">
        <div className="properties-header">
          <h3>Properties</h3>
        </div>
        <div className="properties-content">
          <div className="empty-selection">
            Select a node to view its properties
          </div>
        </div>
      </div>
    );
  }

  // Data validation and error handling
  if (!selectedNode.data) {
    console.error('PropertiesPanel: Selected node has no data:', selectedNode);
    return (
      <div className="properties-panel">
        <div className="properties-header">
          <h3>Properties</h3>
        </div>
        <div className="properties-content">
          <div className="error-state">
            <p>⚠️ Node data is missing</p>
            <p>Node ID: {selectedNode.id}</p>
          </div>
        </div>
      </div>
    );
  }

  const handlePropertyChange = (property: string, value: any) => {
    onUpdateProperty(selectedNode.id, property, value);
  };

  const handleRemoveNode = () => {
    if (selectedNode.type !== 'root' && 
        window.confirm(`Remove dependency "${selectedNode.name}"?`)) {
      onRemoveNode(selectedNode.id);
    }
  };

  const renderBasicProperties = () => (
    <div className="property-section">
      <h4>Basic Properties</h4>
      
      <div className="property-group">
        <label>Name/ID:</label>
        <input
          type="text"
          value={selectedNode.data.name || selectedNode.data.id || ''}
          onChange={(e) => handlePropertyChange('name', e.target.value)}
          disabled={selectedNode.type === 'root'}
        />
      </div>

      {selectedNode.type === 'dependency' && (
        <>
          <div className="property-group">
            <label>Version:</label>
            <input
              type="text"
              value={selectedNode.data.version || ''}
              onChange={(e) => handlePropertyChange('version', e.target.value)}
              placeholder="e.g., ^1.0.0"
            />
          </div>

          <div className="property-group">
            <label>Flavors:</label>
            <input
              type="text"
              value={selectedNode.data.flavors?.join(', ') || ''}
              onChange={(e) => handlePropertyChange('flavors', e.target.value.split(', ').filter(f => f.trim()))}
              placeholder="e.g., standard, enterprise"
            />
          </div>

          <div className="property-group">
            <label>
              <input
                type="checkbox"
                checked={selectedNode.data.optional || false}
                onChange={(e) => handlePropertyChange('optional', e.target.checked)}
              />
              Optional Dependency
            </label>
          </div>

          {selectedNode.data.optional && (
            <div className="property-group">
              <label>
                <input
                  type="checkbox"
                  checked={selectedNode.data.on_by_default || false}
                  onChange={(e) => handlePropertyChange('on_by_default', e.target.checked)}
                />
                Include by Default
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderInputsSection = () => {
    const inputs = selectedNode.data.inputs || [];
    
    console.log('PropertiesPanel: Rendering inputs section:', {
      inputsArray: inputs,
      inputsLength: inputs.length,
      isArray: Array.isArray(inputs)
    });
    
    return (
      <div className="property-section">
        <h4>Inputs ({inputs.length})</h4>
        {inputs.length === 0 ? (
          <div className="empty-state">No inputs defined</div>
        ) : (
          <div className="inputs-list">
            {inputs.map((input: NodeInput, index: number) => (
              <div key={index} className="input-item">
                <div className="input-header">
                  <span className="input-name">{input.name}</span>
                  {input.type && <span className="input-type">({input.type})</span>}
                  {input.required && <span className="required-indicator">*</span>}
                </div>
                
                <div className="input-controls">
                  <div className="control-row">
                    <label className={`toggle-label ${input.connector ? 'active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={input.connector || false}
                        onChange={(e) => {
                          const updatedInputs = [...inputs];
                          updatedInputs[index] = { ...input, connector: e.target.checked };
                          handlePropertyChange('inputs', updatedInputs);
                        }}
                      />
                      <span className="toggle-icon">{input.connector ? '🔗' : '📝'}</span>
                      <span className="toggle-text">
                        {input.connector ? 'Connector Port' : 'Property Only'}
                      </span>
                    </label>
                  </div>
                  
                  {input.connector && (
                    <div className="connector-info">
                      <span className="info-text">
                        💡 This input will appear as a connection port on the node
                      </span>
                    </div>
                  )}
                  
                  <div className="control-row">
                    <label className={`toggle-label secondary ${input.virtual ? 'active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={input.virtual || false}
                        onChange={(e) => {
                          const updatedInputs = [...inputs];
                          updatedInputs[index] = { ...input, virtual: e.target.checked };
                          handlePropertyChange('inputs', updatedInputs);
                        }}
                      />
                      <span className="toggle-icon">{input.virtual ? '👻' : '📄'}</span>
                      <span className="toggle-text">Virtual</span>
                    </label>
                  </div>
                </div>
                
                {input.description && (
                  <div className="input-description">{input.description}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderOutputsSection = () => {
    const outputs = selectedNode.data.outputs || [];
    
    console.log('PropertiesPanel: Rendering outputs section:', {
      outputsArray: outputs,
      outputsLength: outputs.length,
      isArray: Array.isArray(outputs)
    });
    
    return (
      <div className="property-section">
        <h4>Outputs ({outputs.length})</h4>
        {outputs.length === 0 ? (
          <div className="empty-state">No outputs defined</div>
        ) : (
          <div className="outputs-list">
            {outputs.map((output: NodeOutput, index: number) => (
              <div key={index} className="output-item">
                <div className="output-header">
                  <span className="output-name">{output.name}</span>
                  {output.type && <span className="output-type">({output.type})</span>}
                </div>
                
                <div className="output-controls">
                  <div className="control-row">
                    <label className={`toggle-label ${output.connector ? 'active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={output.connector || false}
                        onChange={(e) => {
                          const updatedOutputs = [...outputs];
                          updatedOutputs[index] = { ...output, connector: e.target.checked };
                          handlePropertyChange('outputs', updatedOutputs);
                        }}
                      />
                      <span className="toggle-icon">{output.connector ? '🔗' : '📤'}</span>
                      <span className="toggle-text">
                        {output.connector ? 'Connector Port' : 'Data Only'}
                      </span>
                    </label>
                  </div>
                  
                  {output.connector && (
                    <div className="connector-info">
                      <span className="info-text">
                        💡 This output will appear as a connection port on the node
                      </span>
                    </div>
                  )}
                </div>
                
                {output.description && (
                  <div className="output-description">{output.description}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="properties-panel">
      <div className="properties-header">
        <h3>Properties</h3>
        {selectedNode.type !== 'root' && (
          <button 
            className="remove-button"
            onClick={handleRemoveNode}
            title="Remove Dependency"
          >
            ✕
          </button>
        )}
      </div>
      
      <div className="properties-content">
        <div className="node-info">
          <div className="node-name">{selectedNode.name}</div>
          <div className="node-type">{selectedNode.type === 'root' ? 'Root Flavor' : 'Dependency'}</div>
          
          {/* Connector Summary */}
          <div className="connector-summary">
            <div className="summary-row">
              <span className="summary-label">🔗 Connector Ports:</span>
              <span className="summary-counts">
                <span className="input-count">
                  {(selectedNode.data.inputs || []).filter((input: NodeInput) => input.connector).length} inputs
                </span>
                <span className="divider">•</span>
                <span className="output-count">
                  {(selectedNode.data.outputs || []).filter((output: NodeOutput) => output.connector).length} outputs
                </span>
              </span>
            </div>
            <div className="summary-hint">
              Only connector ports appear on the visual node
            </div>
          </div>
        </div>

        {renderBasicProperties()}
        {renderInputsSection()}
        {renderOutputsSection()}
      </div>
    </div>
  );
};