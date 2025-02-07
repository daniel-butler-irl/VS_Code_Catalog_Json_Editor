// @ts-check

(function() {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    let currentBranch = '';
    let lastReleases = [];
    let catalogDetails = null;
    let availableCatalogs = [];
    let hasErrors = false;

    // DOM Elements
    const errorContainer = /** @type {HTMLElement} */ (document.getElementById('errorContainer'));
    const mainContent = /** @type {HTMLElement} */ (document.getElementById('mainContent'));
    const setupBtn = /** @type {HTMLButtonElement} */ (document.getElementById('setupBtn'));
    const postfixInput = /** @type {HTMLInputElement} */ (document.getElementById('postfix'));
    const versionInput = /** @type {HTMLInputElement} */ (document.getElementById('version'));
    const publishCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('publishToCatalog'));
    const createBtn = /** @type {HTMLButtonElement} */ (document.getElementById('createBtn'));
    const releasesDiv = document.getElementById('releases');
    const catalogDetailsDiv = document.getElementById('catalogDetails');
    const catalogSelect = /** @type {HTMLSelectElement} */ (document.getElementById('catalogSelect'));

    // Event Listeners
    document.addEventListener('DOMContentLoaded', () => {
        vscode.postMessage({ command: 'getBranchName' });
        vscode.postMessage({ command: 'refresh' });
    });

    createBtn?.addEventListener('click', handleCreateClick);
    setupBtn?.addEventListener('click', () => {
        vscode.postMessage({ command: 'setup' });
    });

    catalogSelect?.addEventListener('change', () => {
        const selectedCatalogId = catalogSelect.value;
        if (selectedCatalogId) {
            vscode.postMessage({ 
                command: 'selectCatalog',
                catalogId: selectedCatalogId
            });
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
        if (!releasesDiv) {return;}

        if (releases.length) {
            releasesDiv.innerHTML = releases.map(release => `
                <div class="release-item">
                    <strong>${release.tag_name}</strong>
                    <span>${release.name || ''}</span>
                    <small>${new Date(release.created_at).toLocaleDateString()}</small>
                </div>
            `).join('');
            showError(); // Clear any errors
        } else {
            releasesDiv.innerHTML = '<p class="empty-state">No recent pre-releases found</p>';
        }

        suggestNextVersion();
    }

    /**
     * Updates the catalog details in the UI
     * @param {{ catalogId: string, offeringId: string, name: string, label: string, versions: string[] }} details
     */
    function updateCatalogDetails(details) {
        catalogDetails = details;
        if (!catalogDetailsDiv) {return;}

        if (!catalogSelect?.value) {
            catalogDetailsDiv.innerHTML = '<p class="empty-state">Please select a catalog above to view its details</p>';
            return;
        }

        if (details.catalogId || details.offeringId) {
            catalogDetailsDiv.innerHTML = `
                <div class="catalog-info">
                    <p><strong>Catalog ID:</strong> ${details.catalogId || 'Not set'}</p>
                    <p><strong>Offering ID:</strong> ${details.offeringId || 'Not set'}</p>
                    <p><strong>Name:</strong> ${details.name || 'Not set'}</p>
                    <p><strong>Label:</strong> ${details.label || 'Not set'}</p>
                    <div class="versions">
                        <strong>Recent Versions:</strong>
                        ${details.versions.length ? 
                            `<ul>${details.versions.slice(0, 5).map(v => `<li>${v}</li>`).join('')}</ul>` :
                            '<p>No versions found</p>'
                        }
                    </div>
                </div>
            `;
        } else {
            catalogDetailsDiv.innerHTML = '<p class="empty-state">No catalog details available</p>';
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
        }
    }

    /**
     * Updates the GitHub tag preview
     */
    function updateTagPreview() {
        const version = versionInput?.value || '';
        const postfix = postfixInput?.value || '';
        const tagPreviewDiv = document.getElementById('tagPreview');

        if (!tagPreviewDiv) {
            // Create tag preview element if it doesn't exist
            const formGroup = versionInput?.closest('.form-group');
            if (formGroup) {
                const previewDiv = document.createElement('div');
                previewDiv.id = 'tagPreview';
                previewDiv.className = 'tag-preview';
                formGroup.appendChild(previewDiv);
            }
        }

        const tagPreview = document.getElementById('tagPreview');
        if (tagPreview && version && postfix) {
            tagPreview.textContent = `GitHub Tag: v${version}-${postfix}`;
            tagPreview.style.display = 'block';
        } else if (tagPreview) {
            tagPreview.style.display = 'none';
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
    }

    async function handleCreateClick() {
        if (!postfixInput?.value || !versionInput?.value) {
            vscode.postMessage({
                command: 'showError',
                message: 'Please fill in all required fields'
            });
            return;
        }

        // Validate version format
        if (!/^\d+\.\d+\.\d+$/.test(versionInput.value)) {
            vscode.postMessage({
                command: 'showError',
                message: 'Invalid version format. Please use semantic versioning (e.g., 1.0.0)'
            });
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