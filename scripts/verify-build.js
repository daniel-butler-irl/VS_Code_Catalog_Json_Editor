// scripts/verify-build.js
const fs = require('fs');
const path = require('path');

function verifyFile(filePath) {
    try {
        const stats = fs.statSync(filePath);
        console.log(`✅ ${filePath} exists (${stats.size} bytes)`);
        return true;
    } catch (err) {
        console.error(`❌ ${filePath} is missing`);
        return false;
    }
}

function verifyBuild() {
    const projectRoot = path.resolve(__dirname, '..');
    let success = true;

    // Essential files to check
    const requiredFiles = [
        'dist/extension.js',
        'dist/extension.js.map',
        'dist/webview/webview.js',
        'dist/webview/webview.css',
        'media/icon.svg'
    ];

    console.log('Verifying build output...\n');

    // Verify dist folder exists
    const distPath = path.join(projectRoot, 'dist');
    if (!fs.existsSync(distPath)) {
        console.error('❌ dist folder is missing');
        return false;
    }

    // Check each required file
    requiredFiles.forEach(file => {
        if (!verifyFile(path.join(projectRoot, file))) {
            success = false;
        }
    });

    // Verify extension.js content
    const extensionPath = path.join(projectRoot, 'dist', 'extension.js');
    try {
        const content = fs.readFileSync(extensionPath, 'utf8');
        if (!content.includes('activate') || !content.includes('deactivate')) {
            console.error('❌ extension.js appears to be invalid (missing activate/deactivate exports)');
            success = false;
        }
    } catch (err) {
        console.error('❌ Could not read extension.js content');
        success = false;
    }

    if (success) {
        console.log('\n✅ Build verification passed!');
    } else {
        console.error('\n❌ Build verification failed!');
    }

    return success;
}

if (require.main === module) {
    const success = verifyBuild();
    process.exit(success ? 0 : 1);
}

module.exports = verifyBuild;