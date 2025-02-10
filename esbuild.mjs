import * as esbuild from 'esbuild';
import { copy } from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const baseConfig = {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  external: [
    'vscode',
    '@ibm-cloud/platform-services',
    'ibm-cloud-sdk-core',
    'jsonc-parser',
    'semver'
  ],
  format: 'cjs',
  platform: 'node',
  target: ['node16'],
  outfile: 'dist/extension.js',
  sourcemap: true,
  sourcesContent: false,
  loader: {
    '.json': 'json'
  },
  mainFields: ['module', 'main'],
  metafile: true,
  define: {
    'process.env.NODE_ENV': '"production"'
  }
};

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

async function copyMediaFiles() {
  try {
    await copy('media', 'dist/media');
    console.log('Media files copied successfully');
  } catch (err) {
    console.error('Error copying media files:', err);
  }
}

async function buildExtension() {
  try {
    // Ensure dist directory exists and is clean
    await copy('media', 'dist/media', { overwrite: true });
    
    if (watch) {
      const ctx = await esbuild.context({
        ...baseConfig,
        minify
      });
      
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      const result = await esbuild.build({
        ...baseConfig,
        minify
      });
      
      if (result.metafile) {
        console.log('Build completed successfully');
        // Optionally analyze the build
        const text = await esbuild.analyzeMetafile(result.metafile);
        console.log(text);
      }
    }
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

buildExtension(); 