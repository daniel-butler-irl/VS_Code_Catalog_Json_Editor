import { TerraformVariable, TerraformOutput } from '../../services/TerraformParsingService';
import { Dependency, InputMapping } from '../catalog';

/**
 * Extended mapping option that includes Terraform metadata
 */
export interface ExtendedMappingOption {
  label: string;
  description: string;
  value: string;
  type: any;
  detail?: string;
  required?: boolean;
  defaultValue?: any;
  mappingType: 'input' | 'output';
  source: 'ibm-cloud' | 'terraform-local' | 'terraform-remote';
  terraformType?: string;
  connector?: boolean;
  virtual?: boolean;
}

/**
 * Visual representation of a node in the graph
 */
export interface GraphNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  label?: string;
  data: GraphNodeData;
  position: NodePosition;
  selected?: boolean;
  dragging?: boolean;
}

/**
 * Node position on the canvas
 */
export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Data stored within a graph node
 */
export interface GraphNodeData {
  // Common properties
  flavor?: string;
  label?: string;
  description?: string;
  
  // Dependency-specific properties (when type === 'dependency')
  catalog_id?: string;
  id?: string;
  name?: string;
  version?: string;
  flavors?: string[];
  optional?: boolean;
  on_by_default?: boolean;
  install_type?: string;
  input_mapping?: InputMapping[];
  ignore_auto_referencing?: string[];
  
  // Parsed Terraform data
  inputs: NodeInput[];
  outputs: NodeOutput[];
  
  // Visual editor metadata
  lastModified?: Date;
  valid?: boolean;
  errors?: string[];
}

/**
 * Input definition for a node
 */
export interface NodeInput {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  defaultValue?: any;
  connector?: boolean; // Whether this input is satisfied via connection
  virtual?: boolean;   // Whether this input is virtual (not passed to Terraform)
  sensitive?: boolean;
  
  // Connection info
  connected?: boolean;
  sourceNodeId?: string;
  sourceOutputName?: string;
  
  // Terraform metadata
  terraformVariable?: TerraformVariable;
}

/**
 * Output definition for a node
 */
export interface NodeOutput {
  name: string;
  type?: string;
  description?: string;
  value?: string;
  sensitive?: boolean;
  connector?: boolean; // Whether this output is exposed for connections
  
  // Connection info
  connected?: boolean;
  targetNodeIds?: string[];
  targetInputNames?: string[];
  
  // Terraform metadata
  terraformOutput?: TerraformOutput;
}

/**
 * Visual representation of a connection between nodes
 */
export interface GraphConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  type?: 'dependency_output' | 'version_input' | 'static_value';
  label?: string;
  animated?: boolean;
  selected?: boolean;
  
  // Metadata from input_mapping
  inputMapping?: InputMapping;
  referenceVersion?: boolean;
  staticValue?: any;
}

/**
 * Complete graph model for the visual editor
 */
export interface GraphModel {
  nodes: GraphNode[];
  connections: GraphConnection[];
  selectedFlavor: string;
  availableFlavors: string[];
  
  // Metadata
  version?: string;
  lastModified?: Date;
  valid?: boolean;
  errors?: GraphValidationError[];
}

/**
 * Graph validation error
 */
export interface GraphValidationError {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
  connectionId?: string;
  field?: string;
  suggestion?: string;
}

/**
 * Available offering data for DA Library
 */
export interface OfferingData {
  id: string;
  name: string;
  description: string;
  catalogId?: string;
  versions: string[];
  flavors: FlavorInfo[];
  category?: string;
  tags?: string[];
  
  // Version-specific data
  latestVersion?: string;
  selectedVersion?: string;
  selectedFlavor?: string;
}

/**
 * Flavor information for offerings
 */
export interface FlavorInfo {
  name: string;
  label?: string;
  description?: string;
  default?: boolean;
}

/**
 * Canvas viewport state
 */
export interface CanvasViewport {
  zoom: number;
  pan: { x: number; y: number };
  canvasSize: { width: number; height: number };
}

/**
 * Editor state for persistence
 */
export interface VisualEditorState {
  graphModel?: GraphModel;
  viewport?: CanvasViewport;
  selectedNodes?: string[];
  selectedConnections?: string[];
  
  // UI state
  leftPanelVisible?: boolean;
  rightPanelVisible?: boolean;
  leftPanelWidth?: number;
  rightPanelWidth?: number;
  
  // Settings
  autoLayout?: boolean;
  snapToGrid?: boolean;
  gridSize?: number;
  showMinimap?: boolean;
}

/**
 * Messages sent between webview and extension
 */
export type WebviewMessage = 
  | InitializeGraphMessage
  | UpdateGraphMessage
  | AddDependencyMessage
  | RemoveDependencyMessage
  | UpdateNodePropertyMessage
  | AddConnectionMessage
  | RemoveConnectionMessage
  | RequestOfferingsDataMessage
  | UpdateOfferingsDataMessage
  | ShowErrorMessage
  | ReadyMessage
  | SaveStateMessage
  | LoadStateMessage;

export interface BaseMessage {
  command: string;
  timestamp?: number;
}

export interface InitializeGraphMessage extends BaseMessage {
  command: 'initializeGraph';
  data: GraphModel;
}

export interface UpdateGraphMessage extends BaseMessage {
  command: 'updateGraph';
  data: GraphModel;
}

export interface AddDependencyMessage extends BaseMessage {
  command: 'addDependency';
  data: {
    offering: OfferingData;
    position: NodePosition;
  };
}

export interface RemoveDependencyMessage extends BaseMessage {
  command: 'removeDependency';
  nodeId: string;
}

export interface UpdateNodePropertyMessage extends BaseMessage {
  command: 'updateNodeProperty';
  nodeId: string;
  property: string;
  value: any;
}

export interface AddConnectionMessage extends BaseMessage {
  command: 'addConnection';
  data: Omit<GraphConnection, 'id'>;
}

export interface RemoveConnectionMessage extends BaseMessage {
  command: 'removeConnection';
  connectionId: string;
}

export interface RequestOfferingsDataMessage extends BaseMessage {
  command: 'requestOfferingsData';
  catalogId?: string;
}

export interface UpdateOfferingsDataMessage extends BaseMessage {
  command: 'updateOfferingsData';
  data: {
    offerings: OfferingData[];
    catalogId?: string;
  };
}

export interface ShowErrorMessage extends BaseMessage {
  command: 'showError';
  error: string;
  details?: any;
}

export interface ReadyMessage extends BaseMessage {
  command: 'ready';
}

export interface SaveStateMessage extends BaseMessage {
  command: 'saveState';
  state: VisualEditorState;
}

export interface LoadStateMessage extends BaseMessage {
  command: 'loadState';
  state?: VisualEditorState;
}

/**
 * Layout algorithms for auto-positioning nodes
 */
export type LayoutAlgorithm = 'hierarchical' | 'force-directed' | 'circular' | 'grid';

/**
 * Layout options for auto-positioning
 */
export interface LayoutOptions {
  algorithm: LayoutAlgorithm;
  direction?: 'horizontal' | 'vertical';
  spacing?: {
    node: number;
    rank: number;
  };
  center?: NodePosition;
  animate?: boolean;
}

/**
 * Node port for input/output connections
 */
export interface NodePort {
  id: string;
  name: string;
  type: 'input' | 'output';
  dataType?: string;
  required?: boolean;
  connected?: boolean;
  position?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Validation rule for graph structure
 */
export interface GraphValidationRule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  
  validate(model: GraphModel): GraphValidationError[];
}

/**
 * Settings for the visual editor
 */
export interface VisualEditorSettings {
  // Appearance
  theme?: 'light' | 'dark' | 'auto';
  nodeSize?: 'small' | 'medium' | 'large';
  connectionStyle?: 'straight' | 'curved' | 'orthogonal';
  
  // Behavior
  autoSave?: boolean;
  autoLayout?: boolean;
  snapToGrid?: boolean;
  
  // Validation
  realTimeValidation?: boolean;
  enabledValidationRules?: string[];
  
  // Performance
  maxNodes?: number;
  maxConnections?: number;
  renderOptimization?: boolean;
}

/**
 * Export data for visual editor content
 */
export interface ExportData {
  format: 'json' | 'image' | 'pdf';
  includeMetadata?: boolean;
  includeValidation?: boolean;
  timestamp: Date;
  version: string;
}

/**
 * Import data for visual editor content
 */
export interface ImportData {
  format: 'json' | 'ibm-catalog';
  data: any;
  options?: {
    merge?: boolean;
    replaceExisting?: boolean;
    validateOnImport?: boolean;
  };
}