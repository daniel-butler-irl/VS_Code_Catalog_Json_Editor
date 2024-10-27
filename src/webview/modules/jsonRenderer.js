// src/webview/modules/jsonRenderer.js

import { JsonUtils } from './jsonUtils';

/**
 * Handles rendering JSON data into the webview.
 */
export class JsonRenderer {
    constructor(vscode, logger) {
        this.vscode = vscode;
        this.logger = logger;
        this.jsonData = {};
    }

    /**
     * Renders the JSON data into the webview.
     * @param {Object} data - The JSON data to render.
     * @param {Object} schema - The JSON schema for validation.
     */
    async renderJson(data, schema) {
        try {
            this.jsonData = data;
            const jsonViewer = document.getElementById('json-viewer');
            jsonViewer.innerHTML = ''; // Clear previous content

            // Build the JSON tree
            this.buildJsonTree(data, jsonViewer, '$');
        } catch (error) {
            this.logger.error('Failed to render JSON:', error);
            // Optionally, display an error message in the UI
            const jsonViewer = document.getElementById('json-viewer');
            jsonViewer.innerHTML = '<p class="json-error">Failed to render JSON data.</p>';
        }
    }

    /**
     * Recursively builds a tree view of the JSON data.
     * @param {any} data - The JSON data.
     * @param {HTMLElement} container - The container to append elements to.
     * @param {string} path - The JSONPath to the current data.
     */
    buildJsonTree(data, container, path) {
        if (typeof data !== 'object' || data === null) {
            // Primitive value
            const valueElement = document.createElement('span');
            valueElement.className = 'json-value value';
            valueElement.textContent = JsonUtils.stringifyValue(data);
            valueElement.setAttribute('data-path', path);
            container.appendChild(valueElement);
            return;
        }

        if (Array.isArray(data)) {
            // Array
            data.forEach((item, index) => {
                const itemPath = `${path}[${index}]`;
                const itemContainer = document.createElement('div');
                itemContainer.className = 'json-node';
                container.appendChild(itemContainer);

                this.buildJsonTree(item, itemContainer, itemPath);
            });
        } else {
            // Object
            for (const key in data) {
                if (data.hasOwnProperty(key)) {
                    const keyPath = `${path}.${key}`;
                    const node = document.createElement('div');
                    node.className = 'json-node';
                    node.setAttribute('data-path', keyPath);

                    const keyElement = document.createElement('span');
                    keyElement.className = 'json-key';
                    keyElement.textContent = `${key}: `;

                    const value = data[key];
                    const valueElement = document.createElement('span');
                    valueElement.className = 'json-value value';
                    valueElement.setAttribute('data-path', keyPath);

                    if (typeof value === 'object' && value !== null) {
                        valueElement.textContent = Array.isArray(value) ? '[...]' : '{...}';
                        // Optionally, add expand/collapse functionality
                    } else {
                        valueElement.textContent = JsonUtils.stringifyValue(value);
                    }

                    node.appendChild(keyElement);
                    node.appendChild(valueElement);
                    container.appendChild(node);

                    if (typeof value === 'object' && value !== null) {
                        const childContainer = document.createElement('div');
                        childContainer.className = 'json-children';
                        node.appendChild(childContainer);
                        this.buildJsonTree(value, childContainer, keyPath);
                    }
                }
            }
        }
    }
}
