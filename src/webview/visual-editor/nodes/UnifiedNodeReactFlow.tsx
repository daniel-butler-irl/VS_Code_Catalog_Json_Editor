import React, { useEffect } from 'react';
import { NodeProps, Handle, Position, useUpdateNodeInternals } from 'reactflow';

// Unified Node component that handles both root and dependency node types
export const UnifiedNodeReactFlow: React.FC<NodeProps> = ({ data, selected, id }) => {
  const isSelected = selected || data.selected;
  const updateNodeInternals = useUpdateNodeInternals();
  
  // Determine node type from data (default to 'dependency' for backwards compatibility)
  const nodeType = data.nodeType || data.type || 'dependency';
  const isRootNode = nodeType === 'root';
  
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
  // When collapsed, only show ports that are actually connected
  const connectedInputs = inputs.filter(input => 
    data.connectedHandles?.includes(`input-${input.name}`));
  const connectedOutputs = outputs.filter(output => 
    data.connectedHandles?.includes(`output-${output.name}`));
  
  const visibleInputs = expanded ? inputs : connectedInputs;
  const visibleOutputs = expanded ? outputs : connectedOutputs;
  
  // Calculate dynamic height based on visible port count
  const maxPorts = Math.max(visibleInputs.length, visibleOutputs.length);
  const baseHeight = isRootNode ? 80 : 70; // Root nodes slightly taller for header
  const portSpacing = 10; // Consistent spacing for all node types
  const expandButtonHeight = 15; // Height for expand/collapse buttons
  const dynamicHeight = Math.max(baseHeight, baseHeight + (maxPorts * portSpacing) + expandButtonHeight);
  
  // Consistent width for all nodes
  const nodeWidth = isRootNode ? 120 : 100;
  
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
  
  // Node type specific styling
  const getNodeStyling = () => {
    if (isRootNode) {
      return {
        background: 'linear-gradient(135deg, #374151 0%, #4b5563 100%)',
        indicatorColor: '#60a5fa',
        indicatorShadow: '0 0 3px rgba(96, 165, 250, 0.4)',
        subtitle: 'Root Architecture'
      };
    } else {
      return {
        background: 'linear-gradient(135deg, #475569 0%, #64748b 100%)',
        indicatorColor: '#34d399',
        indicatorShadow: '0 0 3px rgba(52, 211, 153, 0.4)',
        subtitle: 'External Module'
      };
    }
  };
  
  const styling = getNodeStyling();
  
  return (
    <div 
      className={`unified-node-reactflow ${isRootNode ? 'root-type' : 'dependency-type'}`}
      style={{
        background: styling.background,
        color: 'white',
        border: isSelected ? '2px solid #fbbf24' : '1px solid #6b7280',
        borderRadius: '6px',
        width: nodeWidth,
        height: dynamicHeight,
        fontSize: '11px',
        fontFamily: 'var(--vscode-font-family, monospace)',
        boxShadow: isSelected ? '0 3px 8px rgba(251, 191, 36, 0.2)' : '0 2px 6px rgba(0, 0, 0, 0.15)',
        transition: 'all 0.2s ease',
        position: 'relative',
        overflow: 'visible',
        pointerEvents: 'auto',
        cursor: 'pointer'
      }}
      onClick={() => {
        console.log(`UnifiedNode (${nodeType}): Direct click event on node div`);
        // Don't stopPropagation here - let ReactFlow handle it
      }}
    >
      {/* Header */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.15)',
        padding: isRootNode ? '6px 8px' : '5px 6px',
        borderRadius: '5px 5px 0 0',
        fontWeight: '600',
        fontSize: isRootNode ? '11px' : '10px',
        textAlign: 'center',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          gap: isRootNode ? '4px' : '3px' 
        }}>
          <div style={{
            width: isRootNode ? '6px' : '5px',
            height: isRootNode ? '6px' : '5px',
            backgroundColor: styling.indicatorColor,
            borderRadius: '50%',
            boxShadow: styling.indicatorShadow,
          }} />
          <span style={{ 
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: isRootNode ? '100px' : '80px'
          }}>
            {data.label || (isRootNode ? 'Root Node' : 'Dependency')}
          </span>
        </div>
        <div style={{ 
          fontSize: isRootNode ? '9px' : '8px', 
          opacity: 0.7, 
          marginTop: '1px' 
        }}>
          {styling.subtitle}
        </div>
      </div>

      {/* Content Area */}
      <div style={{ padding: isRootNode ? '6px 8px' : '5px 6px' }}>
        <div style={{ 
          fontSize: isRootNode ? '10px' : '9px', 
          opacity: 0.85,
          textAlign: 'center',
          lineHeight: '1.3'
        }}>
          <div style={{ 
            marginBottom: isRootNode ? '3px' : '2px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {data.description || (isRootNode ? 'Primary catalog entry point' : 'External dependency module')}
          </div>
          {data.version && (
            <div style={{ 
              fontSize: isRootNode ? '9px' : '8px', 
              opacity: 0.6,
              color: '#93c5fd'
            }}>
              v{data.version}
            </div>
          )}
          {!isRootNode && data.installType && (
            <div style={{ 
              fontSize: '8px', 
              opacity: 0.6,
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
              color: '#a1a1aa',
              marginTop: '1px'
            }}>
              {data.installType}
            </div>
          )}
        </div>
      </div>
      
      {/* Single Expand/Collapse Control */}
      {(inputs.length > 0 || outputs.length > 0) && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: isRootNode ? '2px 8px' : '2px 6px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <button
            onClick={handleToggleExpand}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              fontSize: isRootNode ? '12px' : '10px',
              cursor: 'pointer',
              padding: isRootNode ? '2px 4px' : '1px 3px',
              borderRadius: isRootNode ? '3px' : '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: isRootNode ? '3px' : '2px',
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
            <span style={{ 
              fontSize: isRootNode ? '10px' : '8px', 
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', 
              transition: 'transform 0.2s ease' 
            }}>▼</span>
          </button>
        </div>
      )}
      
      {/* Input Handles - positioned on left edge within node bounds */}
      {visibleInputs.map((input, index) => {
        const handleId = `input-${input.name || index}`;
        const isBroken = brokenHandles.includes(handleId);
        const isConnected = data.connectedHandles?.includes(handleId);
        
        // Determine port color based on connection state
        let backgroundColor;
        if (isBroken) {
          backgroundColor = '#ef4444'; // Red for broken
        } else if (isConnected) {
          backgroundColor = '#10b981'; // Green for connected
        } else {
          backgroundColor = '#6b7280'; // Grey for unconnected
        }
        
        return (
          <Handle
            key={`input-${index}`}
            type="target"
            position={Position.Left}
            id={handleId}
            style={{
              top: `${((baseHeight + (index * portSpacing)) / dynamicHeight) * 100}%`,
              left: isRootNode ? '-4px' : '-3px',
              width: isRootNode ? '8px' : '6px',
              height: isRootNode ? '8px' : '6px',
              backgroundColor,
              border: isBroken ? '2px solid #dc2626' : '1px solid #fff',
              borderRadius: '50%',
              zIndex: 10,
              boxShadow: isBroken ? '0 0 4px rgba(239, 68, 68, 0.6)' : 'none',
              animation: isBroken ? 'pulse 2s infinite' : 'none'
            }}
            title={isBroken ? 
              `BROKEN: ${getDisplayName(input)} - No valid connection found` : 
              isConnected ?
                `CONNECTED: ${getDisplayName(input)}${input.description ? `\n${input.description}` : ''}` :
                `UNCONNECTED: ${getDisplayName(input)}${input.description ? `\n${input.description}` : ''}`
            }
          />
        );
      })}
      
      {/* Output Handles - positioned on right edge within node bounds */}
      {visibleOutputs.map((output, index) => {
        const handleId = `output-${output.name || index}`;
        const isBroken = brokenHandles.includes(handleId);
        const isConnected = data.connectedHandles?.includes(handleId);
        
        // Determine port color based on connection state
        let backgroundColor;
        if (isBroken) {
          backgroundColor = '#ef4444'; // Red for broken
        } else if (isConnected) {
          backgroundColor = '#f59e0b'; // Amber for connected
        } else {
          backgroundColor = '#6b7280'; // Grey for unconnected
        }
        
        return (
          <Handle
            key={`output-${index}`}
            type="source"
            position={Position.Right}
            id={handleId}
            style={{
              top: `${((baseHeight + (index * portSpacing)) / dynamicHeight) * 100}%`,
              right: isRootNode ? '-4px' : '-3px',
              width: isRootNode ? '8px' : '6px',
              height: isRootNode ? '8px' : '6px',
              backgroundColor,
              border: isBroken ? '2px solid #dc2626' : '1px solid #fff',
              borderRadius: '50%',
              zIndex: 10,
              boxShadow: isBroken ? '0 0 4px rgba(239, 68, 68, 0.6)' : 'none',
              animation: isBroken ? 'pulse 2s infinite' : 'none'
            }}
            title={isBroken ? 
              `BROKEN: ${getDisplayName(output)} - No valid connection found` : 
              isConnected ?
                `CONNECTED: ${getDisplayName(output)}${output.description ? `\n${output.description}` : ''}` :
                `UNCONNECTED: ${getDisplayName(output)}${output.description ? `\n${output.description}` : ''}`
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