import { ClassicPreset } from 'rete';

interface GraphNode {
  id: string;
  type: 'root' | 'dependency';
  name: string;
  data: any;
  position: { x: number; y: number };
}

interface NodeInput {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  defaultValue?: any;
  connector?: boolean;
  virtual?: boolean;
  sensitive?: boolean;
}

interface NodeOutput {
  name: string;
  type?: string;
  description?: string;
  value?: string;
  sensitive?: boolean;
  connector?: boolean;
}

/**
 * Base socket types for different data types
 */
export class StringSocket extends ClassicPreset.Socket {
  constructor() {
    super('string');
  }
}

export class NumberSocket extends ClassicPreset.Socket {
  constructor() {
    super('number');
  }
}

export class BooleanSocket extends ClassicPreset.Socket {
  constructor() {
    super('boolean');
  }
}

export class ObjectSocket extends ClassicPreset.Socket {
  constructor() {
    super('object');
  }
}

export class AnySocket extends ClassicPreset.Socket {
  constructor() {
    super('any');
  }
}

/**
 * Create socket based on type string
 */
export function createSocket(type?: string): ClassicPreset.Socket {
  switch (type?.toLowerCase()) {
    case 'string':
      return new StringSocket();
    case 'number':
    case 'integer':
      return new NumberSocket();
    case 'boolean':
    case 'bool':
      return new BooleanSocket();
    case 'object':
    case 'map':
      return new ObjectSocket();
    default:
      return new AnySocket();
  }
}

/**
 * Root node class representing the main deployable architecture
 */
export class RootNodeClass extends ClassicPreset.Node {
  width = 180;
  height = 120;
  selected = false;
  graphNode: GraphNode;

  constructor(graphNode: GraphNode) {
    super(graphNode.name);
    this.graphNode = graphNode;
    this.id = graphNode.id;
    this.label = graphNode.name;

    // Ensure graphNode.data has proper structure
    this.initializeGraphNodeData();

    // Add inputs from Terraform variables or input mappings
    this.setupInputs();
    
    // Add outputs from Terraform outputs
    this.setupOutputs();
  }

  /**
   * Initialize graphNode.data with proper structure if missing
   */
  private initializeGraphNodeData(): void {
    if (!this.graphNode.data) {
      this.graphNode.data = {};
    }
    
    if (!Array.isArray(this.graphNode.data.inputs)) {
      this.graphNode.data.inputs = [];
    }
    
    if (!Array.isArray(this.graphNode.data.outputs)) {
      this.graphNode.data.outputs = [];
    }
    
    console.log('RootNode: Initialized data structure:', {
      nodeId: this.graphNode.id,
      hasInputs: Array.isArray(this.graphNode.data.inputs),
      inputsLength: this.graphNode.data.inputs.length,
      hasOutputs: Array.isArray(this.graphNode.data.outputs), 
      outputsLength: this.graphNode.data.outputs.length
    });
  }

  private setupInputs(): void {
    const inputs = this.graphNode.data?.inputs || [];
    
    inputs.forEach((input: NodeInput) => {
      // Only create sockets and controls for connector inputs
      if (input.connector) {
        const socket = createSocket(input.type);
        const inputControl = new ClassicPreset.InputControl('text', {
          initial: input.defaultValue || '',
          readonly: false // Connector inputs can be edited via connections or direct input
        });
        
        this.addInput(input.name, new ClassicPreset.Input(socket, input.name, true));
        this.addControl(input.name, inputControl);
      }
    });

    // No hardcoded defaults - inputs are determined by actual data and input mappings
    console.log('RootNode: Setup inputs complete', {
      nodeId: this.graphNode.id,
      totalInputs: inputs.length,
      connectorInputs: inputs.filter(input => input.connector).length
    });
  }

  private setupOutputs(): void {
    const outputs = this.graphNode.data?.outputs || [];
    
    outputs.forEach((output: NodeOutput) => {
      // Only create sockets for connector outputs
      if (output.connector) {
        const socket = createSocket(output.type);
        this.addOutput(output.name, new ClassicPreset.Output(socket, output.name));
      }
    });

    // No hardcoded defaults - outputs are determined by actual data and input mappings
    console.log('RootNode: Setup outputs complete', {
      nodeId: this.graphNode.id,
      totalOutputs: outputs.length,
      connectorOutputs: outputs.filter(output => output.connector).length
    });
  }


  /**
   * Update the node's data and refresh inputs/outputs
   */
  updateNodeData(newData: any): void {
    this.graphNode.data = { ...this.graphNode.data, ...newData };
    this.refreshInputsOutputs();
  }

  /**
   * Refresh inputs and outputs based on current data
   */
  private refreshInputsOutputs(): void {
    // Clear existing inputs and outputs
    Array.from(this.inputs.keys()).forEach(key => {
      this.removeInput(key);
    });
    Array.from(this.outputs.keys()).forEach(key => {
      this.removeOutput(key);
    });
    Array.from(this.controls.keys()).forEach(key => {
      this.removeControl(key);
    });

    // Recreate inputs and outputs
    this.setupInputs();
    this.setupOutputs();
  }

  /**
   * Add a new input to the node
   */
  addNewInput(name: string, type: string = 'string', config: Partial<NodeInput> = {}): void {
    const socket = createSocket(type);
    const inputControl = new ClassicPreset.InputControl('text', {
      initial: config.defaultValue || '',
      readonly: config.connector || false
    });
    
    this.addInput(name, new ClassicPreset.Input(socket, name, true));
    this.addControl(name, inputControl);

    // Update the graph node data
    if (!this.graphNode.data.inputs) {
      this.graphNode.data.inputs = [];
    }
    this.graphNode.data.inputs.push({
      name,
      type,
      ...config
    });
  }

  /**
   * Add a new output to the node
   */
  addNewOutput(name: string, type: string = 'string', config: Partial<NodeOutput> = {}): void {
    const socket = createSocket(type);
    this.addOutput(name, new ClassicPreset.Output(socket, name));

    // Update the graph node data
    if (!this.graphNode.data.outputs) {
      this.graphNode.data.outputs = [];
    }
    this.graphNode.data.outputs.push({
      name,
      type,
      ...config
    });
  }
}

/**
 * Dependency node class representing external modules/dependencies
 */
export class DependencyNodeClass extends ClassicPreset.Node {
  width = 160;
  height = 100;
  selected = false;
  graphNode: GraphNode;

  constructor(graphNode: GraphNode) {
    super(graphNode.name);
    this.graphNode = graphNode;
    this.id = graphNode.id;
    this.label = graphNode.name;

    // Ensure graphNode.data has proper structure
    this.initializeGraphNodeData();

    // Add inputs that can be configured
    this.setupInputs();
    
    // Add outputs that this dependency provides
    this.setupOutputs();
  }

  /**
   * Initialize graphNode.data with proper structure if missing
   */
  private initializeGraphNodeData(): void {
    if (!this.graphNode.data) {
      this.graphNode.data = {};
    }
    
    if (!Array.isArray(this.graphNode.data.inputs)) {
      this.graphNode.data.inputs = [];
    }
    
    if (!Array.isArray(this.graphNode.data.outputs)) {
      this.graphNode.data.outputs = [];
    }
    
    console.log('DependencyNode: Initialized data structure:', {
      nodeId: this.graphNode.id,
      hasInputs: Array.isArray(this.graphNode.data.inputs),
      inputsLength: this.graphNode.data.inputs.length,
      hasOutputs: Array.isArray(this.graphNode.data.outputs), 
      outputsLength: this.graphNode.data.outputs.length
    });
  }

  private setupInputs(): void {
    const inputs = this.graphNode.data?.inputs || [];
    
    inputs.forEach((input: NodeInput) => {
      // Only create sockets and controls for connector inputs
      if (input.connector) {
        const socket = createSocket(input.type);
        const inputControl = new ClassicPreset.InputControl('text', {
          initial: input.defaultValue || '',
          readonly: false // Connector inputs can be edited via connections or direct input
        });
        
        this.addInput(input.name, new ClassicPreset.Input(socket, input.name, !input.required));
        this.addControl(input.name, inputControl);
      }
    });

    // No hardcoded defaults - inputs are determined by actual data and input mappings
    console.log('DependencyNode: Setup inputs complete', {
      nodeId: this.graphNode.id,
      totalInputs: inputs.length,
      connectorInputs: inputs.filter(input => input.connector).length
    });
  }

  private setupOutputs(): void {
    const outputs = this.graphNode.data?.outputs || [];
    
    outputs.forEach((output: NodeOutput) => {
      // Only create sockets for connector outputs
      if (output.connector) {
        const socket = createSocket(output.type);
        this.addOutput(output.name, new ClassicPreset.Output(socket, output.name));
      }
    });

    // No hardcoded defaults - outputs are determined by actual data and input mappings
    console.log('DependencyNode: Setup outputs complete', {
      nodeId: this.graphNode.id,
      totalOutputs: outputs.length,
      connectorOutputs: outputs.filter(output => output.connector).length
    });
  }


  /**
   * Update dependency-specific properties
   */
  updateDependencyProperties(properties: any): void {
    this.graphNode.data = { ...this.graphNode.data, ...properties };
    
    // Update label if name changed
    if (properties.name) {
      this.label = properties.name;
    }
  }

  /**
   * Get dependency metadata for display
   */
  getDependencyInfo(): any {
    const data = this.graphNode.data;
    return {
      id: data.id,
      name: data.name,
      version: data.version,
      flavors: data.flavors,
      optional: data.optional,
      catalog_id: data.catalog_id,
      install_type: data.install_type
    };
  }

  /**
   * Check if this dependency is optional
   */
  isOptional(): boolean {
    return this.graphNode.data?.optional === true;
  }

  /**
   * Get the dependency's input mappings
   */
  getInputMappings(): any[] {
    return this.graphNode.data?.input_mapping || [];
  }
}