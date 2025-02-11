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

    // Initial state setup
    function initializeUI() {
        showLoading('Initializing Pre-Release Manager...');
        
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
            catalogDetailsDiv.innerHTML = '<div class="section"><h2>Next Release</h2><div class="next-version"><div class="next-version-info"><div class="version-row"><span class="version-label">GitHub:</span><span class="version-value">Please select a catalog</span></div><div class="version-row"><span class="version-label">Catalog:</span><span class="version-value">Please select a catalog</span></div></div></div></div>';
        }

        // Initialize auth status display
        const githubStatus = document.getElementById('githubAuthStatus');
        const catalogStatus = document.getElementById('catalogAuthStatus');
        if (githubStatus) {
            githubStatus.querySelector('.auth-text').textContent = 'GitHub: Checking...';
        }
        if (catalogStatus) {
            catalogStatus.querySelector('.auth-text').textContent = 'IBM Cloud: Checking...';
        }

        // Restore previous catalog selection if available
        const previousState = vscode.getState();
        if (previousState?.selectedCatalogId && catalogSelect) {
            catalogSelect.value = previousState.selectedCatalogId;
            // If we have a previous catalog selection and we're not on main/master,
            // enable the version input
            if (!isMainOrMaster && versionInput) {
                versionInput.disabled = false;
                versionInput.placeholder = 'Enter version number';
            }
        }

        // Request initial authentication status
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

    // Event Listeners
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

    // Add input event listeners for tag preview
    postfixInput?.addEventListener('input', updateTagPreview);
    versionInput?.addEventListener('input', updateTagPreview);

    // Add button event listeners
    githubBtn?.addEventListener('click', () => handleCreateClick('github'));
    catalogBtn?.addEventListener('click', () => handleCreateClick('catalog'));
    getLatestBtn?.addEventListener('click', handleGetLatestClick);

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
                    if (postfixInput) {postfixInput.disabled = false;}
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
                updateButtonStates();
                if (refreshButton) {refreshButton.disabled = true;} // Disable refresh when no catalog selected
            }
        }
    });

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'getState':
                vscode.postMessage({
                    command: 'stateResponse',
                    state: vscode.getState() || { selectedCatalogId: '' }
                });
                break;
            case 'authenticationStatus':
                isGithubAuthenticated = message.githubAuthenticated;
                isCatalogAuthenticated = message.catalogAuthenticated;
                updateAuthStatus(isGithubAuthenticated, isCatalogAuthenticated);
                break;
            case 'updateData':
                handleUpdateData(message);
                // Update timestamp when data is received
                lastCheckedTimestamp = message.timestamp;
                isCacheUsed = message.isCacheUsed;
                updateTimestampDisplay();
                break;
            case 'updateBranchName':
                updateBranchName(message.branch, message.error);
                break;
            case 'showError':
                handleError(message.error);
                break;
            case 'updateCatalogDetails':
                updateCatalogDetails(message.catalogDetails);
                break;
            case 'hasUnpushedChanges':
                handleUnpushedChanges(message.hasUnpushedChanges);
                break;
            case 'refreshComplete':
                handleRefreshComplete();
                break;
            case 'releaseComplete':
                handleReleaseComplete(message.success, message.error);
                break;
            case 'showLoading':
                showLoading(message.message || 'Loading...');
                break;
            case 'hideLoading':
                hideLoading();
                break;
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

    function handleRefreshComplete() {
        const mainContent = document.getElementById('mainContent');
        const refreshBtn = /** @type {HTMLButtonElement} */ (document.getElementById('refreshCatalogBtn'));
        const catalogSelect = /** @type {HTMLSelectElement} */ (document.getElementById('catalogSelect'));
        
        if (!mainContent || !catalogSelect) {
            console.error('Required elements not found');
            return;
        }
        
        // Re-enable controls and reset button state
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Get Latest Versions';
            refreshBtn.classList.remove('refreshing');
        }
        
        // Always enable catalog select
        catalogSelect.disabled = false;
        
        // Only enable version and postfix inputs if we're not on main/master
        if (!isMainOrMaster) {
            if (versionInput) { versionInput.disabled = false; }
            if (postfixInput) { postfixInput.disabled = false; }
        }
        
        // Remove loading state
        mainContent.classList.remove('loading-state');
        mainContent.classList.add('loaded');
    }

    function handleError(error) {
        const errorContainer = document.getElementById('errorContainer');
        const errorText = document.getElementById('errorText');
        
        if (!errorContainer || !errorText) {
            console.error('Error elements not found');
            return;
        }
        
        if (error) {
            errorText.textContent = error;
            errorContainer.classList.add('visible');
        } else {
            errorContainer.classList.remove('visible');
        }
    }

    /**
     * Shows or hides the error container
     * @param {string} [errorMessage] 
     * @param {boolean} [force] Whether to force clearing the error even on main/master
     */
    function showError(errorMessage, force = false) {
        // Don't clear error if we're on main/master unless forced
        if (!errorMessage && isMainOrMaster && !force) {
            return;
        }

        if (errorMessage) {
            const errorText = /** @type {HTMLElement} */ (document.getElementById('errorText'));
            if (errorText) {
                errorText.textContent = errorMessage;
            }
            errorContainer?.classList.add('show');
            mainContent?.classList.add('has-error');
            hasErrors = true;
        } else {
            errorContainer?.classList.remove('show');
            mainContent?.classList.remove('has-error');
            hasErrors = false;
        }
    }

    /**
     * Updates the branch name and suggests a postfix
     * @param {string} branch
     * @param {string} [error]
     */
    function updateBranchName(branch, error) {
        if (error) {
            showError(error);
            return;
        }

        // Update current branch
        currentBranch = branch;

        // Check if on main/master branch
        isMainOrMaster = ['main', 'master'].includes(branch.toLowerCase());

        // Always update postfix with branch name suggestion
        if (postfixInput) {
            const suggestedPostfix = `${branch}-beta`;
            postfixInput.value = suggestedPostfix;
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

        // Re-enable controls if not on main/master branch
        if (!isMainOrMaster) {
            if (catalogSelect) {catalogSelect.disabled = false;}
            if (versionInput) {versionInput.disabled = false;}
            if (postfixInput) {postfixInput.disabled = false;}
            const refreshButton = /** @type {HTMLButtonElement} */ (document.getElementById('refreshCatalogBtn'));
            if (refreshButton) {refreshButton.disabled = !catalogSelect?.value;}
            updateButtonStates();
        }

        // Remove loading state
        if (mainContent) {
            mainContent.classList.remove('loading-state');
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

        catalogDetails = details;
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
            version: r.tag_name.replace(/^v/, '').split('-')[0],
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
            }

            // Update the version table with the loaded versions
            renderCatalogDetails(details, versionInput?.value || '', proposedPostfix, githubReleases, details.versions);
        } else {
            // Show loading state for versions
            const versionTable = catalogDetailsDiv.querySelector('.version-table tbody');
            if (versionTable) {
                versionTable.innerHTML = `
                    <tr>
                        <td>${githubReleases[0]?.tag || '—'}</td>
                        <td class="loading-text">Loading versions...</td>
                    </tr>
                    ${githubReleases.slice(1).map(release => `
                        <tr>
                            <td>${release.tag}</td>
                            <td>—</td>
                        </tr>
                    `).join('')}
                `;
            }
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
        console.debug('Rendering catalog details', {
            proposedVersion,
            proposedPostfix,
            githubReleases,
            catalogVersions,
            details
        });

        // Update the next version preview in the pre-release section
        const nextVersionDiv = document.getElementById('nextVersion');
        if (nextVersionDiv) {
            nextVersionDiv.innerHTML = `
                <div class="next-version-info">
                    <div class="next-version-header">Next Release Versions</div>
                    <div class="version-row">
                        <span class="version-label">GitHub:</span>
                        <span class="version-value">${proposedVersion && proposedPostfix ? `v${proposedVersion}-${proposedPostfix}` : 'Not set'}</span>
                    </div>
                    <div class="version-row">
                        <span class="version-label">Catalog:</span>
                        <span class="version-value">${proposedVersion || 'Not set'}</span>
                    </div>
                </div>`;
        }

        // Render catalog details
        let content = `
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
            </div>`;

        // Add versions table if we have versions
        if (details.versions && details.versions.length > 0) {
            console.debug('Processing versions for display', {
                totalVersions: details.versions.length,
                versions: details.versions
            });

            content += `
                <div class="versions-table">
                    <h3>Version History</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>GitHub</th>
                                <th>Catalog</th>
                            </tr>
                        </thead>
                        <tbody>`;

            // Create a map of catalog versions with their GitHub tags
            const catalogVersionMap = new Map();
            details.versions.forEach(version => {
                const tagMatch = version.tgz_url?.match(/\/tags\/([^/]+)\.tar\.gz/);
                if (tagMatch) {
                    catalogVersionMap.set(tagMatch[1], version);
                }
            });

            // Sort GitHub releases by version (newest first)
            const sortedGitHubReleases = [...githubReleases].sort((a, b) => {
                const aTag = String('tag_name' in a ? a.tag_name : a.tag);
                const bTag = String('tag_name' in b ? b.tag_name : b.tag);
                const aVersion = aTag.replace(/^v/, '').split('-')[0];
                const bVersion = bTag.replace(/^v/, '').split('-')[0];
                return -semverCompare(aVersion, bVersion);
            });

            // First, show any GitHub releases that aren't in the catalog
            sortedGitHubReleases.forEach(release => {
                const releaseTag = 'tag_name' in release ? release.tag_name : release.tag;
                if (!catalogVersionMap.has(releaseTag)) {
                    content += `
                        <tr>
                            <td class="github-version">
                                <div class="version-tag">${releaseTag}</div>
                            </td>
                            <td class="catalog-version">
                                <div class="version-tag not-published">
                                    <div class="version-number">Not published</div>
                                </div>
                            </td>
                        </tr>`;
                }
            });

            // Get unique versions from catalog (based on version number)
            const uniqueVersions = Array.from(new Set(details.versions.map(v => v.version)))
                .sort((a, b) => -semverCompare(a, b))
                .slice(0, 5);

            console.debug('Unique versions for display', {
                uniqueVersions,
                count: uniqueVersions.length
            });

            // Then show catalog versions with their matching GitHub releases
            uniqueVersions.forEach(version => {
                const catalogEntries = details.versions.filter(v => v.version === version);
                
                // Get GitHub tag from any entry that has a tgz_url
                const githubTag = catalogEntries.find(entry => {
                    const tagMatch = entry.tgz_url?.match(/\/tags\/([^/]+)\.tar\.gz/);
                    return tagMatch;
                })?.tgz_url?.match(/\/tags\/([^/]+)\.tar\.gz/)?.[1];

                content += `
                    <tr>
                        <td class="github-version">
                            ${githubTag ? 
                                `<div class="version-tag">${githubTag}</div>` :
                                `<div class="version-tag not-published">
                                    <div class="version-number">Not published</div>
                                </div>`
                            }
                        </td>
                        <td class="catalog-version">
                            ${catalogEntries.map(entry => `
                                <div class="version-tag" ${entry.tgz_url ? `title="${entry.tgz_url}"` : ''}>
                                    <div class="version-number">${entry.version}</div>
                                    <div class="version-flavor">${entry.flavor?.label || entry.flavor?.name || 'Unknown'}</div>
                                </div>
                            `).join('')}
                        </td>
                    </tr>`;
            });

            content += `
                        </tbody>
                    </table>
                </div>`;
        } else {
            content += `
                <div class="versions-table">
                    <div class="empty-state">No version history available</div>
                </div>`;
        }

        if (catalogDetailsDiv) {
            catalogDetailsDiv.innerHTML = content;
        }
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
        if (!versionInput || !catalogDetails) {
            return;
        }

        // If versions are still loading, don't show any error or make suggestions
        if (catalogDetails.versions === undefined) {
            return;
        }

        // Now we know versions are loaded (not undefined)
        if (catalogDetails.versions.length === 0 && !isMainOrMaster) {
            showError('First release must be created through the IBM Cloud Catalog interface');
            return;
        }

        // Only suggest version if the input is empty
        if (!versionInput.value) {
            const versions = Array.from(new Set(catalogDetails.versions.map(v => v.version)))
                .filter(v => /^\d+\.\d+\.\d+$/.test(v))
                .sort((a, b) => -semverCompare(a, b));

            if (versions.length) {
                const latest = versions[0];
                const [major, minor, patch] = latest.split('.').map(Number);
                versionInput.value = `${major}.${minor}.${patch + 1}`;
            }
        }

        // Validate current version against catalog versions
        if (versionInput.value && catalogDetails.versions) {
            const isVersionInvalid = catalogDetails.versions.some(v => v.version === versionInput.value);
            if (isVersionInvalid && !isMainOrMaster) {
                showError(`Version ${versionInput.value} already exists in the catalog`);
            }
        }
    }

    /**
     * Updates the GitHub tag preview and catalog version preview
     */
    function updateTagPreview() {
        // Update the next versions in the catalog details
        updateCatalogDetails(catalogDetails);
    }

    function handleCreateClick(type) {
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

        // Clear any existing error state
        showError(undefined, true);

        // Disable buttons during operation
        if (githubBtn) githubBtn.disabled = true;
        if (catalogBtn) catalogBtn.disabled = true;

        // Show loading state
        const button = type === 'github' ? githubBtn : catalogBtn;
        if (button) {
            button.textContent = 'Creating...';
            button.classList.add('loading');
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
            console.error('Required elements not found');
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
            
            // Disable all interactive elements during refresh
            catalogSelect.disabled = true;
            if (versionInput) {versionInput.disabled = true;}
            if (postfixInput) {postfixInput.disabled = true;}

            // Show loading state in catalog details
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '<p class="loading">Refreshing catalog data...</p>';
            }

            // Clear any existing error
            showError(undefined, true);

            // Save the current catalog selection before refresh
            const currentCatalogId = catalogSelect.value;
            vscode.setState({ ...state, selectedCatalogId: currentCatalogId });

            // Request a force refresh from the extension
            vscode.postMessage({ 
                command: 'forceRefresh',
                catalogId: currentCatalogId
            });

        } catch (error) {
            showError('Failed to refresh catalog data. Please try again.');
            // Reset button state
            refreshButton.disabled = !catalogSelect.value;
            refreshButton.textContent = 'Get Latest Versions';
            refreshButton.classList.remove('refreshing');
            mainContent.classList.remove('loading-state');
        }
    }

    function handleReleaseComplete(success, error) {
        // Re-enable buttons
        if (githubBtn) {
            githubBtn.disabled = false;
            githubBtn.textContent = 'Pre-Release GitHub';
            githubBtn.classList.remove('loading');
        }
        if (catalogBtn) {
            catalogBtn.disabled = false;
            catalogBtn.textContent = 'Pre-Release Catalog';
            catalogBtn.classList.remove('loading');
        }

        if (success) {
            // Clear inputs on success
            if (versionInput) versionInput.value = '';
            if (postfixInput) postfixInput.value = '';
            // Clear any existing error state
            showError(undefined, true);
        }
        // Don't show error in the red box for release errors
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

    function updateAuthStatus(githubAuth, catalogAuth) {
        const githubStatus = document.getElementById('githubAuthStatus');
        const catalogStatus = document.getElementById('catalogAuthStatus');

        if (githubAuth) {
            githubStatus.classList.add('authenticated');
            githubStatus.classList.remove('not-authenticated');
            githubStatus.querySelector('.auth-text').textContent = 'GitHub: Logged in';
            if (githubBtn) {
                githubBtn.title = 'Create GitHub pre-release';
            }
        } else {
            githubStatus.classList.add('not-authenticated');
            githubStatus.classList.remove('authenticated');
            githubStatus.querySelector('.auth-text').textContent = 'GitHub: Not logged in';
            if (githubBtn) {
                githubBtn.title = 'Login to GitHub to create releases';
            }
        }

        if (catalogAuth) {
            catalogStatus.classList.add('authenticated');
            catalogStatus.classList.remove('not-authenticated');
            catalogStatus.querySelector('.auth-text').textContent = 'IBM Cloud: Logged in';
            if (catalogBtn) {
                catalogBtn.title = 'Create catalog pre-release';
            }
            if (catalogSelect) {
                catalogSelect.title = 'Select a catalog';
            }
        } else {
            catalogStatus.classList.add('not-authenticated');
            catalogStatus.classList.remove('authenticated');
            catalogStatus.querySelector('.auth-text').textContent = 'IBM Cloud: Not logged in';
            if (catalogBtn) {
                catalogBtn.title = 'Login to IBM Cloud to publish to catalog';
            }
            if (catalogSelect) {
                catalogSelect.title = 'Login to IBM Cloud to view catalogs';
            }
        }

        // Store the authentication states
        isGithubAuthenticated = githubAuth;
        isCatalogAuthenticated = catalogAuth;

        // Update button states based on new auth status
        updateButtonStates();
    }

    function updateButtonStates() {
        if (!githubBtn || !catalogBtn) {
            return;
        }

        const hasVersion = versionInput?.value?.trim();
        const hasPostfix = postfixInput?.value?.trim();
        const hasCatalog = catalogSelect?.value;

        // GitHub button requires version and postfix
        githubBtn.disabled = !hasVersion || !hasPostfix || !isGithubAuthenticated;

        // Catalog button requires version, postfix, catalog selection and authentication
        catalogBtn.disabled = !hasVersion || !hasPostfix || !hasCatalog || !isCatalogAuthenticated;

        // Update catalog select state
        if (catalogSelect) {
            catalogSelect.disabled = !isCatalogAuthenticated;
        }
    }

    function updateBranchInfo(branchInfo) {
        const branchInfoDiv = document.getElementById('branchInfo');
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
})(); 