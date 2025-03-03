import * as esbuild from 'esbuild';
import { copy } from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');
const sourcemap = !production;

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

const baseConfig = {
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap,
    sourcesContent: sourcemap,
    platform: 'node',
    mainFields: ['module', 'main'],
    resolveExtensions: ['.ts', '.js'],
    conditions: ['node', 'import', 'require'],
    logLevel: production ? 'info' : 'warning',

    plugins: [esbuildProblemMatcherPlugin],
    external: [
        'vscode',
        'fs',
        'fs/promises',
        'path',
        'os',
        'crypto',
        'util',
        'child_process',
        'http',
        'https',
        'url',
        'net',
        'tls',
        'zlib',
        'events',
        'stream',
        'buffer',
        'assert',
        'async_hooks'
    ],
    define: {
        'process.env.NODE_ENV': production ? '"production"' : '"development"',
        'global': 'globalThis'
    },
    treeShaking: true,
    splitting: false,
    metafile: true,
    target: ['node18'],
    banner: {
        js: '(() => { try { require("source-map-support").install() } catch(err) { console.warn("source-map-support is not available") } })();'
    },
    tsconfig: './tsconfig.json',
    resolveExtensions: ['.ts', '.js'],
    conditions: ['node', 'import', 'require'],
    alias: {
        '@services': './src/services',
        '@models': './src/models',
        '@utils': './src/utils',
        '@types': './src/types'
    }
};

async function copyAssets() {
    try {
        // Only copy assets for main extension build
        if (!test) {
            await copy('media', 'dist/media', { overwrite: true }).catch(() => {});
            await copy('schemas', 'dist/schemas', { overwrite: true }).catch(() => {});
            await copy('resources', 'dist/resources', { overwrite: true }).catch(() => {});
            console.log('Assets copied successfully');
        }
    } catch (err) {
        console.error('Warning: Error copying assets:', err);
        // Don't throw - allow build to continue even if assets are missing
    }
}

async function buildExtension() {
    try {
        await copyAssets();

        let configs = [];

        // Main extension build
        if (!test) {
            configs.push({
                ...baseConfig,
                entryPoints: ['src/extension.ts'],
                outfile: 'dist/extension.js',
                external: baseConfig.external,
                bundle: true,
                platform: 'node',
                metafile: true,
                loader: {
                    '.node': 'file'
                },
                define: {
                    'process.env.NODE_ENV': production ? '"production"' : '"development"'
                }
            });
        }

        // Test build
        if (test) {
            configs.push({
                ...baseConfig,
                entryPoints: ['src/test/runTest.ts'],
                outfile: 'out/test/runTest.js',
                external: ['vscode', 'mocha', 'chai', 'sinon'],
            });
        }

        for (const config of configs) {
            const ctx = await esbuild.context(config);
            if (watch) {
                await ctx.watch();
                console.log(`Watching ${config.entryPoints[0]}...`);
            } else {
                const result = await ctx.rebuild();
                if (result.metafile) {
                    const text = await esbuild.analyzeMetafile(result.metafile);
                    console.log(text);
                }
                await ctx.dispose();
            }
        }
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
}

buildExtension();