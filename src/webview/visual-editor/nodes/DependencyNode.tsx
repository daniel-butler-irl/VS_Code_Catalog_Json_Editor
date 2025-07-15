import React, { useState } from 'react';
import { ClassicPreset } from 'rete';
import { DependencyNodeClass } from './NodeClasses';

interface DependencyNodeProps {
  data: DependencyNodeClass;
  emit: (data: { type: string; data: any }) => void;
}

export const DependencyNode: React.FC<DependencyNodeProps> = ({ data, emit }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  console.log('DependencyNode: Rendering dependency node component with data:', {
    id: data.id,
    label: data.label,
    graphNodeName: data.graphNode?.name,
    inputCount: data.inputs.size,
    outputCount: data.outputs.size,
    selected: data.selected
  });

  const handleClick = () => {
    console.log('DependencyNode: Node clicked, emitting nodeselect event');
    emit({ type: 'nodeselect', data: { node: data } });
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleInputChange = (key: string, value: any) => {
    // Update the node's data and emit change
    data.graphNode.data[key] = value;
    emit({ type: 'nodechange', data: { node: data, key, value } });
  };

  const dependencyData = data.graphNode.data;

  return (
    <div 
      className={`rete-node dependency-node ${data.selected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
      onClick={handleClick}
      style={{
        minWidth: '180px',
        minHeight: '100px',
        border: '2px solid #2196f3',
        borderRadius: '8px',
        backgroundColor: '#ffffff',
        position: 'relative'
      }}
    >
      <div className="node-header">
        <div className="node-title-section">
          <div className="node-title">{data.graphNode.name}</div>
          <button 
            className="expand-toggle"
            onClick={handleToggleExpand}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? '−' : '+'}
          </button>
        </div>
        <div className="node-type-badge dependency">DEP</div>
      </div>
      
      <div className="node-content">
        {/* Basic info always visible */}
        <div className="node-info">
          <span className="label">Version:</span>
          <span className="value">{dependencyData.version || 'Latest'}</span>
        </div>

        {dependencyData.flavors && dependencyData.flavors.length > 0 && (
          <div className="node-info">
            <span className="label">Flavor:</span>
            <span className="value">{dependencyData.flavors.join(', ')}</span>
          </div>
        )}

        {dependencyData.optional && (
          <div className="node-badge optional">Optional</div>
        )}

        {/* Expanded content */}
        {isExpanded && (
          <div className="expanded-content">
            {dependencyData.id && (
              <div className="node-info">
                <span className="label">ID:</span>
                <span className="value">{dependencyData.id}</span>
              </div>
            )}
            
            {dependencyData.catalog_id && (
              <div className="node-info">
                <span className="label">Catalog:</span>
                <span className="value">{dependencyData.catalog_id}</span>
              </div>
            )}

            {dependencyData.install_type && (
              <div className="node-info">
                <span className="label">Install Type:</span>
                <span className="value">{dependencyData.install_type}</span>
              </div>
            )}

            {/* Quick controls for common properties */}
            <div className="quick-controls">
              {dependencyData.version && (
                <div className="control-group">
                  <label>Version:</label>
                  <select 
                    value={dependencyData.version}
                    onChange={(e) => handleInputChange('version', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value={dependencyData.version}>{dependencyData.version}</option>
                    <option value="latest">Latest</option>
                    <option value="^1.0.0">^1.0.0</option>
                    <option value="~1.0.0">~1.0.0</option>
                  </select>
                </div>
              )}

              {dependencyData.flavors && dependencyData.flavors.length > 1 && (
                <div className="control-group">
                  <label>Flavor:</label>
                  <select 
                    value={dependencyData.flavors[0]}
                    onChange={(e) => handleInputChange('flavors', [e.target.value])}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {dependencyData.flavors.map((flavor: string) => (
                      <option key={flavor} value={flavor}>{flavor}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="control-group">
                <label>
                  <input
                    type="checkbox"
                    checked={dependencyData.optional || false}
                    onChange={(e) => handleInputChange('optional', e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  Optional
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

        <div className="node-debug">
          <small>ID: {data.id} | Inputs: {data.inputs.size} | Outputs: {data.outputs.size}</small>
        </div>
    </div>
  );
};