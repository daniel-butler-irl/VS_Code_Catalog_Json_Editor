// src/webview/webview.js

import { JsonRenderer } from './modules/jsonRenderer';
import { Logger } from './modules/logger';
import { MessageHandler } from './modules/messageHandler';
import { ModalManager } from './modules/modalManager';
import { StateManager } from './modules/stateManager';

/**
 * Initialize the webview's frontend modules.
 */

// Acquire the VS Code API
const vscode = acquireVsCodeApi();

// Initialize the Logger
const logger = new Logger();

// Initialize the JsonRenderer
const jsonRenderer = new JsonRenderer(vscode, logger);

// Initialize the StateManager
const stateManager = new StateManager(vscode, logger);

// Initialize the ModalManager
const modalManager = new ModalManager(logger);

// Initialize the MessageHandler
const messageHandler = new MessageHandler(logger);
messageHandler.initialize();

// Set up event listeners

// Handle save button click
document.getElementById('save-button').addEventListener('click', () => {
    const jsonData = extractJsonData(); // Implement this function to gather JSON from the UI
    vscode.postMessage({ type: 'saveJson', json: jsonData });
});

// Handle refresh button click
document.getElementById('refresh-catalog-button').addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshAllCatalogs' });
});

// Handle modal close
document.getElementById('modal-close').addEventListener('click', () => {
    modalManager.closeModal();
});

// Handle modal add button
document.getElementById('modal-add-button').addEventListener('click', () => {
    const newValue = document.getElementById('element-input').value;
    modalManager.addElement(newValue);
});

// Handle modal cancel button
document.getElementById('modal-cancel-button').addEventListener('click', () => {
    modalManager.closeModal();
});

// Function to extract JSON data from the UI
function extractJsonData() {
    // Implement logic to traverse the DOM and construct the JSON object
    // This can be complex depending on the UI's structure
    // For demonstration, returning an empty object
    return {};
}

// Notify the backend that the webview is ready
vscode.postMessage({ type: 'ready' });
