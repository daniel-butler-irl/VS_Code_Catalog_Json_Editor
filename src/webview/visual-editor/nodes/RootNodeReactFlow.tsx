import React from 'react';
import { NodeProps } from 'reactflow';

// Enhanced Root Node with basic data display
export const RootNodeReactFlow: React.FC<NodeProps> = ({ data, selected }) => {
  const isSelected = selected || data.selected;
  
  return (
    <div style={{
      background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
      color: 'white',
      border: isSelected ? '3px solid #fbbf24' : '2px solid #1e40af',
      borderRadius: '8px',
      minWidth: '180px',
      fontSize: '12px',
      fontFamily: 'var(--vscode-font-family, monospace)',
      boxShadow: isSelected ? '0 4px 12px rgba(251, 191, 36, 0.3)' : '0 2px 8px rgba(30, 64, 175, 0.2)',
    }}>
      {/* Header */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.1)',
        padding: '8px 12px',
        borderRadius: '6px 6px 0 0',
        fontWeight: '600',
        fontSize: '13px',
        textAlign: 'center',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            backgroundColor: '#10b981',
            borderRadius: '50%',
            boxShadow: '0 0 4px rgba(16, 185, 129, 0.6)',
          }} />
          {data.label || 'Root Node'}
        </div>
        <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>
          Root Architecture
        </div>
      </div>

      {/* Content Area */}
      <div style={{ padding: '12px' }}>
        <div style={{ 
          fontSize: '11px', 
          opacity: 0.9,
          textAlign: 'center' 
        }}>
          {data.description || 'Primary catalog entry point'}
        </div>
        
        {data.version && (
          <div style={{ 
            fontSize: '10px', 
            opacity: 0.7, 
            marginTop: '4px',
            textAlign: 'center'
          }}>
            Version: {data.version}
          </div>
        )}
      </div>

      {/* Type Badge */}
      <div style={{
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
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
      }}>
        R
      </div>
    </div>
  );
};