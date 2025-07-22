import React, { useEffect } from 'react';
import { NodeProps, Handle, Position, useUpdateNodeInternals } from 'reactflow';

// Enhanced Root Node with dynamic height and expand/collapse functionality
export const RootNodeReactFlow: React.FC<NodeProps> = ({ data, selected, id }) => {
  const isSelected = selected || data.selected;
  const updateNodeInternals = useUpdateNodeInternals();
  
  // Get broken handles information from data
  const brokenHandles = data.brokenHandles || [];
  
  // Get port data from node data with proper typing and display name support
  const inputs = (data.inputs as Array<{
    name?: string, 
    display_name?: string, 
    description?: string,
    connector?: boolean
  }>) || [];
  const outputs = (data.outputs as Array<{
    name?: string, 
    display_name?: string, 
    description?: string,
    connector?: boolean
  }>) || [];
  
  // Get expand state from data (default to collapsed)
  const expanded = data.expanded || false;
  
  // Filter ports based on expand state and connections
  const connectedInputs = inputs.filter(input => 
    data.connectedHandles?.includes(`input-${input.name}`) || input.connector);
  const connectedOutputs = outputs.filter(output => 
    data.connectedHandles?.includes(`output-${output.name}`) || output.connector);
  
  const visibleInputs = expanded ? inputs : connectedInputs;
  const visibleOutputs = expanded ? outputs : connectedOutputs;
  
  // Calculate dynamic height based on visible port count
  const maxPorts = Math.max(visibleInputs.length, visibleOutputs.length);
  const baseHeight = 80; // Header + content area
  const portSpacing = 10; // Optimized spacing for better fit
  const expandButtonHeight = 15; // Height for expand/collapse buttons
  const dynamicHeight = Math.max(baseHeight, baseHeight + (maxPorts * portSpacing) + expandButtonHeight);
  
  // Update node internals when port data or expand state changes
  useEffect(() => {
    if (id) {
      updateNodeInternals(id);
    }
  }, [inputs.length, outputs.length, expanded, id, updateNodeInternals]);

  // Helper function to get display name with fallback
  const getDisplayName = (item: {name?: string, display_name?: string}) => {
    return item.display_name || item.name || 'Unknown';
  };

  // Helper function to handle expand/collapse toggle
  const handleToggleExpand = () => {
    if (data.onToggleExpand) {
      data.onToggleExpand(id);
    }
  };
  
  return (
    <div style={{
      background: 'linear-gradient(135deg, #374151 0%, #4b5563 100%)',
      color: 'white',
      border: isSelected ? '2px solid #fbbf24' : '1px solid #6b7280',
      borderRadius: '6px',
      width: '120px', // Fixed width instead of min/max
      height: `${dynamicHeight}px`, // Dynamic height
      fontSize: '11px',
      fontFamily: 'var(--vscode-font-family, monospace)',
      boxShadow: isSelected ? '0 3px 8px rgba(251, 191, 36, 0.2)' : '0 2px 6px rgba(0, 0, 0, 0.15)',
      transition: 'all 0.2s ease',
      position: 'relative', // Ensure handles are positioned relative to this container
    }}>
      {/* Header */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.15)',
        padding: '6px 8px',
        borderRadius: '5px 5px 0 0',
        fontWeight: '600',
        fontSize: '11px',
        textAlign: 'center',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          <div style={{
            width: '6px',
            height: '6px',
            backgroundColor: '#60a5fa',
            borderRadius: '50%',
            boxShadow: '0 0 3px rgba(96, 165, 250, 0.4)',
          }} />
          <span style={{ 
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100px'
          }}>
            {data.label || 'Root Node'}
          </span>
        </div>
        <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '1px' }}>
          Root Architecture
        </div>
      </div>

      {/* Content Area */}
      <div style={{ padding: '6px 8px' }}>
        <div style={{ 
          fontSize: '10px', 
          opacity: 0.85,
          textAlign: 'center',
          lineHeight: '1.3'
        }}>
          <div style={{ 
            marginBottom: '3px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {data.description || 'Primary catalog entry point'}
          </div>
          {data.version && (
            <div style={{ 
              fontSize: '9px', 
              opacity: 0.6,
              color: '#93c5fd'
            }}>
              v{data.version}
            </div>
          )}
        </div>
      </div>
      
      {/* Single Expand/Collapse Control */}
      {(inputs.length > 0 || outputs.length > 0) && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '2px 8px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <button
            onClick={handleToggleExpand}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              fontSize: '12px',
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: '3px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              transition: 'all 0.2s ease',
              opacity: 0.7
            }}
            title={`${expanded ? 'Collapse' : 'Expand'} all ports (${inputs.length + outputs.length} total, ${visibleInputs.length + visibleOutputs.length} visible)`}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.opacity = '0.7';
            }}
          >
            <span style={{ fontSize: '10px', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>▼</span>
          </button>
        </div>
      )}
      
      {/* Input Handles - positioned on left edge within node bounds */}
      {visibleInputs.map((input, index) => {
        const handleId = `input-${input.name || index}`;
        const isBroken = brokenHandles.includes(handleId);
        
        return (
          <Handle
            key={`input-${index}`}
            type="target"
            position={Position.Left}
            id={handleId}
            style={{
              left: '0px', // Position handle at left edge to prevent width boundary extension
              top: `${80 + (index * portSpacing)}px`, // Start after header/content area + expand control
              width: '8px',
              height: '8px',
              backgroundColor: isBroken ? '#ef4444' : '#10b981',
              border: isBroken ? '2px solid #dc2626' : '1px solid #fff',
              borderRadius: '50%',
              zIndex: 10,
              boxShadow: isBroken ? '0 0 4px rgba(239, 68, 68, 0.6)' : 'none',
              animation: isBroken ? 'pulse 2s infinite' : 'none'
            }}
            title={isBroken ? 
              `BROKEN: ${getDisplayName(input)} - No valid connection found` : 
              `${getDisplayName(input)}${input.description ? `\n${input.description}` : ''}`
            }
          />
        );
      })}
      
      {/* Output Handles - positioned on right edge within node bounds */}
      {visibleOutputs.map((output, index) => {
        const handleId = `output-${output.name || index}`;
        const isBroken = brokenHandles.includes(handleId);
        
        return (
          <Handle
            key={`output-${index}`}
            type="source"
            position={Position.Right}
            id={handleId}
            style={{
              right: '0px', // Position handle at right edge to prevent width boundary extension
              top: `${80 + (index * portSpacing)}px`, // Start after header/content area + expand control
              width: '8px',
              height: '8px',
              backgroundColor: isBroken ? '#ef4444' : '#f59e0b',
              border: isBroken ? '2px solid #dc2626' : '1px solid #fff',
              borderRadius: '50%',
              zIndex: 10,
              boxShadow: isBroken ? '0 0 4px rgba(239, 68, 68, 0.6)' : 'none',
              animation: isBroken ? 'pulse 2s infinite' : 'none'
            }}
            title={isBroken ? 
              `BROKEN: ${getDisplayName(output)} - No valid connection found` : 
              `${getDisplayName(output)}${output.description ? `\n${output.description}` : ''}`
            }
          />
        );
      })}
      
      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};