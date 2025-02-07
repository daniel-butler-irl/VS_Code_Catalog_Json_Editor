// @ts-check

(function() {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const state = vscode.getState() || { selectedCatalogId: '' };

    let currentBranch = '';
    let lastReleases = [];
    let catalogDetails = null;
    let availableCatalogs = [];
    let hasErrors = false;

    // DOM Elements
    const errorContainer = /** @type {HTMLElement} */ (document.getElementById('errorContainer'));
    const mainContent = /** @type {HTMLElement} */ (document.getElementById('mainContent'));
    const postfixInput = /** @type {HTMLInputElement} */ (document.getElementById('postfix'));
    const versionInput = /** @type {HTMLInputElement} */ (document.getElementById('version'));
    const publishCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('publishToCatalog'));
    const createBtn = /** @type {HTMLButtonElement} */ (document.getElementById('createBtn'));
    const catalogDetailsDiv = document.getElementById('catalogDetails');
    const catalogSelect = /** @type {HTMLSelectElement} */ (document.getElementById('catalogSelect'));

    // Event Listeners
    document.addEventListener('DOMContentLoaded', () => {
        vscode.postMessage({ command: 'getBranchName' });
        vscode.postMessage({ command: 'refresh' });
        
        // Restore selected catalog
        if (catalogSelect && state.selectedCatalogId) {
            catalogSelect.value = state.selectedCatalogId;
            vscode.postMessage({ 
                command: 'selectCatalog',
                catalogId: state.selectedCatalogId
            });
        }
    });

    createBtn?.addEventListener('click', handleCreateClick);

    catalogSelect?.addEventListener('change', () => {
        const selectedCatalogId = catalogSelect.value;
        // Save selection to state
        vscode.setState({ ...state, selectedCatalogId });
        
        if (selectedCatalogId) {
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '<p class="loading">Loading catalog details...</p>';
            }
            vscode.postMessage({ 
                command: 'selectCatalog',
                catalogId: selectedCatalogId
            });
        } else {
            if (catalogDetailsDiv) {
                catalogDetailsDiv.innerHTML = '<p class="empty-state">Please select a catalog above to view its details</p>';
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
                updateReleases(message.releases);
                updateAvailableCatalogs(message.catalogs);
                if (message.catalogDetails) {
                    updateCatalogDetails(message.catalogDetails);
                }
                suggestNextVersion();
                updateTagPreview();
                break;
            case 'updateBranchName':
                updateBranchName(message.branch, message.error);
                break;
            case 'showError':
                showError(message.error || 'An error occurred');
                break;
            case 'updateCatalogDetails':
                updateCatalogDetails(message.catalogDetails);
                break;
        }
    });

    /**
     * Shows or hides the error container
     * @param {string} [errorMessage] 
     */
    function showError(errorMessage) {
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
        currentBranch = branch;
        if (error) {
            showError(error);
            return;
        }

        if (postfixInput && !postfixInput.value && branch) {
            postfixInput.value = `${branch}-beta`;
            showError(); // Clear any errors
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
        catalogDetails = details;
        if (!catalogDetailsDiv) {return;}

        if (!catalogSelect?.value) {
            catalogDetailsDiv.innerHTML = '<p class="empty-state">Please select a catalog above to view its details</p>';
            return;
        }

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
            publishCheckbox.disabled = false;
        }

        const proposedVersion = versionInput?.value;
        const proposedPostfix = postfixInput?.value;
        const githubReleases = lastReleases.map(r => ({
            version: r.tag_name.replace(/^v/, '').split('-')[0],
            tag: r.tag_name,
            date: new Date(r.created_at).toLocaleDateString()
        }));
        const catalogVersions = details.versions || [];
        const isVersionInvalid = proposedVersion && catalogVersions.includes(proposedVersion);

        if (createBtn) {
            createBtn.disabled = isVersionInvalid;
            if (isVersionInvalid) {
                showError(`Version ${proposedVersion} already exists in the catalog`);
            } else {
                showError();
            }
        }

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
                                <td>${githubReleases[i] ? `
                                    <div class="version-tag">${githubReleases[i].tag}</div>
                                    <div class="version-date">${githubReleases[i].date}</div>
                                ` : '—'}</td>
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
                        <input type="checkbox" id="releaseCatalog" ${isVersionInvalid ? 'disabled' : 'checked'}>
                        Release Catalog
                    </label>
                </div>

                <button id="createBtn" class="release-button" ${isVersionInvalid ? 'disabled' : ''}>
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
        availableCatalogs = catalogs;
        if (!catalogSelect) {return;}

        // Clear existing options
        catalogSelect.innerHTML = '<option value="">Select a catalog...</option>';

        if (catalogs.length) {
            catalogs.forEach(catalog => {
                const option = document.createElement('option');
                option.value = catalog.id;
                option.textContent = catalog.label;
                if (catalog.shortDescription) {
                    option.title = catalog.shortDescription;
                }
                catalogSelect.appendChild(option);
            });
            showError(); // Clear any errors
        } else {
            showError('No private catalogs available');
        }

        // Restore selected catalog
        if (state.selectedCatalogId) {
            catalogSelect.value = state.selectedCatalogId;
        }
    }

    /**
     * Suggests the next version number based on existing releases
     */
    function suggestNextVersion() {
        if (!versionInput || !lastReleases.length) {return;}

        // Find the latest version from releases
        const versions = lastReleases
            .map(r => r.tag_name.replace(/^v/, '').split('-')[0]) // Remove 'v' prefix and postfix
            .filter(v => /^\d+\.\d+\.\d+$/.test(v)); // Only consider valid semver

        if (versions.length) {
            const latest = versions.sort((a, b) => {
                const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
                const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
                
                if (aMajor !== bMajor) {return bMajor - aMajor;}
                if (aMinor !== bMinor) {return bMinor - aMinor;}
                return bPatch - aPatch;
            })[0];

            // Increment patch version
            const [major, minor, patch] = latest.split('.').map(Number);
            versionInput.value = `${major}.${minor}.${patch + 1}`;
            updateTagPreview();
        }
    }

    /**
     * Updates the GitHub tag preview and catalog version preview
     */
    function updateTagPreview() {
        const version = versionInput?.value || '';
        const postfix = postfixInput?.value || '';

        // Update the next versions in the catalog details
        updateCatalogDetails(catalogDetails);
    }

    async function handleCreateClick() {
        if (!postfixInput?.value || !versionInput?.value) {
            showError('Please fill in all required fields');
            return;
        }

        // Validate version format
        if (!/^\d+\.\d+\.\d+$/.test(versionInput.value)) {
            showError('Invalid version format. Please use semantic versioning (e.g., 1.0.0)');
            return;
        }

        vscode.postMessage({
            command: 'createPreRelease',
            data: {
                version: versionInput.value,
                postfix: postfixInput.value,
                publishToCatalog: publishCheckbox?.checked ?? false
            }
        });
    }
})(); 