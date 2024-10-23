// scripts/build.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distPath = path.join(__dirname, '..', 'dist');
const webviewPath = path.join(distPath, 'webview');

// Ensure dist directory exists
if (!fs.existsSync(distPath)) {
  fs.mkdirSync(distPath);
}

// Ensure webview directory exists
if (!fs.existsSync(webviewPath)) {
  fs.mkdirSync(webviewPath);
}

// Clean dist directory
console.log('Cleaning dist directory...');
fs.readdirSync(distPath).forEach(file => {
  const filePath = path.join(distPath, file);
  if (file !== 'webview') {
    if (fs.lstatSync(filePath).isDirectory()) {
      fs.rmdirSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
  }
});

// Clean webview directory
console.log('Cleaning webview directory...');
fs.readdirSync(webviewPath).forEach(file => {
  const filePath = path.join(webviewPath, file);
  if (fs.lstatSync(filePath).isDirectory()) {
    fs.rmdirSync(filePath, { recursive: true });
  } else {
    fs.unlinkSync(filePath);
  }
});

console.log('Running webpack builds...');
try {
  execSync('webpack --config webpack.config.js', { stdio: 'inherit' });
  execSync('webpack --config webpack.webview.config.js', { stdio: 'inherit' });
  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}