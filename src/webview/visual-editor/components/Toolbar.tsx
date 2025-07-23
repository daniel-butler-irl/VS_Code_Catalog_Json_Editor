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
}

export const Toolbar: React.FC<ToolbarProps> = ({
  products,
  selectedProduct,
  selectedFlavor,
  onProductChange,
  onFlavorChange,
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
      
    </div>
  );
};