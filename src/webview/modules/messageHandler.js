// src/webview/modules/messageHandler.js

/**
 * Handles all communication between the webview and extension
 * Manages message passing, state updates, and UI notifications
 */
export class MessageHandler {
    /**
     * Creates a new MessageHandler instance
     * @param {Object} vscode - The VS Code API instance
     * @param {Object} logger - Logger instance for recording operations
     * @param {Object} jsonRenderer - JsonRenderer instance for handling JSON updates
     * @param {Object} stateManager - StateManager instance for managing webview state
     * @param {Object} modalManager - ModalManager instance for handling modals
     */
    constructor(vscode, logger, jsonRenderer, stateManager, modalManager) {
        this.vscode = vscode;
        this.logger = logger;
        this.jsonRenderer = jsonRenderer;
        this.stateManager = stateManager;
        this.modalManager = modalManager;
        this.pendingRequests = new Map();
        this.requestTimeout = 30000; // 30 seconds timeout for requests
    }

    /**
     * Initializes the message handler and sets up event listeners
     */
    initialize() {
        window.addEventListener('message', event => this.handleMessage(event.data));
        this.setupUIEventListeners();
        this.sendReadyMessage();
        this.logger.log('MessageHandler initialized');
    }

    /**
     * Sends the initial ready message to the extension
     */
    sendReadyMessage() {
        this.postMessage({ type: 'ready' });
        this.logger.log('Ready message sent to extension');
    }

    /**
     * Sets up event listeners for UI elements
     */
    setupUIEventListeners() {
        // Save button handler
        const saveButton = document.getElementById('save-button');
        if (saveButton) {
            saveButton.addEventListener('click', () => this.handleSaveRequest());
        }

        // Refresh catalog button handler
        const refreshButton = document.getElementById('refresh-catalog-button');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => this.handleRefreshRequest());
        }

        // Add element button handler (global delegation)
        document.addEventListener('click', (event) => {
            if (event.target.classList.contains('add-element-button')) {
                const path = event.target.getAttribute('data-path');
                if (path) {
                    this.modalManager.showAddElementModal(path, 
                        (newValue) => this.handleAddElement(path, newValue));
                }
            }
        });
    }

    /**
     * Handles incoming messages from the extension
     * @param {Object} message - The message to handle
     */
    async handleMessage(message) {
        try {
            this.logger.log('Received message:', message.type);

            // Handle pending request responses
            if (message.requestId && this.pendingRequests.has(message.requestId)) {
                this.handleRequestResponse(message);
                return;
            }

            switch (message.type) {
                case 'loadJson':
                    await this.handleLoadJson(message);
                    break;
                    
                case 'saveSuccess':
                    this.handleSaveSuccess();
                    break;

                case 'loginStatus':
                    this.handleLoginStatus(message.isLoggedIn);
                    break;

                case 'offeringsData':
                    this.handleOfferingsData(message.path, message.offerings);
                    break;

                case 'catalogData':
                    this.handleCatalogData(message);
                    break;

                case 'versionDetails':
                    this.handleVersionDetails(message);
                    break;

                case 'error':
                    this.handleError(message.error);
                    break;

                case 'statusUpdate':
                    this.handleStatusUpdate(message);
                    break;

                case 'validationResult':
                    this.handleValidationResult(message);
                    break;

                case 'cacheUpdate':
                    this.handleCacheUpdate(message);
                    break;

                default:
                    this.logger.warn(`Unknown message type received: ${message.type}`);
            }
        } catch (error) {
            this.logger.error('Error handling message:', error);
            this.showError(`Error processing message: ${error.message}`);
        }
    }

    /**
     * Handles responses to pending requests
     * @param {Object} message - The response message
     */
    handleRequestResponse(message) {
        const { resolve, reject, timeout } = this.pendingRequests.get(message.requestId);
        clearTimeout(timeout);
        this.pendingRequests.delete(message.requestId);

        if (message.error) {
            reject(new Error(message.error));
        } else {
            resolve(message.data);
        }
    }

    /**
     * Handles loading JSON data into the viewer
     * @param {Object} message - Message containing JSON data and schema
     */
    async handleLoadJson(message) {
        try {
            this.logger.log('Loading JSON data');
            await this.jsonRenderer.renderJson(message.json, message.schema);
            this.stateManager.updateState({ currentJson: message.json });
        } catch (error) {
            this.logger.error('Error loading JSON:', error);
            this.showError('Failed to load JSON data');
        }
    }

    /**
     * Handles successful save operations
     */
    handleSaveSuccess() {
        const saveButton = document.getElementById('save-button');
        if (saveButton) {
            saveButton.disabled = true;
        }
        this.showInfo('Changes saved successfully');
    }

    /**
     * Handles login status updates
     * @param {boolean} isLoggedIn - Current login status
     */
    handleLoginStatus(isLoggedIn) {
        this.updateLoginUI(isLoggedIn);
        this.stateManager.updateState({ isLoggedIn });
    }

    /**
     * Updates UI elements based on login status
     * @param {boolean} isLoggedIn - Current login status
     */
    updateLoginUI(isLoggedIn) {
        const statusElement = document.getElementById('login-status');
        const refreshButton = document.getElementById('refresh-catalog-button');

        if (statusElement) {
            statusElement.textContent = isLoggedIn ? 'Logged In' : 'Not Logged In';
            statusElement.className = isLoggedIn ? 'logged-in' : 'logged-out';
        }

        if (refreshButton) {
            refreshButton.disabled = !isLoggedIn;
        }
    }

    /**
     * Handles offerings data updates
     * @param {string} path - Path to update
     * @param {Array} offerings - Offerings data
     */
    handleOfferingsData(path, offerings) {
        try {
            this.logger.log(`Updating offerings for path: ${path}`);
            // Implementation depends on UI requirements
            this.refreshOfferingsUI(path, offerings);
        } catch (error) {
            this.logger.error('Error handling offerings data:', error);
            this.showError('Failed to update offerings');
        }
    }

    /**
     * Handles catalog data updates
     * @param {Object} message - Catalog data message
     */
    handleCatalogData(message) {
        try {
            const { catalogId, data, status } = message;
            this.logger.log(`Received catalog data for ${catalogId}`);
            this.updateCatalogUI(catalogId, data, status);
        } catch (error) {
            this.logger.error('Error handling catalog data:', error);
            this.showError('Failed to update catalog data');
        }
    }

    /**
     * Handles version details updates
     * @param {Object} message - Version details message
     */
    handleVersionDetails(message) {
        try {
            const { versionLocator, data } = message;
            this.logger.log(`Received version details for ${versionLocator}`);
            this.updateVersionUI(versionLocator, data);
        } catch (error) {
            this.logger.error('Error handling version details:', error);
            this.showError('Failed to update version details');
        }
    }

    /**
     * Sends a message to the extension
     * @param {Object} message - Message to send
     * @returns {Promise} Resolves when response is received
     */
    async postMessage(message) {
        if (message.requiresResponse) {
            return this.sendRequestWithResponse(message);
        } else {
            this.vscode.postMessage(message);
        }
    }

    /**
     * Sends a request and waits for response
     * @param {Object} message - Message to send
     * @returns {Promise} Resolves with response data
     */
    sendRequestWithResponse(message) {
        return new Promise((resolve, reject) => {
            const requestId = this.generateRequestId();
            message.requestId = requestId;

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error('Request timed out'));
            }, this.requestTimeout);

            this.pendingRequests.set(requestId, { resolve, reject, timeout });
            this.vscode.postMessage(message);
        });
    }

    /**
     * Handles save button clicks
     */
    async handleSaveRequest() {
        try {
            const jsonData = this.jsonRenderer.getCurrentData();
            await this.postMessage({
                type: 'saveJson',
                json: jsonData,
                requiresResponse: true
            });
        } catch (error) {
            this.logger.error('Error saving JSON:', error);
            this.showError('Failed to save changes');
        }
    }

    /**
     * Handles refresh button clicks
     */
    async handleRefreshRequest() {
        try {
            await this.postMessage({
                type: 'refreshCatalog',
                requiresResponse: true
            });
        } catch (error) {
            this.logger.error('Error refreshing catalog:', error);
            this.showError('Failed to refresh catalog');
        }
    }

    /**
     * Handles adding new elements to arrays
     * @param {string} path - Path where to add element
     * @param {*} value - Value to add
     */
    async handleAddElement(path, value) {
        try {
            await this.jsonRenderer.addElement(path, value);
            const saveButton = document.getElementById('save-button');
            if (saveButton) {
                saveButton.disabled = false;
            }
        } catch (error) {
            this.logger.error('Error adding element:', error);
            this.showError('Failed to add element');
        }
    }

    /**
     * Shows an error message
     * @param {string} message - Error message to display
     */
    showError(message) {
        this.postMessage({
            type: 'showError',
            message: message
        });
    }

    /**
     * Shows an info message
     * @param {string} message - Info message to display
     */
    showInfo(message) {
        this.postMessage({
            type: 'showInfo',
            message: message
        });
    }

    /**
     * Generates a unique request ID
     * @returns {string} Unique ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Updates the UI with catalog data
     * @param {string} catalogId - Catalog identifier
     * @param {Object} data - Catalog data
     * @param {string} status - Current status
     */
    updateCatalogUI(catalogId, data, status) {
        // Implementation depends on UI requirements
        this.logger.log(`Updating UI for catalog ${catalogId}`);
    }

    /**
     * Updates the UI with version details
     * @param {string} versionLocator - Version identifier
     * @param {Object} data - Version data
     */
    updateVersionUI(versionLocator, data) {
        // Implementation depends on UI requirements
        this.logger.log(`Updating UI for version ${versionLocator}`);
    }

    /**
     * Refreshes the offerings UI
     * @param {string} path - Path to refresh
     * @param {Array} offerings - Offerings data
     */
    refreshOfferingsUI(path, offerings) {
        // Implementation depends on UI requirements
        this.logger.log(`Refreshing offerings UI for path ${path}`);
    }

    /**
     * Handles generic error messages
     * @param {Error|string} error - Error to handle
     */
    handleError(error) {
        const message = error instanceof Error ? error.message : error;
        this.logger.error('Error received:', message);
        this.showError(message);
    }

    /**
     * Handles status updates
     * @param {Object} message - Status update message
     */
    handleStatusUpdate(message) {
        this.logger.log('Status update:', message.status);
        // Update UI based on status
    }

    /**
     * Handles validation results
     * @param {Object} message - Validation result message
     */
    handleValidationResult(message) {
        const { isValid, errors } = message;
        if (!isValid) {
            this.showError(`Validation failed: ${errors.join(', ')}`);
        }
    }

    /**
     * Handles cache update notifications
     * @param {Object} message - Cache update message
     */
    handleCacheUpdate(message) {
        this.logger.log('Cache update received:', message.type);
        // Handle cache update based on type
    }

    /**
     * Cleans up resources
     */
    dispose() {
        // Clear all pending requests
        for (const [, request] of this.pendingRequests) {
            clearTimeout(request.timeout);
            request.reject(new Error('MessageHandler disposed'));
        }
        this.pendingRequests.clear();
    }
}