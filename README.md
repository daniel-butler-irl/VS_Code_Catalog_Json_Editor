# IBM Catalog JSON Editor (POC)

Use at your own risk. This is a proof of concept and is not intended for production use.
Not all features are implemented and some features may not work as expected.
Note: When the extension is preforming lookups, it will make API calls to IBM Cloud. This can result in some of the prompts taking a long time to load.

## Overview
IBM Catalog JSON Editor is a Visual Studio Code extension designed to streamline the management and editing of complex `ibm_catalog.json` files. Tailored for IBM Cloud architects and developers, this extension offers an intuitive side panel that visualizes the JSON structure in a tree format, facilitating easy navigation, editing, and validation with real-time synchronization and IBM Cloud integration.

## Features

1. **Tree View Representation**
   - Renders `ibm_catalog.json` in an expandable and collapsible tree structure.
   - Maintains the state of the tree (expanded/collapsed nodes) across sessions.

2. **Editing Capabilities**
   - Editable fields directly within the tree.
   - Supports various input types, including text boxes and combo boxes with filtering.
   - Save functionality to update the JSON file upon changes.

3. **Synchronization**
   - Real-time updates when the JSON file is modified externally.
   - Highlights corresponding JSON lines when tree nodes are selected.

4. **Adding Elements**
   - Dialog boxes for adding new elements to lists within the JSON.
   - Dynamic form generation based on the JSON schema and additional custom fields.

5. **Validation and IBM Cloud Integration**
   - Validates fields such as `catalog_id` using IBM Cloud SDK lookups.
   - Highlights invalid entries in red.
   - Caches lookup results to optimize performance.

6. **Schema Handling**
   - Utilizes the provided JSON schema for form generation.
   - Supports adding new features not present in the schema.

7. **User Authentication**
   - Detects IBM Cloud API key for authenticated operations.
   - Operates in a basic mode without authentication, ensuring core functionalities remain accessible.

8. **Extensibility**
   - Modular architecture to allow future enhancements and integrations.

## Installation

You can install the extension manually via the `.vsix` package.

### Install from Marketplace
1. Open the **Extensions** view in **Visual Studio Code**.
2. Search for `IBM Catalog JSON Editor`.
3. Click **Install** to add the extension to your workspace.

### Install from VSIX

1. Download the `.vsix` package from your repository or another source.
2. Open **Visual Studio Code**.
3. Go to the **Extensions** view.
4. Click on the three-dot menu (`...`) in the top-right corner.
5. Select `Install from VSIX...`.
6. Browse to the downloaded `.vsix` file and select it.
7. Reload **Visual Studio Code** if prompted.

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


## Contributing

Contributions are welcome! Please follow these steps to contribute:

1. **Fork the Repository**
   - Click the **Fork** button on the repository page to create your own fork.

2. **Clone Your Fork**
   ```bash
   git clone https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor.git
   ```

3. **Create a New Branch**
   ```bash
   git checkout -b feature/YourFeatureName
   ```

4. **Make Your Changes**
   - Implement your feature or bug fix.

5. **Commit Your Changes**
   ```bash
   git commit -m "Add feature: YourFeatureName"
   ```

6. **Push to Your Fork**
   ```bash
   git push origin feature/YourFeatureName
   ```

7. **Open a Pull Request**
   - Navigate to your fork on GitHub and click **Compare & pull request**.

## License

This project is licensed under the [Apache 2.0](./LICENSE).

## Acknowledgements

- Thanks to the [Visual Studio Code](https://code.visualstudio.com/) team for their amazing editor.
- Inspired by IBM Cloud services and their robust catalog management.

## Additional Information

### Project Overview

IBM Catalog JSON Editor is developed to assist IBM Cloud architects and developers in managing and editing `ibm_catalog.json` files efficiently across repositories. By providing a user-friendly side panel with a tree view representation, the extension simplifies navigation, editing, and validation of complex JSON data structures with real-time synchronization and IBM Cloud integration.

### Architecture

The extension follows a modular architecture comprising:

1. **Frontend (Tree View and UI Components)**
   - Utilizes VS Code’s Tree View API to render the JSON structure.
   - Employs webviews or custom editors for dialog boxes and detailed views.

2. **Backend (Extension Host)**
   - Manages file operations, state persistence, and interactions with IBM Cloud SDKs.
   - Handles validation, caching, and synchronization logic.

3. **Integration Layer**
   - Interfaces with IBM Cloud SDKs for data validation and lookups.
   - Manages authentication states and API interactions.

4. **State Management**
   - Utilizes VS Code’s Memento storage for persisting tree states and cached data.

### Technologies and Tools

- **Language:** TypeScript
- **Framework:** VS Code Extension API
- **IBM Cloud SDK:** Latest version from [IBM Cloud SDK Documentation](https://cloud.ibm.com/docs?tab=api-docs)
- **JSON Schema:** For form generation and validation
- **Caching Library:** In-memory caching or suitable caching strategy
- **Version Control:** Git
- **Testing:** Jest or Mocha for unit and integration tests

## Getting Started

To set up the development environment and contribute to the IBM Catalog JSON Editor extension, follow these steps:

1. **Clone the Repository**
   ```bash
   git clone https://github.com/your-username/ibm-catalog-json-editor.git
   ```

2. **Navigate to the Project Directory**
   ```bash
   cd ibm-catalog-json-editor
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Compile the Extension**
   ```bash
   npm run build
   ```

5. **Run the Extension**
   - Press `F5` in Visual Studio Code to open a new Extension Development Host window with the extension loaded.

## Contributing Guidelines

Please ensure your contributions adhere to the following guidelines:

- **Code Quality**
  - Write clean, readable, and maintainable code.
  - Follow TypeScript and VS Code extension development best practices.

- **Documentation**
  - Update the `README.md` with any significant changes or new features.
  - Ensure inline code documentation is clear and concise.

- **Testing**
  - Write unit and integration tests for new features and bug fixes.
  - Ensure all existing tests pass before submitting a pull request.

- **Commit Messages**
  - Use clear and descriptive commit messages.
  - Follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) standard.

## Support

If you encounter any issues or have questions about the IBM Catalog JSON Editor extension, please open an issue on the [GitHub repository](https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor/issues).

## Future Enhancements

Based on the project specification, future phases may include:

1. **Advanced Validation**
   - Implement additional validation rules using JSONPath and custom functions.
   - Enable dynamic population or transformation of data based on the JSON structure.

2. **Extensibility Framework**
   - Design the extension to support plugins or modules for future feature additions.
   - Provide APIs or hooks for developers to extend functionalities.

3. **Performance Optimization**
   - Optimize tree rendering for large JSON files.
   - Enhance caching strategies for better performance.

4. **Comprehensive Error Handling**
   - Implement detailed error handling and user notifications for various failure scenarios.
   - Ensure the extension remains stable in offline mode or when API calls fail.

5. **Continuous Integration and Deployment (CI/CD)**
   - Set up CI/CD pipelines for automated testing and deployment of extension updates.

