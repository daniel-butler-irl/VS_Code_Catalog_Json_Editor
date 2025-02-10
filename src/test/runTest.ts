import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import * as fs from 'fs';
import { execSync } from 'child_process';

async function main() {
  try {
    // Kill any existing VS Code instances
    try {
      execSync('taskkill /F /IM Code.exe 2>nul');
      execSync('taskkill /F /IM "Code - Insiders.exe" 2>nul');
    } catch (e) {
      // Ignore errors if processes don't exist
    }

    // Clean up test directories
    const testDirs = ['.vscode-test', 'out/test-workspace', 'out/test-results'];
    for (const dir of testDirs) {
      const dirPath = path.resolve(__dirname, '../../', dir);
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    }

    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to the extension test runner script
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Create test workspace if it doesn't exist
    const testWorkspacePath = path.resolve(__dirname, '../../test-workspace');
    if (!fs.existsSync(testWorkspacePath)) {
      fs.mkdirSync(testWorkspacePath, { recursive: true });
    }

    // Create test results directory if it doesn't exist
    const testResultsPath = path.resolve(__dirname, '../../test-results');
    if (!fs.existsSync(testResultsPath)) {
      fs.mkdirSync(testResultsPath, { recursive: true });
    }

    // Run the tests
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspacePath,
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-telemetry',
        '--disable-workspace-trust',
        '--user-data-dir=.vscode-test/user-data'
      ],
      extensionTestsEnv: {
        VSCODE_DEBUG_MODE: 'true',
        NODE_ENV: 'test',
        FORCE_COLOR: '1',
        NODE_OPTIONS: '--force-node-api-uncaught-exceptions-policy=true'
      }
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main(); 