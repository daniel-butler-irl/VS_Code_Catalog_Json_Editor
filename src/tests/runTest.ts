import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to the extension test script
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // Create test workspace for tests that need workspace context
        const testWorkspacePath = path.resolve(__dirname, '../../test-workspace');

        // Download VS Code, unzip it, and run the integration test
        await runTests({
            // Use insiders or specific version when needed:
            // version: '1.87.0' or 'insiders'
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                testWorkspacePath,
                // Disable other extensions to avoid interference
                '--disable-extensions',
                // Add any additional CLI flags needed
            ],
            extensionTestsEnv: {
                // Add environment variables for tests
                VSCODE_DEBUG_MODE: 'true',
                NODE_ENV: 'test'
            }
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

void main();