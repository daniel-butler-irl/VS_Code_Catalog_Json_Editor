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

    // Initial state setup
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
        
        // Initialize state
        const savedState = vscode.getState();
        if (savedState) {
            state.selectedCatalogId = savedState.selectedCatalogId || '';
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

        // Request initial data
        vscode.postMessage({ command: 'getBranchName' });
        vscode.postMessage({ command: 'checkAuthentication' });
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

    // Remove duplicate event listeners from DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
        // Initialize UI first
        initializeUI();
        
        // Immediately request branch name
        vscode.postMessage({ command: 'getBranchName' });
        
        // Set up polling for branch changes
        branchCheckInterval = setInterval(() => {
            vscode.postMessage({ command: 'getBranchName' });
            // Also periodically check auth status
            vscode.postMessage({ command: 'checkAuthentication' });
        }, 2000); // Check every 2 seconds
    });

    // Clean up interval when window is closed
    window.addEventListener('unload', () => {
        if (branchCheckInterval) {
            clearInterval(branchCheckInterval);
        }
    });

    // Remove duplicate event listeners - they are already registered above
    // postfixInput?.addEventListener('input', updateTagPreview);
    // versionInput?.addEventListener('input', updateTagPreview);
    // githubBtn?.addEventListener('click', () => handleCreateClick('github'));
    // catalogBtn?.addEventListener('click', () => handleCreateClick('catalog'));
    // getLatestBtn?.addEventListener('click', handleGetLatestClick);

    catalogSelect?.addEventListener('change', () => {
        const selectedCatalogId = catalogSelect.value;
        const refreshButton = /** @type {HTMLButtonElement} */ (document.getElementById('refreshCatalogBtn'));
        
        // Save selection in state
        vscode.setState({ ...state, selectedCatalogId: selectedCatalogId });
        
        if (selectedCatalogId) {
            // Show loading state
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '<p class="loading">Loading catalog details...</p>';
            }
            if (mainContent) {
                mainContent.classList.add('loading-state');
            }

            // Enable version and postfix inputs if not on main/master branch
            if (!isMainOrMaster) {
                if (versionInput) {
                    versionInput.disabled = false;
                    versionInput.placeholder = 'Enter version number';
                }
                if (postfixInput) {
                    postfixInput.disabled = false;
                    // Set postfix to <branch>-beta if empty or matches previous branch pattern
                    if (currentBranch && (!postfixInput.value || postfixInput.value.endsWith('-beta'))) {
                        postfixInput.value = `${currentBranch}-beta`;
                    }
                }
            }

            // Temporarily disable controls during load
            if (catalogSelect) {catalogSelect.disabled = true;}
            if (refreshButton) {refreshButton.disabled = true;}

            // Clear any existing timeout
            if (currentTimeoutId) {
                clearTimeout(currentTimeoutId);
            }

            // Set a timeout to re-enable controls if no response received
            currentTimeoutId = setTimeout(() => {
                // Re-enable controls if not on main/master
                if (!isMainOrMaster) {
                    if (catalogSelect) {catalogSelect.disabled = false;}
                    if (versionInput) {versionInput.disabled = false;}
                    if (postfixInput) {
                        postfixInput.disabled = false;
                        // Ensure postfix is set even after timeout
                        if (currentBranch && (!postfixInput.value || postfixInput.value.endsWith('-beta'))) {
                            postfixInput.value = `${currentBranch}-beta`;
                        }
                    }
                    updateButtonStates();
                    if (refreshButton) {refreshButton.disabled = !selectedCatalogId;}
                }
                // Clear loading states
                if (mainContent) {mainContent.classList.remove('loading-state');}
                if (catalogDetailsDiv) {
                    catalogDetailsDiv.innerHTML = '<p class="empty-state">Failed to load catalog details. Please try again.</p>';
                }
                currentTimeoutId = null;
            }, 10000); // 10 second timeout

            vscode.postMessage({ 
                command: 'selectCatalog',
                catalogId: selectedCatalogId
            });
        } else {
            // Reset to initial state when no catalog is selected
            if (mainContent) {mainContent.classList.remove('loading-state');}
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '<p class="empty-state">Please select a catalog above to view its details</p>';
            }
            // Re-enable controls if not on main/master
            if (!isMainOrMaster) {
                if (catalogSelect) {catalogSelect.disabled = false;}
                if (versionInput) {
                    versionInput.disabled = true;
                    versionInput.placeholder = 'Select a catalog first';
                }
                if (postfixInput) {
                    postfixInput.disabled = true;
                    // Keep the postfix value but disable the input
                    if (currentBranch && (!postfixInput.value || postfixInput.value.endsWith('-beta'))) {
                        postfixInput.value = `${currentBranch}-beta`;
                    }
                }
                updateButtonStates();
                if (refreshButton) {refreshButton.disabled = true;} // Disable refresh when no catalog selected
            }
        }
    });

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        console.debug('Received message:', message);

        // Handle polling messages silently without validation
        if (message?.command === 'getBranchName' || message?.command === 'checkAuthentication') {
            return;
        }

        // Handle state response
        if (message?.command === 'stateResponse') {
            if (message.state && typeof message.state === 'object') {
                state.selectedCatalogId = message.state.selectedCatalogId || '';
                vscode.setState(state);
                console.debug('State updated:', state);
            }
            return;
        }

        // For other messages, validate and handle normally
        if (!message || typeof message.command !== 'string') {
            console.warn('Invalid message format:', message);
            return;
        }
        
        try {
            switch (message.command) {
                case 'updateButtonStates':
                    if (message.data) {
                        const { githubAuth, catalogAuth, enableCatalogButtons, enableGithubButtons } = message.data;
                        isGithubAuthenticated = githubAuth;
                        isCatalogAuthenticated = catalogAuth;
                        updateButtonStates();
                    }
                    break;
                case 'updateGitHubDetails':
                    handleGitHubDetailsUpdate(message);
                    break;
                case 'updateCatalogDetails':
                    handleCatalogDetailsUpdate(message);
                    break;
                case 'updateData':
                    handleDataUpdate(message);
                    break;
                case 'updateNextVersion':
                    handleNextVersionUpdate(message);
                    break;
                case 'updateAuthStatus':
                    updateAuthStatus(message.data);
                    break;
                case 'setLoadingState':
                    handleSetLoadingState(message);
                    break;
                case 'showError':
                    handleError(message);
                    break;
                case 'refreshComplete':
                    handleRefreshComplete();
                    break;
                case 'releaseComplete':
                    handleReleaseComplete(message.success, message.error, message.cancelled);
                    break;
                default:
                    console.debug('Unknown message command:', message.command);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            // Ensure UI stays responsive even after error
            hideLoading();
            enableAllControls();
            if (mainContent) {
                mainContent.classList.remove('loading-state');
            }
        }
    });

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
        
        // Handle catalog details if present
        if (message.catalogDetails && message.catalogDetails.offerings && message.catalogDetails.offerings.length > 0) {
            const catalogDetails = message.catalogDetails.offerings[0];
            console.debug('Updating catalog details:', catalogDetails);
            updateCatalogDetails(catalogDetails);
        }

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

        // Clear loading state if it was set
        if (mainContent) {
            mainContent.classList.remove('loading-state');
        }
    }

    function handleRefreshComplete() {
        hideLoading();
        if (mainContent) {
            mainContent.classList.remove('loading-state');
        }
        if (getLatestBtn) {
            getLatestBtn.disabled = false;
        }

        // Clear version input to allow new suggestion
        if (versionInput) {
            versionInput.value = '';
        }

        // Update version suggestion after refresh
        suggestNextVersion();
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
        console.debug('Updating catalog details with:', details);
        
        // Get the versions container
        const versionsContainer = document.getElementById('versionsContainer');
        if (!versionsContainer) {
            console.error('Versions container not found');
            return;
        }

        // Clear existing content
        versionsContainer.innerHTML = '';

        if (!details || !details.versions || details.versions.length === 0) {
            versionsContainer.innerHTML = '<p class="no-versions">No versions available</p>';
            return;
        }

        // Create a table for versions
        const table = document.createElement('table');
        table.className = 'versions-table';
        
        // Add table header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>Version</th>
                <th>Flavor</th>
                <th>GitHub Tag</th>
            </tr>
        `;
        table.appendChild(thead);

        // Add table body
        const tbody = document.createElement('tbody');
        
        // Sort versions by semver (newest first)
        const sortedVersions = [...details.versions].sort((a, b) => {
            return -compareVersions(a.version, b.version);
        });

        // Add rows for each version
        sortedVersions.forEach(version => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${version.version}</td>
                <td>${version.flavor.label || version.flavor.name}</td>
                <td>${version.githubTag || 'N/A'}</td>
            `;
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        versionsContainer.appendChild(table);

        // Update UI state
        if (mainContent) {
            mainContent.classList.remove('loading-state');
        }
        
        console.debug('Catalog details updated successfully');
    }

    // Helper function to compare version numbers
    function compareVersions(a, b) {
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;
            if (numA !== numB) {
                return numA - numB;
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
        if (!versionInput || !catalogDetails?.versions) return;

        // Get all versions
        const versions = catalogDetails.versions.map(v => v.version);

        // Sort versions by semver (newest first)
        versions.sort((a, b) => -compareVersions(a, b));

        // Get latest version
        const latestVersion = versions[0];
        if (!latestVersion) {
            versionInput.value = '1.0.0';
            return;
        }

        // Increment patch version
        const parts = latestVersion.split('.').map(Number);
        parts[2] = (parts[2] || 0) + 1;
        versionInput.value = parts.join('.');
    }

    /**
     * Updates the GitHub tag preview and catalog version preview
     */
    function updateTagPreview() {
        // Update the next versions in the catalog details
        updateCatalogDetails(catalogDetails);
    }

    function handleCreateClick(type) {
        // Prevent multiple simultaneous release attempts
        if (isReleaseInProgress) {
            console.debug('Release already in progress, ignoring click');
            return;
        }

        const version = versionInput?.value || '';
        const postfix = postfixInput?.value || '';
        const catalogId = catalogSelect?.value || '';

        if (!version || !postfix) {
            vscode.postMessage({
                command: 'showError',
                error: 'Please fill in all required fields'
            });
            return;
        }

        // For catalog imports, verify a catalog is selected
        if (type === 'catalog' && !catalogId) {
            return;
        }

        // Set release in progress flag
        isReleaseInProgress = true;

        // Clear any existing error state
        showError(undefined, true);

        // Disable all buttons during operation
        if (githubBtn) {
            githubBtn.disabled = true;
            githubBtn.innerHTML = 'Create GitHub Pre-Release <span class="loading-dots"></span>';
            githubBtn.classList.add('loading');
        }
        if (catalogBtn) {
            catalogBtn.disabled = true;
            catalogBtn.innerHTML = 'Import to IBM Cloud Catalog <span class="loading-dots"></span>';
            catalogBtn.classList.add('loading');
        }
        if (getLatestBtn) {
            getLatestBtn.disabled = true;
        }

        vscode.postMessage({
            command: 'createPreRelease',
            data: {
                version,
                postfix,
                publishToCatalog: type === 'catalog',
                releaseGithub: type === 'github',
                catalogId
            }
        });
    }

    async function handleRefreshClick() {
        const refreshButton = /** @type {HTMLButtonElement} */ (document.getElementById('refreshCatalogBtn'));
        const mainContent = document.getElementById('mainContent');
        const catalogSelect = /** @type {HTMLSelectElement} */ (document.getElementById('catalogSelect'));
        
        if (!refreshButton || !mainContent || !catalogSelect) {
            return;
        }

        try {
            // Update button state
            refreshButton.disabled = true;
            refreshButton.textContent = 'Refreshing...';
            refreshButton.classList.add('refreshing');
            
            // Reset cache status
            isCacheUsed = false;
            updateTimestampDisplay();
            
            // Add loading state to main content
            mainContent.classList.add('loading-state');
            
            // Save the current catalog selection before refresh
            const currentCatalogId = catalogSelect.value;
            vscode.setState({ ...state, selectedCatalogId: currentCatalogId });

            // Request a force refresh from the extension
            vscode.postMessage({ 
                command: 'forceRefresh',
                catalogId: currentCatalogId
            });

        } catch (error) {
            // Just reset the UI state without showing error
            enableAllControls();
            if (mainContent) {
                mainContent.classList.remove('loading-state');
            }
        }
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

        // Clear inputs on success
        if (versionInput) {
            versionInput.value = '';
        }
        if (postfixInput && currentBranch) {
            postfixInput.value = `${currentBranch}-beta`;
        }

        // Force a refresh to get latest versions
        vscode.postMessage({
            command: 'forceRefresh',
            catalogId: catalogSelect?.value
        });

        // Request catalog details update
        if (catalogSelect?.value) {
            vscode.postMessage({ 
                command: 'selectCatalog',
                catalogId: catalogSelect.value
            });
        }

        // Update UI
        updateTagPreview();
    }

    // Add function to update timestamp display
    function updateTimestampDisplay() {
        const timestampDiv = document.getElementById('lastCheckedTimestamp');
        if (!timestampDiv) return;

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

    // Add the handler function
    async function handleGetLatestClick() {
        // Show loading state
        if (mainContent) {
            mainContent.classList.add('loading-state');
        }
        if (catalogDetailsDiv) {
            catalogDetailsDiv.innerHTML = '<p class="loading">Fetching latest releases...</p>';
        }

        // Disable the button during refresh
        const getLatestBtn = /** @type {HTMLButtonElement} */ (document.getElementById('getLatestBtn'));
        if (getLatestBtn) {
            getLatestBtn.disabled = true;
        }

        try {
            // Request a force refresh from the extension
            vscode.postMessage({
                command: 'forceRefresh',
                catalogId: catalogSelect?.value
            });
        } catch (error) {
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '<p class="error">Failed to fetch latest releases. Please try again.</p>';
            }
        } finally {
            // Re-enable the button
            if (getLatestBtn) {
                getLatestBtn.disabled = false;
            }
        }
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

    // Remove the old handleCatalogSelect reference and add proper handler
    function handleCatalogSelect() {
        if (!catalogSelect) return;
        const selectedCatalogId = catalogSelect.value;
        vscode.postMessage({ 
            command: 'selectCatalog',
            catalogId: selectedCatalogId
        });
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
        
        // Handle catalog details if present
        if (message.catalogDetails && message.catalogDetails.offerings && message.catalogDetails.offerings.length > 0) {
            const catalogDetails = message.catalogDetails.offerings[0];
            console.debug('Updating catalog details:', catalogDetails);
            updateCatalogDetails(catalogDetails);
        }
        
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

        // Clear loading state if it was set
        if (mainContent) {
            mainContent.classList.remove('loading-state');
        }
    }

    // Add proper handler for catalog details updates
    function handleCatalogDetailsUpdate(message) {
        if (!message.catalogDetails) {
            console.error('No catalog details in message');
            return;
        }

        console.debug('Updating catalog details:', message.catalogDetails);
        updateCatalogDetails(message.catalogDetails);
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

        // Create a map of versions to their details
        const versionMap = new Map();
        
        // First, map all catalog versions
        details.versions.forEach(version => {
            const baseVersion = version.version;
            if (!versionMap.has(baseVersion)) {
                versionMap.set(baseVersion, {
                    version: baseVersion,
                    githubRelease: null,
                    catalogVersions: []
                });
            }
            versionMap.get(baseVersion).catalogVersions.push(version);
        });

        // Then map GitHub releases
        githubReleases.forEach(release => {
            const baseVersion = release.tag_name.replace(/^v/, '').split('-')[0];
            if (!versionMap.has(baseVersion)) {
                versionMap.set(baseVersion, {
                    version: baseVersion,
                    githubRelease: release,
                    catalogVersions: []
                });
            } else {
                versionMap.get(baseVersion).githubRelease = release;
            }
        });

        // Sort versions by semver
        const sortedVersions = Array.from(versionMap.entries())
            .sort(([a], [b]) => -compareVersions(a, b))
            .slice(0, 5); // Show only the latest 5 versions

        const versionsHtml = sortedVersions.map(([version, data]) => {
            const githubRelease = data.githubRelease;
            const catalogEntries = data.catalogVersions;
            const releaseDate = githubRelease?.created_at ? 
                new Date(githubRelease.created_at).toLocaleDateString() : '';
            const tag = githubRelease?.tag_name || '';
            const postfix = tag.includes('-') ? tag.split('-').slice(1).join('-') : '';

            const repoUrlElement = document.querySelector('#github-repo .git-repo-info');
            const repoUrl = repoUrlElement?.getAttribute('href');
            const githubUrl = repoUrl && repoUrl !== 'Not a Git repository' && tag ? 
                `${repoUrl}/releases/tag/${tag}` : undefined;

            return `
                <tr>
                    <td class="github-version">
                        ${githubRelease ? `
                            <div class="version-tag ${githubUrl ? 'clickable' : ''}" data-release-url="${githubUrl || ''}">
                                <div class="version-number">${version}</div>
                                ${postfix ? `<div class="version-flavor">${postfix}</div>` : ''}
                                ${releaseDate ? `<div class="release-date">${releaseDate}</div>` : ''}
                            </div>
                        ` : `
                            <div class="version-tag not-published">
                                <div class="version-number">${version}</div>
                                <div class="version-flavor">Not published</div>
                            </div>
                        `}
                    </td>
                    <td class="catalog-version">
                        ${catalogEntries.length > 0 ? 
                            catalogEntries.map(entry => `
                                <div class="version-tag">
                                    <div class="version-number">${entry.version}</div>
                                    <div class="version-flavor">${entry.flavor?.label || entry.flavor?.name || 'Unknown'}</div>
                                </div>
                            `).join('') : `
                            <div class="version-tag not-published">
                                <div class="version-number">Not published</div>
                            </div>
                        `}
                    </td>
                </tr>`;
        }).join('');

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
})();