import React from 'react';
import { ClassicPreset } from 'rete';
import { RootNodeClass } from './NodeClasses';

interface RootNodeProps {
  data: RootNodeClass;
  emit: (data: { type: string; data: any }) => void;
}

export const RootNode: React.FC<RootNodeProps> = ({ data, emit }) => {
  console.log('RootNode: Rendering root node component with data:', {
    id: data.id,
    label: data.label,
    graphNodeName: data.graphNode?.name,
    inputCount: data.inputs.size,
    outputCount: data.outputs.size,
    selected: data.selected
  });

  const handleClick = () => {
    console.log('RootNode: Node clicked, emitting nodeselect event');
    emit({ type: 'nodeselect', data: { node: data } });
  };

  const handleInputChange = (key: string, value: any) => {
    console.log('RootNode: Input changed:', { key, value });
    // Update the node's data and emit change
    data.graphNode.data[key] = value;
    emit({ type: 'nodechange', data: { node: data, key, value } });
  };

  return (
    <div 
      className={`rete-node root-node ${data.selected ? 'selected' : ''}`}
      onClick={handleClick}
      style={{
        minWidth: '200px',
        minHeight: '120px',
        position: 'relative'
      }}
    >
      <div className="node-header">
        <div className="node-title">{data.graphNode?.name || data.label || 'Root Node'}</div>
        <div className="node-type-badge root">ROOT</div>
      </div>
      
      <div className="node-content">
        <div className="node-info">
          <span className="label">Flavor:</span>
          <span className="value">{data.graphNode?.data?.flavor || 'Default'}</span>
        </div>
        
        {data.graphNode?.data?.label && (
          <div className="node-info">
            <span className="label">Label:</span>
            <span className="value">{data.graphNode.data.label}</span>
          </div>
        )}
        
        {data.graphNode?.data?.description && (
          <div className="node-description">
            {data.graphNode.data.description}
          </div>
        )}
        
        <div className="node-debug">
          <small>ID: {data.id} | Inputs: {data.inputs.size} | Outputs: {data.outputs.size}</small>
        </div>
      </div>
    </div>
  );
};