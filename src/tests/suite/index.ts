// src/tests/suite/index.ts
import path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';
import fs from 'fs';

export async function run(): Promise<void> {
    // Ensure test results directory exists
    const testResultsDir = path.resolve(__dirname, '../../../test-results');
    if (!fs.existsSync(testResultsDir)) {
        fs.mkdirSync(testResultsDir, { recursive: true });
    }

    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        reporter: 'mocha-junit-reporter',
        reporterOptions: {
            mochaFile: path.resolve(testResultsDir, 'test-report.xml'),
            useFullSuiteTitle: true,
            outputs: true, // Ensures the report is written even if tests fail
            attachments: true, // Include attachments in report
            testCaseSwitchClassnameAndName: true // More readable test names
        }
    });

    const testsRoot = path.resolve(__dirname);

    try {
        const files = await glob('**/*.test.js', { cwd: testsRoot });

        // Add all test files
        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

        // Run tests and handle results
        return new Promise<void>((resolve, reject) => {
            try {
                const runner = mocha.run((failures: number) => {
                    // Give time for the reporter to write the file
                    setTimeout(() => {
                        if (failures > 0) {
                            reject(new Error(`${failures} tests failed.`));
                        } else {
                            console.log("All tests passed!");
                            resolve();
                        }
                    }, 1000);
                });

                // Handle runner events for better reporting
                runner.on('end', () => {
                    // Verify report was generated
                    const reportFile = path.resolve(testResultsDir, 'test-report.xml');
                    if (fs.existsSync(reportFile)) {
                        console.log(`Test report generated at ${reportFile}`);
                        try {
                            const reportContent = fs.readFileSync(reportFile, 'utf8');
                            if (!reportContent.trim()) {
                                console.error("Warning: Test report file is empty");
                            }
                        } catch (err) {
                            console.error("Error reading test report:", err);
                        }
                    } else {
                        console.error("Failed to generate test report at expected location.");
                    }
                });

                // Log test failures for debugging
                runner.on('fail', (test, err) => {
                    console.error(`Test failed: ${test.fullTitle()}`);
                    console.error(err.stack || err.message);
                });
            } catch (err) {
                console.error("Error during test execution:", err);
                reject(err);
            }
        });
    } catch (err) {
        console.error("Error loading or running tests:", err);
        throw err;
    }
}
