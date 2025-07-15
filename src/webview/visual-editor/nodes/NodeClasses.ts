import { ClassicPreset } from 'rete';
import { GraphNode } from '../../../types/visual-editor';

// Custom socket types for different data types
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

export class ObjectSocket extends ClassicPreset.Socket {
  constructor() {
    super('object');
  }
}

export class BooleanSocket extends ClassicPreset.Socket {
  constructor() {
    super('boolean');
  }
}

export class AnySocket extends ClassicPreset.Socket {
  constructor() {
    super('any');
  }
}

// Base class for our custom nodes
export abstract class BaseNodeClass extends ClassicPreset.Node {
  public selected = false;
  public graphNode: GraphNode;

  constructor(graphNode: GraphNode) {
    console.log('BaseNodeClass: Starting constructor with graphNode:', graphNode);
    
    super(graphNode.name);
    console.log('BaseNodeClass: Called super(), checking inputs/outputs initialization');
    console.log('BaseNodeClass: this.inputs type:', typeof this.inputs, 'value:', this.inputs);
    console.log('BaseNodeClass: this.outputs type:', typeof this.outputs, 'value:', this.outputs);
    console.log('BaseNodeClass: this.inputs instanceof Map:', this.inputs instanceof Map);
    console.log('BaseNodeClass: this.outputs instanceof Map:', this.outputs instanceof Map);
    
    this.graphNode = graphNode;
    
    // Ensure inputs and outputs are properly initialized as Maps
    if (!(this.inputs instanceof Map)) {
      console.log('BaseNodeClass: inputs is not a Map, initializing as new Map');
      this.inputs = new Map();
    }
    if (!(this.outputs instanceof Map)) {
      console.log('BaseNodeClass: outputs is not a Map, initializing as new Map');
      this.outputs = new Map();
    }
    
    console.log('BaseNodeClass: About to call setupPorts()');
    this.setupPorts();
    console.log('BaseNodeClass: setupPorts() completed successfully');
  }

  abstract setupPorts(): void;

  protected createSocket(type: string): ClassicPreset.Socket {
    switch (type) {
      case 'string':
        return new StringSocket();
      case 'number':
        return new NumberSocket();
      case 'object':
        return new ObjectSocket();
      case 'boolean':
        return new BooleanSocket();
      default:
        return new AnySocket();
    }
  }

  updateGraphNode(graphNode: GraphNode): void {
    console.log('BaseNodeClass: updateGraphNode called with:', graphNode);
    this.graphNode = graphNode;
    this.label = graphNode.name;
    
    // Ensure inputs and outputs are Maps before clearing
    if (this.inputs instanceof Map) {
      this.inputs.clear();
    } else {
      console.log('BaseNodeClass: inputs is not a Map in updateGraphNode, initializing');
      this.inputs = new Map();
    }
    
    if (this.outputs instanceof Map) {
      this.outputs.clear();
    } else {
      console.log('BaseNodeClass: outputs is not a Map in updateGraphNode, initializing');
      this.outputs = new Map();
    }
    
    this.setupPorts();
  }
}

// Root node class - represents the main flavor
export class RootNodeClass extends BaseNodeClass {
  constructor(graphNode: GraphNode) {
    console.log('RootNodeClass: Creating instance with graphNode:', graphNode);
    super(graphNode);
    console.log('RootNodeClass: Instance created successfully with ID:', this.id);
  }

  setupPorts(): void {
    console.log('RootNodeClass: Setting up ports for root node:', {
      graphNodeData: this.graphNode.data,
      inputs: this.graphNode.data.inputs,
      outputs: this.graphNode.data.outputs
    });

    // Double-check that inputs and outputs are Maps
    console.log('RootNodeClass: Checking inputs/outputs Maps before setup');
    console.log('RootNodeClass: this.inputs instanceof Map:', this.inputs instanceof Map, 'type:', typeof this.inputs);
    console.log('RootNodeClass: this.outputs instanceof Map:', this.outputs instanceof Map, 'type:', typeof this.outputs);
    
    // Ensure they are Maps (defensive programming)
    if (!(this.inputs instanceof Map)) {
      console.log('RootNodeClass: inputs is not a Map, creating new Map');
      this.inputs = new Map();
    }
    if (!(this.outputs instanceof Map)) {
      console.log('RootNodeClass: outputs is not a Map, creating new Map');
      this.outputs = new Map();
    }

    // Add inputs based on the root node's inputs
    const inputs = this.graphNode.data.inputs || [];
    console.log('RootNodeClass: Processing', inputs.length, 'inputs');
    
    inputs.forEach((input: any, index: number) => {
      const inputName = input.name || input.key || `input_${index}`;
      const inputType = input.type || 'any';
      const socket = this.createSocket(inputType);
      
      console.log('RootNodeClass: Adding input:', { inputName, inputType });
      this.addInput(inputName, new ClassicPreset.Input(socket, inputName, true));
    });

    // Add outputs based on the root node's outputs
    const outputs = this.graphNode.data.outputs || [];
    console.log('RootNodeClass: Processing', outputs.length, 'outputs');
    
    outputs.forEach((output: any, index: number) => {
      const outputName = output.name || output.key || `output_${index}`;
      const outputType = output.type || 'any';
      const socket = this.createSocket(outputType);
      
      console.log('RootNodeClass: Adding output:', { outputName, outputType });
      this.addOutput(outputName, new ClassicPreset.Output(socket, outputName, true));
    });

    // If no ports were added, add some default ones so the node is visible
    if (inputs.length === 0 && outputs.length === 0) {
      console.log('RootNodeClass: No inputs/outputs defined, adding default ports for visibility');
      
      // Add a default input and output
      const anySocket = this.createSocket('any');
      this.addInput('config', new ClassicPreset.Input(anySocket, 'Configuration', true));
      this.addOutput('result', new ClassicPreset.Output(anySocket, 'Result', true));
    }

    // Safe logging with existence checks
    console.log('RootNodeClass: Ports setup completed. Final state:', {
      inputCount: this.inputs ? this.inputs.size : 'inputs is null/undefined',
      outputCount: this.outputs ? this.outputs.size : 'outputs is null/undefined',
      inputKeys: (this.inputs && typeof this.inputs.keys === 'function') ? Array.from(this.inputs.keys()) : 'inputs.keys() not available',
      outputKeys: (this.outputs && typeof this.outputs.keys === 'function') ? Array.from(this.outputs.keys()) : 'outputs.keys() not available'
    });
  }
}

// Dependency node class - represents external dependencies
export class DependencyNodeClass extends BaseNodeClass {
  constructor(graphNode: GraphNode) {
    super(graphNode);
  }

  setupPorts(): void {
    // Add inputs based on the dependency's expected inputs
    const inputs = this.graphNode.data.inputs || [];
    inputs.forEach((input: any, index: number) => {
      const inputName = input.name || input.key || `input_${index}`;
      const inputType = input.type || 'any';
      const socket = this.createSocket(inputType);
      
      this.addInput(inputName, new ClassicPreset.Input(socket, inputName, true));
    });

    // Add outputs based on the dependency's outputs
    const outputs = this.graphNode.data.outputs || [];
    outputs.forEach((output: any, index: number) => {
      const outputName = output.name || output.key || `output_${index}`;
      const outputType = output.type || 'any';
      const socket = this.createSocket(outputType);
      
      this.addOutput(outputName, new ClassicPreset.Output(socket, outputName, true));
    });

    // Default ports based on dependency type
    if (inputs.length === 0) {
      // Common dependency inputs
      this.addInput('region', new ClassicPreset.Input(new StringSocket(), 'Region', false));
      this.addInput('resource_group_id', new ClassicPreset.Input(new StringSocket(), 'Resource Group ID', false));
    }

    if (outputs.length === 0) {
      // Common dependency outputs based on the dependency type/name
      const depName = this.graphNode.name.toLowerCase();
      
      if (depName.includes('vpc')) {
        this.addOutput('vpc_id', new ClassicPreset.Output(new StringSocket(), 'VPC ID', true));
        this.addOutput('subnet_ids', new ClassicPreset.Output(new ObjectSocket(), 'Subnet IDs', true));
      } else if (depName.includes('iks') || depName.includes('kubernetes')) {
        this.addOutput('cluster_id', new ClassicPreset.Output(new StringSocket(), 'Cluster ID', true));
        this.addOutput('cluster_endpoint', new ClassicPreset.Output(new StringSocket(), 'Cluster Endpoint', true));
      } else if (depName.includes('cos') || depName.includes('storage')) {
        this.addOutput('bucket_name', new ClassicPreset.Output(new StringSocket(), 'Bucket Name', true));
        this.addOutput('bucket_endpoint', new ClassicPreset.Output(new StringSocket(), 'Bucket Endpoint', true));
      } else if (depName.includes('iam')) {
        this.addOutput('service_id', new ClassicPreset.Output(new StringSocket(), 'Service ID', true));
        this.addOutput('api_key', new ClassicPreset.Output(new StringSocket(), 'API Key', true));
      } else {
        // Generic outputs
        this.addOutput('id', new ClassicPreset.Output(new StringSocket(), 'ID', true));
        this.addOutput('endpoint', new ClassicPreset.Output(new StringSocket(), 'Endpoint', true));
      }
    }
  }
}