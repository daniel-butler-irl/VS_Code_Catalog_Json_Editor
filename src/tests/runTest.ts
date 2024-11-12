// src/tests/runTest.ts
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        const testWorkspacePath = path.resolve(__dirname, '../../test-workspace');

        // Use the Mocha config file explicitly if needed
        process.env.MOCHA_OPTIONS = JSON.stringify({ config: path.resolve(__dirname, '../../.mocharc.json') });

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [testWorkspacePath, '--disable-extensions'],
            extensionTestsEnv: {
                VSCODE_DEBUG_MODE: 'true',
                NODE_ENV: 'test'
            }
        });
    } catch (err) {
        console.error('Failed to run tests:', err);
        process.exit(1);
    }
}

void main();
