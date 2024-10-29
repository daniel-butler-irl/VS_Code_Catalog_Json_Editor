// scripts/copyTestFixtures.js
const fs = require('fs');
const path = require('path');

// Create directories
const fixturesDir = path.join(__dirname, '../out/test/fixtures');
fs.mkdirSync(fixturesDir, { recursive: true });

// Copy test fixtures
const sourceFixture = path.join(__dirname, '../src/test/fixtures/sample-catalog.json');
const targetFixture = path.join(fixturesDir, 'sample-catalog.json');
fs.copyFileSync(sourceFixture, targetFixture);

console.log('Test fixtures copied successfully.');
