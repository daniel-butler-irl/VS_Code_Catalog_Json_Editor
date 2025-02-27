// src/tests/suite/index.ts
import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        reporter: 'spec',
        timeout: 60000,
        slow: 1000,
        bail: false,
        fullTrace: true
    });

    // Enable debug output
    process.env.DEBUG = '*';

    const testsRoot = path.resolve(__dirname, '..');

    return new Promise((resolve, reject) => {
        console.log('Finding test files in:', testsRoot);

        glob('**/**.test.js', { cwd: testsRoot })
            .then((files: string[]) => {
                console.log('Found test files:', files);

                // Add files to the test suite
                files.forEach((f: string) => {
                    console.log('Adding test file:', f);
                    mocha.addFile(path.resolve(testsRoot, f));
                });

                console.log('Starting test execution...');

                try {
                    // Run the mocha test
                    mocha.run((failures: number) => {
                        if (failures > 0) {
                            reject(new Error(`${failures} tests failed.`));
                        } else {
                            resolve();
                        }
                    }).on('test', (test: Mocha.Test) => {
                        console.log('Running test:', test.title);
                    }).on('test end', (test: Mocha.Test) => {
                        console.log('Test completed:', test.title, test.state);
                    }).on('suite', (suite: Mocha.Suite) => {
                        console.log('Starting suite:', suite.title);
                    }).on('suite end', (suite: Mocha.Suite) => {
                        console.log('Completed suite:', suite.title);
                    }).on('fail', (test: Mocha.Test, err: Error) => {
                        console.error('Test failed:', test.title);
                        console.error('Error:', err);
                    });
                } catch (err) {
                    console.error('Failed to run tests:', err);
                    reject(err);
                }
            })
            .catch((err: Error) => {
                console.error('Error finding test files:', err);
                reject(err);
            });
    });
}
