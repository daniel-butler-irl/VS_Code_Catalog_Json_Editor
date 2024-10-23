import { Logger } from './modules/logger.js';
import { JsonRenderer } from './modules/jsonRenderer.js';
import { StateManager } from './modules/stateManager.js';
import { ModalManager } from './modules/modalManager.js';
import { MessageHandler } from './modules/messageHandler.js';

(function () {
    const vscode = acquireVsCodeApi();
    
    // Initialize modules
    const logger = new Logger(vscode);
    const jsonRenderer = new JsonRenderer(vscode, logger);
    const stateManager = new StateManager(vscode, logger);
    const modalManager = new ModalManager(logger);
    const messageHandler = new MessageHandler(vscode, logger, jsonRenderer, stateManager);

    // Initialize message handling
    messageHandler.initialize();

    // Send ready message
    logger.log('Webview script initialized.');
    vscode.postMessage({ type: 'ready' });
})();