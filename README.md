# IBM Catalog JSON Editor

> ⚠️ **WARNING**: This extension is in active development. While stable for production use, new features are regularly added. Please report any issues on the GitHub repository.

## Overview

IBM Catalog JSON Editor is a Visual Studio Code extension designed to streamline the management and editing of `ibm_catalog.json` files. Tailored for IBM Cloud architects and developers, this extension offers an intuitive side panel that visualizes the JSON structure in a tree format, facilitating easy navigation, editing, and IBM Cloud integration.

## Features

1. **File Management**
   - Auto-detection of `ibm_catalog.json` files in the workspace
   - Create new catalog files with a default structure
   - Real-time file system watching and synchronization
   - Locate existing catalog files in the workspace

2. **Tree View Navigation**
   - Color-coded hierarchical display of JSON structure
   - Expandable/collapsible nodes for easy navigation
   - Custom icons for different value types
   - Tree state persistence across sessions
   - **Left-click** interacts with elements, while **double-click**, **Space**, or **Enter** triggers the edit mode
   - **Delete Operations**:
     - Right-click context menu for element deletion
     - Safety confirmation dialogs with detailed information
     - Child element warnings for arrays and objects
     - Clear display of affected elements before deletion
     - Ability to cancel deletion operations

3. **IBM Cloud Integration**
   - Secure API key management and authentication
   - Login through the status bar or command palette
   - Real-time catalog ID lookup when logged in
   - Offering and flavors lookups with caching support
   - Offline mode with cached data when available

4. **Pre-release Management**
   - Dedicated pre-release panel in the side view
   - GitHub integration for release management
   - Automated version suggestion based on semantic versioning
   - Support for both stable and preview releases
   - IBM Cloud Catalog version import functionality
   - Branch protection and validation
   - Unpushed changes detection
   - Multiple flavor support per release
   - Automated release notes generation

5. **Smart Editing and Dependency Management**
   - **Catalog ID Interaction**:
     - Interactive catalog selection with real-time validation
     - Offering list display based on selected catalog
   - **Dependencies Management**:
     - Add regular and swappable dependencies
     - Guided prompts for catalog, offering, version, and flavor selection
     - Inline editing of dependency properties
     - Version selection with availability validation
     - Multiple flavor support with context-aware suggestions
   - **Configuration Management**:
     - Property-based configuration field editing
     - Guided configuration field addition
     - Property deletion support
   - **Input Mapping**:
     - Support for version_input, dependency_input, dependency_output, and value mappings
     - Context-aware mapping source and target selection
     - Dependency output validation against offerings and flavors
     - Configuration key mapping for version inputs

6. **Performance Optimization**
   - Local caching of IBM Cloud data
   - Debounced file system operations
   - Background data fetching
   - Cache management commands
   - Configurable debug logging

## Guided Prompts

The extension provides context-aware prompts to guide you through various operations. Each section below describes how to trigger the prompts and what they offer:

### 1. Dependency Management

#### Regular Dependencies

- **How to Access**:

  ```plaintext
  Add New: Click + icon next to "dependencies" array
  Edit: Double-click or press Space/Enter on any dependency field
  Delete: Right-click on dependency and select "Delete"
  ```

- **Catalog Selection** (Triggered first when adding dependency)
  - Browse public and private catalogs with descriptions
  - Search by name or ID with real-time filtering
  - View catalog metadata including owner and visibility
  - Enter custom catalog ID with validation
  - Recently used catalogs appear at the top

- **Offering Selection** (After catalog selection)
  - List of offerings from selected catalog with descriptions
  - Filter by name, ID, or keywords
  - Preview offering details including versions and flavors
  - Quick select from recent offerings
  - Manual ID entry with validation

- **Version Selection** (After offering selection)
  - Predefined constraint options:

    ```plaintext
    Latest Compatible (^1.2.3): Updates within major version
    Patch Updates Only (~1.2.3): Updates patch version only
    Greater Than or Equal (>=1.2.3): Always use newer versions
    Version Range: Specify custom range (e.g., >=1.2.3 <2.0.0)
    ```

  - List of available versions with release dates
  - Custom version constraint with validation
  - Version range builder with visual feedback

- **Flavor Selection** (Final step)
  - Browse available flavors with detailed descriptions
  - Multi-select support for multiple flavors
  - Preview flavor capabilities and requirements
  - Filter by compatibility and features
  - Custom flavor name entry with validation

#### Swappable Dependencies

- **How to Access**:

  ```plaintext
  Add Group: Click + icon next to "swappable_dependencies" array
  Add to Group: Click + icon inside a swappable group
  Set Default: Double-click "default_dependency" field
  Edit Group: Double-click any group field
  ```

- **Group Creation**
  - Set unique group identifier
  - Configure as optional or required
  - Set default dependency selection
  - Define group behavior and constraints

### 2. Input Mapping

#### Adding New Mappings

- **How to Access**:

  ```plaintext
  New Mapping: Click + icon next to "input_mapping" array
  Edit Existing: Double-click the respective field:
    - version_input
    - dependency_input
    - dependency_output
    - value
  Direction: Double-click "reference_version" field
  ```

- **Mapping Types and Options**:
  1. **Version Input Mapping**
     - Maps configuration inputs to dependency
     - Direction options:

       ```plaintext
       ↑ Default (false): Dependency up to parent
       ↓ Parent down (true): Parent to dependency
       ↑ Explicit up (false): Force upward mapping
       ```

     - Source selection with validation
     - Configuration key suggestions

  2. **Dependency Input Mapping**
     - Available inputs from dependency's configuration
     - Type validation and compatibility check
     - Default value suggestions
     - Reference version control

  3. **Dependency Output Mapping**
     - Lists available outputs from dependency
     - Filtered by selected flavors
     - Real-time validation against offering
     - Output type information

  4. **Static Value Mapping**
     - Supports multiple data types:

       ```plaintext
       String: Text values with optional validation
       Number: Integers or decimals with range checks
       Boolean: True/false with toggle
       Array: JSON array with structure validation
       Object: JSON object with schema validation
       Null: Explicit null value
       ```

     - Format validation and suggestions
     - Type conversion assistance

### 4. Pre-release Management

- **How to Access**:

  ```plaintext
  Panel: Click "Pre-release" in side panel
  Create: Click "Create Release" button
  Import: Click "Import" button
  Edit: Click version number
  Branch: Use branch dropdown
  ```

- **Version Management**
  1. **Version Selection**
     - Semantic version suggestions
     - Preview/stable version rules
     - Increment options (major/minor/patch)
     - Version validation

  2. **Branch Management**
     - Branch name validation
     - Protection rules verification
     - Change detection
     - Conflict resolution

  3. **Release Configuration**
     - Preview settings management
     - Version number validation
     - Marketplace visibility control
     - Catalog integration options

## Available Elements

The following elements can be added and configured in your catalog:

1. **Root Level Elements**
   - `name`: Catalog name
   - `label`: Display label
   - `short_description`: Brief description
   - `catalog_id`: Unique identifier
   - `tags`: Categorization tags
   - `keywords`: Search keywords
   - `provider`: Provider information
   - `support`: Support contact details

2. **Dependencies**
   - Regular Dependencies
     - `catalog_id`: Source catalog
     - `id`: Offering ID
     - `version`: Version specification
     - `flavors`: Supported flavors
   - Swappable Dependencies
     - `group_id`: Group identifier
     - `default`: Default selection
     - `alternatives`: Alternative options

3. **Configuration**
   - Simple Values
     - `string`: Text values
     - `number`: Numeric values
     - `boolean`: True/false values
   - Complex Types
     - `object`: Nested objects
     - `array`: Value arrays
     - `enum`: Predefined options

4. **Input Mapping**
   - `version_input`: Version-specific inputs
   - `dependency_input`: Dependency configuration
   - `dependency_output`: Output mapping
   - `value`: Static value mapping

5. **Metadata**
   - `format_kind`: Format specification
   - `offering_id`: Offering identifier
   - `version_id`: Version identifier
   - `flavor_id`: Flavor identifier

## Installation

### VS Code Marketplace

<https://marketplace.visualstudio.com/items?itemName=DanielButler.ibm-catalog-json-editor>

1. Open VS Code
2. Click the Extensions icon (`Cmd+Shift+X` or `Ctrl+Shift+X`)
3. Search for "IBM Catalog JSON Editor"
4. Click "Install"

### Manual Installation

1. Download the `.vsix` file from [Releases](https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor/releases)
2. Install via command:

   ```bash
   code --install-extension ibm-catalog-json-editor-x.x.x.vsix
   ```

## Usage

1. **Open or Create a Catalog**
   - Open existing `ibm_catalog.json`
   - Or create new via command palette

2. **Navigate and Edit**
   - Use the IBM Catalog Explorer view
   - Click elements to edit
   - Use context menus for advanced options

3. **Pre-release Management**
   - Open Pre-release panel
   - Login to GitHub and IBM Cloud
   - Follow guided workflow for releases

4. **Dependency Management**
   - Add dependencies via + icon
   - Configure through guided prompts
   - Manage versions and flavors

5. **Configuration and Mapping**
   - Edit configuration fields
   - Set up input mappings
   - Configure dependency relationships

## Debugging

The extension provides comprehensive debugging support:

1. **Log Levels**
   - Set via command palette
   - DEBUG: Detailed operation logs
   - INFO: General operation info
   - WARN: Warning messages
   - ERROR: Error details

2. **Log Channels**
   - Main Channel: General extension logs
   - Pre-release Channel: Pre-release operation logs

3. **Cache Management**
   - Clear cache command
   - Force refresh options
   - Authentication reset

## Support

For issues, questions, or feature requests:

- Open an issue on [GitHub](https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor/issues)
- Check the [Documentation](https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor/wiki)

## License

This project is licensed under the [Apache 2.0](./LICENSE.md).
