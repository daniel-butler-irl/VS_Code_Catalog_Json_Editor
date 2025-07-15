# Product Requirements Document – IBM Catalog JSON Visual Editor

## Project Overview

The **IBM Catalog JSON Visual Editor** is a new feature for the existing IBM Catalog Tools VS Code extension, designed to provide a rich, interactive visualization for **`ibm_catalog.json`** files. The `ibm_catalog.json` manifest is the source of truth for IBM Cloud catalog offerings – it contains all product metadata, versions, flavors (variations), dependencies, and input/output mappings. Currently, the extension offers JSON editing and a tree view to navigate the file structure. However, managing complex dependencies and mappings via raw JSON is error-prone and cumbersome. This PRD proposes a **node-based graphical editor** (inspired by tools like *n8n* and Node-RED) that will let developers visually create and manage a deployable architecture’s dependency graph.

**Objective:** Enable IBM Cloud offering developers to intuitively configure dependencies by dragging and connecting nodes representing the product and its required or optional sub-components (dependencies), with real-time updates to the underlying JSON. This visual editor will simplify the creation of valid catalog manifests, reduce errors (like missing input mappings or mis-typed fields), and accelerate the design of complex multi-module architectures.

**Background & Motivation:** IBM Cloud *deployable architectures* often consist of a primary module (the product) and several dependencies (other Terraform modules or architectures) that must be wired together. Today, these relationships are defined in `ibm_catalog.json` by listing dependencies and specifying how outputs from one feed into inputs of another via `input_mapping` entries. For example, a dependency might output a KMS key ID that the root module consumes as an input. Writing these mappings in JSON is difficult to visualize; a graphical editor will allow users to *see* the dependency graph and quickly configure connections by drawing lines between node pins, reducing the need to understand low-level manifest syntax. This feature aligns with the extension’s goal to streamline IBM Cloud catalog development by providing WYSIWYG-style tools.

## User Scenarios and Use Cases

* **Visualizing an Architecture’s Dependencies:** A developer opens a project containing `ibm_catalog.json` and sees a **graphical canvas** illustrating the architecture. The root product (and selected flavor) appears as the central node, with its dependent modules as connected nodes. This overview helps the user understand the structure at a glance (which dependencies exist, which are optional, how they interconnect).

* **Configuring a New Dependency:** Instead of manually editing JSON arrays, the user can add a new dependency via drag-and-drop. For instance, if the product requires an IBM Cloud VPC module, the user drags the “VPC Infrastructure” entry from the left-side **DA Library** onto the canvas. They then select the appropriate version and flavor, and **draw connections** from the VPC node’s outputs (e.g. `vpc_id`) to the root node’s inputs that need those values (e.g. a root input for `vpc_id`). The editor automatically adds a new entry to the `dependencies` array in JSON and populates its `input_mapping` based on the connections drawn.

* **Editing Dependency Properties:** The user wants to change details of an existing dependency (e.g. upgrade its version or mark it optional). By clicking the node, a **properties panel** on the right displays all editable fields – catalog ID, offering ID or name, version (with possible range), selected flavor(s), and flags like *optional*. The user can modify these fields via dropdowns or text inputs, and the JSON updates accordingly in real time.

* **Managing Inputs and Outputs:** Suppose a dependency module has an output (e.g. `kms_instance_crn`) that the root module needs to consume, and also requires an input (e.g. `region`) to be set. The developer uses the visual editor to map these: they connect the dependency’s `kms_instance_crn` output pin to the root node’s `existing_kms_instance_crn` input pin (creating a `dependency_output -> version_input` mapping), and set the dependency’s `region` input to a static value or to reference a root input. The right-hand panel shows an **Inputs** section listing all input variables of the selected node (with name, type, description, and flags to mark an input as a *connector* or *virtual*). The user can toggle “Connector” on the `kms_instance_crn` input of the root node, indicating it’s satisfied via connection rather than user entry, and “Virtual” on inputs that should not be passed to Terraform (IBM Schematics). They can also add new inputs to the root flavor if needed (e.g., define a new configuration parameter) via an “Add Input” action.

* **Validating Configuration:** As the user builds the graph, the editor continuously validates it. For example, if a required input of a dependency isn’t connected or given a value, the UI highlights it (e.g., an input pin might glow red, and the right panel might show a warning). If the user accidentally creates a circular reference (Node A depends on B while B depends on A), or uses an output that doesn’t exist, the editor flags the error immediately. The user can correct issues before saving or publishing the architecture. This proactive validation complements the extension’s existing context-aware prompts and validation for mappings.

* **Saving and Syncing:** The user doesn’t need to manually save the JSON. Any change – adding a node, deleting a connection, editing a property – is immediately reflected in the underlying text document. If the user switches to the JSON text view or to the tree view, they would see the updates in real time. Conversely, if the `ibm_catalog.json` is edited externally (or via the old tree view), the visual editor will update to reflect those changes, keeping both views in sync.

* **Centering and Navigation:** For large graphs, the user can pan/zoom the canvas to explore. A “Zoom to Fit” or **Center** button recenters all nodes in view. If the user has many dependencies, they can zoom out to see the big picture, or zoom in for details on a particular node and its connections. Scrolling is intuitive (click-drag the canvas or use trackpad gestures), and dragging nodes automatically re-routes connections to avoid overlap, maintaining a clear layout.

## Detailed Functional Requirements

### 1. Activation & File Association

* **Custom Editor Launch:** The extension must register a custom editor for the resource `ibm_catalog.json` (identified by filename). When the user opens this file in VS Code, the custom editor opens by default (instead of the standard JSON text editor), showing the visual editor UI. An option should allow toggling to the raw JSON editor if needed (e.g., via a right-click “Open With…” menu to choose the text editor or the custom visual editor).

* **Single-File Scope:** The editor operates on the single `ibm_catalog.json` in the workspace root. If multiple folders are open, the extension should detect the relevant one (likely the first `ibm_catalog.json` found or based on user selection). The extension already auto-detects such files; this feature will integrate with that logic to automatically provide the custom editor view.

* **Preservation of Text:** All changes made through the visual editor must directly update the JSON text document (maintaining formatting where possible). The extension should use VS Code’s `CustomTextEditorProvider` API with the underlying TextDocument as the model, or a similar approach, so that standard VS Code features (version control diff, undo/redo stack, save to disk) continue to work seamlessly. Each graph edit translates to a text edit (e.g., inserting a dependency object, changing a field’s value, etc.), and triggers VS Code’s dirty state and file save as usual.

### 2. Graph Model Construction

* **Initial Graph Rendering:** On load, the extension parses the JSON to build an internal representation of the graph:

  * Identify the **root node**: The `flavors` array in the JSON may contain multiple flavor objects. The editor should prompt the user to pick one flavor as the context (if there’s more than one) – this chosen flavor will be the root node displayed. Each flavor has a `name` and possibly other attributes like `label`, `description`, etc., which can be shown on the node or in the panel. The root node represents *the deployable architecture itself (the product flavor the user is editing)*.
  * **Dependencies**: Within that flavor’s JSON, gather all entries in its `"dependencies"` array (and possibly `"swappable_dependencies"` – see later). Each dependency object becomes a node on the canvas connected to the root. If a dependency includes its own `dependencies` (in unusual cases of nested dependencies), the editor should recursively include those as well, building a tree. (However, typically IBM Cloud deployable architectures list direct dependencies only, not deep nested graphs. We assume one level unless JSON explicitly has nested flavors references; the implementation should be robust to multiple levels if it occurs).
  * **Node Data**: For each dependency, extract key fields: *catalog\_id* (or default to IBM Cloud catalog if not present), *offering name or id*, *version* (could be a specific version or a version range like `^1.2.0`), *flavors* (list of variation names this dependency uses), and flags like *optional*, *install\_type*, etc.. These will populate the node’s displayed label or metadata and the editable fields in the right panel.
  * **Input Mappings**: For each dependency node, read its `input_mapping` array (if present). Each mapping entry defines how an input of one side is fulfilled by an output or value of the other side. For example:

    * `"dependency_output": "kms_instance_crn", "version_input": "existing_kms_instance_crn"` means the dependency’s output `kms_instance_crn` is fed into the **parent’s** input named `existing_kms_instance_crn`. In graph terms, this is a connection from the dependency node’s `kms_instance_crn` output port to the root node’s `existing_kms_instance_crn` input port.
    * `"dependency_input": "some_var", "version_input": "region"` (with `reference_version: true`) would mean the parent provides its `region` value down into the dependency’s input `some_var`. Graphically, that is a connection from the parent node’s output (or a special “constant” output representing the parent’s own input) to the dependency node’s input. The `reference_version` flag essentially flips the direction of data flow for the mapping – the editor must support both upward (dependency->parent) and downward (parent->dependency) mappings.
    * `"version_input": "prefix", "reference_version": true` (no dependency\_input/output specified) implies the dependency references the *parent’s* input named “prefix”. This could be visualized as the parent node having an output pin for “prefix” (since it’s an input the parent expects from the user or environment) connected to the dependency’s “prefix” input pin.
    * `"version_input": "region", "value": "us-south"` means a static value mapping – the dependency’s `region` input is set to `"us-south"` constant. The graph might show this as an input pin “region” on the dependency node with no connection, but a default value indicator. Alternatively, constants could be represented as small inline labels or as connections from a special “constant” node.
  * The editor must create connection lines on the canvas for each mapping that links a dependency node to the root or vice versa, corresponding to these `input_mapping` entries. Unmapped inputs (with no entry) remain unconnected and potentially flagged if required.

* **Swappable Dependencies:** (If in scope) The JSON may also contain a `swappable_dependencies` section where groups of alternative dependencies are defined (only applicable if `dependency_version_2` flag is being used). For this first iteration, handling **regular `dependencies`** is the priority. Swappable dependencies might be shown as grouped nodes or a special container node. This PRD focuses on core functionality; swappable groups can be considered a stretch goal or future enhancement, to be visualized perhaps as a single node representing the group with multiple internal options. If implemented, the group node should allow toggling the default choice and marking group optional/required, per JSON fields `default_dependency`, `optional`, `on_by_default`, etc..

* **Outputs Parsing:** The visual editor must list **outputs** for the root and each dependency, even though outputs are not declared in `ibm_catalog.json`. The extension will scan the workspace for Terraform files (e.g., `outputs.tf` or any `output` blocks in `.tf` files) to retrieve output variable names and types:

  * **Root Outputs:** In the root module (the code corresponding to the current `ibm_catalog.json`), all Terraform outputs defined are candidates that the user might expose to other architectures. These are not explicitly used in the manifest (since the manifest focuses on inputs and dependencies), but when the root is used as a dependency by another product, its outputs become relevant. The editor should show the root’s outputs in its node (right side output pins), so the user understands what this architecture could provide.
  * **Dependency Outputs:** If a dependency node corresponds to a module present in the workspace (for example, in a multi-module monorepo, the dependency might be a local folder with its own Terraform code), the extension should similarly parse that module’s outputs. If the dependency is external (only referenced by ID/version and not present locally), the extension might not have the code to parse; in such cases, it could query a cached metadata or simply allow the user to manually specify output names when drawing connections. Ideally, the extension’s IBM Cloud integration could fetch metadata about known offerings – however, IBM’s catalog APIs might not directly provide Terraform output details. As a practical solution, use local parsing where possible, and otherwise allow connections by letting the user type/select output names (with validation against known output names if previously cached).
  * The parsing of outputs can be done using a lightweight HCL parser or regex to find lines like `output "NAME" { ... type = ... }` in the repository. The discovered outputs (name and maybe type if easily extracted) populate the node’s available output pins. This should happen on load (for root and any dependency modules present), and possibly on demand (e.g., if user adds a new dependency and points it to a local path).

* **Node Positions & Layout:** On initial render, the extension can auto-arrange the nodes. The root node will typically be centered. Direct dependencies can be laid out around it (e.g., in a left-to-right flow or radial). For example, required dependencies might be placed on the left side of the root if they feed inputs into the root (so connections go from left nodes to center), while if the root passes outputs to dependencies, those dependencies might appear on the right. A simple approach: place all dependency nodes to the left of the root if treating connections as coming into root, or below the root in a layered diagram. Optionally, use an auto-layout algorithm or a library’s auto-arrange plugin to space nodes without overlaps. The user should be free to drag nodes to new positions after initial layout, for clarity or preference, and a “Reset Layout” action could re-run the auto-arrange if needed.

### 3. Canvas and Node Interaction

&#x20;*Figure: Visual Editor Canvas with nodes representing the root flavor and its dependencies. The left-side **DA Library** (Dependency Asset Library) allows dragging new modules onto the canvas. In this example, “VPC Infrastructure” and “Application Runtime” are dependency nodes connected to the root “Security & Compliance” node via input/output mappings (blue connector lines). Each node shows its name, version, and flavor, with colored connector ports (green for inputs, orange for outputs) for mapping variables.*

* **Canvas Overview:** The canvas is the main panel where nodes (root and dependencies) are displayed as visual blocks. The canvas should be an **infinite/scrollable area**, supporting panning (click-drag background or scrollbars) and zooming (e.g., Ctrl+Scroll to zoom, plus/minus buttons or gestures). It should have a neutral background (to contrast nodes and connections) and possibly a grid or guidelines to align nodes. The canvas must resize with the editor window and handle window resizes gracefully.

* **Node Rendering:** Each **node** appears as a card or box with:

  * A **header** containing the node’s name (e.g., the dependency’s offering name or a user-friendly label). For the root node, use the product’s flavor name or product name.
  * A small sub-label or icon indicating type: e.g., mark the root node distinctly (since it’s not a dependency but the main product), and perhaps use an icon for IBM Cloud modules. (The extension can use VS Code’s codicons or custom icons for different kinds of nodes if desired, ensuring they align with VS Code’s theme for consistency.)
  * **Meta info**: beneath the title, display key fields like version and flavor. For example, “Version: 1.2.3” and “Flavor: standard”. If the dependency is optional, an “(Optional)” tag or icon should appear. If it’s swappable (group), maybe a label for that.
  * **Ports / Connectors:** Nodes have **input ports** on one side and **output ports** on the opposite side, consistent with a left-to-right data flow convention:

    * **Inputs (green):** Represent values this node needs. For the root node, inputs correspond to its configuration parameters (often called `version_inputs` in IBM manifest terms – these might be the user-provided inputs when deploying the architecture). For dependency nodes, inputs correspond to any `dependency_input` that the parent can/must supply or any configuration the dependency expects to get via mapping.
    * **Outputs (orange):** Represent values this node provides. For dependency nodes, outputs are typically Terraform output variables from that module. For the root node, outputs could represent things it exposes (to be consumed if this architecture is embedded elsewhere) – though within this context, root outputs are not mapped to anything (unless we show a scenario of root hooking to something else, which normally wouldn’t happen in the same manifest). Nonetheless, showing root outputs is informative. Outputs are also used for **passing values down**: the root node can have a conceptual “output” for each of its own inputs – essentially, if the root’s input needs to be passed into a dependency, we treat the root’s input as an output source from the root node (since it’s an externally provided value). This way, connecting a root input to a dependency input is represented by linking a port on the root (source) to a port on the dependency (target).
    * Each port is typically drawn as a small circle or square on the node’s side. Color-coding (like green for inputs, orange for outputs as seen in the design) provides visual distinction. A line (edge) connecting an output port to an input port represents a mapping. The line should perhaps have an arrow indicating direction (e.g., arrowhead pointing into the input side) or can be implicitly directional by the side it connects (left side of one node to right side of another).
    * Ports may also display a label (the variable name). To avoid clutter, the design might show port labels only on hover or in the properties panel. However, showing them could be useful; one approach is to list input names on the left side of the node box (next to each input port) and output names on the right side (next to each output port). If space is a concern, just the port icons might be shown and the full details of what they represent are visible in the properties panel when the node is selected.
  * The node card should be visually distinct when **selected** (e.g., a highlighted border or different header color) so the user knows which node’s properties they are editing in the right panel.

* **Connecting Nodes:** The user can create or modify connections by clicking and dragging between ports:

  * **Drag from Output to Input:** The primary interaction: the user clicks an output port (e.g., the `vpc_id` output on a VPC node) and drags a cable. Available target input ports (e.g., any input of compatible type on another node, typically the root or another dependency that depends on VPC) could highlight to indicate they can accept a connection. The user releases on the desired input (e.g., root’s `vpc_id` input). This creates a mapping entry in JSON linking that dependency’s output to the parent’s input. Visually, a curved line appears connecting the two ports.
  * **Reverse (Input to Output):** The tool should also allow starting a drag from an input port (some users might think “I need to supply this input – let me drag from it to an output that provides it”). The editor can support dragging from an input port; in that case, highlight compatible output sources. Technically, either direction drag can result in the same mapping being created.
  * **Connection Constraints:** Only valid connections should be permitted:

    * Enforce that a given input is only satisfied by at most one source (in IBM manifest, each input mapping entry is singular). If the user tries to connect multiple outputs into one input, either disallow a second connection or automatically replace the previous one.
    * Some outputs might connect to multiple inputs if logically one output value should feed several places (though usually each dependency output goes to one parent input; feeding multiple might indicate the parent’s single value is reused – which might be handled by the parent having one input that multiple dependencies reference via separate mapping entries using `reference_version:true`). For simplicity, allow one-to-many connections *from an output* if needed, but ensure the JSON reflects this properly (likely by creating two mapping entries both referencing the same dependency\_output going to two different version\_inputs, which IBM manifest might not directly support – probably better to avoid one output to multiple parent inputs unless that output is a complex object that splits, which is out of scope).
    * **Type compatibility:** If we have type info (from Terraform outputs and input variable definitions), the editor should warn or disallow obvious mismatches (e.g., connecting a string output to an input expected to be an array). However, IBM’s manifest doesn’t enforce types strongly; this check is secondary. The properties panel will show the type of each input/output if known, to guide the user.
    * Prevent connecting a node to itself or creating cycles (a cycle would likely require two separate mapping going opposite directions between two nodes – if user attempted that, it should warn).
  * **Rewiring:** The user can change an existing connection by either deleting it and drawing a new one, or by dragging the end of a connected line to a new target:

    * Clicking on a connection line could highlight it and pressing `Delete` would remove it (and the corresponding JSON mapping entry).
    * Alternatively, perhaps the user can grab the arrowhead (or the midpoint) of a connection and drag it to another input port. Dropping it there will update the mapping to the new target. Dropping it on empty canvas (not on a port) will remove the connection entirely.
    * If the user starts a connection, then decides to cancel (drops on no target or presses Esc), no mapping is created (or the line is removed if it was an existing one being moved).

* **Adding Nodes (Dependencies):** The canvas itself will likely not allow freehand creation of nodes (since each dependency must correspond to a real IBM Cloud module offering). Instead, adding nodes is done via the **DA Library** (left panel drag-drop) described below. However, we should support a scenario: if the user right-clicks on the canvas, we could offer a context menu “Add Dependency…” which triggers the same flow as picking from the library (e.g., opens a selection dropdown of available DAs, possibly reusing the extension’s existing search prompt for offerings). This provides a keyboard-accessible way to add nodes for those who prefer not to drag-drop.

* **Deleting Nodes:** Removing a dependency from the architecture should be intuitive:

  * The user can select a node (click to highlight) and press the `Delete` or `Backspace` key. Confirm the action if the node has existing connections (optional safety prompt, since deleting a node will remove its JSON entry and any associated input\_mappings).
  * Or provide a right-click context menu on the node with a “Remove Dependency” action. The extension’s current deletion mechanism for JSON elements uses confirmation dialogs; we can mirror that (e.g., show a prompt “Remove dependency X? This will also remove its input mappings.”).
  * Upon deletion, the node is removed from the canvas, connections to it are removed, and the JSON is updated (the dependency object is removed from the array, and any input\_mapping entries in other dependencies that referenced it are removed or adjusted if applicable).
  * The root node cannot be deleted (it represents the flavor itself). If the user wants to remove the entire flavor, that’s outside the visual editor’s scope (they would do that in JSON or with a separate command).

* **Canvas Controls:** A small toolbar should overlay the canvas (for example, in the top-right corner of the canvas area) providing utility buttons:

  * **Zoom In (+) / Zoom Out (-):** Adjust zoom level of the canvas.
  * **Fit to Screen:** When clicked, auto-adjusts the zoom and center so all nodes currently in the graph are visible (margin included). Useful after adding many nodes or after panning far.
  * Possibly **Re-center Root:** Brings the root node back to center focus (similar to fit, but focusing on root).
  * **Reset Layout:** Optionally, re-run the auto-layout if nodes got messy.
  * These controls should use icon buttons consistent with VS Code’s iconography (e.g., magnifying glass icons, a four-corners icon for fit). We can use the Webview UI Toolkit or VS Code codicons for these for a native look.
  * Also consider a **mini-map** (overview map) if the graph can become large – Rete.js offers a minimap plugin. This is a small viewport showing all nodes as boxes, indicating the visible area. Not required for moderate graph sizes but nice-to-have for navigation.

* **Undo/Redo Integration:** Because we are using VS Code’s text document, undo/redo at the text level should be kept in sync with visual actions. We must ensure each atomic user action (node addition, deletion, move, connection create/remove, property edit) corresponds to a text edit or series of edits such that pressing Ctrl+Z will undo it cleanly. The extension might need to manage a stack of edits if a single logical action involves multiple text changes. Alternatively, utilize VS Code’s `EditTransaction` (if available) or coalesce edits. The goal: The user should be able to undo a node addition and see the node disappear, undo a drag connection and see it disconnect, etc., just by using standard Undo. Redo similarly reapplies.

* **Performance Considerations:** The canvas interactions should remain smooth. Typical usage is expected to be on the order of a handful to maybe a few dozen nodes (each flavor rarely has more than, say, 5-15 dependencies). Rete.js (if used) can easily handle this volume, and custom-coding the canvas should too. We should double-check memory usage if using `retainContextWhenHidden` (webview stays alive in background) – it has overhead, but given the small graph size it’s acceptable to prioritize UX. We will enable `retainContextWhenHidden: true` for the webview so that if the user switches to another editor tab and back, the graph state (zoom, positions, any unsaved changes) is preserved.

### 4. Right Panel: Properties Inspector

When a user selects a node on the canvas (single-click), the **Properties Panel** on the right side displays detailed information and editable fields for that node. This panel is crucial for editing all attributes that are not easily manipulated by graphical connections.

&#x20;*Figure: Properties Panel (right side) shown for a selected node (“Security & Compliance”). The panel is divided into sections: basic info like Catalog, Offering ID, Version, Flavor, etc., an **Inputs** section listing the node’s input variables (with controls for flags like Connector/Virtual, type, description), and an **Outputs** section showing outputs parsed from code. In this example, the root node “Security & Compliance” has inputs `vpc_id` and `subnet_ids` marked as connectors (supplied via other nodes), and an output `compliance_report` of type object.*

**Panel Layout:**

* The right panel occupies a side region of the editor (collapsible if needed to gain more canvas space, but by default visible). It can use VS Code’s Webview UI Toolkit components for form controls (dropdowns, checkboxes, text fields) to match the native look.
* It is context-sensitive: if no node is selected, it could display instructions (“Select a node to view details”) or be empty. If multiple selection is allowed (likely not needed here), we only show the first or aggregate.
* The panel has a close or collapse button (e.g., an “X” or a pane splitter) so advanced users can hide it when not needed.

**Sections in Properties Panel:**

* **Node Identification:** At the top, show the node’s display name big and bold. For a dependency, this might be the offering name or a user-defined alias. (We might allow the user to edit the node’s “nickname” if desired, but primarily it’s defined by the offering’s name from IBM Cloud. We can fetch the friendly name via IBM Cloud API if we have an ID, or the user might enter it if not auto-provided.)

  * If the node corresponds directly to JSON fields, e.g. the `name` and `id` of the offering, display those. The extension can decide whether to use `name` or `id` as the primary label. Many IBM catalog entries have a human-friendly name and a GUID ID; the JSON allows either. The panel might show both: *Name* and *Offering ID* (one or the other may be filled).
  * The root node (flavor) might show the product’s **Label** or name, and flavor name. (For instance, product might be “IBM Secure App”, flavor “enterprise”, etc.)

* **Basic Properties:** Key editable fields drawn from the JSON object:

  * **Catalog**: If `catalog_id` is present (for dependencies from a private or other catalog). In most cases dependencies are in the main IBM Cloud public catalog (so `catalog_id` may be omitted). Provide a dropdown or text field to edit this. Ideally, populate known catalog options (IBM Cloud, or any custom catalogs the user has configured).
  * **Offering Name/ID**: The dependency’s identifier. The JSON can accept either `name` or `id`. We should display what the JSON currently uses (if both provided, probably one or the other). This could be a disabled field if we treat it as fixed after selection, or allow edits (not typical to change an offering after adding, but maybe needed if user wants to point to a different offering without re-adding).
  * **Version**: A text or dropdown field for the version constraint. If the extension has cached version info for that offering (via IBM Cloud API), we could provide a dropdown of available versions, or at least suggestions like “^1.0.0 (Latest major)” etc. The extension already supports guided version selection with validation. In the visual editor, we might simplify by letting advanced users type a SemVer constraint or pick from a short list of most common patterns (Latest, >=, \~). Ensuring the string goes into JSON exactly as intended (including the format like `^1.2.3`).
  * **Flavor (Dependency Variation)**: If the offering has multiple flavors (variations of that product), the JSON dependency can list which flavor(s) it’s using. Provide a multi-select or at least an input. More likely, we restrict to one flavor here (most dependencies specify exactly one flavor by name). The extension’s existing capabilities include flavor selection prompts. We can fetch the flavor list for the chosen offering via IBM API if online. In offline mode, user might type the flavor name.
  * **Optional Flag**: If applicable (`optional: true/false` in JSON). A checkbox “Optional dependency” that marks whether this dependency is required or not. If checked, additional sub-fields might appear (IBM manifest has `on_by_default` and `description` for optional dependencies). We can include:

    * *Include by default:* (on\_by\_default) – if optional, should it be pre-selected for the user in the IBM Cloud UI.
    * *Description:* a text field to describe this optional dependency’s purpose (visible to users selecting optional architectures).
  * **Install Type**: (If present) The `install_type` field can be “fullstack” or “extension”, indicating how the dependency is integrated. Possibly not often used by end-users; if present in JSON, just show it (dropdown with those two options).
  * **Group ID / Swappable Group Settings:** (if swappable dependencies feature is used). If the node is part of a swappable group, show the group identifier and flags like default selection. This might be an advanced scenario; if implementing, display “Group: \[group\_name]” and an indication if this node is the default in that group. Changing group membership might not be supported except via adding/removing in a group UI.

* **Inputs Section:** This lists all input variables that this node can receive:

  * For the **root node**: inputs correspond to the deployable architecture’s user-configurable parameters (the manifest might implicitly define these via `version_inputs` references and the Terraform `variables.tf` of the module). The extension likely has knowledge of these from parsing `variables.tf` or from the manifest’s input mapping usage. In the panel, list each input key (e.g., `region`, `prefix`, `vpc_id`, etc.).
  * For a **dependency node**: inputs are the parameters that the dependency module requires and expects the parent to supply. These could be known from that module’s manifest if it had one, or from analyzing the module’s input variables. However, since `dependency_input` mappings in the JSON explicitly name which inputs of the dependency are being set (or if none, it assumes the dependency might not need anything beyond what’s mapped or defaulted), it’s tricky to list “all possible inputs” of the dependency. We might initially list only those inputs that are mapped or that the user has specifically configured. We can also allow the user to add an input entry manually (to represent that they want to provide something to the dependency that isn’t auto-detected). Future enhancement: integrate with a registry of module input metadata.
  * For each input listed, show the following fields/controls:

    * **Name**: The variable name (non-editable if it comes from code or manifest mapping; editable if user is adding a new one for root).
    * **Type**: if known (string, number, bool, object, etc.). If we parsed `variables.tf`, we might know the type. Otherwise, allow the user to select a type from a dropdown (with common types). This helps in validating mapping connections (e.g., an output of type object shouldn’t connect to an input expecting a simple string).
    * **Description**: A short text describing the input’s meaning. Populate it if available (from code comments or manifest documentation). The user can edit this, which should update the JSON if those descriptions are stored (the IBM manifest doesn’t explicitly store input descriptions under flavors, but it might under a separate `architecture.inputs` section in the manifest or via comments – we might store it in JSON’s `metadata` or skip).
    * **Default Value / Static Value**: If the input has a default in code or if the user wants to set a static value via manifest (the `input_mapping` can specify a static `value`), show that. Possibly as a field that becomes enabled when the input is not marked as connector. For example, if input `region` is not connected, user could type a default "us-south". This would create an `input_mapping` entry of type static value for that dependency (or for root if it’s a root input default? Actually, IBM manifest doesn’t define defaults for version\_inputs in the manifest; defaults would be in Terraform code. So maybe for dependencies only, static mappings are meaningful).
    * **Connector toggle**: A checkbox or toggle indicating this input is fulfilled via a connection (rather than a user-supplied value). When “Connector” is true, it implies the input *should* or *must* have an incoming connection from another node’s output. For root inputs, marking as connector means “this input is provided by a dependency’s output” (i.e., some dependency maps into it). For dependency inputs, marking as connector might not apply (they’re inherently expecting connection from parent; or if reference\_version is used, maybe the concept flips). But likely, the Connector toggle is mainly relevant for root’s inputs to indicate they are mapped from dependencies. In IBM’s UI, a “connector” input might not be shown to end-users deploying the root, because it’s auto-wired by the architecture.
    * **Virtual toggle**: Another checkbox indicating whether this input is “virtual”. IBM Cloud uses *virtual* to mean the input is not passed to the underlying Terraform engine. Essentially, it might be used only to map things among modules but not actually a variable for the module. For example, an input that exists just to carry an ID from one dependency to another might be marked virtual on the root so that Schematics doesn’t expect a real variable. The user can toggle this to true/false; the JSON should then include `"virtual": true` for that input definition (the manifest has a section to define inputs and mark them virtual/hidden, which might be outside dependencies – possibly under `architecture.inputs` or similar).
    * For root node inputs, if possible, allow adding a **new input**: e.g., “+ Add Input” button. This would correspond to adding a new configuration parameter for the product. In JSON, these might be added under a `variables` or `inputs` section if one exists (the IBM docs mention generating the manifest will include inputs and outputs imported from code). If no clear place in JSON, the extension might maintain it in a reserved section. But given IBM's note, we likely rely on code’s `variables.tf` to define inputs, so adding a new one might be out-of-scope (or we instruct user to add in code). Still, for completeness, PRD suggests user can define a new input which will require adding a Terraform variable and referencing it – this may be too complex to fully implement here, so perhaps the visual editor will primarily manage existing inputs.
    * The panel updates live: if the user toggles “Connector” on a root input to true, the UI might automatically draw a placeholder port ready to be connected. Likewise, toggling it off could drop any existing connection (with confirmation). Edits here (name, description, type, etc.) update JSON (if those fields are represented there, e.g., maybe in a future JSON schema where inputs can be listed with attributes – IBM manifest doesn’t explicitly list each input except via mappings and code).

* **Outputs Section:** This lists outputs provided by the node (if any):

  * For the root node: list all Terraform outputs from the root module (names and types, as parsed). This is mostly informational in this context (since within a single manifest, root outputs aren’t consumed elsewhere). But it’s good documentation for the developer and could allow mapping to a hypothetical higher-level architecture if someone ever extended this manifest by using it as dependency.
  * For a dependency node: list outputs of that dependency’s module. The ones that are actually mapped to the root will have connections drawn already. Outputs not mapped could be either unused or maybe intended for something else (like maybe another dependency could consume it). The user might see an output in the list and decide to connect it to another dependency’s input if that makes sense (like chaining dependencies).
  * Display each output name, type (if known), and perhaps a short description (if we had it from the module’s documentation).
  * **Connector flag for outputs:** Not typically needed – outputs are inherently connectable. In the screenshot design, outputs have a “Connector” checkbox as well (the `compliance_report` output shows connector checked). This could indicate whether an output is *exposed upward* to parent architectures. For the root, marking an output’s “Connector” might mean “this output should be part of the public interface of this architecture when used as a dependency elsewhere”. However, in IBM manifest, outputs aren’t declared; they are always whatever the Terraform code defines. So this toggle might not actually alter JSON except to perhaps add something in docs or not. It could be omitted or used purely for user clarity.
  * If an output is not used in any mapping and it’s optional, that’s fine; but if an output is critical and not mapped, maybe a warning if user expectation was to map it (this is more a lint than an error).

* **Interactions in Properties Panel:**

  * As soon as the user edits a field (e.g., changes version or optional flag), the extension should update the JSON text. This can be done by constructing an edit for that JSON key. If using the TextDocument model, use `edit.replace` on the appropriate range. If using a custom model, update and mark dirty.
  * Some fields may require updating multiple parts of JSON. For example, changing an offering might require updating its id and name together and possibly clearing incompatible mappings.
  * Fields like Catalog, Offering, Version might be interdependent: If user selects a different offering, the extension should ideally refresh available versions/flavors for that offering (if online). Possibly prompt: “Changing offering will reset mappings and properties of this node. Continue?” to avoid accidental heavy changes.
  * For inputs and outputs, toggling connector or virtual updates that input’s definition (in JSON, maybe under some `inputs` definition list). Since IBM’s manifest format for inputs is somewhat implicit, the extension might manage an internal structure for this. We can, for now, ensure the `input_mapping` entries reflect connections and the presence of `reference_version` flags to indicate direction.
  * If the user edits an input’s static default value, add or update the corresponding `input_mapping` entry with `"value": thatValue` (paired with version\_input name).
  * If the user sets reference\_version on a mapping (e.g., marks that the mapping is from parent input), we can reflect that as a toggle on the mapping itself or perhaps by whether they connect from a special “parent” output vs a dependency output. We might keep this simpler by letting the act of connecting from root’s own pseudo-output imply reference\_version = true for that mapping.

* **Dynamic Update**: The panel should reflect the currently selected node’s state *and* update dynamically if the user makes changes on the canvas:

  * If user connects a line on the canvas, the panel for the affected node should immediately show that the corresponding input now has a connection (maybe disable editing of the default value since it’s now connected, etc.).
  * If user deletes a connection, the panel could either refresh to show the input as needing value (and re-enable default field).
  * Node selection change: clicking a different node should swap the panel to that node’s info. If unsaved edits in the panel exist, ensure they were applied on the fly (since we do instant apply, it should be fine).

* **Validation in Panel:** Some field-level validation:

  * If the user enters an invalid version string (e.g., not a valid SemVer or range), show a warning (and the extension’s existing version validation logic can be reused).
  * If required fields are blank (offering id/name must be set, version usually must be set, etc.), highlight the field.
  * If an input is marked connector but no connection exists, highlight it as an issue.
  * If a dependency is optional but not a `dependency_version_2` scenario, warn (IBM requires certain global flags for optional, but that might be beyond scope to validate here except in a final manifest validation step).
  * For now, most heavy validation is covered in a later section (real-time validation messages possibly shown globally or on nodes). The properties panel can show red borders or inline text for each problematic field.

### 5. Left Panel: Dependency Asset Library

A **left-side panel** (the *DA Library*) lists available modules (Dependency Assets) that the user can add as dependencies. This leverages the extension’s IBM Cloud integration to fetch or cache catalog offerings.

* **Panel Layout:** The left panel can be a sidebar within the custom editor webview (not the native VS Code activity bar, to keep it self-contained). It appears as a list of cards or rows, each representing an available dependency offering. At the top, include:

  * A **Catalog Filter Dropdown:** If the user is logged in and has private catalogs or wants to switch between IBM Public Catalog and others, provide a dropdown to choose the source of offerings (e.g., “IBM Cloud Public Catalog” vs a named private catalog). Default to IBM Public.
  * A **Search/Filter box:** A text box to filter the list by keyword (name, category, etc.). For example, typing “vpc” filters the list to offerings matching “vpc”.
  * A count of shown items vs total (e.g., “Showing 6 of 50 DAs”).

* **DA Cards:** Each entry shows minimal info about an offering:

  * **Name:** e.g., “VPC Infrastructure”, “Security Baseline”, “Database Cluster”, etc.
  * **Description:** a one-line or truncated description of what it is (from IBM Catalog metadata, if available). This helps identify the correct module.
  * **Latest Version:** possibly show the latest stable version number (if the extension has fetched it). Or if we allow choosing version here, see next point.
  * **Version Selector:** It could be useful to allow picking the desired version before adding. For instance, each card could have a small dropdown for version (populated with known releases of that offering, defaulting to latest). If the user picks a version here, when they drag the item to the canvas it will create the node with that version pre-set. Otherwise, a default (like latest or a range) is used.
  * **Flavor Selector:** Similarly, if the offering has multiple flavors, allow choosing one (or multiple) prior to adding. Possibly a dropdown defaulting to a common flavor (like “standard”).
  * In the provided design screenshot【32†】, each card has “Version: x.y.z” and “Flavor: \_\_\_” fields visible, indicating the user can set these on the card.
  * Each card might have an icon or thumbnail if available (though not necessary; text is fine).
  * The card should be styled with a light border or background to appear clickable/draggable.

* **Data Source:** The extension’s backend can populate this list using:

  * **Cached IBM Catalog offerings**: The extension already supports offering and flavor lookups with caching. We can reuse that data. Possibly it caches a list of recently used or all offerings under a certain category.
  * We might not want to list *every* IBM Cloud offering (could be hundreds) – maybe focus on a subset relevant to deployable architectures (IBM’s “secure-enterprise” docs or categories). Possibly the extension knows the context of which offerings are deployable modules vs something else. If not, we could provide a broad list but allow search.
  * Alternatively, only show offerings that the user has *fetched or used before*, plus a search button to find others on the fly. The UI could have an entry at bottom “Find more offerings…” which opens a prompt or expands the list after searching online.

* **Drag and Drop Addition:** The user should be able to drag a DA card from this panel onto the canvas:

  * On drag start, possibly create a semi-transparent ghost of the node under cursor. The user drags into the canvas area and releases to add.
  * On drop, the extension should create a new dependency node at that location. This triggers:

    * Add a new object in the JSON `dependencies` array with the appropriate fields filled: name/id, version, flavor, etc. (The extension can fill `name` if we have it, or leave `id` if using that, along with `version` and `flavors`).
    * Because it’s newly added, it likely has no `input_mapping` yet except maybe some default reference mappings if the extension auto-adds those (likely not automatically; let user connect manually).
    * The canvas should render the new node. The node’s outputs can be populated by parsing the module’s outputs (if the module is local or if known via template).
    * Optionally, immediately open the properties panel for this new node to encourage user to adjust anything (like ensure correct version/flavor).
  * If the user drags but then drops outside of the canvas or back to the list, cancel the operation.
  * As an alternative to drag-drop, double-clicking a card could also add it to the canvas (maybe at some default position near the root).
  * **Multiple flavors or group addition**: If a card represents a whole group of alternatives (not likely listed that way), that’s beyond current scope. Each card is one offering.

* **Catalog Authentication:** If a user is not logged in to IBM Cloud and tries to access private catalogs or offerings not cached, we may require login. The existing extension handles login and API keys. This visual editor should interface with that – e.g., if user selects a private catalog from the dropdown and no token, prompt them. Or simply rely on the extension’s global state (if the user has logged in via the extension’s commands, the data is cached or accessible).

  * If offline (no internet and no cached data for a query), the library should degrade gracefully – show what is cached or show a message “Offline: using cached data”.

* **Search and Filter Behavior:** The filter box should instantly filter the list of loaded items by name or tag. Possibly also allow hitting Enter to perform a deeper search (like query IBM Cloud for that term if not found locally).

  * Could integrate a command: e.g., if user enters a term and presses a “Search in IBM Cloud” button, call the IBM Cloud API for offerings matching that term and populate results (similar to extension’s command-palette search).
  * But since a full interactive search might be complicated in the webview, we can decide to load an ample list upfront (maybe all offerings in IBM’s public “Deployable Architectures” category) to allow client-side filtering.

* **Usability considerations:**

  * The left panel should be scrollable if the list is long. It could have categories or collapsible sections by solution area (network, security, etc.) if data available, but that may overcomplicate initially.
  * Each card’s drag handle is the whole card (or a specific icon on the card).
  * Ensure the panel is keyboard accessible: user can focus the list, arrow through items, and press Enter or a shortcut to add the selected item (maybe Enter = add, or a context menu).
  * The panel can be collapsible too if user wants more canvas space; maybe a small hide arrow.

### 6. Interaction Flow and Examples

To illustrate the end-to-end user flow, consider this scenario:

1. **Open Visual Editor:** The user opens the project’s `ibm_catalog.json`. VS Code switches to the “IBM Catalog JSON Editor” custom editor view. The extension reads the JSON and identifies the first flavor “Enterprise” as the default root (prompts if multiple flavors exist). The canvas loads with a root node “Security & Compliance (Enterprise)”, because the product name in JSON might be "Security & Compliance" and flavor "Enterprise". This node’s input ports (e.g., `vpc_id`, `subnet_ids`, `region`, etc.) are generated from a combination of the manifest’s mappings and Terraform variables, and its output ports (e.g., `compliance_report`) from Terraform outputs. Initially, since no dependencies yet in JSON, the root is alone.

2. **Add Dependency via Drag-drop:** The user knows this architecture requires a VPC. They locate “VPC Infrastructure” in the left DA Library (filtering for "VPC"). The card shows a default flavor (perhaps "standard") and latest version (e.g., 1.0.0). They drag the card to the canvas and drop it. Immediately, a **VPC node** appears. In JSON, a new entry is added in `dependencies`:

   ```json
   {
     "name": "vpc-infrastructure",
     "id": "...", 
     "version": "1.0.0",
     "flavors": ["standard"],
     "input_mapping": []
   }
   ```

   (with possibly a real offering ID if known). The properties panel for this new node opens, showing “VPC Infrastructure” with fields. The user confirms it's optional *false* (it’s required), etc. The extension parses the local VPC module’s outputs (if the module is present, else it knows common outputs like `vpc_id`, `subnet_ids` via caching or documentation) – it finds outputs `vpc_id` (string) and `subnet_ids` (list). It also identifies that the VPC module likely needs inputs like `region` (the Terraform variable), but since no mapping yet, these appear as inputs possibly to be set.

3. **Connect Outputs to Root Inputs:** The user sees on the root node that it has inputs `vpc_id` and `subnet_ids` (green ports). On the VPC node, there are matching outputs `vpc_id` and `subnet_ids` (orange ports). They click the `vpc_id` output on the VPC node and drag to the root node’s `vpc_id` input – upon release, a connection line is drawn. The JSON gets an `input_mapping` entry under the **VPC dependency’s** object:

   ```json
   {"dependency_output": "vpc_id", "version_input": "vpc_id"}
   ```

   meaning VPC’s output goes to root’s input of the same name. They do the same for `subnet_ids`. Now the root’s `vpc_id` and `subnet_ids` inputs are marked as satisfied via connectors. In the properties panel for the root, those inputs might show Connector = true, and perhaps become read-only for value since they’re connected.

4. **Provide Static Input:** The VPC node has an input `region` (the cloud region to create the VPC). The root has an input `region` as well, which might be intended to be a user-provided value. The user decides that the root will take `region` as a user input, and pass it down to dependencies:

   * They see the root node’s outputs includes a pseudo-output for `region` (since it's a root input, treat it as source). Or in the properties panel for VPC, under inputs, `region` is listed. They could simply check a box “Reference parent input” for `region`. Suppose in the UI they connect the root’s `region` output (since root input can act like an output in graph) to VPC’s `region` input. This draws a connection from root to VPC. In the VPC dependency’s `input_mapping`, an entry is added:

   ```json
   {"dependency_input": "region", "version_input": "region", "reference_version": true}
   ```

   meaning pass the root’s `region` value to the dependency’s `region` variable.

   * The root’s `region` input remains not connected above it (because it’s a top-level input provided by the user at deploy time, not by another dependency), which is fine. It’s not marked as connector (since it’s not coming from another dependency, it’s from user), and not virtual either (since it *will* be passed to Schematics).
   * If multiple dependencies need `region`, the user will connect root’s `region` to each of them (creating multiple `dependency_input` mappings referencing the same root input).

5. **Add Optional Dependency:** The user now wants to add an optional module (e.g., “Monitoring Stack”). They drag “Monitoring Stack” onto the canvas. The properties panel shows an *Optional* checkbox – they enable it (this sets `"optional": true` in JSON, and possibly adds `description` and `on_by_default` fields if exposed). The node “Monitoring” appears perhaps with a dashed border or different color to indicate optional. If optional, maybe it’s not connected to anything by default (the user can still map outputs/inputs if needed). The user could leave it unconnected if it doesn’t interact with others except being a standalone optional add-on. Validation might allow optional nodes to have unmapped inputs because they might only be used when selected.

6. **Use of Swappable Group (if applicable):** Suppose the user wants to offer either Module A or Module B (mutually exclusive) as choices. In JSON, that would be a `swappable_dependencies` group. The UI might represent it by adding one node for each and linking them together or a container node. For now, if implemented:

   * The user could drag both modules in, mark them as part of the same group by entering a Group ID in their properties (or selecting “Add as alternative in group…”). The UI might visually group them (e.g., a dashed rectangle around them or a linking bar).
   * They set one as default via a property.
   * The JSON would then not put them in `dependencies` but in a new `swappable_dependencies` structure. The extension must remove them from standard dependencies in JSON and create the group object accordingly. (This is complex; possibly omitted in initial release).
   * For completeness, just note that optional group scenario is considered but can be future work.

7. **Realtime Sync and Edit:** At any point, the user can open the JSON file in a text editor (side-by-side or later) to see the changes:

   * The `dependencies` array now has entries for VPC, Monitoring, etc., with all fields and mappings the user configured.
   * If the user edits something in the text (say they manually change a version number) and saves, the visual editor should respond (e.g., updating the node’s version label). We will set up a file watcher or rely on VS Code’s text document events to refresh the graph model on external edits. Minor changes we can patch into the graph without full reload (e.g., only update that node’s field). But for simplicity, on any external edit, reparse the JSON and update the graph (preserving node positions and such if possible).

8. **Validation Feedback:** The user tries to connect an incompatible output: e.g., connecting an object output to a number input. The UI either doesn’t allow the connection to snap (if we implement type checking) or if allowed, immediately flags the input as type mismatch (e.g., red underline on input name). The user is alerted that configuration is invalid. They resolve it by either not making that connection or changing types if appropriate.

   * Another validation: If user added two dependencies that both provide `vpc_id` and accidentally connected both to the same root input (which doesn’t logically make sense to have two sources for one input), the second connection might override the first in JSON or be disallowed. Ideally disallow a second connection into an already mapped input (the first one could be removed first).
   * If a dependency is optional but something else depends on its output (like root input mapping from it), that could be a warning: because if the user chooses not to deploy that optional, the mapping fails. However, IBM manifest likely forbids referencing an optional dependency’s output in a required way. The editor should caution or not allow connecting an optional dependency’s output into a required input of root unless there is a default value or it’s also optional somehow.
   * These complex scenarios aside, the tool should catch common errors: missing required inputs (maybe highlight the root node if any of its inputs have no static value and no connection – meaning at deploy time, user must supply them; that’s okay if it’s intended, not an error, but we might highlight which are unfilled so user is aware), or missing required dependency (if dependency expected by code but not listed – hard for tool to know).
   * We may include a “Validate Manifest” button (or rely on existing extension command) to run a full validation using IBM’s APIs or schematics (the extension likely has a command to validate deployable architecture). That could produce a list of errors if any, which we can surface in the UI (like an overlay or as VS Code diagnostics on the JSON file). This is beyond real-time and more like pre-publish validation.

9. **Saving and Closing:** The user closes the editor by switching files or closing VS Code. Since we updated the TextDocument all along, the `ibm_catalog.json` is already up-to-date. If there are unsaved changes (document dirty), VS Code will prompt to save on close as usual. The custom editor must implement save and backup handlers (which in CustomTextEditor may be largely handled by VS Code using the text document; if using CustomEditor with separate model, we implement save method to write the JSON).

   * The user can commit the changes to version control, etc., like any other file. The visual layout (node positions, etc.) is not stored in the JSON. If we want to preserve layout between sessions, we could save that in the extension’s state (memento or a hidden file). Possibly store a mapping of node IDs to x,y coordinates in VS Code’s globalState or workspaceState keyed by file. This way, when reopening, we apply the last known positions instead of default layout.

10. **Collaboration:** (Note: not a primary requirement, but consider) If two users or two instances of VS Code edit the same file (or if the user has the text editor open alongside the visual editor), live updates and potential conflicts need to be handled. The extension should handle file change events gracefully. Probably out-of-scope to manage multi-user editing beyond what VS Code merges.

## JSON Schema Mapping to UI

To ensure clarity, here’s how elements of the `ibm_catalog.json` manifest correspond to the visual editor UI elements:

* **Top-level fields (product level)**: Fields like `name`, `label`, `description`, `tags`, `keywords`, `provider`, `support` at the root of JSON – these describe the overall product but are not flavor-specific. The visual editor currently focuses on the **flavor’s architecture**. These top-level metadata fields could be edited elsewhere (perhaps in the extension’s tree view or a separate form). They are not displayed on the canvas. We might include a “Project Info” dialog or leave them to existing JSON editing UI. (Out of scope for this feature, which is about the architecture diagram).

* **Flavors**: `flavors` is an array of objects, each with `name`, `label`, `description`, and possibly its own `architecture` details. The user selects one flavor to visualize. The root node corresponds to that flavor object.

  * If multiple flavors exist, we might add a dropdown at the top of the editor: “Showing flavor: \[dropdown of flavor names]”. Changing it would rebuild the graph for the selected flavor.
  * Within a flavor JSON, aside from dependencies, it may have a section like `architecture` with features and diagrams (IBM uses this for UI highlights). Those are not directly related to dependency graph; we might ignore them in this editor or provide a link to manage diagrams elsewhere.
  * The flavor’s own `inputs` (if IBM manifest had an explicit list) – IBM docs hint that inputs that aren’t used can be referenced in input\_mapping. Possibly, the manifest doesn’t list inputs explicitly; rather, they are implied by the code’s variables. We will treat the root’s Terraform variables as the flavor’s inputs.

* **Dependencies array**: Each object here is a node. Key fields:

  * `name` / `id`: identify the offering. In JSON, one of these may be filled. The extension should preserve whichever the user provides. If user chooses a known public offering, we could fill in the `id` (which is a GUID) and also store the `name` for readability. IBM docs say ID not required if name is set. We might standardize on using `name` for readability in manifest (which IBM’s onboarding might resolve to an ID).
  * `version`: exactly as user set (string). Could be `>=1.0.0` etc. Ensure formatting is preserved.
  * `flavors`: list of strings (could be multiple). We allow multiple selection if needed. If only one flavor, we might choose to store just one string or still an array of one element (likely always an array in JSON even for one flavor, as shown in samples).
  * `optional`: boolean (only if using new manifest v2 features). We include it if user marked optional.
  * `install_type`: string (“fullstack” or “extension”) if user specified.
  * Potentially `catalog_id`: if user chose a non-default catalog.
  * `input_mapping`: array of mapping objects:

    * If we created connections or set static values, each is one object. They can have one of the following combos:

      * `{ "dependency_output": X, "version_input": Y }` for normal output-up mapping (this covers most connections from dependency to root).
      * `{ "dependency_input": X, "version_input": Y, "reference_version": true }` for parent-down mapping (root passes Y to dependency’s X).
      * `{ "version_input": Y, "value": V }` for static values (root provides constant V for its input Y). Actually stored under dependency's mapping, meaning "the dependency doesn’t use any output for this, just take value V for parent's input Y". This essentially sets a default on the parent’s input Y in context of this dependency relationship.
      * `{ "version_input": Y, "reference_version": true }` without dependency\_input means dependency references the parent’s Y input as if it were an output from dependency – this case is a bit confusing; likely should include dependency\_input to be clear. We might avoid generating an object with only version\_input and reference\_version (the IBM example shows it though, possibly implying dependency’s input has same name as parent’s input so they skip repeating it).
    * The editor should generate these precisely. Ensure only one of dependency\_output or dependency\_input is in each mapping (IBM says only one should be provided).
    * If a dependency has multiple mappings, preserve their array order (order not significant but keep consistent).
    * Removing a connection deletes that mapping object.
    * We should also update the `reference_version` boolean accordingly for mappings. The user shouldn’t have to toggle it manually – it’s inferred by connection direction (but maybe allow editing in panel if needed).

* **Swappable\_dependencies**: If used, the JSON structure is:

  ```json
  "swappable_dependencies": [
    {
      "name": "Group1",
      "default_dependency": "moduleA",
      "optional": true/false,
      "dependencies": [ { ... moduleA fields ... }, { ... moduleB fields ... } ]
    }
  ]
  ```

  This is more complex and not directly one node per JSON object. If we support it:

  * The group container corresponds to the outer object (with name and optional/default flags).
  * Each dependency in it is similar to normal dependencies but lives inside the group’s array.
  * The UI might show group name and allow toggling default by maybe a star icon on one of the nodes.
  * The PRD mainly acknowledges this structure but initial implementation might handle groups in a minimal way or not at all to avoid confusion. If not implemented, the editor should at least not break when encountering swappable\_dependencies in JSON: perhaps ignore or present them read-only (e.g., show group as one combined node or separate them out).
  * Ideally, we could hide the complexity: treat each dependency inside a swappable group as separate nodes on canvas with a visual link (like grouping) and allow marking them as part of group via property. But due to time, maybe mark as future feature beyond initial scope.

* **Inputs (version\_inputs)**: IBM manifest does not explicitly list them in JSON. They are implied from Terraform variables. The editor’s additions like marking connector/virtual could be stored in a custom way:

  * Perhaps the manifest’s `metadata` section can hold flags. IBM might have in manifest v2 a way to list inputs in the `architecture` or `manifest`. If not, the extension might simply not persist those flags except via the context that if an input is used in input\_mapping as dependency\_output, it’s effectively a connector.
  * Virtual inputs might need to be recorded in JSON. IBM’s docs mention `virtual` flag on input variables but not clearly where to put in manifest. Possibly they expect you to annotate in Terraform code or not at all. However, since extension manages context, we might maintain an internal list of virtual input names (and apply in IBM publishing step).
  * For completeness, maybe the extension could add a special section in JSON like:

    ```json
    "manifest_version": 2,
    "architecture_inputs": [
       {"name": "vpc_id", "virtual": false, "connector": true},
       {"name": "region", "virtual": false, "connector": false}
    ],
    "architecture_outputs": [ {"name": "compliance_report"} ]
    ```

    This is not standard – IBM’s actual usage might differ. This PRD will note that all changes are within the dependencies and input\_mapping, except possibly metadata for virtual (we’ll assume not explicitly stored unless manifest v2 uses it as part of input definitions).

* **Outputs**: Not stored in JSON as said. The editor does not modify JSON for outputs (except if maybe in the future to list outputs if IBM required listing them somewhere, but they don’t; output variables are auto-imported from code).

* **Retaining Additional Data**: Node positions, UI-specific configuration should not be stored in `ibm_catalog.json` (to avoid polluting the manifest). Instead, if needed, store in extension storage or just recompute layout each time. Possibly store a mapping of node (by offering id or name + flavor) to coordinates in workspaceState when the editor is open.

## Validation Rules and Error Handling

The visual editor will enforce and assist with several validation rules, both **preventative** (disallowing invalid actions) and **detect-and-notify** style:

* **Schema Validation:** The extension should ensure any edits produce a JSON that adheres to IBM’s manifest schema. Key points:

  * Required fields like `name` or `id` for dependencies must be present (one or the other).
  * `kind` is typically required for dependencies; IBM defaults to "terraform" for modules. The extension can auto-set `"kind": "terraform"` for every dependency unless there’s a reason not to. That way the schema is satisfied.
  * Version strings should be valid SemVer or acceptable range syntax (e.g., `^`, `~`).
  * Each dependency’s flavors list should not be empty (if the offering requires a flavor).
  * If using optional or swappable fields, ensure `dependency_version_2: true` is set somewhere if needed (IBM requires that globally to allow those fields, but that might be a manifest-level property).
  * The extension’s existing JSON validation (likely with a JSON schema or custom logic) can be reused here, possibly run on save or on the fly.

* **Duplicate Dependencies:** If a user tries to add the same dependency offering & flavor twice (especially as regular dependency), IBM’s system might see that as duplicate. We should caution or prevent adding a duplicate entry (unless it’s intended in rare cases). E.g., two of the same module could be allowed if logically needed with different flavors, but likely not needed. We can warn “Dependency already added.”

* **Circular Dependency:** Although the manifest doesn’t directly allow expressing a cycle (since one manifest is for one product, and dependencies are separate products), a logical cycle could happen if two modules somehow depend on each other’s outputs. The tool should detect if Node A’s output is mapped to Node B’s input *and* Node B’s output is mapped to Node A’s input – flag that as a circular mapping. Another form: if root’s input is fed from a dependency output while that dependency expects something from root that ultimately comes from its own output… (Complex self-reference). Likely rare or impossible in one manifest. But if detected, highlight both nodes and list “circular reference” error.

* **Missing Input Mappings:** If a dependency has an input that has no mapping or static value, and no default in its module code, then when deploying, that value is undefined – error. However, the extension might not know the module’s defaults. We can assume any input not mapped might still have a default in Terraform. So we can’t error, but we might caution: “Input X of dependency Y is not set (no mapping or value) and will use the module’s default if available.” Possibly a warning level indicator.

* **Unused Inputs (Root):** Conversely, if the root has defined inputs (Terraform variables) that are never used in any mapping or consumed by anything, that’s not an error (the user might just require user to input them). But if root input was intended to be satisfied by a dependency but isn’t, it could be flagged if connector was toggled. For example, root `vpc_id` was marked as connector (meaning “I expect a dependency to provide this”), but no dependency output is connected. That is likely an error – user either forgot to attach something. The editor can highlight root’s `vpc_id` input in red with message “No provider for this connector input.”

* **Type Mismatch:** If the extension can determine data types of outputs and inputs, ensure incompatible types aren’t connected:

  * e.g., don’t allow connecting a list output to a string input (unless maybe the string is supposed to receive a JSON string of list – too context-specific, skip).
  * We at least inform the user of differences. Types should ideally match or be easily convertible. The IBM manifest doesn’t explicitly enforce type, but the actual Terraform deployment would fail if types mismatched (unless user uses type conversion).
  * As a simple rule, if both sides have known types and they differ (and not one being a superset like object vs object with extra fields), show a warning on that connection.

* **Invalid Names/Keys:** If user edits a field to something invalid (like a flavor name with spaces that might not exist, or an offering name that doesn’t match any known offering), we warn. The extension could validate offering names/IDs by checking cached catalog data. If user enters an unknown, maybe highlight and offer “Not recognized. Ensure the ID or name is correct.”

* **IBM Catalog Constraints:** Some IBM-specific rules:

  * If using `optional: true` in any dependency, the manifest likely requires a top-level `"dependency_version_2": true` flag (from IBM docs). We should either automatically set that flag in JSON when the first optional or swappable dependency is used, or warn the user to add it (maybe the extension’s manifest creation already handles it).
  * Similarly, if `swappable_dependencies` are present, ensure all dependencies in that group have `optional` implicitly (since they’re alternatives, possibly optional in usage).
  * Limit known fields: if user adds some unsupported field through panel, either disallow or mark as custom (we should restrict to schema).

* **Visual Indicators:** All validation issues should be communicated:

  * Within the canvas, nodes or ports with issues can get an error state (e.g., red outline or an icon). For instance, a node with an unsatisfied required input could have a small warning icon on it. Hovering could show tooltip “Missing input: subnet\_ids not provided”.
  * The properties panel can list errors at the top or inline by fields (like a field turns red and message next to it).
  * Possibly a “Problems” list outside (but since this is all within one file, VS Code’s Problems panel could show JSON schema errors if we integrate a JSON schema – though for dynamic mapping issues, we might not have schema rules).

* **Graceful Error Handling:** If something goes wrong in the extension (e.g., failure to parse JSON, or lost connection to webview):

  * The editor should not corrupt the JSON. Keep a backup of last known good state in memory. If parsing fails (e.g., invalid JSON syntax due to an external edit while open), show an error message and possibly disable editing until it’s fixed (user might need to correct via text).
  * If IBM API calls fail (for loading DA list or flavor details), show an offline mode message in left panel. Allow user to manually input needed info. Basically, the tool should still allow adding a dependency by manually entering offering name if it can’t fetch list.
  * If the webview crashes or reloads, the extension should restore the state (the custom editor API will call resolve again – reparse JSON and rebuild UI). Because we use `retainContextWhenHidden`, reload should be rare except on full restart.

* **Testing and Validation Mode:** The feature could include a command “Validate Deployable Architecture” (the extension might already have this) to run IBM’s own validation (like using `ibmcloud catalog offering validate --file ibm_catalog.json` or similar). That could be integrated but is external to the editor. We ensure that our output JSON passes that validation.

## Architecture and Implementation Approach

**Extension Side (TypeScript):** This feature will be implemented as part of the existing VS Code extension (written in TypeScript). It will leverage the **VS Code Custom Editor API**, specifically likely the `CustomTextEditorProvider` since we have a JSON text file as the source. The provider (let’s call it `CatalogEditorProvider`) will register for `ibm_catalog.json` files. Key responsibilities:

* **Document Management:** Use the TextDocument for reading initial content and applying edits. The provider’s `resolveCustomTextEditor(document, webviewPanel)` will:

  * Read the JSON content from `document.getText()`.
  * Parse it (likely into a JavaScript object). Use a robust JSON parser or even a JSON schema validator to catch issues early.
  * Construct an initial graph model (nodes, connections) in an intermediate format (e.g., an array of nodes, each with id and properties, and list of connections between node ports).
  * Initialize the webview panel (set HTML, scripts, etc.), and post a message containing the graph model data to the webview for rendering.

* **Webview Content (Frontend):** Use a modern frontend framework to build the UI inside the webview. We can choose **React** (as suggested) or **Svelte** or even vanilla with the Webview UI Toolkit components.

  * The extension sample using React and the toolkit can be a template. We will bundle the webview JS/CSS using a build tool (webpack or vite).
  * Use the **VS Code Webview UI Toolkit** for ready-made controls (buttons, checkboxes, dropdowns) that match VS Code’s look. These are implemented as web components, easily usable in React or other frameworks.
  * For the node-based canvas, consider integrating **Rete.js** (a JS library specifically made for visual node editors). Rete.js provides out-of-the-box support for creating nodes with input/output sockets, connecting them, moving them, zoom/pan, etc.. It’s also extensible (plugins for minimap, history, etc.). We could significantly speed up development by using Rete:

    * We’d define node types for “Root” and “Dependency” (they can actually be one node type with different data).
    * Define socket types (we might not need distinct types except for perhaps type-checking; but at least one for general outputs and one for inputs).
    * Use Rete’s React renderer plugin (since Rete v1 was tied to Vue; Rete v2 supports React via plugin).
    * We will have to handle custom behavior like showing/hiding certain sockets, but Rete likely can handle dynamic node content (for example, change number of input sockets if a new input variable is added).
    * Rete has a concept of an engine for processing data flow, which we might not use beyond visual editing.
    * If not Rete, an alternative is to use a lower-level library like d3 or drawing lines in SVG/Canvas ourselves. But given time and complexity, Rete is a strong choice to implement dragging, connecting, etc., with minimal bugs. It’s MIT licensed (good for inclusion).
  * Manage application state with a suitable approach (if React, maybe use context or Redux style for the graph state). The state will mirror the JSON structure.

* **Communication between Webview and Extension:** Use VS Code’s `postMessage` messaging:

  * On initial load, extension posts the parsed graph data to webview (`webview.postMessage({type: 'init', data: graph})`).
  * The webview JS receives it (via `window.addEventListener('message', e=>{...})`) and renders the graph.
  * When the user interacts (e.g., adds a node, deletes a connection, edits a field), the webview will send messages back to extension:

    * e.g., `{ type: 'addDependency', offering: ..., version: ... }` or `{ type: 'updateField', nodeId: X, field: 'version', value: '1.2.1' }` or `{ type: 'connect', fromNode: A, output: 'foo', toNode: B, input: 'bar' }`.
  * The extension, upon receiving these, will update the TextDocument:

    * Possibly using `TextEdit` operations. We have to locate where in the JSON to make the change. We can maintain a mapping from nodeId to JSON node (like character ranges) to ease editing.
    * Alternatively, reconstruct the JSON object in memory and then call `edit.replace` on the entire document text with the new JSON string. This is simpler but might lose original formatting/ordering. A better approach: use a library like `jsonc-parser` which can apply edits preserving formatting.
    * The extension can also keep track of formatting options (like indent size).
  * After updating the document (which triggers VS Code’s dirty state and shows the changes in text if open), the extension might also want to update the webview’s state. But since our webview initiated the change, it often already updated its local state optimistically. We should ensure consistency – possibly the extension responds with an acknowledgement or the updated partial graph if the change triggered other updates.

    * Example: user adds a dependency node via drag-drop. Webview sends `addDependency` with details. Extension updates JSON (new object in dependencies array). Extension responds with a message `dependencyAdded` with maybe an assigned internal ID or any fields it filled (like if it generated a new GUID or something). The webview then finalizes adding the node using that data. Alternatively, the webview could have pre-added it visually and just waits to hear if any correction needed.
  * For complex things like connecting nodes, likely easier: the webview can update its UI immediately, and just inform extension to update JSON. If extension hits an error, we may need to revert the UI. But these operations are straightforward so conflicts are rare.
  * Similarly, if the TextDocument changes from outside (like user typing in a text editor or extension applying an update after user logs in and gets new data), the extension will send messages to the webview to update:

    * Possibly `documentChange` message with diff or full new graph.
    * We should implement `CustomTextEditorProvider.onDidChangeTextDocument` event to catch any edits to the document and update the webview. This ensures consistency if, say, a find/replace is done on JSON in text editor.

* **State Persistence:** Enable `retainContextWhenHidden` for the webview panel so that when the user switches away from the editor tab and back, the webview (and any Rete internal state) does not reinitialize from scratch. This helps maintain scroll position, etc.

  * Memory overhead is acceptable given typically small graph and we assume one such editor open at a time.
  * If not using CustomTextEditor (if we used CustomEditor with own document model), we would have to handle save differently; but the text model approach is fine and simpler.

* **Reuse Extension Functions:** The existing extension likely has functions to:

  * List catalogs and offerings (with API calls).
  * Fetch offering details like available versions/flavors.
  * Possibly a cache of outputs? (Not sure if extension deals with outputs currently – likely not.)
  * Validate the manifest.

  We should call those from our code:

  * For populating left panel, call something like `extension.getAvailableOfferings(catalog)` which returns an array of {name, id, latestVersion, description, flavors}.
  * Use `vscode.commands.executeCommand` to call any commands the extension already defines (if any) for these lookups.
  * Alternatively, the extension could expose an internal API to the webview via the messaging (but that means round trip: webview -> extension (requests data) -> extension fetches (maybe asynchronous from IBM Cloud) -> extension posts back data).
  * Because webview cannot directly access Node.js APIs or internet, it must rely on extension for any heavy lifting like reading files (for outputs parsing) or HTTP requests (for IBM Cloud data).
  * The extension should thus handle:

    * Terraform output parsing: On init, parse root and possibly dependency modules’ outputs. Could use a simple regex or integrate a Terrafrom HCL parser library. Possibly simpler: since Terraform code is HCL, maybe treat it as text: find lines `output "XYZ"` and then find a `}` that ends it; parse type if present. It’s doable. We then send those outputs with each node data.
    * Terraform input (variable) parsing: similar approach for root’s `variables.tf` to list inputs with types and maybe defaults.

* **Tech Stack Summary:**

  * *Language:* TypeScript (for extension and possibly for webview app as well, via TSX if React).
  * *Framework:* React for building the UI (component model helps manage the left list, right panel form, and embed the canvas). Svelte is another lightweight alternative which might be even simpler for state management; either is acceptable. React has more sample code available in context of VS Code webviews.
  * *Webview Components:* VS Code Webview UI Toolkit for uniform design of form elements. This ensures toggles, dropdowns, buttons look like VS Code native (dark/light theme compliance).
  * *Node Graph library:* **Rete.js** (v2 if stable) to implement the canvas interactions, because it covers dragging nodes, connecting cables, zoom/pan, and even features like undo/redo via history plugin. We can use the Rete history plugin to integrate with VS Code undo if needed, or at least for internal state (though we plan to map to text undo).

    * If Rete for some reason is not used, we’d need to implement drag/line drawing logic ourselves or use another library (e.g., **JointJS**, **d3** or **Drawflow**). Rete is purpose-built for this scenario (visual programming UIs) and has an active community.
  * *Bundling:* Use webpack or vite to bundle the webview code with all dependencies (Rete, React, toolkit). The output will be a single JS and CSS that the extension serves. (The extension might use the `vscode-extension-samples/webview-webpack` as reference.)
  * *Security:* Use VS Code’s provided CSP. All scripts are local (no remote script). The webview will likely need to load local resource (our JS bundle). We must set `webviewPanel.webview.html` with proper CSP meta and use the `vscode-resource` or new `Webview.asWebviewUri` to load images if any (like icons).
  * *Testing:* We will test the UI on sample JSON files (like the provided Secrets Manager sample or others) to ensure the graph builds correctly. Also test adding new stuff, toggling optional, etc., and see that the JSON output matches expectation (maybe by diffing with expected JSON).

* **Performance and Memory:** With `retainContextWhenHidden`, the webview stays alive, which is fine. Rete and React might use a few MBs, trivial for modern systems. The JSON files are small (couple KB to maybe tens of KB if many dependencies), parsing is instant. IBM API calls might slow initial load if we fetch data – we should do those asynchronously and maybe show a loading indicator in the DA Library until data arrives. But we do have caching to mitigate repeated calls.

* **Timeline & Risk:** Integration of Rete (if not already known by team) has a learning curve but many examples exist. Alternatively, since the user’s screenshots suggest an existing design, maybe the team already has a partial implementation or UI concept. We’ll align with that design. The major risk is ensuring the JSON <-> UI synchronization is robust (not losing any changes, and handling concurrent changes). Also, making sure we don’t inadvertently write a wrong JSON that could break the manifest. Extensive testing with IBM’s manifest validator will be needed.

## References

* IBM Cloud Docs – *Manifest File (ibm\_catalog.json) Structure and Values*: Describes flavors, dependencies, input\_mapping, and usage of fields like `dependency_output`, `dependency_input`, `version_input`, `optional`, etc. This documentation guided how we interpret and map JSON elements to the editor UI.
* Sample IBM Catalog JSON (Terraform module example – Secrets Manager): Provided real-world context for flavors, dependencies, and input mappings usage in an IBM deployable architecture manifest.
* **IBM Catalog Tools Extension (existing)** – Marketplace listing: Details current features like JSON tree view, dependency management prompts, and IBM Cloud integration, which our visual editor builds upon. The extension’s ability to fetch offerings, validate mappings, and handle caching is reused in this feature.
* VS Code Custom Editor API Documentation: Explains how custom editors can replace the standard text editor for specific file types, using webviews and messaging. Also notes the `retainContextWhenHidden` option to keep the webview state alive when not visible, which we use for a smooth user experience.
* VS Code Webview UI Toolkit: UI component library for VS Code extensions, ensuring consistent design and theme support for webview content. We leverage it for form controls in the properties and library panels.
* Microsoft’s Webview UI Toolkit Sample (React): An official sample extension demonstrating how to integrate the toolkit with a React webview front-end. It serves as a reference for setting up our project structure and messaging between extension and webview.
* **Rete.js** – Node Editor Framework: Provides the foundation for implementing node-based editors with features like draggable nodes, connecting sockets, zoomable canvas, and plugins for common needs. Using Rete saves development time for the canvas interactions.
* IBM Cloud Private Catalog Onboarding Guide: Explains how deployable architectures are onboarded and how the manifest file is used. Emphasizes that the manifest is the source of truth for product configuration, reinforcing the need for our editor to maintain correctness of this file.
* IBM Secure Enterprise Developer Guide (if any relevant sections): Could include info on input/output variable handling and advanced manifest features (like optional dependencies under `dependency_version_2`). We consulted these to ensure optional and swappable dependencies are accounted for.
* Node-RED / n8n Editor inspiration: While not directly cited, the visual paradigm is inspired by well-known workflow editors like *n8n* (open source automation tool) – providing a familiar metaphor of nodes and connections to users. The goal is to bring similar intuitiveness to IBM Cloud architecture composition.
