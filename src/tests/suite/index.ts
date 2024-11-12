// src/tests/suite/index.ts
import path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';
import fs from 'fs';

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',  // Use TDD syntax
        color: true,
        reporter: process.env.CI ? 'mocha-junit-reporter' : 'spec',
        reporterOptions: {
            mochaFile: path.resolve(__dirname, '../../../test-results/test-report.xml')
        }
    });

    const testsRoot = path.resolve(__dirname);

    try {
        const files = await glob('**/*.test.js', { cwd: testsRoot });
        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

        return new Promise<void>((resolve, reject) => {
            mocha.run((failures: number) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    console.log("All tests passed!");
                    resolve();
                }
            });
        });
    } catch (err) {
        throw new Error(`Error loading test files: ${err}`);
    } finally {
        // Check if report file was created
        const reportFile = path.resolve(__dirname, '../../../test-results/test-report.xml');
        if (fs.existsSync(reportFile)) {
            console.log(`Test report generated at ${reportFile}`);
        } else {
            console.error("Failed to generate test report.");
        }
    }
}
