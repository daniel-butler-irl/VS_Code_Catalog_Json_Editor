// src/services/core/UIStateService.ts

import * as vscode from 'vscode';
import { LoggingService } from './LoggingService';
import { UIState, UIStateChangeEvent } from '../../types/ui/state';

/**
 * Service for managing persistent UI state with optimized performance.
 */
export class UIStateService {
    private static instance: UIStateService;
    private readonly logger = LoggingService.getInstance();
    private readonly stateKey = 'ibmCatalog.uiState';
    private state: UIState;
    private debounceSaveTimer: NodeJS.Timeout | null = null;
    private cachedTreeState: UIState['treeView'] | null = null;

    private readonly _onDidChangeState = new vscode.EventEmitter<UIStateChangeEvent<keyof UIState>>();
    public readonly onDidChangeState = this._onDidChangeState.event;

    private constructor(private readonly context: vscode.ExtensionContext) {
        this.logger.debug('Initializing UIStateService');
        this.state = this.loadState();
    }

    public static getInstance(context?: vscode.ExtensionContext): UIStateService {
        if (!UIStateService.instance) {
            if (!context) {
                throw new Error('UIStateService must be initialized with context');
            }
            UIStateService.instance = new UIStateService(context);
        }
        return UIStateService.instance;
    }

    private loadState(): UIState {
        const defaultState: UIState = {
            treeView: {
                expandedNodes: [],
                scrollPosition: 0
            }
        };

        const savedState = this.context.globalState.get<UIState>(this.stateKey);
        return savedState ?? defaultState;
    }

    /**
     * Saves state with debouncing to prevent rapid consecutive saves.
     */
    private async debouncedSave(): Promise<void> {
        if (this.debounceSaveTimer) {
            clearTimeout(this.debounceSaveTimer);
        }

        return new Promise((resolve) => {
            this.debounceSaveTimer = setTimeout(async () => {
                try {
                    await this.context.globalState.update(this.stateKey, this.state);
                    this.logger.debug('State saved successfully');
                } catch (error) {
                    this.logger.error('Failed to save state', error);
                }
                this.debounceSaveTimer = null;
                resolve();
            }, 250);
        });
    }

    /**
     * Gets cached tree state for optimized access.
     */
    public getTreeState(): UIState['treeView'] {
        if (!this.cachedTreeState) {
            this.cachedTreeState = { ...this.state.treeView };
        }
        return this.cachedTreeState;
    }

    /**
     * Updates tree state with optimized save and cache invalidation.
     */
    public async updateTreeState(update: Partial<UIState['treeView']>): Promise<void> {
        this.state.treeView = {
            ...this.state.treeView,
            ...update
        };
        this.cachedTreeState = null;

        await this.debouncedSave();

        this._onDidChangeState.fire({
            key: 'treeView',
            value: this.state.treeView
        } as UIStateChangeEvent<'treeView'>);
    }

    public dispose(): void {
        if (this.debounceSaveTimer) {
            clearTimeout(this.debounceSaveTimer);
        }
        this._onDidChangeState.dispose();
    }
}