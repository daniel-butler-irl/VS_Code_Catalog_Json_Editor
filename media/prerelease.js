// @ts-check

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

    // DOM Elements
    const errorContainer = /** @type {HTMLElement} */ (document.getElementById('errorContainer'));
    const mainContent = /** @type {HTMLElement} */ (document.getElementById('mainContent'));
    const postfixInput = /** @type {HTMLInputElement} */ (document.getElementById('postfix'));
    const versionInput = /** @type {HTMLInputElement} */ (document.getElementById('version'));
    const publishCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('publishToCatalog'));
    const createBtn = /** @type {HTMLButtonElement} */ (document.getElementById('createBtn'));
    const catalogDetailsDiv = document.getElementById('catalogDetails');
    const catalogSelect = /** @type {HTMLSelectElement} */ (document.getElementById('catalogSelect'));

    // Initial state setup
    function initializeUI() {
        // Disable all inputs initially
        if (versionInput) {
            versionInput.disabled = true;
            versionInput.placeholder = 'Loading...';
        }
        if (postfixInput) {
            postfixInput.disabled = true;
            postfixInput.placeholder = 'Loading...';
        }
        if (catalogSelect) {
            catalogSelect.disabled = true;
            catalogSelect.innerHTML = '<option value="">Loading catalogs...</option>';
        }

        // Add refresh button container after catalog select
        const catalogSelectContainer = catalogSelect?.parentElement;
        if (catalogSelectContainer) {
            // Add timestamp display
            const timestampDiv = document.createElement('div');
            timestampDiv.id = 'lastCheckedTimestamp';
            timestampDiv.className = 'timestamp-info';
            timestampDiv.innerHTML = 'Last checked: Never';
            catalogSelectContainer.appendChild(timestampDiv);

            const refreshButton = document.createElement('button');
            refreshButton.id = 'refreshCatalogBtn';
            refreshButton.className = 'secondary-button refresh-button';
            refreshButton.innerHTML = 'Get Latest Versions';
            refreshButton.title = 'Force refresh of catalog data and get latest versions (clears 6-hour cache)';
            // Set initial state based on catalog selection
            refreshButton.disabled = !catalogSelect?.value;
            refreshButton.onclick = handleRefreshClick;
            catalogSelectContainer.appendChild(refreshButton);
        }

        // Show loading state in catalogDetailsDiv
        if (catalogDetailsDiv) {
            catalogDetailsDiv.innerHTML = '<p class="loading">Initializing pre-release panel...</p>';
        }

        // Add loading class to main content
        if (mainContent) {
            mainContent.classList.add('loading-state');
        }
    }

    // Event Listeners
    document.addEventListener('DOMContentLoaded', () => {
        // Initialize UI first
        initializeUI();
        // Then get branch name
        vscode.postMessage({ command: 'getBranchName' });
        
        // Set up polling for branch changes
        branchCheckInterval = setInterval(() => {
            vscode.postMessage({ command: 'getBranchName' });
        }, 2000); // Check every 2 seconds
    });

    // Clean up interval when window is closed
    window.addEventListener('unload', () => {
        if (branchCheckInterval) {
            clearInterval(branchCheckInterval);
        }
    });

    createBtn?.addEventListener('click', handleCreateClick);

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

            // Temporarily disable controls during load
            if (catalogSelect) {catalogSelect.disabled = true;}
            if (versionInput) {versionInput.disabled = true;}
            if (postfixInput) {postfixInput.disabled = true;}
            if (publishCheckbox) {publishCheckbox.disabled = true;}
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
                    if (publishCheckbox) {publishCheckbox.disabled = false;}
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
                if (versionInput) {versionInput.disabled = false;}
                if (postfixInput) {postfixInput.disabled = false;}
                if (publishCheckbox) {publishCheckbox.disabled = false;}
                if (refreshButton) {refreshButton.disabled = true;} // Disable refresh when no catalog selected
            }
        }
    });

    // Add input event listeners for tag preview
    postfixInput?.addEventListener('input', updateTagPreview);
    versionInput?.addEventListener('input', updateTagPreview);

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
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
        }
    });

    function handleUpdateData(message) {
        const mainContent = document.getElementById('mainContent');
        const catalogSelect = /** @type {HTMLSelectElement} */ (document.getElementById('catalogSelect'));
        const version = /** @type {HTMLInputElement} */ (document.getElementById('version'));
        const postfix = /** @type {HTMLInputElement} */ (document.getElementById('postfix'));
        const refreshButton = /** @type {HTMLButtonElement} */ (document.getElementById('refreshCatalogBtn'));
        
        if (!mainContent || !catalogSelect || !version || !postfix) {
            console.error('Required elements not found');
            return;
        }
        
        // Enable inputs and remove loading state
        version.disabled = false;
        postfix.disabled = false;
        catalogSelect.disabled = false;
        
        // Update placeholders
        version.placeholder = '1.0.0';
        postfix.placeholder = 'branch-beta';
        
        // Update catalog select
        updateAvailableCatalogs(message.catalogs);
        
        // Update the UI with releases data
        updateReleases(message.releases);
        
        // Remove loading state with animation
        mainContent.classList.add('loaded');

        // Enable refresh button if a catalog is selected (including from session state)
        if (refreshButton && catalogSelect.value) {
            refreshButton.disabled = false;
        }
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
        
        // Only re-enable catalog select if we're not on main/master
        if (!isMainOrMaster) {
            catalogSelect.disabled = false;
            if (versionInput) {versionInput.disabled = false;}
            if (postfixInput) {postfixInput.disabled = false;}
            if (publishCheckbox) {publishCheckbox.disabled = false;}
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
        // Remove loading state
        if (mainContent) {
            mainContent.classList.remove('loading-state');
        }
        if (versionInput) {
            versionInput.placeholder = '1.0.0';
        }
        if (postfixInput) {
            postfixInput.placeholder = 'branch-beta';
        }

        // If branch hasn't changed and we already have a lastBranch set, do nothing
        if (branch === currentBranch && lastBranch !== '') {
            return;
        }

        lastBranch = currentBranch;
        currentBranch = branch;
        
        if (error) {
            showError(error);
            if (createBtn) {
                createBtn.disabled = true;
            }
            return;
        }

        // Update main/master status
        isMainOrMaster = ['main', 'master'].includes(branch.toLowerCase());

        // Block main/master branches immediately
        if (isMainOrMaster) {
            showError('Pre-releases cannot be created from main/master branch. Please switch to another branch.');
            if (createBtn) {
                createBtn.disabled = true;
            }
            if (catalogSelect) {
                catalogSelect.disabled = true;
            }
            if (versionInput) {
                versionInput.disabled = true;
            }
            if (postfixInput) {
                postfixInput.disabled = true;
            }
            if (publishCheckbox) {
                publishCheckbox.disabled = true;
            }
            // Clear any existing content
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '';
            }
            return;
        }

        // Always proceed with operations on valid branch
        if (postfixInput && !postfixInput.value) {
            postfixInput.value = `${branch}-beta`;
        }
        if (catalogSelect) {
            catalogSelect.disabled = false;
        }
        if (versionInput) {
            versionInput.disabled = false;
        }
        if (postfixInput) {
            postfixInput.disabled = false;
        }
        if (publishCheckbox) {
            publishCheckbox.disabled = false;
        }
        showError(undefined, true); // Force clear any errors when switching to valid branch

        // Now that we know we're on a valid branch, only fetch the catalogs list
        vscode.postMessage({ command: 'refresh' });
        
        // Only restore and fetch catalog details if we have a previously selected catalog
        if (catalogSelect && state.selectedCatalogId) {
            catalogSelect.value = state.selectedCatalogId;
            vscode.postMessage({ 
                command: 'selectCatalog',
                catalogId: state.selectedCatalogId
            });
        }
    }

    /**
     * Updates the releases list in the UI
     * @param {Array<{tag_name: string, name: string, created_at: string}>} releases
     */
    function updateReleases(releases) {
        lastReleases = releases;
        suggestNextVersion();
        updateCatalogDetails(catalogDetails);
    }

    /**
     * Updates the catalog details in the UI
     * @param {{ catalogId: string, offeringId: string, name: string, label: string, versions: string[], offeringNotFound?: boolean }} details
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
            if (publishCheckbox) {publishCheckbox.disabled = false;}
            const refreshButton = /** @type {HTMLButtonElement} */ (document.getElementById('refreshCatalogBtn'));
            if (refreshButton) {refreshButton.disabled = !catalogSelect?.value;}
        }

        // Don't update if we don't have a selected catalog
        if (!catalogSelect?.value) {
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '<p class="empty-state">Please select a catalog above to view its details</p>';
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
            if (publishCheckbox) {
                publishCheckbox.checked = false;
                publishCheckbox.disabled = true;
            }
            return;
        }

        if (publishCheckbox) {
            publishCheckbox.disabled = isMainOrMaster;
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
            const catalogVersions = details.versions;
            const isVersionInvalid = proposedVersion && catalogVersions.includes(proposedVersion);

            if (createBtn) {
                createBtn.disabled = isVersionInvalid || isMainOrMaster;
                if (isVersionInvalid && !isMainOrMaster) {
                    showError(`Version ${proposedVersion} already exists in the catalog`);
                }
            }

            // Only suggest version if input is empty
            if (!versionInput?.value) {
                suggestNextVersion();
            }

            // Update the version table with the loaded versions
            renderCatalogDetails(details, versionInput?.value || '', proposedPostfix, githubReleases, catalogVersions);
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
     * @param {*} details Catalog details
     * @param {string} proposedVersion Proposed version
     * @param {string} proposedPostfix Proposed postfix
     * @param {Array<{tag: string}>} githubReleases GitHub releases
     * @param {string[]} catalogVersions Catalog versions
     */
    function renderCatalogDetails(details, proposedVersion, proposedPostfix, githubReleases, catalogVersions) {
        const content = `
            <div class="terminal-section">
                <div class="next-version">
                    <div>Next Versions</div>
                    <div>GitHub: ${proposedVersion && proposedPostfix ? `v${proposedVersion}-${proposedPostfix}` : 'Not set'}</div>
                    <div>Catalog: ${proposedVersion || 'Not set'}</div>
                </div>

                <hr class="separator-line">

                <div class="catalog-quick-info">
                    <div>Name: ${details.name || 'Not set'}</div>
                    <div>Offering ID: ${details.offeringId || 'Not set'}</div>
                    <div>Label: ${details.label || 'Not set'}</div>
                </div>

                <hr class="separator-line">

                <table class="version-table">
                    <thead>
                        <tr>
                            <th>GitHub Releases</th>
                            <th>Catalog Releases</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Array.from({ length: Math.max(githubReleases.length, catalogVersions.length) }, (_, i) => `
                            <tr>
                                <td>${githubReleases[i]?.tag || '—'}</td>
                                <td>${catalogVersions[i] || '—'}</td>
                            </tr>
                        `).join('')}
                        ${!githubReleases.length && !catalogVersions.length ? `
                            <tr>
                                <td colspan="2" class="empty-state">No versions available</td>
                            </tr>
                        ` : ''}
                    </tbody>
                </table>

                <hr class="separator-line">

                <div class="release-options">
                    <label>
                        <input type="checkbox" id="releaseGithub" checked>
                        Release GitHub
                    </label>
                    <label>
                        <input type="checkbox" id="publishToCatalog" ${catalogVersions.includes(proposedVersion || '') ? 'disabled' : 'checked'}>
                        Release Catalog
                    </label>
                </div>

                <button id="createBtn" class="release-button" ${catalogVersions.includes(proposedVersion || '') ? 'disabled' : ''}>
                    Release Now
                </button>
            </div>
        `;

        catalogDetailsDiv.innerHTML = content;

        // Re-attach event listeners
        const releaseButton = catalogDetailsDiv.querySelector('.release-button');
        if (releaseButton) {
            releaseButton.addEventListener('click', handleCreateClick);
        }
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
            if (createBtn) {
                createBtn.disabled = true;
            }
            return;
        }

        // Only suggest version if the input is empty
        if (!versionInput.value) {
            const versions = catalogDetails.versions
                .filter(v => /^\d+\.\d+\.\d+$/.test(v))
                .sort((a, b) => {
                    const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
                    const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
                    
                    if (aMajor !== bMajor) {return bMajor - aMajor;}
                    if (aMinor !== bMinor) {return bMinor - aMinor;}
                    return bPatch - aPatch;
                });

            if (versions.length) {
                const latest = versions[0];
                const [major, minor, patch] = latest.split('.').map(Number);
                versionInput.value = `${major}.${minor}.${patch + 1}`;
            }
        }

        // Validate current version against catalog versions
        if (versionInput.value && catalogDetails.versions) {
            const isVersionInvalid = catalogDetails.versions.includes(versionInput.value);
            if (createBtn) {
                createBtn.disabled = isVersionInvalid || isMainOrMaster;
            }
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

    async function handleCreateClick() {
        const createBtn = /** @type {HTMLButtonElement} */ (document.getElementById('createBtn'));
        const mainContent = /** @type {HTMLElement} */ (document.getElementById('mainContent'));
        
        if (!createBtn || !mainContent) {
            console.error('Required elements not found');
            return;
        }

        if (!postfixInput?.value || !versionInput?.value) {
            showError('Please fill in all required fields');
            return;
        }

        // Block main/master branches
        if (['main', 'master'].includes(currentBranch.toLowerCase())) {
            showError('Pre-releases cannot be created from main/master branch. Please switch to another branch.');
            return;
        }

        // Validate version format
        if (!/^\d+\.\d+\.\d+$/.test(versionInput.value)) {
            showError('Invalid version format. Please use semantic versioning (e.g., 1.0.0)');
            return;
        }

        const releaseGithub = /** @type {HTMLInputElement} */ (document.getElementById('releaseGithub'))?.checked ?? true;
        const releaseCatalog = /** @type {HTMLInputElement} */ (document.getElementById('publishToCatalog'))?.checked ?? false;

        // If only releasing to catalog, verify GitHub release exists
        if (!releaseGithub && releaseCatalog) {
            const targetVersion = `v${versionInput.value}-${postfixInput.value}`;
            const existingRelease = lastReleases.find(r => r.tag_name === targetVersion);
            
            if (!existingRelease) {
                showError(`Cannot publish to catalog: GitHub release ${targetVersion} not found`);
                return;
            }
        }

        // Build confirmation message with detailed information
        let confirmMessage = 'Are you sure you want to create a pre-release?\n\n';
        confirmMessage += `Source Details:\n`;
        confirmMessage += `- Branch: ${currentBranch}\n`;
        confirmMessage += `- Version: v${versionInput.value}-${postfixInput.value}\n\n`;

        if (releaseGithub) {
            confirmMessage += `GitHub Release:\n`;
            confirmMessage += `- Tag: v${versionInput.value}-${postfixInput.value}\n`;
            if (hasUnpushedChanges) {
                confirmMessage += `⚠️ Warning: You have unpushed changes in your branch.\n`;
                confirmMessage += `Please make sure to push your changes before proceeding.\n`;
            }
            confirmMessage += '\n';
        }

        if (releaseCatalog && catalogDetails?.name) {
            confirmMessage += `IBM Cloud Catalog:\n`;
            confirmMessage += `- Account: <ACCOUNT_NAME>\n`;
            confirmMessage += `- Catalog: ${catalogDetails.label}\n`;
            confirmMessage += `- Offering: ${catalogDetails.name}\n`;
            
            // Add offering kinds and flavors if available
            if (catalogDetails.kinds && catalogDetails.kinds.length > 0) {
                const kinds = catalogDetails.kinds.map(kind => {
                    let kindInfo = kind.format_kind_label || kind.format_kind;
                    if (kind.versions && kind.versions.length > 0) {
                        const flavors = new Set(kind.versions.map(v => v.flavor?.name).filter(Boolean));
                        if (flavors.size > 0) {
                            kindInfo += ` (${Array.from(flavors).join(', ')})`;
                        }
                    }
                    return kindInfo;
                });
                confirmMessage += `- Types: ${kinds.join(', ')}\n`;
            }
            confirmMessage += '\n';
        }

        // Show loading state
        createBtn.disabled = true;
        createBtn.classList.add('loading');
        mainContent.classList.add('loading-state');
        
        // Clear any existing errors
        showError(undefined, true);

        // Send message to extension to show confirmation dialog
        vscode.postMessage({
            command: 'showConfirmation',
            data: {
                message: confirmMessage,
                version: versionInput.value,
                postfix: postfixInput.value,
                publishToCatalog: releaseCatalog,
                releaseGithub: releaseGithub
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
            if (publishCheckbox) {publishCheckbox.disabled = true;}

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
        const createBtn = /** @type {HTMLButtonElement} */ (document.getElementById('createBtn'));
        const mainContent = /** @type {HTMLElement} */ (document.getElementById('mainContent'));
        const catalogSelect = /** @type {HTMLSelectElement} */ (document.getElementById('catalogSelect'));
        const refreshButton = /** @type {HTMLButtonElement} */ (document.getElementById('refreshCatalogBtn'));
        
        if (!createBtn || !mainContent || !catalogSelect) {
            console.error('Required elements not found');
            return;
        }

        // Re-enable all interactive elements if not on main/master branch
        if (!isMainOrMaster) {
            // Re-enable inputs
            if (versionInput) {versionInput.disabled = false;}
            if (postfixInput) {postfixInput.disabled = false;}
            if (publishCheckbox) {publishCheckbox.disabled = false;}
            if (catalogSelect) {catalogSelect.disabled = false;}
            if (refreshButton) {refreshButton.disabled = !catalogSelect.value;}
            
            // Re-enable create button
            createBtn.disabled = false;
        }

        // Remove loading states
        createBtn.classList.remove('loading');
        mainContent.classList.remove('loading-state');
        
        if (!success && error) {
            showError(error);
        } else {
            // Clear any existing errors on success
            showError(undefined, true);
        }
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
})(); 