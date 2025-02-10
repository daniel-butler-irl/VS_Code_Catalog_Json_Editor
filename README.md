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
   - **Dependencies Management**:
     - **Add Dependencies**:
       - Use the **+** icon beside dependencies arrays to add new dependencies.
       - Supports adding both regular and swappable dependencies.
       - Guided prompts help in selecting catalogs, offerings, versions, and flavors.
     - **Edit Dependencies**:
       - Inline editing of dependency properties such as `catalog_id`, `id`, `version`, `flavors`, etc.
       - When editing versions, a list of available versions is provided based on the selected offering.
     - **Flavors Interaction**:
       - When editing flavors, the extension provides a list of flavors available for the selected offering and dependency.
       - Supports adding multiple flavors to a dependency.
     - **Swappable Dependencies**:
       - Manage swappable dependency groups.
       - Set default dependencies within swappable groups.
   - **Configuration Management**:
     - **Edit Configuration Fields**:
       - Use the **Edit** action on the `configuration` node to manage configuration fields.
       - Select properties to delete from configuration fields to simplify the configuration objects.
     - **Add Configuration Fields**:
       - Use the **+** icon to add new configuration fields.
       - Guided prompts assist in defining new configuration fields.
   - **Input Mapping Section**:
     - Use the **+** icon beside input mapping to add a new mapping.
     - Supports adding mappings of various types, including `version_input`, `dependency_input`, `dependency_output`, and `value`.
     - Guided prompts help in selecting appropriate mapping sources and targets.
     - **Dependency Output Editing**:
       - When a dependency output is edited, a list of available dependency outputs for the matching offering and flavor is shown.
     - **Dependency Input Editing**:
       - When selecting dependency inputs, a list of inputs from the configuration section in `ibm_catalog.json` is presented.
     - **Version Input Editing**:
       - Selecting the version input displays the configuration keys available for mapping.
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

<https://marketplace.visualstudio.com/items?itemName=DanielButler.ibm-catalog-json-editor>

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

   - **Adding Elements**:
     - Use the **+** icon beside arrays (e.g., `dependencies`, `configuration`, `input_mapping`) to add new elements.
     - Guided prompts assist in adding dependencies, configuration fields, flavors, and input mappings.
   - **Editing Elements**:
     - Double-click, **Space**, or **Enter** to trigger the edit mode for elements.
     - Inline editing supports various data types with context-aware prompts.
   - **Edit Configuration Fields**:
     - Use the **Edit** action on the `configuration` node to manage configuration fields.
     - Select properties to **delete** from configuration fields to simplify them.

4. **Manage Dependencies and Configurations**

   - **Dependencies**:
     - Easily manage and add both regular and swappable dependencies within your catalog configurations through the UI.
     - When adding or editing dependencies, relevant options are provided based on the selected context, including catalogs, offerings, versions, and flavors.
   - **Configurations**:
     - Manage configuration fields by adding new fields or editing existing ones.
     - Use the property selection feature to remove unwanted properties from configuration fields.

5. **Input Mapping Management**
   - **Add Input Mappings**:
     - Use the **+** icon beside `input_mapping` to add new mappings.
     - Select the type of mapping and follow guided prompts to define the mapping.
   - **Edit Input Mappings**:
     - Edit existing mappings with context-aware prompts.
     - Supports mapping to `version_input`, `dependency_input`, `dependency_output`, and `value`.

## Notes on Performance and Caching

Fetching offerings from IBM Cloud can take some time initially. During this time, prompts related to these operations will not be available until the data has been fetched. However, subsequent interactions are instant due to caching. To clear cached data:

- Use the command **IBM Catalog: Clear Cache**.
- Alternatively, log out and back in to clear the cache.

## Creating Releases

The extension supports both stable releases and pre-releases. The release process is automated through GitHub Actions.

### Stable Releases

To create a stable release:

1. Update the version in `package.json` following semantic versioning (e.g., `1.2.3`).
2. Commit and push the changes to the `main` branch.
3. The GitHub Action will automatically:
   - Validate the version increment
   - Generate a changelog
   - Create a GitHub release
   - Publish to VS Code Marketplace

### Pre-releases

To create a pre-release:

1. Create a new branch from `main` with the pattern `releases/**` (e.g., `releases/v1.2.3-preview`).
2. Update `package.json`:
   - Set the version (e.g., `"version": "1.2.3"`)
   - Add the preview flag: `"preview": true`
3. Commit and push the changes to your release branch.
4. The GitHub Action will automatically:
   - Detect the preview flag
   - Create a GitHub pre-release
   - Publish to VS Code Marketplace as a pre-release

Pre-releases in the VS Code Marketplace:

- Are marked as preview versions
- Can be installed alongside stable versions
- Help test new features before stable release
- Are not automatically updated for users on stable versions

### Version Guidelines

Follow semantic versioning (MAJOR.MINOR.PATCH):

- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes (backward compatible)

Example version sequence with preview:

```
1.2.0 (preview: true) -> 1.2.0 (preview: false)
```

For preview releases, we use the preview flag in package.json instead of version suffixes.

## License

This project is licensed under the [Apache 2.0](./LICENSE.md).

## Support

If you encounter any issues or have questions about the IBM Catalog JSON Editor extension, please open an issue on the [GitHub repository](https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor/issues).
