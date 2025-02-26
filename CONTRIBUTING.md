# Contributing to IBM Catalog JSON Editor

Thank you for your interest in contributing to the IBM Catalog JSON Editor extension! This document provides guidelines and information for developers who want to contribute to the project.

## Development Setup

1. **Prerequisites**
   - Node.js (LTS version recommended)
   - Visual Studio Code
   - Git
   - TypeScript knowledge
   - VS Code Extension API knowledge

2. **Local Development**

   ```bash
   # Clone the repository
   git clone https://github.com/daniel-butler-irl/VS_Code_Catalog_Json_Editor.git
   cd VS_Code_Catalog_Json_Editor

   # Install dependencies
   npm install

   # Build the extension
   npm run compile

   # Watch for changes during development
   npm run watch
   ```

3. **Running Tests**

   ```bash
   # Run all tests
   npm test

   # Run specific test suite
   npm run test:unit
   npm run test:integration
   ```

## Project Structure

```plaintext
src/
├── services/          # Core services and business logic
├── providers/         # VS Code providers (TreeProvider, etc.)
├── models/           # Data models and interfaces
├── types/            # TypeScript type definitions
├── utils/            # Utility functions
├── webview/          # Webview implementations
└── extension.ts      # Extension entry point
```

## Coding Guidelines

1. **TypeScript Best Practices**
   - Use strict type checking
   - Avoid `any` types
   - Document public APIs with JSDoc comments
   - Use early returns and guard clauses
   - Keep functions small and focused

2. **VS Code Extension Guidelines**
   - Follow VS Code Extension API best practices
   - Use proper activation events
   - Handle disposables correctly
   - Implement proper error handling
   - Use appropriate VS Code APIs

3. **Performance Considerations**
   - Implement caching where appropriate
   - Use debouncing for frequent operations
   - Avoid blocking the main thread
   - Lazy load resources when possible
   - Profile performance-critical code

4. **Testing Requirements**
   - Write unit tests for core functionality
   - Include integration tests for VS Code interactions
   - Add performance tests for critical paths
   - Maintain test coverage above 80%

## Release Process

### Version Management

Follow semantic versioning (MAJOR.MINOR.PATCH) with an odd/even strategy:

- **MAJOR**: Breaking changes
- **MINOR**:
  - Even numbers (x.2.x, x.4.x) for stable releases
  - Odd numbers (x.1.x, x.3.x) for preview releases
- **PATCH**: Bug fixes (backward compatible)

Example version sequence:

```plaintext
1.1.0 (preview) -> 1.1.1 (preview) -> 1.2.0 (stable) -> 1.3.0 (preview) -> 1.4.0 (stable)
```

### Creating Releases

#### Stable Releases

1. **Preparation**
   - Ensure all tests pass
   - Update CHANGELOG.md
   - Update version in package.json (even minor version)
   - Set `"preview": false` in package.json

2. **Release Process**

   ```bash
   # Create release branch
   git checkout -b release/v1.2.0

   # Commit changes
   git add package.json CHANGELOG.md
   git commit -m "chore(release): prepare v1.2.0"

   # Push and create PR
   git push origin release/v1.2.0
   ```

3. **After PR Approval**
   - Merge to main
   - GitHub Action will:
     - Validate version increment
     - Generate changelog
     - Create GitHub release
     - Publish to VS Code Marketplace

#### Preview Releases

1. **Preparation**
   - Update version in package.json (odd minor version)
   - Set `"preview": true` in package.json
   - Update CHANGELOG.md

2. **Release Process**

   ```bash
   # Create preview branch
   git checkout -b releases/v1.3.0-preview

   # Commit changes
   git add package.json CHANGELOG.md
   git commit -m "chore(prerelease): prepare v1.3.0-preview"

   # Push branch
   git push origin releases/v1.3.0-preview
   ```

3. **Automated Process**
   - GitHub Action will:
     - Detect preview flag
     - Create GitHub pre-release
     - Publish to VS Code Marketplace as preview

### Pre-release Notes

Pre-releases in the VS Code Marketplace:

- Are marked as preview versions
- Can be installed alongside stable versions
- Help test new features before stable release
- Are not automatically updated for users on stable versions

### Version Guidelines

The preview flag in package.json must be:

- `true` for odd minor versions (pre-releases)
- `false` for even minor versions (stable releases)

This strategy ensures:

- Clear distinction between preview and stable releases
- Smooth upgrade path from preview to stable
- Compatibility with VS Code's extension versioning requirements

## Pull Request Guidelines

1. **Branch Naming**
   - Feature: `feature/description`
   - Bug fix: `fix/issue-description`
   - Release: `release/vX.Y.Z`
   - Preview: `releases/vX.Y.Z-preview`

2. **Commit Messages**
   Follow Conventional Commits:

   ```plaintext
   type(scope): description

   [optional body]

   [optional footer]
   ```

   Types:
   - feat: New feature
   - fix: Bug fix
   - docs: Documentation
   - style: Formatting
   - refactor: Code restructuring
   - test: Tests
   - chore: Maintenance

3. **PR Requirements**
   - Reference related issues
   - Include test coverage
   - Update documentation
   - Add changelog entry
   - Pass all checks

## Documentation

1. **Code Documentation**
   - Use JSDoc for public APIs
   - Document complex algorithms
   - Include usage examples
   - Explain non-obvious code

2. **Extension Documentation**
   - Update README.md for user-facing changes
   - Maintain CHANGELOG.md
   - Document new features
   - Include screenshots for UI changes

## Support

For development questions:

1. Check existing issues
2. Review documentation
3. Open a new issue with [DEV] prefix

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
