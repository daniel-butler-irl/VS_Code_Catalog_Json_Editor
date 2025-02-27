/**
 * SVG to PNG Converter for IBM Catalog Tools Extension
 * 
 * This script converts the SVG icon to PNG format for use as the VS Code extension icon.
 * VS Code requires PNG format for extension icons in the marketplace.
 * 
 * Usage:
 *   - Run directly: node svg-to-png.js
 *   - Run as npm script: npm run update-icon
 * 
 * The script will:
 *   1. Read the SVG file from media/catalog-icon.svg
 *   2. Convert it to a 128x128 PNG file
 *   3. Save the PNG file to media/catalog-icon.png
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Input and output file paths
const svgPath = path.join(__dirname, 'media', 'catalog-icon.svg');
const pngPath = path.join(__dirname, 'media', 'catalog-icon.png');

// Ensure the source SVG exists
if (!fs.existsSync(svgPath)) {
  console.error(`Error: Source SVG file not found at ${svgPath}`);
  process.exit(1);
}

// Read the SVG file
const svgBuffer = fs.readFileSync(svgPath);

// Convert to PNG with 128x128 dimensions (matching the SVG viewBox)
sharp(svgBuffer)
  .resize(128, 128)
  .png()
  .toFile(pngPath)
  .then(() => {
    console.log(`Successfully converted ${svgPath} to ${pngPath}`);
    console.log('The icon has been updated. Use "npm run package" to update the extension package.');
  })
  .catch(err => {
    console.error('Error converting SVG to PNG:', err);
    process.exit(1);
  }); 