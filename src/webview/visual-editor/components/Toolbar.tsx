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
  onAutoLayout?: () => void;
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
  onAutoLayout,
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