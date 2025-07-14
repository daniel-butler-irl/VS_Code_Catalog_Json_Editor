import React from 'react';

interface GraphNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  data: any;
  position: { x: number; y: number };
}

interface InputOutput {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  connector?: boolean;
  virtual?: boolean;
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
  if (!selectedNode) {
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
    
    return (
      <div className="property-section">
        <h4>Inputs</h4>
        {inputs.length === 0 ? (
          <div className="empty-state">No inputs defined</div>
        ) : (
          <div className="inputs-list">
            {inputs.map((input: InputOutput, index: number) => (
              <div key={index} className="input-item">
                <div className="input-header">
                  <span className="input-name">{input.name}</span>
                  {input.type && <span className="input-type">({input.type})</span>}
                  {input.required && <span className="required-indicator">*</span>}
                </div>
                
                <div className="input-controls">
                  <label>
                    <input
                      type="checkbox"
                      checked={input.connector || false}
                      onChange={(e) => {
                        const updatedInputs = [...inputs];
                        updatedInputs[index] = { ...input, connector: e.target.checked };
                        handlePropertyChange('inputs', updatedInputs);
                      }}
                    />
                    Connector
                  </label>
                  
                  <label>
                    <input
                      type="checkbox"
                      checked={input.virtual || false}
                      onChange={(e) => {
                        const updatedInputs = [...inputs];
                        updatedInputs[index] = { ...input, virtual: e.target.checked };
                        handlePropertyChange('inputs', updatedInputs);
                      }}
                    />
                    Virtual
                  </label>
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
    
    return (
      <div className="property-section">
        <h4>Outputs</h4>
        {outputs.length === 0 ? (
          <div className="empty-state">No outputs defined</div>
        ) : (
          <div className="outputs-list">
            {outputs.map((output: InputOutput, index: number) => (
              <div key={index} className="output-item">
                <div className="output-header">
                  <span className="output-name">{output.name}</span>
                  {output.type && <span className="output-type">({output.type})</span>}
                </div>
                
                <div className="output-controls">
                  <label>
                    <input
                      type="checkbox"
                      checked={output.connector || false}
                      onChange={(e) => {
                        const updatedOutputs = [...outputs];
                        updatedOutputs[index] = { ...output, connector: e.target.checked };
                        handlePropertyChange('outputs', updatedOutputs);
                      }}
                    />
                    Connector
                  </label>
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
        </div>

        {renderBasicProperties()}
        {renderInputsSection()}
        {renderOutputsSection()}
      </div>
    </div>
  );
};