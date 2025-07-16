import React from 'react';

interface Product {
  name: string;
  label: string;
  flavors: Flavor[];
}

interface Flavor {
  name: string;
  label: string;
}

interface ToolbarProps {
  products: Product[];
  selectedProduct: string;
  selectedFlavor: string;
  onProductChange: (productName: string) => void;
  onFlavorChange: (flavorName: string) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitToScreen?: () => void;
  onResetLayout?: () => void;
  onSave?: () => void;
  onValidate?: () => void;
  onAutoLayout?: () => void;
  validationErrors?: number;
  isModified?: boolean;
  isSaving?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  products,
  selectedProduct,
  selectedFlavor,
  onProductChange,
  onFlavorChange,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onResetLayout,
  onSave,
  onValidate,
  onAutoLayout,
  validationErrors = 0,
  isModified = false,
  isSaving = false
}) => {
  const currentProduct = products.find(p => p.name === selectedProduct);
  const availableFlavors = currentProduct?.flavors || [];

  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <span className="toolbar-title">IBM Catalog Visual Editor</span>
      </div>
      
      <div className="toolbar-section toolbar-selectors">
        <div className="selector-group">
          <label htmlFor="product-selector">Product:</label>
          <select 
            id="product-selector"
            className="toolbar-select"
            value={selectedProduct}
            onChange={(e) => onProductChange(e.target.value)}
          >
            {products.map(product => (
              <option key={product.name} value={product.name}>
                {product.label || product.name}
              </option>
            ))}
          </select>
        </div>
        
        <div className="selector-group">
          <label htmlFor="flavor-selector">Flavor:</label>
          <select 
            id="flavor-selector"
            className="toolbar-select"
            value={selectedFlavor}
            onChange={(e) => onFlavorChange(e.target.value)}
            disabled={availableFlavors.length === 0}
          >
            {availableFlavors.length === 0 ? (
              <option value="">No flavors available</option>
            ) : (
              availableFlavors.map(flavor => (
                <option key={flavor.name} value={flavor.name}>
                  {flavor.label || flavor.name}
                </option>
              ))
            )}
          </select>
        </div>
        
        {/* Status Indicators */}
        <div className="status-indicators">
          {isModified && (
            <span className="status-indicator modified" title="Unsaved changes">
              •
            </span>
          )}
          {validationErrors > 0 && (
            <span className="status-indicator error" title={`${validationErrors} validation errors`}>
              ⚠️ {validationErrors}
            </span>
          )}
        </div>
      </div>
      
      <div className="toolbar-section toolbar-actions">
        <button 
          className={`toolbar-button ${isModified ? 'modified' : ''}`}
          onClick={onSave}
          disabled={isSaving || !isModified}
          title={isModified ? 'Save Changes' : 'No Changes to Save'}
        >
          <span className="toolbar-icon">{isSaving ? '⏳' : '💾'}</span>
          <span className="toolbar-text">Save</span>
          {isModified && <span className="modified-indicator">•</span>}
        </button>
        
        <button 
          className={`toolbar-button ${validationErrors > 0 ? 'error' : 'success'}`}
          onClick={onValidate}
          title={validationErrors > 0 ? `${validationErrors} validation errors` : 'Validation passed'}
        >
          <span className="toolbar-icon">{validationErrors > 0 ? '⚠️' : '✅'}</span>
          <span className="toolbar-text">Validate</span>
          {validationErrors > 0 && <span className="error-count">{validationErrors}</span>}
        </button>
      </div>
      
      <div className="toolbar-section toolbar-layout">
        <button 
          className="toolbar-button"
          onClick={onAutoLayout}
          title="Auto Layout"
        >
          <span className="toolbar-icon">🎯</span>
          <span className="toolbar-text">Auto</span>
        </button>
        
        <button 
          className="toolbar-button"
          onClick={onResetLayout}
          title="Reset Layout"
        >
          <span className="toolbar-icon">🔄</span>
          <span className="toolbar-text">Reset</span>
        </button>
      </div>
      
      <div className="toolbar-section toolbar-view">
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
      </div>
    </div>
  );
};