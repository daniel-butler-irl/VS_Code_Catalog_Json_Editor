# IBM Catalog JSON Editor (POC)

> ⚠️ **WARNING**: This is a proof of concept extension. Use at your own risk. Features may be incomplete or unstable. API calls to IBM Cloud may cause delays in responsiveness.

## Overview
IBM Catalog JSON Editor is a Visual Studio Code extension designed to streamline the management and editing of complex `ibm_catalog.json` files. Tailored for IBM Cloud architects and developers, this extension offers an intuitive side panel that visualizes the JSON structure in a tree format, facilitating easy navigation, editing, and validation with real-time synchronization and IBM Cloud integration.

## Features

1. **File Management**
   - Auto-detection of `ibm_catalog.json` files in workspace
   - Create new catalog files with default structure
   - Real-time file system watching and synchronization
   - Locate existing catalog files in workspace

2. **Tree View Navigation**
   - Color-coded hierarchical display of JSON structure
   - Expandable/collapsible nodes for easy navigation
   - Custom icons for different value types
   - Tree state persistence across sessions

3. **IBM Cloud Integration**
   - Secure API key management and authentication
   - Real-time catalog ID validation
   - Offering validation against IBM Cloud
   - Visual indicators for validation status

4. **Smart Editing**
   - Context-aware element addition
   - Schema-based validation
   - Inline value editing
   - Type-specific input controls
   - Auto-save on changes

5. **Performance Optimization**
   - Local caching of IBM Cloud data
   - Debounced file system operations
   - Background validation
   - Cache management commands

6. **Developer Tools**
   - Configurable debug logging
   - Visual status indicators
   - Command palette integration
   - Detailed error messaging

## Installation

### VS Code Marketplace
1. Open VS Code
2. Click Extensions icon in Activity Bar (`Cmd+Shift+X`)
3. Search for "IBM Catalog JSON Editor"
4. Click "Install"

### Manual Installation
1. Download `.vsix` from [Releases](https://github.com/your-username/ibm-catalog-json-editor/releases)
2. Install via command:
   ```bash
   code --install-extension ibm-catalog-json-editor-0.0.6.vsix
   ```

## Usage

1. **Open an IBM Catalog JSON File**
   - Open your `ibm_catalog.json` file in **Visual Studio Code**.

2. **Navigate the Catalog**
   - Use the **IBM Catalog JSON Editor** view to navigate through your catalog elements.

3. **Add or Edit Elements**
   - Right-click on a catalog element to add a new entry or edit an existing one.
   - Follow the prompts to input necessary details.

4. **Validate Entries**
   - Hover over fields like `catalog_id` or `offering_id` to see validation statuses and detailed tooltips.
   - The extension automatically validates entries against IBM Cloud services.

5. **Manage Dependencies**
   - Easily manage and validate dependencies within your catalog configurations through the UI.


## License

This project is licensed under the [Apache 2.0](./LICENSE).

## Support

If you encounter any issues or have questions about the IBM Catalog JSON Editor extension, please open an issue on the [GitHub repository](https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor/issues).

