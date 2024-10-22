// esbuild.js
const esbuild = require("esbuild");
const { copy } = require('esbuild-plugin-copy');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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
    try {
        const ctx = await esbuild.context({
            entryPoints: {
                'extension': 'src/extension.ts',
                'webview/webview': 'src/webview/webview.js'
            },
            bundle: true,
            format: 'cjs',
            minify: production,
            sourcemap: true,
            sourcesContent: true,
            platform: 'node',
            outdir: 'dist',
            external: ['vscode'],
            logLevel: 'silent',
            plugins: [
                esbuildProblemMatcherPlugin,
                copy({
                    resolveFrom: 'cwd',
                    assets: [
                        {
                            from: ['./src/viewProviders/templates/html/*.html'],
                            to: ['./dist'],
                        },
                        {
                            from: ['./src/webview/*.css'],
                            to: ['./dist/webview'],
                        }
                    ]
                })
            ],
        });

        if (watch) {
            await ctx.watch();
        } else {
            await ctx.rebuild();
            await ctx.dispose();
        }
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();