# IBM Catalog JSON Editor (Proof of Concept)

IBM Catalog JSON Editor is a VS Code extension designed to simplify the process of editing IBM Cloud Catalog JSON files. It provides an easy-to-use interface for managing catalog entries directly within VS Code.

## Features

- **Catalog JSON Editing**: Provides a specialized interface for editing `ibm_catalog.json` files.
- **Webview Integration**: A webview-based editor for a more visual representation of catalog entries.
- **Login & Logout Commands**: Log in with an IBM Cloud API key to access offerings and features.
- **Offering Management**: Fetch and manage offerings from IBM Cloud Catalogs.
- **Custom Status Bar Indicator**: Shows the login state and allows quick access to login/logout.

## Requirements

- **IBM Cloud API Key**: To use certain features, you will need an IBM Cloud API Key. This can be generated from the IBM Cloud console.
- **VS Code Version**: Requires VS Code version 1.94.0 or higher.

## Installation

1. Clone or download this repository.
2. Run `npm install` to install dependencies.
3. Use `vsce package` to create a VSIX package.
4. Install the `.vsix` package in your VS Code environment.

## Usage

1. **Open a Workspace**: Open a folder or workspace in VS Code.
2. **Open the Catalog JSON File**: The extension only works with the `ibm_catalog.json` file. Please ensure this file is in your workspace.
3. **Login**: Run the `IBM Catalog Editor: Login` command to provide your IBM Cloud API Key.
4. **Start Editing**: Use the webview to visually edit the catalog JSON file.

## Commands

- **IBM Catalog Editor: Login**: Log in to IBM Cloud with an API key.
- **IBM Catalog Editor: Logout**: Log out from IBM Cloud.

## Activation Events

The extension activates on the following events:

- **Catalog Editor Commands**: When running login/logout commands.
- **View Activation**: When opening the Catalog Editor view.

## Building from Source

To build this extension from the source:

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Watch for changes:
   ```bash
   npm run watch
   ```

## Disclaimer

This is a Proof of Concept (POC) extension and is not intended for production use.

## License

This project is licensed under the Apache 2.0 License.
