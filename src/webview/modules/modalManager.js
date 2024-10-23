/**
 * Handles all modal-related functionality
 */
export class ModalManager {
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Shows the modal for adding a new element
     * @param {string} listPath - The path where the element will be added
     * @param {Function} onAdd - Callback for when element is added
     */
    showAddElementModal(listPath, onAdd) {
        const modalOverlay = document.getElementById('modal-overlay');
        const elementInput = document.getElementById('element-input');
        const addButton = document.getElementById('modal-add-button');
        const cancelButton = document.getElementById('modal-cancel-button');

        modalOverlay.hidden = false;
        elementInput.value = '';
        elementInput.focus();

        this.setupModalEventListeners(modalOverlay, elementInput, addButton, cancelButton, listPath, onAdd);
    }

    /**
     * Closes the modal and cleans up event listeners
     */
    closeModal() {
        const modalOverlay = document.getElementById('modal-overlay');
        if (modalOverlay) {
            modalOverlay.hidden = true;
        }

        this.cleanupModalEventListeners();
    }
}