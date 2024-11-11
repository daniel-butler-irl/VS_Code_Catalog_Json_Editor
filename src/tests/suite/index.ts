import path from 'path';
import Mocha from 'mocha';  // Changed to default import
import { glob } from 'glob';

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',  // Using TDD interface (suite/test)
        color: true,
        reporter: process.env.CI ? 'mocha-junit-reporter' : 'spec',
        reporterOptions: {
            mochaFile: path.resolve(__dirname, '../../../test-results/test-report.xml')
        }
    });

    const testsRoot = path.resolve(__dirname);

    try {
        // Find all test files
        const files = await glob('**/*.test.js', {
            cwd: testsRoot
        });

        // Add files to the test suite
        files.forEach(f => {
            mocha.addFile(path.resolve(testsRoot, f));
        });

        return new Promise<void>((resolve, reject) => {
            mocha.run((failures: number) => {  // Added type for failures
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        });
    } catch (err) {
        throw new Error(`Error loading test files: ${err}`);
    }
}