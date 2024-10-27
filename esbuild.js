// esbuild.js
const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const baseConfig = {
  logLevel: 'info',
  bundle: true,
  minify: false,
  sourcemap: true,
  platform: 'node'
};

// Main extension build config
const mainConfig = {
  ...baseConfig,
  entryPoints: ['./src/extension.ts'],
  outfile: 'dist/extension.js',
  format: 'cjs',
  external: [
    'vscode',
    '@ibm-cloud/platform-services/catalog-management/v1',
    'ibm-cloud-sdk-core',
    'jsonpath',
    'esprima',
    'fs',
    'path'
  ]
  // Removed plugins
};

// Webview build config
const webviewConfig = {
  ...baseConfig,
  platform: 'browser',
  entryPoints: {
    'webview': './src/webview/webview.js',
    'modules/logger': './src/webview/modules/logger.js',
    'modules/jsonRenderer': './src/webview/modules/jsonRenderer.js',
    'modules/messageHandler': './src/webview/modules/messageHandler.js',
    'modules/modalManager': './src/webview/modules/modalManager.js',
    'modules/stateManager': './src/webview/modules/stateManager.js'
  },
  outdir: 'dist/webview',
  format: 'esm',
  loader: {
    '.css': 'copy'
  }
};

async function buildAll() {
  try {
    // Clean dist directory
    require('fs').rmSync('dist', { recursive: true, force: true });
    require('fs').mkdirSync('dist', { recursive: true });
    require('fs').mkdirSync('dist/webview/modules', { recursive: true });

    if (watch) {
      console.log('Starting watch mode...');
      const mainCtx = await esbuild.context(mainConfig);
      const webviewCtx = await esbuild.context(webviewConfig);

      await Promise.all([
        mainCtx.watch(),
        webviewCtx.watch()
      ]);
      console.log('Watching for changes...');
    } else {
      console.log('Building extension...');
      await esbuild.build(mainConfig);
      console.log('Building webview...');
      await esbuild.build(webviewConfig);

      // Copy CSS file
      const fs = require('fs');
      fs.copyFileSync(
        path.join(__dirname, 'src/webview/webview.css'),
        path.join(__dirname, 'dist/webview/webview.css')
      );

      console.log('Build complete!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildAll();
