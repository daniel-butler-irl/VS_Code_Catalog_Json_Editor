import React, { useState, useRef, useEffect } from 'react';

interface GraphNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  data: any;
  position: { x: number; y: number };
  // Single expand/collapse state
  expanded?: boolean;
}

interface NodeInput {
  name: string;
  display_name?: string;
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
  display_name?: string;
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
  const [showDebugMode, setShowDebugMode] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(250);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  
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

  // Load panel state from localStorage
  useEffect(() => {
    const savedWidth = localStorage.getItem('propertiesPanel.width');
    const savedCollapsed = localStorage.getItem('propertiesPanel.collapsed');
    
    if (savedWidth) {
      const width = parseInt(savedWidth, 10);
      if (width >= 200 && width <= 600) {
        setPanelWidth(width);
      }
    }
    
    if (savedCollapsed) {
      setIsCollapsed(savedCollapsed === 'true');
    }
  }, []);

  // Save panel state to localStorage
  useEffect(() => {
    localStorage.setItem('propertiesPanel.width', panelWidth.toString());
    localStorage.setItem('propertiesPanel.collapsed', isCollapsed.toString());
  }, [panelWidth, isCollapsed]);

  // Handle resize functionality
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;
      
      const rect = panelRef.current.getBoundingClientRect();
      const newWidth = rect.right - e.clientX;
      const clampedWidth = Math.max(200, Math.min(600, newWidth));
      
      setPanelWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  if (!selectedNode) {
    console.log('PropertiesPanel: No node selected, showing empty state');
    return (
      <div 
        ref={panelRef}
        className="properties-panel"
        style={{ width: isCollapsed ? '40px' : `${panelWidth}px` }}
      >
        <div 
          className="resize-handle"
          onMouseDown={handleResizeStart}
          style={{ display: isCollapsed ? 'none' : 'block' }}
        />
        <div className="properties-header">
          <h3 style={{ display: isCollapsed ? 'none' : 'block' }}>Properties</h3>
          <button 
            className="collapse-button"
            onClick={handleCollapse}
            title={isCollapsed ? 'Expand Properties Panel' : 'Collapse Properties Panel'}
          >
            {isCollapsed ? '→' : '←'}
          </button>
        </div>
        {!isCollapsed && (
          <div className="properties-content">
            <div className="empty-selection">
              <div className="empty-selection-icon">🔍</div>
              <div className="empty-selection-title">No Node Selected</div>
              <div className="empty-selection-message">
                Click on a node in the canvas to view and edit its properties
              </div>
              <div className="empty-selection-hint">
                💡 <strong>Tip:</strong> Use the connector toggles to show/hide input and output ports on nodes
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Data validation and error handling
  if (!selectedNode.data) {
    console.error('PropertiesPanel: Selected node has no data:', selectedNode);
    return (
      <div 
        ref={panelRef}
        className="properties-panel"
        style={{ width: isCollapsed ? '40px' : `${panelWidth}px` }}
      >
        <div 
          className="resize-handle"
          onMouseDown={handleResizeStart}
          style={{ display: isCollapsed ? 'none' : 'block' }}
        />
        <div className="properties-header">
          <h3 style={{ display: isCollapsed ? 'none' : 'block' }}>Properties</h3>
          <button 
            className="collapse-button"
            onClick={handleCollapse}
            title={isCollapsed ? 'Expand Properties Panel' : 'Collapse Properties Panel'}
          >
            {isCollapsed ? '→' : '←'}
          </button>
        </div>
        {!isCollapsed && (
          <div className="properties-content">
            <div className="error-state">
              <div className="error-state-icon">⚠️</div>
              <div className="error-state-title">Node Data Missing</div>
              <div className="error-state-message">
                The selected node is missing its data structure. This might be due to a parsing error or corrupted node state.
              </div>
              <div className="error-state-details">
                <strong>Node ID:</strong> {selectedNode.id}
              </div>
              <div className="error-state-hint">
                💡 Try selecting a different node or refreshing the visual editor
              </div>
            </div>
          </div>
        )}
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
          <div className="empty-state">
            <div className="empty-state-icon">📥</div>
            <div className="empty-state-title">No Inputs Defined</div>
            <div className="empty-state-message">
              This node doesn't have any input variables configured. 
              {selectedNode.type === 'dependency' 
                ? 'Dependencies typically have inputs like region, resource_group_name, and module-specific parameters.' 
                : 'Root nodes typically have inputs from user configuration and dependency mappings.'
              }
            </div>
            <div className="empty-state-hint">
              💡 Inputs with <strong>connector</strong> enabled appear as ports on the visual node
            </div>
          </div>
        ) : (
          <div className="inputs-list">
            {inputs.map((input: NodeInput, index: number) => (
              <div key={index} className="input-item">
                <div className="input-header">
                  <span 
                    className="input-name"
                    title={input.description || input.name}
                  >
                    {input.display_name || input.name}
                  </span>
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
          <div className="empty-state">
            <div className="empty-state-icon">📤</div>
            <div className="empty-state-title">No Outputs Defined</div>
            <div className="empty-state-message">
              This node doesn't have any output variables configured. 
              {selectedNode.type === 'dependency' 
                ? 'Dependencies typically expose outputs like resource IDs, CRNs, and connection details.' 
                : 'Root nodes typically expose outputs that can be consumed by other architectures.'
              }
            </div>
            <div className="empty-state-hint">
              💡 Outputs with <strong>connector</strong> enabled appear as ports on the visual node
            </div>
          </div>
        ) : (
          <div className="outputs-list">
            {outputs.map((output: NodeOutput, index: number) => (
              <div key={index} className="output-item">
                <div className="output-header">
                  <span 
                    className="output-name"
                    title={output.description || output.name}
                  >
                    {output.display_name || output.name}
                  </span>
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

  const renderDebugMode = () => {
    if (!showDebugMode || !selectedNode) return null;
    
    return (
      <div className="debug-section">
        <h4>🐛 Debug Data</h4>
        <div className="debug-content">
          <div className="debug-item">
            <strong>Node ID:</strong> {selectedNode.id}
          </div>
          <div className="debug-item">
            <strong>Node Type:</strong> {selectedNode.type}
          </div>
          <div className="debug-item">
            <strong>Node Name:</strong> {selectedNode.name}
          </div>
          <div className="debug-item">
            <strong>Position:</strong> x: {selectedNode.position.x}, y: {selectedNode.position.y}
          </div>
          <div className="debug-item">
            <strong>Raw Data:</strong>
            <pre className="debug-json">
              {JSON.stringify(selectedNode.data, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div 
      ref={panelRef}
      className="properties-panel"
      style={{ width: isCollapsed ? '40px' : `${panelWidth}px` }}
    >
      <div 
        className="resize-handle"
        onMouseDown={handleResizeStart}
        style={{ display: isCollapsed ? 'none' : 'block' }}
      />
      <div className="properties-header">
        <h3 style={{ display: isCollapsed ? 'none' : 'block' }}>Properties</h3>
        <div className="properties-header-actions">
          <button 
            className="collapse-button"
            onClick={handleCollapse}
            title={isCollapsed ? 'Expand Properties Panel' : 'Collapse Properties Panel'}
          >
            {isCollapsed ? '→' : '←'}
          </button>
          {!isCollapsed && (
            <>
              <button 
                className="debug-toggle-button"
                onClick={() => setShowDebugMode(!showDebugMode)}
                title="Toggle Debug Mode"
              >
                🐛
              </button>
              {selectedNode && selectedNode.type !== 'root' && (
                <button 
                  className="remove-button"
                  onClick={handleRemoveNode}
                  title="Remove Dependency"
                >
                  ✕
                </button>
              )}
            </>
          )}
        </div>
      </div>
      
      {!isCollapsed && (
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
              
              {/* Single Expand/Collapse Control */}
              <div className="expansion-controls">
                <div className="expansion-row">
                  <span className="expansion-label">🔧 Node View:</span>
                  <div className="expansion-buttons">
                    <button
                      className={`expansion-button ${selectedNode.data?.expanded ? 'active' : ''}`}
                      onClick={() => {
                        if (selectedNode.data?.onToggleExpand) {
                          selectedNode.data.onToggleExpand(selectedNode.id);
                        }
                      }}
                      title={`${selectedNode.data?.expanded ? 'Collapse' : 'Expand'} all ports on visual node`}
                    >
                      {selectedNode.data?.expanded ? '🔽' : '▶️'} Show All Ports ({(selectedNode.data.inputs || []).length + (selectedNode.data.outputs || []).length})
                    </button>
                  </div>
                </div>
                <div className="expansion-hint">
                  By default, only connected ports are visible. Use this control to show all available ports on the visual node.
                </div>
              </div>
              <div className="summary-hint">
                Only connector ports appear on the visual node. Use the toggles below to enable/disable connector ports.
              </div>
              <div className="summary-help">
                <strong>Connector Ports:</strong> These appear as connection points on the visual node and can be linked to other nodes.
                <br />
                <strong>Property-Only:</strong> These are configuration values that don't appear as visual ports.
              </div>
            </div>
          </div>

          {renderBasicProperties()}
          {renderInputsSection()}
          {renderOutputsSection()}
          {renderDebugMode()}
        </div>
      )}
    </div>
  );
};