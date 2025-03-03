// @ts-check
/// <reference path="../src/types/catalog/prerelease.ts" />
/// <reference path="../src/types/ibmCloud/index.ts" />

(function() {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const state = vscode.getState() || { selectedCatalogId: '' };

    let currentBranch = '';
    let lastBranch = '';
    let lastReleases = [];
    let catalogDetails = null;
    let availableCatalogs = [];
    let hasErrors = false;
    let hasUnpushedChanges = false;
    let isMainOrMaster = false;
    let branchCheckInterval;
    let currentTimeoutId = null;
    let lastCheckedTimestamp = null;
    let isCacheUsed = false;
    let isGithubAuthenticated = false;
    let isCatalogAuthenticated = false;
    let loadingState = false;
    let loadingMessage = '';
    let githubReleases = [];
    let isReleaseInProgress = false;

    // DOM Elements
    const loadingView = /** @type {HTMLElement} */ (document.getElementById('loadingView'));
    const mainContainer = /** @type {HTMLElement} */ (document.getElementById('mainContainer'));
    const errorContainer = /** @type {HTMLElement} */ (document.getElementById('errorContainer'));
    const mainContent = /** @type {HTMLElement} */ (document.getElementById('mainContent'));
    const postfixInput = /** @type {HTMLInputElement} */ (document.getElementById('postfix'));
    const versionInput = /** @type {HTMLInputElement} */ (document.getElementById('version'));
    const githubBtn = /** @type {HTMLButtonElement} */ (document.getElementById('githubBtn'));
    const catalogBtn = /** @type {HTMLButtonElement} */ (document.getElementById('catalogBtn'));
    const catalogDetailsDiv = document.getElementById('catalogDetails');
    const catalogSelect = /** @type {HTMLSelectElement} */ (document.getElementById('catalogSelect'));
    const getLatestBtn = /** @type {HTMLButtonElement} */ (document.getElementById('getLatestBtn'));

    // Add event listeners once at the start
    if (githubBtn) {
        githubBtn.addEventListener('click', () => handleCreateClick('github'));
    }
    if (catalogBtn) {
        catalogBtn.addEventListener('click', () => handleCreateClick('catalog'));
    }
    if (getLatestBtn) {
        getLatestBtn.addEventListener('click', handleGetLatestClick);
    }
    if (postfixInput) {
        postfixInput.addEventListener('input', updateTagPreview);
    }
    if (versionInput) {
        versionInput.addEventListener('input', updateTagPreview);
    }
    if (catalogSelect) {
        catalogSelect.addEventListener('change', handleCatalogSelect);
    }

    // Initialize UI and start polling
    initializeUI();
    
    // Initial data fetch
    postValidatedMessage({ command: 'getBranchName' });
    postValidatedMessage({ command: 'checkAuthentication' });

    // Set up polling for branch name and auth status
    branchCheckInterval = setInterval(() => {
        if (!isReleaseInProgress) {
            postValidatedMessage({ command: 'getBranchName' });
            
            // Only check authentication if we haven't checked recently
            const now = Date.now();
            if (!lastCheckedTimestamp || now - lastCheckedTimestamp > 60000) { // Check every minute
                lastCheckedTimestamp = now;
                postValidatedMessage({ command: 'checkAuthentication' });
            }
        }
    }, 5000);

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        if (!message || !message.command) {
            console.warn('Received invalid message:', message);
            return;
        }

        try {
            switch (message.command) {
                case 'updateBranchName':
                    updateBranchName(message.branch);
                    break;
                case 'updateData':
                    handleDataUpdate(message);
                    break;
                case 'refreshComplete':
                    handleRefreshComplete(message);
                    break;
                case 'showError':
                    handleError(message.error);
                    break;
                case 'updateGitHubDetails':
                    handleGitHubDetailsUpdate(message);
                    break;
                case 'updateCatalogDetails':
                    handleCatalogDetailsUpdate(message);
                    break;
                case 'updateNextVersion':
                    handleNextVersionUpdate(message);
                    break;
                case 'releaseComplete':
                    handleReleaseComplete(message.success, message.error, message.cancelled);
                    break;
                case 'setLoadingState':
                    handleSetLoadingState(message.message);
                    break;
                case 'updateAuthStatus':
                    updateAuthStatus(message);
                    break;
                case 'updateUnpushedChanges':
                    handleUnpushedChanges(message.hasUnpushedChanges);
                    break;
                default:
                    console.warn('Unknown message command:', message.command);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            showError('An error occurred while processing the response');
        }
    });

    function initializeUI() {
        // Show initial loading state
        if (loadingView) {
            loadingView.style.display = 'flex';
            const loadingText = loadingView.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = 'Initializing Pre-Release Manager...';
            }
        }
        if (mainContainer) {
            mainContainer.style.display = 'none';
        }
        
        // Initialize inputs - version should be enabled from start
        if (versionInput) {
            versionInput.disabled = false;
            versionInput.placeholder = 'Enter version number';
        }

        // Postfix should be enabled from start and not depend on catalog
        if (postfixInput) {
            postfixInput.disabled = false;
            postfixInput.placeholder = 'Loading branch name...';
        }

        // Catalog select should always be enabled
        if (catalogSelect) {
            catalogSelect.disabled = false;
            catalogSelect.innerHTML = '<option value="">Select a catalog...</option>';
        }

        // Show initial states for sections
        if (catalogDetailsDiv) {
            catalogDetailsDiv.innerHTML = '<p class="empty-state">Please select a catalog to view its details</p>';
        }

        // Initialize auth status display
        const githubStatus = document.getElementById('githubAuthStatus');
        const catalogStatus = document.getElementById('catalogAuthStatus');
        const githubAuthText = githubStatus?.querySelector('.auth-text');
        const catalogAuthText = catalogStatus?.querySelector('.auth-text');
        
        if (githubAuthText) {
            githubAuthText.textContent = 'GitHub: Checking...';
        }
        if (catalogAuthText) {
            catalogAuthText.textContent = 'IBM Cloud: Checking...';
        }

        // Add click handlers for auth buttons
        const githubButton = document.getElementById('githubAuthButton');
        const catalogButton = document.getElementById('catalogAuthButton');

        if (githubButton) {
            githubButton.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'githubAuth',
                    data: { isLoggedIn: isGithubAuthenticated }
                });
            });
        }

        if (catalogButton) {
            catalogButton.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'catalogAuth',
                    data: { isLoggedIn: isCatalogAuthenticated }
                });
            });
        }
    }

    function showLoading(message = 'Loading...') {
        if (loadingView) {
            const loadingText = loadingView.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = message;
            }
            loadingView.style.display = 'flex';
        }
        if (mainContainer) {
            mainContainer.style.display = 'none';
        }
    }

    function hideLoading() {
        if (loadingView) {
            loadingView.style.display = 'none';
        }
        if (mainContainer) {
            mainContainer.style.display = 'block';
        }
    }

    // Clean up interval when window is closed
    window.addEventListener('unload', () => {
        if (branchCheckInterval) {
            clearInterval(branchCheckInterval);
        }
    });

    catalogSelect?.addEventListener('change', () => {
        const selectedCatalogId = catalogSelect.value;
        
        // Save selection in state
        vscode.setState({ ...state, selectedCatalogId: selectedCatalogId });
        
        if (selectedCatalogId) {
            // Show loading state
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '<p class="loading">Loading catalog details...</p>';
            }

            // Set a timeout to show an error if the request takes too long
            const timeoutId = setTimeout(() => {
                if (catalogDetailsDiv) {
                    catalogDetailsDiv.innerHTML = '<p class="error">Request timed out. Please try again.</p>';
                }
            }, 10000); // 10 second timeout

            postValidatedMessage({ 
                command: 'selectCatalog',
                catalogId: selectedCatalogId
            });

            // Store the timeout ID
            currentTimeoutId = timeoutId;
        }
    });

    function handleUpdateData(message) {
        if (!mainContent || !catalogSelect || !versionInput || !postfixInput) {
            console.error('Required elements not found');
            return;
        }
        
        // Update catalog select
        if (message.catalogs && message.catalogs.length > 0) {
            updateAvailableCatalogs(message.catalogs);
        } else {
            catalogSelect.innerHTML = '<option value="">No catalogs available</option>';
        }
        
        // Store releases for later use
        lastReleases = message.releases || [];
        
        // Version input should always be enabled unless on main/master
        if (!isMainOrMaster) {
            versionInput.disabled = false;
            versionInput.placeholder = 'Enter version number';
        }
        
        // Postfix should remain enabled and keep its value
        if (postfixInput && !postfixInput.value && currentBranch) {
            postfixInput.value = `${currentBranch}-beta`;
        }
        postfixInput.disabled = false;
        
        // Update button states
        updateButtonStates();
    }

    function handleRefreshComplete(message) {
        hideLoading();
        if (mainContent) {
            mainContent.classList.remove('loading-state');
        }
        if (getLatestBtn) {
            getLatestBtn.disabled = false;
        }

        // Update local variables if we have new GitHub releases
        if (message && message.githubReleases) {
            console.debug(`Received ${message.githubReleases.length} GitHub releases in refresh complete`);
            
            // Store the releases for later use
            githubReleases = message.githubReleases;
            lastReleases = message.githubReleases;
            
            // Debug: Log the first few releases
            if (message.githubReleases.length > 0) {
                console.debug('Latest GitHub releases after refresh:', 
                    message.githubReleases.slice(0, 3).map(r => ({
                        tag: r.tag_name,
                        created: r.created_at
                    }))
                );
            }
        }

        // Check if we have a recently created version
        const createdVersion = message && message.createdVersion;
        const createdPostfix = message && message.createdPostfix;
        console.debug('Refresh complete with created version:', { createdVersion, createdPostfix });
        
        // If we just created a version, use it to suggest the next one
        if (createdVersion && versionInput) {
            // Extract the base version (semver part)
            const baseVersion = createdVersion.split('-')[0];
            const parts = baseVersion.split('.').map(Number);
            
            // Increment the patch version
            if (parts.length >= 3) {
                parts[2] = parts[2] + 1;
                const nextVersion = parts.join('.');
                versionInput.value = nextVersion;
                console.debug(`Suggesting next version ${nextVersion} after release creation of ${createdVersion}`);
            } else {
                // Clear version input as fallback if version format is unexpected
                console.debug(`Invalid version format ${createdVersion}, falling back to suggestNextVersion()`);
                versionInput.value = '';
                // Let the normal suggestion process run
                suggestNextVersion();
            }
        } else {
            // No created version provided, use normal suggestion logic
            console.debug('No created version provided, using normal version suggestion');
            if (versionInput) {
                versionInput.value = '';
            }
            // Update version suggestion after refresh
            suggestNextVersion();
        }
        
        updateTagPreview();
    }

    function handleError(error) {
        // Instead of showing error, just log it
        console.log('Operation could not be completed:', error);
        
        // Ensure UI stays functional
        if (mainContent) {
            mainContent.classList.remove('loading-state');
        }
        hideLoading();
        
        // Re-enable all controls
        enableAllControls();

        // Update auth status with current state
        updateAuthStatus({
            github: {
                isLoggedIn: isGithubAuthenticated,
                text: `GitHub: ${isGithubAuthenticated ? 'Logged in' : 'Not logged in'}`
            },
            catalog: {
                isLoggedIn: isCatalogAuthenticated,
                text: `IBM Cloud: ${isCatalogAuthenticated ? 'Logged in' : 'Not logged in'}`
            }
        });
    }

    function enableAllControls() {
        // Reset release in progress flag
        isReleaseInProgress = false;

        // Re-enable all interactive elements
        if (catalogSelect) {
            catalogSelect.disabled = false;
        }
        if (versionInput) {
            versionInput.disabled = false;
        }
        if (postfixInput) {
            postfixInput.disabled = false;
        }
        if (githubBtn) {
            githubBtn.disabled = false;
            githubBtn.textContent = 'Create GitHub Pre-Release';
            githubBtn.classList.remove('loading');
        }
        if (catalogBtn) {
            catalogBtn.disabled = false;
            catalogBtn.textContent = 'Import to IBM Cloud Catalog';
            catalogBtn.classList.remove('loading');
        }
        if (getLatestBtn) {
            getLatestBtn.disabled = false;
        }

        // Update button states based on current auth status
        updateButtonStates();
    }

    // Update showError function to not show the red box
    function showError(errorMessage, force = false) {
        // Don't show errors, just log them
        if (errorMessage) {
            console.log('Operation message:', errorMessage);
        }
        
        // Always ensure UI is functional
        if (mainContent) {
            mainContent.classList.remove('has-error');
        }
        enableAllControls();
    }

    /**
     * Updates the branch name and suggests a postfix
     * @param {string} branch
     */
    function updateBranchName(branch) {
        // Update current branch
        currentBranch = branch;

        // Check if on main/master branch
        isMainOrMaster = ['main', 'master'].includes(branch.toLowerCase());

        // Only update postfix if it's empty or matches the previous branch-beta pattern
        if (postfixInput) {
            const suggestedPostfix = `${branch}-beta`;
            const currentValue = postfixInput.value;
            const previousBranchPattern = currentBranch ? `${currentBranch}-beta` : '';
            
            // Only update if empty or matches previous pattern
            if (!currentValue || currentValue === previousBranchPattern) {
                postfixInput.value = suggestedPostfix;
            }
            postfixInput.placeholder = suggestedPostfix;
            updateTagPreview();
        }

        // Handle input states based on branch
        if (isMainOrMaster) {
            if (versionInput) versionInput.disabled = true;
            if (postfixInput) postfixInput.disabled = true;
            if (catalogSelect) catalogSelect.disabled = true;
            showError('Pre-releases cannot be created from main/master branch. Please switch to another branch.');
        } else {
            // Enable all inputs by default
            if (catalogSelect) catalogSelect.disabled = false;
            if (versionInput) versionInput.disabled = false;
            if (postfixInput) postfixInput.disabled = false;
        }

        updateButtonStates();
    }

    /**
     * Updates the catalog details in the UI
     * @param {import('../src/types/catalog/prerelease').CatalogDetails} details
     */
    function updateCatalogDetails(details) {
        // Clear any pending timeout
        if (currentTimeoutId) {
            clearTimeout(currentTimeoutId);
            currentTimeoutId = null;
        }

        // Store catalog details
        catalogDetails = details;

        // Re-enable controls if not on main/master branch
        if (!isMainOrMaster) {
            if (catalogSelect) {catalogSelect.disabled = false;}
            if (versionInput) {versionInput.disabled = false;}
            if (postfixInput) {postfixInput.disabled = false;}
            const refreshButton = /** @type {HTMLButtonElement} */ (document.getElementById('refreshCatalogBtn'));
            if (refreshButton) {refreshButton.disabled = !catalogSelect?.value;}
            updateButtonStates();
        }

        // Don't update catalog details if we don't have a selected catalog
        if (!catalogSelect?.value) {
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '<p class="empty-state">Please select a catalog to view its details</p>';
            }
            // Enable GitHub releases even without catalog
            if (!isMainOrMaster) {
                if (githubBtn) githubBtn.disabled = false;
                if (catalogBtn) catalogBtn.disabled = true; // Disable catalog button when no catalog selected
            }
            return;
        }

        if (!catalogDetailsDiv) {return;}

        // Handle case where offering is not found in catalog
        if (details.offeringNotFound) {
            catalogDetailsDiv.innerHTML = `
                <div class="catalog-info error">
                    <p class="warning-message">The offering "${details.name}" was not found in this catalog.</p>
                    <p>Publishing to this catalog will not be available.</p>
                </div>
            `;
            if (catalogBtn) {
                catalogBtn.disabled = true;
            }
            return;
        }

        const proposedVersion = versionInput?.value;
        const proposedPostfix = postfixInput?.value;
        const githubReleases = lastReleases.map(r => ({
            version: r.tag_name.replace(/^v/, ''),
            tag: r.tag_name
        }));

        // Initial render without versions
        renderCatalogDetails(details, proposedVersion, proposedPostfix, githubReleases, []);

        // Then update versions when they're available
        if (details.versions) {
            /** @type {import('../src/types/catalog/prerelease').CatalogVersion[]} */
            const catalogVersions = details.versions;
            const isVersionInvalid = proposedVersion && catalogVersions.some(v => v.version === proposedVersion);

            if (catalogBtn) {
                catalogBtn.disabled = isVersionInvalid || isMainOrMaster;
            }

            // Only suggest version if input is empty
            if (!versionInput?.value) {
                suggestNextVersion();
                updateTagPreview();
            }

            // Update the version table with the loaded versions
            renderCatalogDetails(details, versionInput?.value || '', proposedPostfix, githubReleases, details.versions);
        }
    }

    /**
     * Renders the catalog details UI
     * @param {import('../src/types/catalog/prerelease').CatalogDetails} details
     * @param {string} proposedVersion
     * @param {string} proposedPostfix
     * @param {Array<{tag: string}>} githubReleases
     * @param {import('../src/types/catalog/prerelease').CatalogVersion[]} catalogVersions
     */
    function renderCatalogDetails(details, proposedVersion, proposedPostfix, githubReleases, catalogVersions) {
        const nextVersionDiv = document.getElementById('nextVersion');
        if (!nextVersionDiv) return;

        // Check if version is already released in catalog or GitHub
        const isVersionReleasedInCatalog = catalogVersions?.some(v => {
            // Extract base version (without postfix) from catalog version
            const catalogBaseVersion = v.version.split('-')[0];
            const baseProposedVersion = proposedVersion.split('-')[0];
            
            // Compare base versions (without postfixes)
            return catalogBaseVersion === baseProposedVersion;
        });
        
        const isVersionReleasedInGithub = githubReleases?.some(r => {
            // Remove 'v' prefix and get base version (without postfix)
            const version = r.tag.replace(/^v/, '');
            const baseVersion = version.split('-')[0]; // Get just the semver part before any postfix
            const baseProposedVersion = proposedVersion.split('-')[0]; // Get proposed version without postfix
            
            // Compare base versions (without postfixes)
            return baseVersion === baseProposedVersion;
        });

        // Get all flavors for the proposed version base
        const baseProposedVersion = proposedVersion.split('-')[0];
        const versionFlavors = catalogVersions
            ?.filter(v => {
                // Compare base versions without postfixes
                const catalogBaseVersion = v.version.split('-')[0];
                return catalogBaseVersion === baseProposedVersion;
            })
            .map(v => v.flavor)
            .filter(f => f);

        nextVersionDiv.innerHTML = `
            <div class="next-version-info">
                <div class="version-row">
                    <div class="version-label">GitHub:</div>
                    <div class="version-content">
                        <span class="version-number">v${proposedVersion}-${proposedPostfix}</span>
                        ${isVersionReleasedInGithub ? '<span class="release-status">(Released)</span>' : ''}
                    </div>
                </div>
                <div class="version-row">
                    <div class="version-label">Catalog:</div>
                    <div class="version-content">
                        <span class="version-number">${proposedVersion}-${proposedPostfix}</span>
                        ${versionFlavors && versionFlavors.length > 0 ? `
                            <div class="flavors-section">
                                <div class="flavors-label">Flavors:</div>
                                ${versionFlavors.map(flavor => `
                                    <div class="flavor-item">
                                        <span>${flavor.label || flavor.name}</span>
                                        <span class="flavor-released">(Released)</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        // Render catalog info
        const catalogDetailsDiv = document.getElementById('catalogDetails');
        if (!catalogDetailsDiv) return;

        if (!details) {
            catalogDetailsDiv.innerHTML = '<p class="empty-state">No catalog details available</p>';
            return;
        }

        if (details.offeringNotFound) {
            catalogDetailsDiv.innerHTML = `
                <div class="catalog-info error">
                    <p class="warning-message">The offering "${details.name}" was not found in this catalog.</p>
                    <p>Publishing to this catalog will not be available.</p>
                </div>
            `;
            if (catalogBtn) {
                catalogBtn.disabled = true;
            }
            return;
        }

        catalogDetailsDiv.innerHTML = `
            <div class="catalog-info">
                <div class="info-row">
                    <span class="info-label">Name:</span>
                    <span class="info-value">${details.name || 'Not set'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Offering ID:</span>
                    <span class="info-value">${details.offeringId || 'Not set'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Label:</span>
                    <span class="info-value">${details.label || 'Not set'}</span>
                </div>
            </div>
        `;

        // Render the versions table
        renderVersionsTable(details, githubReleases);
    }

    // Add semver comparison function
    function semverCompare(a, b) {
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);

        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aVal = aParts[i] || 0;
            const bVal = bParts[i] || 0;
            if (aVal !== bVal) {
                return aVal - bVal;
            }
        }
        return 0;
    }

    /**
     * Updates the available catalogs dropdown
     * @param {Array<{id: string, label: string, shortDescription?: string}>} catalogs
     */
    function updateAvailableCatalogs(catalogs) {
        // Only update if we have new catalogs
        if (!catalogs || !catalogs.length) {
            if (!availableCatalogs.length) {
                showError('No private catalogs available');
            }
            return;
        }

        // Update the stored catalogs
        availableCatalogs = catalogs;

        if (!catalogSelect) {return;}

        // Preserve current selection
        const currentSelection = catalogSelect.value;

        // Update dropdown options
        catalogSelect.innerHTML = '<option value="">Select a catalog...</option>';
        catalogs.forEach(catalog => {
            const option = document.createElement('option');
            option.value = catalog.id;
            option.textContent = catalog.label;
            if (catalog.shortDescription) {
                option.title = catalog.shortDescription;
            }
            catalogSelect.appendChild(option);
        });

        // Restore selection if it still exists in the new catalog list
        if (currentSelection && catalogs.some(c => c.id === currentSelection)) {
            catalogSelect.value = currentSelection;
        }
    }

    /**
     * Handles the unpushed changes state
     * @param {boolean} unpushedChanges 
     */
    function handleUnpushedChanges(unpushedChanges) {
        hasUnpushedChanges = unpushedChanges;
        if (unpushedChanges) {
            showError('Warning: You have unpushed changes in your branch. Please push your changes before creating a release.');
        }
    }

    /**
     * Suggests the next version number based on catalog versions
     */
    function suggestNextVersion() {
        if (!versionInput) {
            return;
        }

        // Only suggest version if the input is empty
        if (versionInput.value) {
            return;
        }

        console.debug('Suggesting next version based on:', {
            catalogVersionsCount: catalogDetails?.versions?.length || 0,
            githubReleasesCount: lastReleases?.length || 0
        });

        // Debug the latest releases
        if (lastReleases && lastReleases.length > 0) {
            console.debug('Latest GitHub releases for suggestion:',
                lastReleases.slice(0, 3).map(r => ({
                    tag: r.tag_name,
                    created: r.created_at,
                    url: r.html_url
                }))
            );
        }
        
        // Try to find the latest version from GitHub releases first (most accurate)
        const githubVersions = Array.from(new Set(lastReleases.map(r => {
            // Remove 'v' prefix and extract base version without postfix
            const version = r.tag_name.replace(/^v/, '');
            return version.split('-')[0]; // Return only the semver part
        })))
        .filter(v => /^\d+\.\d+\.\d+$/.test(v))
        .sort((a, b) => -semverCompare(a, b));

        console.debug('Sorted GitHub versions for suggestion:', githubVersions);

        if (githubVersions.length) {
            const latest = githubVersions[0];
            const baseParts = latest.split('.').map(Number);
            const [major, minor, patch] = baseParts;
            // Create new version with incremented patch
            versionInput.value = `${major}.${minor}.${patch + 1}`;
            console.debug('Suggested next version from GitHub:', versionInput.value);
            return;
        }

        // Fallback to catalog version if GitHub version is not available
        if (catalogDetails?.versions) {
            const catalogVersions = Array.from(new Set(catalogDetails.versions.map(v => {
                // Get only the base version without postfix
                return v.version.split('-')[0];
            })))
            .filter(v => /^\d+\.\d+\.\d+$/.test(v))
            .sort((a, b) => -semverCompare(a, b));

            console.debug('Sorted catalog versions for suggestion:', catalogVersions);

            if (catalogVersions.length) {
                const latest = catalogVersions[0];
                const baseParts = latest.split('.').map(Number);
                const [major, minor, patch] = baseParts;
                // Create new version with incremented patch
                versionInput.value = `${major}.${minor}.${patch + 1}`;
                console.debug('Suggested next version from catalog:', versionInput.value);
                return;
            }
        }

        // If no versions found in either source and not on main/master branch
        if (!isMainOrMaster) {
            showError('First release must be created through the IBM Cloud Catalog interface');
        }
    }

    /**
     * Updates the GitHub tag preview and catalog version preview
     */
    function updateTagPreview() {
        // Update the next versions in the catalog details
        updateCatalogDetails(catalogDetails);
    }

    // Add message validation helper
    function postValidatedMessage(message) {
        if (!message || typeof message !== 'object') {
            console.error('Invalid message structure:', message);
            return;
        }
        if (!message.command || typeof message.command !== 'string') {
            console.error('Message missing command or invalid command type:', message);
            return;
        }
        vscode.postMessage(message);
    }

    // Replace direct vscode.postMessage calls with validated version
    function handleCreateClick(type) {
        if (!versionInput || !postfixInput) return;

        const version = versionInput.value.trim();
        const postfix = postfixInput.value.trim();

        if (!version || !postfix) {
            showError('Please fill in both version and postfix fields.');
            return;
        }

        const data = {
            version,
            postfix,
            publishToCatalog: type === 'catalog',
            releaseGithub: type === 'github',
            catalogId: catalogSelect ? catalogSelect.value : undefined
        };

        postValidatedMessage({
            command: 'createPreRelease',
            data
        });
    }

    // Update other message sending functions
    function handleCatalogSelect() {
        const selectedId = catalogSelect ? catalogSelect.value : '';
        if (selectedId) {
            postValidatedMessage({
                command: 'selectCatalog',
                catalogId: selectedId
            });
        }
    }

    async function handleRefreshClick() {
        const selectedId = catalogSelect ? catalogSelect.value : '';
        postValidatedMessage({
            command: 'forceRefresh',
            catalogId: selectedId
        });
    }

    async function handleGetLatestClick() {
        postValidatedMessage({
            command: 'getBranchName'
        });
    }

    // Add function to update timestamp display
    function updateTimestampDisplay() {
        const timestampDiv = document.getElementById('lastCheckedTimestamp');
        if (!timestampDiv) {return;}

        if (!lastCheckedTimestamp) {
            timestampDiv.innerHTML = 'Last checked: Never';
            return;
        }

        const date = new Date(lastCheckedTimestamp);
        const formattedDate = date.toLocaleString();
        timestampDiv.innerHTML = `Last ${isCacheUsed ? 'cached' : 'checked'}: ${formattedDate}`;
        timestampDiv.title = isCacheUsed ? 'Using cached data' : 'Using fresh data';
    }

    function updateAuthStatus(data) {
        const githubStatus = document.getElementById('githubAuthStatus');
        const catalogStatus = document.getElementById('catalogAuthStatus');
        const githubButton = document.getElementById('githubAuthButton');
        const catalogButton = document.getElementById('catalogAuthButton');
        const githubAuthText = githubStatus?.querySelector('.auth-text');
        const catalogAuthText = catalogStatus?.querySelector('.auth-text');

        if (githubStatus && githubButton && githubAuthText) {
            githubAuthText.textContent = data.github.text;
            githubButton.textContent = data.github.isLoggedIn ? 'Logout' : 'Login';
        }

        if (catalogStatus && catalogButton && catalogAuthText) {
            catalogAuthText.textContent = data.catalog.text;
            catalogButton.textContent = data.catalog.isLoggedIn ? 'Logout' : 'Login';
        }

        isGithubAuthenticated = data.github.isLoggedIn;
        isCatalogAuthenticated = data.catalog.isLoggedIn;
        updateButtonStates();
    }

    function updateButtonStates() {
        const isGitRepo = document.getElementById('github-repo')?.textContent !== 'Not a Git repository';
        const selectedCatalogId = catalogSelect?.value;
        const hasValidVersion = versionInput?.value && versionInput.value.trim() !== '';
        const hasValidPostfix = postfixInput?.value && postfixInput.value.trim() !== '';
        
        // Common condition for all buttons - require catalog selection
        const baseConditions = isGitRepo && selectedCatalogId;
        
        // GitHub button state
        if (githubBtn) {
            githubBtn.disabled = !baseConditions || !isGithubAuthenticated || isMainOrMaster || !hasValidVersion || !hasValidPostfix;
            githubBtn.title = !isGitRepo ? 'Not a Git repository' :
                             !selectedCatalogId ? 'Please select a catalog first' :
                             !isGithubAuthenticated ? 'Please log in to GitHub first' :
                             isMainOrMaster ? 'Cannot create pre-release from main/master branch' :
                             !hasValidVersion ? 'Please enter a version number' :
                             !hasValidPostfix ? 'Please enter a postfix' :
                             'Create a new pre-release';
        }
        
        // Catalog button state
        if (catalogBtn) {
            catalogBtn.disabled = !baseConditions || !isCatalogAuthenticated || !hasValidVersion || !hasValidPostfix;
            catalogBtn.title = !isGitRepo ? 'Not a Git repository' :
                             !selectedCatalogId ? 'Please select a catalog first' :
                             !isCatalogAuthenticated ? 'Please log in to IBM Cloud first' :
                             !hasValidVersion ? 'Please enter a version number' :
                             !hasValidPostfix ? 'Please enter a postfix' :
                             'Import to catalog';
        }
        
        // Get Latest button state
        if (getLatestBtn) {
            getLatestBtn.disabled = !baseConditions || (!isGithubAuthenticated && !isCatalogAuthenticated);
            getLatestBtn.title = !isGitRepo ? 'Not a Git repository' :
                                !selectedCatalogId ? 'Please select a catalog first' :
                                (!isGithubAuthenticated && !isCatalogAuthenticated) ? 'Please log in to GitHub or IBM Cloud first' :
                                'Get latest releases';
        }
        
        // Input fields state
        if (postfixInput) {
            postfixInput.disabled = !isGitRepo || isMainOrMaster || !selectedCatalogId;
            if (!isGitRepo) {
                postfixInput.value = '';
                postfixInput.placeholder = 'Not a Git repository';
            } else if (isMainOrMaster) {
                postfixInput.placeholder = 'Cannot create releases from main/master branch';
            } else if (!selectedCatalogId) {
                postfixInput.placeholder = 'Please select a catalog first';
            } else {
                postfixInput.placeholder = 'Enter postfix';
            }
        }

        // Version input state
        if (versionInput) {
            versionInput.disabled = !isGitRepo || isMainOrMaster || !selectedCatalogId;
            if (!isGitRepo) {
                versionInput.placeholder = 'Not a Git repository';
            } else if (isMainOrMaster) {
                versionInput.placeholder = 'Cannot create releases from main/master branch';
            } else if (!selectedCatalogId) {
                versionInput.placeholder = 'Please select a catalog first';
            } else {
                versionInput.placeholder = 'Enter version number';
            }
        }

        // Update catalog select state
        if (catalogSelect) {
            catalogSelect.disabled = !isGitRepo || isMainOrMaster || !isCatalogAuthenticated;
            catalogSelect.title = !isGitRepo ? 'Not a Git repository' :
                                isMainOrMaster ? 'Cannot create releases from main/master branch' :
                                !isCatalogAuthenticated ? 'Please log in to IBM Cloud first' :
                                'Select a catalog';
        }
    }

    function updateBranchInfo(branchInfo) {
        const branchInfoDiv = document.getElementById('branchInfo');
        if (!branchInfoDiv) return;

        if (!branchInfo || !branchInfo.name) {
            branchInfoDiv.innerHTML = `
                <div class="error">
                    Not in a Git repository or unable to get branch information.
                </div>`;
            return;
        }

        const isMainBranch = branchInfo.name === 'main' || branchInfo.name === 'master';
        const warning = isMainBranch ? 
            '<span class="warning">Cannot create pre-releases from main/master branch</span>' : '';

        branchInfoDiv.innerHTML = `
            <div class="branch-display">
                Current branch: <strong>${branchInfo.name}</strong>${warning}
            </div>`;
    }

    function updateNextVersions(githubNext, catalogNext) {
        const nextVersionDiv = document.querySelector('.next-version');
        if (!nextVersionDiv) return;

        nextVersionDiv.innerHTML = `
            <div class="next-version-info">
                <div class="version-row">
                    <span class="version-label">GitHub:</span>
                    <span class="version-value">${githubNext || 'Not available'}</span>
                </div>
                <div class="version-row">
                    <span class="version-label">Catalog:</span>
                    <span class="version-value">${catalogNext || 'Not available'}</span>
                </div>
            </div>`;
    }

    // Handle loading state changes
    function handleSetLoadingState(message) {
        if (!loadingView || !mainContainer) {
            return;
        }

        const loadingText = loadingView.querySelector('.loading-text');
        const errorText = loadingView.querySelector('.error-text');

        if (message.loading) {
            loadingView.style.display = 'flex';
            if (loadingText) {
                loadingText.textContent = message.message || 'Loading...';
            }
            if (errorText && errorText instanceof HTMLElement) {
                errorText.textContent = '';
                errorText.style.display = 'none';
            }
            mainContainer.style.display = 'none';
        } else {
            loadingView.style.display = 'none';
            mainContainer.style.display = 'block';
            if (message.error && errorText && errorText instanceof HTMLElement) {
                errorText.textContent = message.error;
                errorText.style.display = 'block';
            }
        }
    }

    // Handle GitHub details update
    function handleGitHubDetailsUpdate(message) {
        console.debug('Received GitHub details update:', message);
        
        const repoElement = document.getElementById('github-repo');
        const branchElement = document.getElementById('github-branch');
        
        if (!repoElement || !branchElement) {
            console.warn('GitHub details elements not found in DOM');
            return;
        }

        const isGitRepo = message.repoUrl !== 'Not a Git repository';
        console.debug('Git repository status:', { isGitRepo, repoUrl: message.repoUrl, branch: message.branch });
        
        // Update display values with proper styling and tooltip
        if (isGitRepo) {
            repoElement.innerHTML = `<a href="${message.repoUrl}" class="git-repo-info" target="_blank" title="${message.repoUrl}">${message.repoUrl}</a>`;
            branchElement.textContent = message.branch;
            repoElement.classList.remove('not-git-repo');
            branchElement.classList.remove('not-git-repo');
        } else {
            repoElement.textContent = 'Not a Git repository';
            branchElement.textContent = 'Not a Git repository';
            repoElement.classList.add('not-git-repo');
            branchElement.classList.add('not-git-repo');
        }
        
        // Store current branch for later use
        currentBranch = isGitRepo ? message.branch : '';
        isMainOrMaster = ['main', 'master'].includes(currentBranch.toLowerCase());
        console.debug('Branch status:', { currentBranch, isMainOrMaster });
        
        // Update UI state based on Git repository status
        if (!isGitRepo) {
            console.debug('Disabling Git-related functionality - not a Git repository');
            // Disable Git-related functionality
            if (githubBtn) {
                githubBtn.disabled = true;
                githubBtn.title = 'Not a Git repository';
            }
            if (postfixInput) {
                postfixInput.disabled = true;
                postfixInput.value = '';
                postfixInput.placeholder = 'Not a Git repository';
            }
            if (versionInput) {
                versionInput.disabled = true;
                versionInput.placeholder = 'Not a Git repository';
            }
        }
        
        // Update button states
        updateButtonStates();
        console.debug('GitHub details update complete');
    }

    // Add proper handler for data updates
    function handleDataUpdate(message) {
        if (!mainContent || !catalogSelect || !versionInput || !postfixInput) {
            console.error('Required elements not found');
            return;
        }
        
        // Update catalog select
        if (message.catalogs && message.catalogs.length > 0) {
            updateAvailableCatalogs(message.catalogs);
        } else {
            catalogSelect.innerHTML = '<option value="">No catalogs available</option>';
        }
        
        // Store releases for later use
        lastReleases = message.releases || [];
        
        // Update button states
        updateButtonStates();
    }

    // Add proper handler for catalog details updates
    function handleCatalogDetailsUpdate(message) {
        if (!catalogDetailsDiv) {
            return;
        }
        catalogDetails = message.catalogDetails;
        
        // Clear loading states
        if (mainContent) {
            mainContent.classList.remove('loading-state');
        }
        if (catalogDetailsDiv) {
            // Remove any loading messages
            const loadingElement = catalogDetailsDiv.querySelector('.loading');
            if (loadingElement) {
                loadingElement.remove();
            }
        }
        hideLoading(); // Ensure loading overlay is hidden
        
        // Update the catalog details
        updateCatalogDetails(catalogDetails);
        
        // Re-enable controls
        enableAllControls();
    }

    // Add proper handler for next version updates
    function handleNextVersionUpdate(message) {
        if (versionInput && !versionInput.value) {
            versionInput.value = message.version;
            updateTagPreview();
        }
    }

    // Add version table rendering
    function renderVersionsTable(details, githubReleases) {
        const versionsTable = document.querySelector('.versions-table tbody');
        if (!versionsTable) return;

        if (!details.versions || details.versions.length === 0) {
            versionsTable.innerHTML = `
                <tr>
                    <td colspan="2" class="empty-state">No version history available</td>
                </tr>`;
            return;
        }

        // Create a map of GitHub tags to catalog versions
        const versionMap = new Map();
        details.versions.forEach(version => {
            if (version.githubTag) {
                if (!versionMap.has(version.githubTag)) {
                    versionMap.set(version.githubTag, []);
                }
                versionMap.get(version.githubTag).push(version);
            }
        });

        // Create a set of processed GitHub tags and versions
        const processedTags = new Set();
        const processedVersions = new Set();
        let versionCount = 0;
        let versionsHtml = '';

        // First, process GitHub releases (limited to 5)
        githubReleases.slice(0, 5).forEach(release => {
            if (versionCount >= 5) return;

            const tag = 'tag_name' in release ? release.tag_name : release.tag;
            const catalogEntries = versionMap.get(tag) || [];
            processedTags.add(tag);

            // IMPORTANT: Only remove 'v' prefix, keep the entire postfix (e.g., "-beta", "-alpha")
            const baseVersion = (typeof tag === 'string' ? tag : String(tag)).replace(/^v/, '');
            // Extract postfix if present for display purposes
            const postfix = typeof tag === 'string' && tag.includes('-') ? tag.split('-').slice(1).join('-') : '';
            processedVersions.add(baseVersion);

            const repoUrlElement = document.querySelector('#github-repo .git-repo-info');
            const repoUrl = repoUrlElement?.getAttribute('href');
            const githubUrl = repoUrl && repoUrl !== 'Not a Git repository' ? 
                `${repoUrl}/releases/tag/${tag}` : undefined;
            const releaseDate = 'created_at' in release && typeof release.created_at === 'string' ? 
                new Date(release.created_at).toLocaleDateString() : '';

            versionsHtml += `
                <tr>
                    <td class="github-version">
                        <div class="version-tag ${githubUrl ? 'clickable' : ''}" data-release-url="${githubUrl || ''}">
                            <div class="version-number">${baseVersion}</div>
                            ${postfix ? `<div class="version-flavor">${postfix}</div>` : ''}
                            ${releaseDate ? `<div class="release-date">${releaseDate}</div>` : ''}
                        </div>
                    </td>
                    <td class="catalog-version">
                        ${catalogEntries.length > 0 ? 
                            catalogEntries.map(entry => {
                                const flavorName = entry.flavor?.name || 'Unknown';
                                const flavorLabel = entry.flavor?.label || flavorName;
                                return `
                                    <div class="version-tag" title="${entry.tgz_url || ''}">
                                        <div class="version-number">${entry.version}</div>
                                        <div class="version-flavor">${flavorLabel} (${flavorName})</div>
                                    </div>
                                `;
                            }).join('') :
                            `<div class="version-tag not-published">
                                <div class="version-number">Not published</div>
                            </div>`
                        }
                    </td>
                </tr>`;
            versionCount++;
        });

        versionsTable.innerHTML = versionsHtml || `
            <tr>
                <td colspan="2" class="empty-state">No version history available</td>
            </tr>`;

        // Add click handlers for GitHub release links
        const releaseLinks = document.querySelectorAll('.version-tag.clickable');
        releaseLinks.forEach(link => {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const element = /** @type {HTMLElement} */ (event.currentTarget);
                const url = element.getAttribute('data-release-url');
                if (url) {
                    vscode.postMessage({
                        command: 'openUrl',
                        url: url
                    });
                }
            });
        });
    }

    function handleReleaseComplete(success, error, cancelled) {
        // Reset release in progress flag
        isReleaseInProgress = false;

        hideLoading();
        enableAllControls();

        if (cancelled) {
            showError('Release was cancelled', true);
            return;
        }

        if (!success) {
            showError(error || 'Failed to create release', true);
            return;
        }

        // Save the current version before clearing it
        const createdVersion = versionInput?.value || '';
        const createdPostfix = postfixInput?.value || '';

        // Clear inputs on success
        if (versionInput) {
            versionInput.value = '';
        }
        if (postfixInput && currentBranch) {
            postfixInput.value = `${currentBranch}-beta`;
        }

        // Force a refresh to get latest versions
        postValidatedMessage({
            command: 'forceRefresh',
            catalogId: catalogSelect?.value,
            createdVersion,
            createdPostfix
        });

        // Request catalog details update
        if (catalogSelect?.value) {
            postValidatedMessage({
                command: 'selectCatalog',
                catalogId: catalogSelect.value
            });
        }

        // Update UI
        updateTagPreview();
    }
})();