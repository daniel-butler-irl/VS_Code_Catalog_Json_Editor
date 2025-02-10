// src/tests/suite/index.ts
import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        timeout: 60000, // Increased timeout for VS Code extension tests
        retries: 1,     // Allow one retry for flaky tests
        slow: 1000,     // Mark tests as slow if they take more than 1s
        reporter: 'spec'
    });

    const testsRoot = path.resolve(__dirname, '.');

    try {
        // Find all test files
        const files = await glob('**/*.test.{js,ts}', { cwd: testsRoot });

        // Log test discovery info
        console.log('Found test files:', files);

        // Add files to the test suite
        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

        // Run the tests
        return new Promise<void>((resolve, reject) => {
            try {
                // Register the BDD interface globally
                require('mocha/lib/interfaces/bdd');

                mocha.run((failures: number) => {
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed.`));
                    } else {
                        resolve();
                    }
                });
            } catch (err) {
                console.error('Error running tests:', err);
                reject(err);
            }
        });
    } catch (err) {
        console.error('Error finding test files:', err);
        throw err;
    }
}
