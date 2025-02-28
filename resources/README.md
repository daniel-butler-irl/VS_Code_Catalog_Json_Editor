# Resources Directory

This directory contains resources used by the VS Code Catalog JSON Editor extension.

## About This Directory

This directory serves as a placeholder for resources that will be included in the built extension. In the repository itself, this directory will appear mostly empty (except for this README).

### schema.json (Generated File)

The `schema.json` file is **not** committed to this repository, but is generated during the build process and included in the final extension package.

Key points about this file:

- **Purpose**: Provides schema validation for IBM Cloud Catalog JSON files, enabling features like IntelliSense, validation, and documentation in the editor.

- **Update Process**:
  - The schema is automatically generated during the build process via the `scripts/update-schema.js` script
  - This script downloads the latest schema from the official GitHub repository at build time
  - The schema file is not committed to the repository (it's in `.gitignore`)
  - The file will only exist in the built/packaged extension or temporarily during local development

- **Fallback Mechanism**:
  - This bundled schema serves as a fallback when online schema fetching fails
  - It ensures the extension can work offline or in environments with network restrictions
  - At runtime, the extension still attempts to fetch the latest schema first

- **Integration with CI/CD**:
  - The GitHub Actions workflow automatically updates the schema before building and publishing
  - This ensures that the published extension always contains the most up-to-date schema

## Why Bundle the Schema?

1. **Offline Support**: Ensures the extension works even without internet access
2. **Faster Initial Experience**: Users have immediate access to schema features without waiting for downloads
3. **Reliability**: Provides a fallback in case of network issues or GitHub API rate limiting
4. **Predictable Testing**: Enables reliable testing with a consistent schema

The schema is updated frequently, so having an automated process to keep it current is essential for maintaining the extension's functionality.
