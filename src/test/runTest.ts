import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import * as fs from 'fs';
import { execSync } from 'child_process';

/**
 * Cleanup function to handle process termination
 */
function setupCleanup() {
  // Handle normal exits
  process.on('exit', () => {
    cleanup();
  });

  // Handle CTRL+C
  process.on('SIGINT', () => {
    console.log('\nCaught interrupt signal');
    cleanup();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    cleanup();
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    cleanup();
    process.exit(1);
  });
}

/**
 * Cleanup function to remove temporary files and processes
 */
function cleanup() {
  try {
    console.log('Running cleanup...');
    // Kill any remaining VS Code processes
    try {
      execSync('taskkill /F /IM Code.exe 2>nul');
      execSync('taskkill /F /IM "Code - Insiders.exe" 2>nul');
      console.log('Cleaned up VS Code processes');
    } catch (e) {
      // Ignore errors if processes don't exist
    }

    // Clean up test directories
    const testDirs = ['.vscode-test', 'out/test-workspace', 'out/test-results'];
    for (const dir of testDirs) {
      const dirPath = path.resolve(__dirname, '../../', dir);
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`Cleaned up directory: ${dir}`);
      }
    }
  } catch (err) {
    console.error('Error during cleanup:', err);
  }
}

async function main() {
  try {
    console.log('Setting up test environment...');
    // Set up cleanup handlers
    setupCleanup();

    // Clean up before starting
    cleanup();

    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    console.log('Extension development path:', extensionDevelopmentPath);

    // The path to the extension test runner script
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    console.log('Extension tests path:', extensionTestsPath);

    // Create test workspace if it doesn't exist
    const testWorkspacePath = path.resolve(__dirname, '../../test-workspace');
    if (!fs.existsSync(testWorkspacePath)) {
      fs.mkdirSync(testWorkspacePath, { recursive: true });
      console.log('Created test workspace:', testWorkspacePath);
    }

    // Create test results directory if it doesn't exist
    const testResultsPath = path.resolve(__dirname, '../../test-results');
    if (!fs.existsSync(testResultsPath)) {
      fs.mkdirSync(testResultsPath, { recursive: true });
      console.log('Created test results directory:', testResultsPath);
    }

    console.log('Starting VS Code test run...');
    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspacePath,
        '--disable-extensions',
        '--disable-gpu',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-telemetry',
        '--disable-workspace-trust',
        '--user-data-dir=.vscode-test/user-data',
        '--no-sandbox', // Add this to prevent sandbox-related issues
        '--disable-dev-shm-usage' // Add this to prevent shared memory issues
      ]
    });

    console.log('Test run completed successfully');
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

// Handle errors in the main process
main().catch(err => {
  console.error('Failed to run tests:', err);
  cleanup();
  process.exit(1);
}); 