// src/types/ui/state.ts

/**
 * Interface representing the state of the UI.
 */
export interface UIState {
    /**
     * The state of the tree view component.
     */
    treeView: TreeViewState;
}

/**
 * Interface representing the state of the tree view component.
 */
export interface TreeViewState {
    /**
     * An array of node identifiers that are currently expanded.
     */
    expandedNodes: string[];

    /**
     * The current scroll position of the tree view.
     */
    scrollPosition?: number;

    /**
     * The path of the last selected node in the tree view.
     */
    lastSelectedPath?: string;
}

/**
 * Interface representing an event that changes the UI state.
 * @template K - The key of the UI state that is being changed.
 */
export interface UIStateChangeEvent<K extends keyof UIState> {
    /**
     * The key of the UI state that is being changed.
     */
    key: K;

    /**
     * The new value of the UI state.
     */
    value: UIState[K];
}