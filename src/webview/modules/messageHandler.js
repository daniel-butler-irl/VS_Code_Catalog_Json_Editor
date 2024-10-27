// src/webview/modules/messageHandler.js

/**
 * Handles incoming messages from the backend to apply UI enhancements.
 */
export class MessageHandler {
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Sets up message listeners.
     */
    initialize() {
        window.addEventListener('message', event => {
            const message = event.data;
            this.handleMessage(message);
        });
    }

    /**
     * Handles a single message.
     * @param {Object} message - The message object.
     */
    handleMessage(message) {
        switch (message.type) {
            case 'loadJson':
                this.handleLoadJson(message.json, message.schema, message.enhancements);
                break;
            case 'jsonValidationError':
                this.handleJsonValidationError(message.errors);
                break;
            case 'authenticationRequired':
                this.handleAuthenticationRequired(message.message);
                break;
            case 'saveSuccess':
                this.handleSaveSuccess();
                break;
            case 'error':
                this.handleError(message.message);
                break;
            // Add more cases as needed
            default:
                this.logger.warn(`Unknown message type received: ${message.type}`);
        }
    }

    /**
     * Handles the 'loadJson' message by rendering the JSON and applying enhancements.
     * @param {Object} jsonData 
     * @param {Object} schema 
     * @param {FunctionResult[]} enhancements 
     */
    handleLoadJson(jsonData, schema, enhancements) {
        // Assuming a global jsonRenderer instance exists
        if (window.jsonRenderer) {
            window.jsonRenderer.renderJson(jsonData, schema);
        }

        // Apply enhancements
        this.applyEnhancements(enhancements);
    }

    /**
     * Applies UI enhancements based on FunctionResult.
     * @param {FunctionResult[]} enhancements 
     */
    applyEnhancements(enhancements) {
        enhancements.forEach(enhancement => {
            const { path, highlightColor, elementType, options } = enhancement;

            // Find all matching elements based on the path
            // The path is relative to a parent path, so adjust accordingly
            const selector = `[data-path$=".${path}"] .value`;
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                // Apply highlight color if specified
                if (highlightColor) {
                    element.style.borderColor = highlightColor === 'green' ? 'green' : 'red';
                    // Optionally, add a tooltip or other visual indicators
                    if (highlightColor === 'red') {
                        element.title = 'Invalid Catalog ID';
                    } else if (highlightColor === 'green') {
                        element.title = 'Valid Catalog ID';
                    }
                }

                // Change element type if specified
                if (elementType === 'combobox' && options && Array.isArray(options)) {
                    // Create a select element
                    const select = document.createElement('select');
                    select.className = 'enhanced-combobox';
                    options.forEach(option => {
                        const opt = document.createElement('option');
                        opt.value = option;
                        opt.text = option;
                        select.appendChild(opt);
                    });
                    // Replace the existing element with the select
                    element.parentElement.replaceChild(select, element);
                }
            });
        });
    }

    /**
     * Handles JSON validation errors by displaying them in the UI.
     * @param {string[]} errors 
     */
    handleJsonValidationError(errors) {
        const errorContainer = document.getElementById('error-container');
        if (!errorContainer) return;

        errorContainer.innerHTML = ''; // Clear previous errors
        errors.forEach(err => {
            const errorElement = document.createElement('div');
            errorElement.className = 'json-error';
            errorElement.textContent = err;
            errorContainer.appendChild(errorElement);
        });
    }

    /**
     * Handles authentication required scenarios by prompting the user.
     * @param {string} message 
     */
    handleAuthenticationRequired(message) {
        const authContainer = document.getElementById('auth-container');
        if (!authContainer) {
            const container = document.createElement('div');
            container.id = 'auth-container';
            container.innerHTML = `
                <div class="auth-message">
                    <p>${message}</p>
                    <button id="login-button">Login</button>
                </div>
            `;
            document.body.insertBefore(container, document.getElementById('json-viewer'));
        } else {
            authContainer.innerHTML = `
                <div class="auth-message">
                    <p>${message}</p>
                    <button id="login-button">Login</button>
                </div>
            `;
        }

        document.getElementById('login-button').addEventListener('click', () => {
            const vscode = acquireVsCodeApi();
            vscode.postMessage({ type: 'promptLogin' });
        });
    }

    /**
     * Handles successful save operations.
     */
    handleSaveSuccess() {
        // Optionally, show a success message or perform other actions
        alert('JSON data saved successfully.');
    }

    /**
     * Handles generic errors by displaying them in the UI.
     * @param {string} message 
     */
    handleError(message) {
        const errorContainer = document.getElementById('error-container');
        if (!errorContainer) return;

        const errorElement = document.createElement('div');
        errorElement.className = 'json-error';
        errorElement.textContent = `Error: ${message}`;
        errorContainer.appendChild(errorElement);
    }
}

// Initialize the message handler
const logger = new Logger(); // Assuming a Logger class exists
const messageHandler = new MessageHandler(logger);
messageHandler.initialize();

// Assuming a global jsonRenderer instance exists
// For example, you might have:
// window.jsonRenderer = new JsonRenderer(vscode, logger);
