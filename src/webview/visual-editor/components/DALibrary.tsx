import React, { useState, useMemo } from 'react';

interface FlavorData {
  name: string;
  label?: string;
}

interface OfferingData {
  id: string;
  name: string;
  label?: string;
  description: string;
  versions: string[];
  flavors: FlavorData[];
  catalogId?: string;
  catalogLabel?: string;
}

interface CatalogData {
  id: string;
  label: string;
  shortDescription?: string;
  isPublic: boolean;
}

interface DALibraryProps {
  offerings: OfferingData[];
  catalogs?: CatalogData[];
  selectedCatalogId?: string;
  onAddDependency: (offering: OfferingData, position: { x: number; y: number }) => void;
  onCatalogChange?: (catalogId: string) => void;
  loading?: boolean;
  error?: string | null;
}

interface OfferingCardProps {
  offering: OfferingData;
  onDragStart: (offering: OfferingData) => void;
}

const OfferingCard: React.FC<OfferingCardProps> = ({ offering, onDragStart }) => {
  const [selectedFlavor, setSelectedFlavor] = useState(offering.flavors[0]?.name || 'standard');
  const [selectedVersion, setSelectedVersion] = useState(offering.versions[0] || '');

  // Get versions for the selected flavor - for now, we'll show all versions
  // In a real implementation, this would filter versions based on the selected flavor
  const availableVersions = offering.versions;

  const handleDragStart = (e: React.DragEvent) => {
    try {
      const dragData = {
        ...offering,
        selectedVersion,
        selectedFlavor
      };
      
      console.log('DALibrary: Drag started for offering:', dragData);
      e.dataTransfer.setData('application/json', JSON.stringify(dragData));
      e.dataTransfer.effectAllowed = 'copy';
      console.log('DALibrary: Drag data set, effectAllowed:', e.dataTransfer.effectAllowed);
      onDragStart(offering);
    } catch (dragError) {
      console.error('DALibrary: Error during drag start:', dragError);
      // Prevent drag operation on error
      e.preventDefault();
    }
  };

  return (
    <div 
      className="offering-card"
      draggable
      onDragStart={handleDragStart}
      title={offering.description}
    >
      <div className="offering-header">
        <div className="offering-name">{offering.label || offering.name}</div>
      </div>
      
      <div className="offering-description">
        {offering.description.length > 80 
          ? `${offering.description.substring(0, 80)}...` 
          : offering.description}
      </div>
      
      <div className="offering-controls">
        {offering.flavors.length > 0 && (
          <div className="control-group">
            <label>Variation:</label>
            <select 
              value={selectedFlavor}
              onChange={(e) => setSelectedFlavor(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              {offering.flavors.map(flavor => (
                <option key={`${offering.id}-${flavor.name}`} value={flavor.name}>{flavor.label || flavor.name}</option>
              ))}
            </select>
          </div>
        )}
        
        {availableVersions.length > 0 && (
          <div className="control-group">
            <label>Version:</label>
            <select 
              value={selectedVersion}
              onChange={(e) => setSelectedVersion(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              {availableVersions.map((version, index) => (
                <option key={`${offering.id}-${selectedFlavor}-${version}-${index}`} value={version}>{version}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
};

export const DALibrary: React.FC<DALibraryProps> = ({ 
  offerings, 
  catalogs = [], 
  selectedCatalogId, 
  onAddDependency, 
  onCatalogChange, 
  loading = false, 
  error = null 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [draggedOffering, setDraggedOffering] = useState<OfferingData | null>(null);

  const filteredOfferings = useMemo(() => {
    try {
      if (!Array.isArray(offerings)) {
        console.warn('DALibrary: Invalid offerings format, expected array');
        return [];
      }
      
      return offerings.filter(offering => {
        try {
          const searchLower = searchTerm.toLowerCase();
          const name = offering.name || '';
          const label = offering.label || '';
          const description = offering.description || '';
          
          return name.toLowerCase().includes(searchLower) ||
                 label.toLowerCase().includes(searchLower) ||
                 description.toLowerCase().includes(searchLower);
        } catch (filterError) {
          console.warn('DALibrary: Error filtering offering:', offering, filterError);
          return false;
        }
      });
    } catch (error) {
      console.error('DALibrary: Error in filteredOfferings:', error);
      return [];
    }
  }, [offerings, searchTerm]);

  const handleDragStart = (offering: OfferingData) => {
    setDraggedOffering(offering);
  };

  const handleDragEnd = () => {
    setDraggedOffering(null);
  };

  const handleRetryOfferings = () => {
    console.log('DALibrary: Retrying offerings data fetch');
    try {
      if (window.vscode) {
        window.vscode.postMessage({ command: 'requestOfferingsData' });
      } else {
        console.error('DALibrary: VS Code API not available for retry');
      }
    } catch (retryError) {
      console.error('DALibrary: Error sending retry message:', retryError);
    }
  };

  return (
    <div className="da-library" onDragEnd={handleDragEnd}>
      <div className="da-library-header">
        <h3>Catalog</h3>
        <div className="catalog-selector">
          <select 
            value={selectedCatalogId || ''}
            onChange={(e) => onCatalogChange && onCatalogChange(e.target.value)}
            disabled={catalogs.length === 0}
          >
            {catalogs.length === 0 ? (
              <option value="">No catalogs available</option>
            ) : (
              catalogs.map(catalog => (
                <option key={catalog.id} value={catalog.id}>
                  {catalog.label} {catalog.isPublic ? '(Public)' : '(Private)'}
                </option>
              ))
            )}
          </select>
        </div>
      </div>
      
      <div className="search-container">
        <input
          type="text"
          placeholder="Search offerings..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>
      
      <div className="offerings-count">
        {loading ? (
          'Loading offerings...'
        ) : error ? (
          'Unable to load offerings'
        ) : (
          `Showing ${filteredOfferings.length} of ${offerings.length} offerings`
        )}
      </div>
      
      <div className="offerings-list">
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <div className="loading-text">Loading offerings...</div>
          </div>
        ) : error ? (
          <div className="error-state">
            <div className="error-icon">⚠️</div>
            <div className="error-message">{error}</div>
            <div className="error-hint">
              Please check your IBM Cloud authentication and try again.
            </div>
            <button className="retry-button" onClick={handleRetryOfferings}>
              Retry
            </button>
          </div>
        ) : filteredOfferings.length === 0 ? (
          <div className="empty-state">
            {searchTerm ? `No offerings found for "${searchTerm}"` : 'No offerings available'}
          </div>
        ) : (
          filteredOfferings.map(offering => (
            <OfferingCard
              key={offering.id}
              offering={offering}
              onDragStart={handleDragStart}
            />
          ))
        )}
      </div>
      
      {draggedOffering && (
        <div className="drag-feedback">
          <div className="drag-feedback-text">
            Drag to canvas to add <strong>{draggedOffering.label || draggedOffering.name}</strong>
          </div>
          <div className="drag-feedback-details">
            Version: {draggedOffering.versions[0] || 'Latest'} | Flavor: {draggedOffering.flavors[0]?.label || draggedOffering.flavors[0]?.name || 'Standard'}
          </div>
        </div>
      )}
    </div>
  );
};