import React, { useState, useMemo } from 'react';

interface OfferingData {
  id: string;
  name: string;
  description: string;
  versions: string[];
  flavors: string[];
}

interface DALibraryProps {
  offerings: OfferingData[];
  onAddDependency: (offering: OfferingData, position: { x: number; y: number }) => void;
}

interface OfferingCardProps {
  offering: OfferingData;
  onDragStart: (offering: OfferingData) => void;
}

const OfferingCard: React.FC<OfferingCardProps> = ({ offering, onDragStart }) => {
  const [selectedVersion, setSelectedVersion] = useState(offering.versions[0] || '');
  const [selectedFlavor, setSelectedFlavor] = useState(offering.flavors[0] || 'standard');

  const handleDragStart = (e: React.DragEvent) => {
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
  };

  return (
    <div 
      className="offering-card"
      draggable
      onDragStart={handleDragStart}
      title={offering.description}
    >
      <div className="offering-header">
        <div className="offering-name">{offering.name}</div>
      </div>
      
      <div className="offering-description">
        {offering.description.length > 80 
          ? `${offering.description.substring(0, 80)}...` 
          : offering.description}
      </div>
      
      <div className="offering-controls">
        {offering.versions.length > 0 && (
          <div className="control-group">
            <label>Version:</label>
            <select 
              value={selectedVersion}
              onChange={(e) => setSelectedVersion(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              {offering.versions.map(version => (
                <option key={version} value={version}>{version}</option>
              ))}
            </select>
          </div>
        )}
        
        {offering.flavors.length > 0 && (
          <div className="control-group">
            <label>Flavor:</label>
            <select 
              value={selectedFlavor}
              onChange={(e) => setSelectedFlavor(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              {offering.flavors.map(flavor => (
                <option key={flavor} value={flavor}>{flavor}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
};

export const DALibrary: React.FC<DALibraryProps> = ({ offerings, onAddDependency }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [catalogFilter, setCatalogFilter] = useState('public');
  const [draggedOffering, setDraggedOffering] = useState<OfferingData | null>(null);

  const filteredOfferings = useMemo(() => {
    return offerings.filter(offering => 
      offering.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      offering.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [offerings, searchTerm]);

  const handleDragStart = (offering: OfferingData) => {
    setDraggedOffering(offering);
  };

  const handleDragEnd = () => {
    setDraggedOffering(null);
  };

  return (
    <div className="da-library" onDragEnd={handleDragEnd}>
      <div className="da-library-header">
        <h3>DA Library</h3>
        <div className="catalog-selector">
          <select 
            value={catalogFilter}
            onChange={(e) => setCatalogFilter(e.target.value)}
          >
            <option value="public">IBM Cloud Public Catalog</option>
            <option value="private">Private Catalogs</option>
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
        Showing {filteredOfferings.length} of {offerings.length} offerings
      </div>
      
      <div className="offerings-list">
        {filteredOfferings.length === 0 ? (
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
          Drag to canvas to add {draggedOffering.name}
        </div>
      )}
    </div>
  );
};