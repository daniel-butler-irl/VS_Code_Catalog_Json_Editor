// src/webview/modules/jsonRenderer.js

/**
 * Handles rendering and manipulation of JSON data in the webview
 */
export class JsonRenderer {
    /**
     * Creates a new JsonRenderer instance
     * @param {Object} vscode - The VS Code API instance
     * @param {Object} logger - Logger instance for recording operations
     */
    constructor(vscode, logger) {
        this.vscode = vscode;
        this.logger = logger;
        this.jsonData = {};
        this.expandedNodes = new Set();

        // Bind all methods to ensure proper 'this' context
        this.renderJson = this.renderJson.bind(this);
        this.createTree = this.createTree.bind(this);
        this.createArrayNode = this.createArrayNode.bind(this);
        this.createObjectNode = this.createObjectNode.bind(this);
        this.createValueNode = this.createValueNode.bind(this);
        this.createKeyContainer = this.createKeyContainer.bind(this);
        this.createValueInput = this.createValueInput.bind(this);
        this.createAddButton = this.createAddButton.bind(this);
        this.createNestedList = this.createNestedList.bind(this);
        this.toggleNodeVisibility = this.toggleNodeVisibility.bind(this);
        this.updateJsonValue = this.updateJsonValue.bind(this);
        this.addEventListener = this.addEventListener.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
    }

    /**
     * Renders the JSON data as a tree structure
     * @param {Object} data - The JSON data to render
     * @param {Object} schema - The JSON schema for validation
     */
    renderJson(data, schema) {
        try {
            this.logger.log('Rendering JSON data:', typeof data);
            this.jsonData = data || { products: {} };
            const jsonViewer = document.getElementById('json-viewer');
            if (!jsonViewer) {
                this.logger.error('json-viewer element not found.');
                return;
            }

            jsonViewer.innerHTML = '';
            const ul = document.createElement('ul');
            ul.className = 'json-tree';
            ul.setAttribute('role', 'tree');

            try {
                if (!data || !data.products) {
                    this.renderError(jsonViewer, 'Invalid JSON structure. Expected "products" object.');
                    return;
                }
                this.createTree(data, ul, 'products', 'Products');
                jsonViewer.appendChild(ul);
                this.restoreExpandedNodes();
                this.logger.log('JSON data rendered successfully');
            } catch (error) {
                this.logger.error('Error in render:', error);
                this.renderError(jsonViewer, `Error rendering JSON: ${error.message}`);
            }
        } catch (error) {
            this.logger.error('Failed to render JSON:', error);
            throw error;
        }
    }

    /**
     * Creates a tree structure from JSON data
     * @param {any} obj - The value to create a node for
     * @param {HTMLElement} parent - The parent element to append to
     * @param {string} path - The current path in the JSON structure
     * @param {string} currentKey - The key of the current value
     */
    createTree(obj, parent, path, currentKey) {
        try {
            if (Array.isArray(obj) || this.isObjectLikeArray(obj)) {
                this.createArrayNode(obj, parent, path, currentKey);
            } else if (typeof obj === 'object' && obj !== null) {
                this.createObjectNode(obj, parent, path, currentKey);
            } else {
                this.createValueNode(obj, parent, path, currentKey);
            }
        } catch (error) {
            this.logger.error(`Error creating tree node at path ${path}:`, error);
            throw error;
        }
    }

    /**
     * Creates a node for an array
     */
    createArrayNode(obj, parent, path, currentKey) {
        const li = document.createElement('li');
        li.setAttribute('data-path', path);
        li.setAttribute('role', 'treeitem');
        li.setAttribute('aria-expanded', 'false');

        const keyContainer = this.createKeyContainer(currentKey, true);
        const addButton = this.createAddButton(path);
        keyContainer.appendChild(addButton);
        li.appendChild(keyContainer);

        const ul = this.createNestedList(path);
        li.appendChild(ul);

        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                const currentPath = `${path}[${index}]`;
                this.createTree(item, ul, currentPath, index.toString());
            });
        } else {
            Object.keys(obj)
                .sort((a, b) => Number(a) - Number(b))
                .forEach(key => {
                    const currentPath = `${path}[${key}]`;
                    this.createTree(obj[key], ul, currentPath, key);
                });
        }

        parent.appendChild(li);
    }

    /**
     * Creates a node for an object
     */
    createObjectNode(obj, parent, path, currentKey) {
        const li = document.createElement('li');
        li.setAttribute('data-path', path);
        li.setAttribute('role', 'treeitem');
        li.setAttribute('aria-expanded', 'false');

        const keyContainer = this.createKeyContainer(currentKey, true);
        li.appendChild(keyContainer);

        const ul = this.createNestedList(path);
        li.appendChild(ul);

        Object.entries(obj).forEach(([key, value]) => {
            const currentPath = path ? `${path}.${key}` : key;
            this.createTree(value, ul, currentPath, key);
        });

        parent.appendChild(li);
    }

    /**
     * Creates a node for a primitive value
     */
    createValueNode(value, parent, path, currentKey) {
        const li = document.createElement('li');
        li.setAttribute('data-path', path);
        li.setAttribute('role', 'treeitem');

        const keyContainer = this.createKeyContainer(currentKey, false);
        const valueInput = this.createValueInput(value, path, currentKey);
        keyContainer.appendChild(valueInput);
        li.appendChild(keyContainer);
        parent.appendChild(li);
    }

    /**
     * Creates a key container element
     */
    createKeyContainer(key, isCollapsible) {
        const container = document.createElement('div');
        container.className = 'key-container';

        const keySpan = document.createElement('span');
        keySpan.className = isCollapsible ? 'key collapsible' : 'key';
        keySpan.textContent = key;
        keySpan.setAttribute('tabindex', '0');

        if (isCollapsible) {
            this.addEventListener(keySpan);
        }

        container.appendChild(keySpan);
        return container;
    }

    /**
     * Creates an input element for a value
     */
    createValueInput(value, path, key) {
        const input = document.createElement('input');
        input.className = 'value';
        input.type = 'text';
        input.value = String(value);
        input.setAttribute('data-path', path);
        input.setAttribute('aria-label', `Value for ${key}`);

        input.addEventListener('input', (event) => {
            const newValue = event.target.value;
            this.updateJsonValue(path, newValue);
            this.enableSaveButton();
        });

        return input;
    }

    /**
     * Creates a button for adding elements to arrays
     */
    createAddButton(path) {
        const button = document.createElement('button');
        button.textContent = 'Add Element';
        button.className = 'add-element-button';
        button.setAttribute('data-path', path);
        return button;
    }

    /**
     * Creates a nested list element
     */
    createNestedList(path) {
        const ul = document.createElement('ul');
        ul.className = 'nested';
        ul.setAttribute('id', `nested-${this.sanitizePath(path)}`);
        ul.setAttribute('role', 'group');
        return ul;
    }

    /**
     * Toggles node visibility
     */
    toggleNodeVisibility(ul, keySpan) {
        if (ul.classList.contains('visible')) {
            ul.classList.remove('visible');
            keySpan.setAttribute('aria-expanded', 'false');
            keySpan.classList.remove('expanded');
        } else {
            ul.classList.add('visible');
            keySpan.setAttribute('aria-expanded', 'true');
            keySpan.classList.add('expanded');
        }
        this.updateExpandedNodes();
    }

    /**
     * Restores the state of expanded nodes
     */
    restoreExpandedNodes() {
        const state = this.vscode.getState();
        if (state?.expandedNodes) {
            state.expandedNodes.forEach(path => {
                const element = document.querySelector(`[data-path="${path}"] .key.collapsible`);
                if (element) {
                    const ul = element.closest('li').querySelector('.nested');
                    if (ul) {
                        ul.classList.add('visible');
                        element.classList.add('expanded');
                        element.setAttribute('aria-expanded', 'true');
                    }
                }
            });
        }
    }

    /**
     * Updates expanded nodes state
     */
    updateExpandedNodes() {
        const expandedNodes = Array.from(
            document.querySelectorAll('.key.collapsible.expanded')
        ).map(node => 
            node.closest('li').getAttribute('data-path')
        ).filter(Boolean);

        this.vscode.setState({ expandedNodes, jsonData: this.jsonData });
    }

    /**
     * Updates a JSON value
     */
    updateJsonValue(path, newValue) {
        const keys = this.parsePath(path);
        let current = this.jsonData;

        for (let i = 0; i < keys.length - 1; i++) {
            if (current[keys[i]] === undefined) {
                this.logger.warn(`Key ${keys[i]} not found.`);
                return;
            }
            current = current[keys[i]];
        }

        const lastKey = keys[keys.length - 1];
        try {
            current[lastKey] = JSON.parse(newValue);
            this.logger.log(`Updated path ${path} with parsed value:`, current[lastKey]);
        } catch {
            current[lastKey] = newValue;
            this.logger.log(`Updated path ${path} with string value:`, current[lastKey]);
        }

        this.notifyChange();
    }

    /**
     * Adds event listeners to an element
     */
    addEventListener(element) {
        element.addEventListener('click', () => {
            const ul = element.closest('li').querySelector('.nested');
            if (ul) {
                this.toggleNodeVisibility(ul, element);
            }
        });

        element.addEventListener('keydown', this.handleKeydown);
    }

    /**
     * Handles keyboard navigation
     */
    handleKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const ul = event.target.closest('li').querySelector('.nested');
            if (ul) {
                this.toggleNodeVisibility(ul, event.target);
            }
        }
    }

    /**
     * Renders an error message
     */
    renderError(container, message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'json-error';
        errorDiv.style.color = 'var(--vscode-errorForeground)';
        errorDiv.style.padding = '10px';
        errorDiv.innerHTML = `
            <h3>Error</h3>
            <p>${message}</p>
            <p>Please check your JSON file for syntax errors.</p>
        `;
        container.appendChild(errorDiv);
    }

    /**
     * Utility method to check if an object is array-like
     */
    isObjectLikeArray(obj) {
        if (typeof obj !== 'object' || obj === null) return false;
        const keys = Object.keys(obj);
        return keys.length > 0 && keys.every(key => /^\d+$/.test(key));
    }

    /**
     * Utility method to sanitize paths
     */
    sanitizePath(path) {
        return path.replace(/[\[\]\.]/g, '-');
    }

    /**
     * Utility method to parse JSON paths
     */
    parsePath(path) {
        return path.match(/[^.\[\]]+/g) || [];
    }

    /**
     * Notifies the extension of JSON changes
     */
    notifyChange() {
        this.vscode.postMessage({ type: 'jsonChanged', data: this.jsonData });
    }

    /**
     * Enables the save button
     */
    enableSaveButton() {
        const saveButton = document.getElementById('save-button');
        if (saveButton) {
            saveButton.disabled = false;
        }
    }
}