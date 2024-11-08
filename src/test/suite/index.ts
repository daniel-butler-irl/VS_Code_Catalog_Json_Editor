// src/test/suite/index.ts
import * as path from 'path';
import * as Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        reporter: 'mocha-junit-reporter',
        reporterOptions: {
            mochaFile: './test-results/test-report.xml'
        }
    });

    const testsRoot = path.resolve(__dirname, '.');

    try {
        // Use promisified glob
        const files = await glob('**/**.test.js', { cwd: testsRoot });

        // Add all files to mocha
        files.forEach((f: string) => {
            mocha.addFile(path.resolve(testsRoot, f));
        });

        return new Promise<void>((resolve, reject) => {
            mocha.run(failures => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        });
    } catch (err) {
        console.error(err);
        throw err;
    }
}