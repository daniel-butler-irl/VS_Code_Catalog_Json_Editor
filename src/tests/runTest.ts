// src/tests/runTest.ts
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import fs from 'fs';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        const testWorkspacePath = path.resolve(__dirname, '../../test-workspace');
        const testResultsPath = path.resolve(__dirname, '../../test-results');

        // Ensure test results directory exists
        if (!fs.existsSync(testResultsPath)) {
            fs.mkdirSync(testResultsPath, { recursive: true });
        }

        // Configure Mocha options
        process.env.MOCHA_OPTIONS = JSON.stringify({
            reporter: 'mocha-junit-reporter',
            reporterOptions: {
                mochaFile: path.resolve(testResultsPath, 'test-report.xml'),
                useFullSuiteTitle: true,
                outputs: true,
                attachments: true
            }
        });

        // Run the tests
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                testWorkspacePath,
                '--disable-extensions',
                '--disable-gpu'  // Helps with CI environments
            ],
            extensionTestsEnv: {
                VSCODE_DEBUG_MODE: 'true',
                NODE_ENV: 'test',
                FORCE_COLOR: '1',  // Enable colored output
                MOCHA_REPORTER_RETRY_TIME: '5000'  // Give more time for report generation
            }
        });
    } catch (err) {
        console.error('Failed to run tests:', err);

        // Check if test report exists despite failure
        const reportFile = path.resolve(__dirname, '../../test-results/test-report.xml');
        if (fs.existsSync(reportFile)) {
            console.log('Test report was generated despite test failures');
            // Exit with error code but allow CI to collect the report
            process.exit(1);
        } else {
            console.error('No test report was generated');
            process.exit(2);  // Different error code to distinguish report generation failure
        }
    }
}

void main();