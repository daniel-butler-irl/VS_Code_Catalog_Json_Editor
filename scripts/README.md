# Build Scripts

This directory contains utility scripts for the build and development process.

## update-schema.js

This script downloads the latest IBM Catalog JSON schema from GitHub and saves it to `resources/schema.json`. 
The schema is automatically updated during build time via the npm scripts:

- `npm run update-schema` - Manually update the schema
- `npm run build` - Automatically updates the schema before building
- `npm run vscode:prepublish` - Automatically updates the schema before packaging for publication

### Why This Exists

The schema is downloaded at runtime when the extension is used, but we also bundle a copy in the extension for these reasons:

1. **Offline Functionality**: Provides validation even when users are offline
2. **Faster Initial Experience**: Users don't have to wait for a download when first using the extension
3. **Reliability**: Acts as a fallback when download fails
4. **Integration Testing**: Provides a consistent schema for tests

### How It Works

1. Downloads from the same URL that's used at runtime
2. Creates the resources directory if it doesn't exist
3. Saves the schema as JSON with proper formatting
4. Exits with code 0 for success, 1 for failure (to integrate with build pipelines)

## copyTestFixtures.js

Script to copy test fixtures for use in tests. 