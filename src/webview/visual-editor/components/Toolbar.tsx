import React from 'react';

interface ToolbarProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitToScreen?: () => void;
  onResetLayout?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onResetLayout
}) => {
  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <span className="toolbar-title">IBM Catalog Visual Editor</span>
      </div>
      
      <div className="toolbar-section toolbar-controls">
        <button 
          className="toolbar-button"
          onClick={onZoomIn}
          title="Zoom In"
        >
          <span className="toolbar-icon">🔍+</span>
        </button>
        
        <button 
          className="toolbar-button"
          onClick={onZoomOut}
          title="Zoom Out"
        >
          <span className="toolbar-icon">🔍-</span>
        </button>
        
        <button 
          className="toolbar-button"
          onClick={onFitToScreen}
          title="Fit to Screen"
        >
          <span className="toolbar-icon">⚏</span>
        </button>
        
        <button 
          className="toolbar-button"
          onClick={onResetLayout}
          title="Reset Layout"
        >
          <span className="toolbar-icon">🔄</span>
        </button>
      </div>
    </div>
  );
};