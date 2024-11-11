const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    const baseConfig = {
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        logLevel: 'silent',
        plugins: [esbuildProblemMatcherPlugin],
    };

    let configs = [];

    // Main extension build
    if (!test) {
        configs.push({
            ...baseConfig,
            entryPoints: ['src/extension.ts'],
            outfile: 'dist/extension.js',
            external: [
                'vscode',
                'jsonc-parser',
                '@ibm-cloud/platform-services',
                'ibm-cloud-sdk-core'
            ],
        });
    }

    // Test build
    if (test) {
        configs.push({
            ...baseConfig,
            entryPoints: ['src/tests/runTest.ts'],
            outfile: 'out/tests/runTest.js',
            external: ['vscode', 'mocha', 'jsonc-parser'],
        });
    }

    for (const config of configs) {
        const ctx = await esbuild.context(config);
        if (watch) {
            await ctx.watch();
        } else {
            await ctx.rebuild();
            await ctx.dispose();
        }
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});