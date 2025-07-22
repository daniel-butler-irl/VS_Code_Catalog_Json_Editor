import React from 'react';
import { NodeProps } from 'reactflow';

// Enhanced Dependency Node with basic data display  
export const DependencyNodeReactFlow: React.FC<NodeProps> = ({ data, selected }) => {
  const isSelected = selected || data.selected;
  
  return (
    <div style={{
      background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
      color: 'white',
      border: isSelected ? '3px solid #fbbf24' : '2px solid #059669',
      borderRadius: '8px',
      minWidth: '160px',
      fontSize: '12px',
      fontFamily: 'var(--vscode-font-family, monospace)',
      boxShadow: isSelected ? '0 4px 12px rgba(251, 191, 36, 0.3)' : '0 2px 8px rgba(5, 150, 105, 0.2)',
    }}>
      {/* Header */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.1)',
        padding: '6px 10px',
        borderRadius: '6px 6px 0 0',
        fontWeight: '600',
        fontSize: '12px',
        textAlign: 'center',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <div style={{
            width: '6px',
            height: '6px',
            backgroundColor: '#f59e0b',
            borderRadius: '50%',
            boxShadow: '0 0 4px rgba(245, 158, 11, 0.6)',
          }} />
          {data.label || 'Dependency'}
        </div>
        
        {data.version && (
          <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '1px' }}>
            v{data.version}
          </div>
        )}
      </div>

      {/* Content Area */}
      <div style={{ padding: '8px' }}>
        <div style={{ 
          fontSize: '10px', 
          opacity: 0.9,
          textAlign: 'center',
          marginBottom: '4px'
        }}>
          {data.description || 'External dependency module'}
        </div>
        
        {data.installType && (
          <div style={{ 
            fontSize: '9px', 
            opacity: 0.7,
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            {data.installType}
          </div>
        )}
      </div>

      {/* Type Badge */}
      <div style={{
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
      }}>
        D
      </div>
    </div>
  );
};