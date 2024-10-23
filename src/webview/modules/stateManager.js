// src/webview/modules/stateManager.js
export class StateManager {
    constructor(vscode, logger) {
        this.vscode = vscode;
        this.logger = logger;
        this.state = this.vscode.getState() || {};
    }

    /**
     * Updates the state with new data
     * @param {Object} newState - The state updates to apply
     */
    updateState(newState) {
        this.state = { ...this.state, ...newState };
        this.vscode.setState(this.state);
        this.logger.log('State updated:', newState);
    }

    /**
     * Gets current state value
     * @param {string} key - The key to retrieve
     * @returns {any} The state value
     */
    getState(key) {
        return this.state[key];
    }

    /**
     * Updates the state of expanded nodes and saves it
     * @param {string[]} expandedNodes - Array of expanded node paths
     */
    updateExpandedNodes(expandedNodes) {
        this.logger.log('Current expanded nodes:', expandedNodes);
        this.updateState({ expandedNodes, jsonData: this.jsonData });
    }

    /**
     * Restores previously expanded nodes from saved state
     */
    restoreExpandedNodes() {
        const state = this.vscode.getState();
        if (!state?.expandedNodes) {
            this.logger.log('No expandedNodes found in state.');
            return;
        }
        this.restoreNodes(state.expandedNodes);
    }

    /**
     * Restores specific nodes to their expanded state
     * @param {string[]} nodes - Array of node paths to restore
     */
    restoreNodes(nodes) {
        nodes.forEach(nodePath => {
            const element = document.querySelector(`[data-path="${nodePath}"] .key.collapsible`);
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