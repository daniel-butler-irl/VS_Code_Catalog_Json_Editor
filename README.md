# IBM Catalog JSON Editor (POC)

> ⚠️ **WARNING**: This is a proof of concept extension. Use at your own risk. Features may be incomplete or unstable. API calls to IBM Cloud may cause delays in responsiveness.

## Overview
IBM Catalog JSON Editor is a Visual Studio Code extension designed to streamline the management and editing of complex `ibm_catalog.json` files. Tailored for IBM Cloud architects and developers, this extension offers an intuitive side panel that visualizes the JSON structure in a tree format, facilitating easy navigation, editing, and IBM Cloud integration.

## Features

1. **File Management**
   - Auto-detection of `ibm_catalog.json` files in the workspace.
   - Create new catalog files with a default structure.
   - Real-time file system watching and synchronization.
   - Locate existing catalog files in the workspace.

2. **Tree View Navigation**
   - Color-coded hierarchical display of JSON structure.
   - Expandable/collapsible nodes for easy navigation.
   - Custom icons for different value types.
   - Tree state persistence across sessions.
   - **Left-click** interacts with elements, while **double-click**, **Space**, or **Enter** triggers the edit mode.

3. **IBM Cloud Integration**
   - Secure API key management and authentication.
   - Login through the status bar.
   - Real-time catalog ID lookup when logged in.
   - Offering and flavors lookups are available if logged in.
   - If not logged in, cached data is used when available; otherwise, lookups are not accessible.

4. **Smart Editing and Dependency Management**
   - **Catalog ID Interaction**:
     - Catalog IDs can be double-clicked or selected with `Space/Enter` to display a list of available catalogs for the current logged-in API key.
     - If a catalog ID is edited, the prompt will display offerings within that catalog.
   - **Flavors Interaction**:
     - When editing flavors, the extension provides a list of flavors available for the selected offering.
   - **Input Mapping Section**:
     - Use the **+** icon beside input mapping to add a new mapping. You can add mappings of one of three available types.
     - A new blank mapping is added to the list, and users can edit it to specify details.
     - **Dependency Output Editing**:
       - When a dependency output is edited, a list of available dependency outputs for the matching offering and flavor (with the highest version within the version constraint) is shown.
     - **Dependency Input Editing**:
       - When selecting dependency inputs, a list of inputs from the configuration section in `ibm_catalog.json` is presented.
     - **Version Input Editing**:
       - Selecting the version input displays the configuration values for the current selected flavor.
   - **Inline Value Editing**:
     - Type-specific input controls make editing smoother.
   - **Auto-save on Changes**:
     - All changes are auto-saved to prevent data loss.

5. **Performance Optimization**
   - Local caching of IBM Cloud data for improved performance.
   - Debounced file system operations to reduce unnecessary processing.
   - Background data fetching keeps the UI responsive.
   - Cached data ensures subsequent interactions are instant after the first fetch.
   - Cache management commands are available, and users can log out and back in to clear the cache.

6. **Developer Tools**
   - Configurable debug logging for troubleshooting.
   - Visual status indicators for sync operations.
   - Command palette integration for easy access.
   - Detailed error messaging to guide the user through issues.

## Installation

### VS Code Marketplace

https://marketplace.visualstudio.com/items?itemName=DanielButler.ibm-catalog-json-editor

1. Open VS Code.
2. Click the Extensions icon in the Activity Bar (`Cmd+Shift+X`).
3. Search for "IBM Catalog JSON Editor".
4. Click "Install".

### Manual Installation
1. Download the `.vsix` file from [Releases](https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor/releases).
2. Install via the command:
   ```bash
   code --install-extension ibm-catalog-json-editor-x.x.x.vsix
   ```

## Usage

1. **Open an IBM Catalog JSON File**
   - Open your `ibm_catalog.json` file in **Visual Studio Code**.

2. **Navigate the Catalog**
   - Use the **IBM Catalog JSON Editor** view to navigate through your catalog elements.

3. **Add or Edit Elements**
   - Currently, the only element that supports adding new entries is **input mappings**.
   - Double-click, **Space**, or **Enter** to trigger the edit mode for elements.

4. **Manage Dependencies**
   - Easily manage and add dependencies within your catalog configurations through the UI.
   - When editing dependency outputs, inputs, or version inputs, relevant options are provided based on the selected context.

## Notes on Performance and Caching

Fetching offerings from IBM Cloud can take some time initially. During this time, prompts related to these operations will not be available until the data has been fetched. However, subsequent interactions are instant due to caching. To clear cached data:

- Use the command **IBM Catalog: Clear Cache**.
- Alternatively, log out and back in to clear the cache.

## License

This project is licensed under the [Apache 2.0](./LICENSE.md).

## Support

If you encounter any issues or have questions about the IBM Catalog JSON Editor extension, please open an issue on the [GitHub repository](https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor/issues).
