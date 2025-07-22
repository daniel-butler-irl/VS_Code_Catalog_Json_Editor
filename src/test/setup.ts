// Jest test setup file - configure global mocks and test environment
// This file is run before each test suite
/// <reference types="jest" />
/// <reference path="./jest.d.ts" />

// Mock vscode module globally for all tests
jest.mock('vscode', () => ({
  EventEmitter: jest.fn(),
  Uri: {
    file: jest.fn((path: string) => ({ fsPath: path, path })),
    parse: jest.fn(),
    joinPath: jest.fn(),
  },
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn(),
      update: jest.fn(),
      has: jest.fn(),
      inspect: jest.fn(),
    })),
    onDidChangeConfiguration: jest.fn(),
    workspaceFolders: [],
    getWorkspaceFolder: jest.fn(),
    openTextDocument: jest.fn(),
    applyEdit: jest.fn(),
    createFileSystemWatcher: jest.fn(() => ({
      onDidChange: jest.fn(),
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    })),
    fs: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      stat: jest.fn(),
      readDirectory: jest.fn(),
      createDirectory: jest.fn(),
      delete: jest.fn(),
    },
  },
  window: {
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    createOutputChannel: jest.fn(() => ({
      append: jest.fn(),
      appendLine: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    })),
    createWebviewPanel: jest.fn(),
    createTreeView: jest.fn(),
    registerWebviewPanelSerializer: jest.fn(),
    activeTextEditor: null,
    onDidChangeActiveTextEditor: jest.fn(),
    showTextDocument: jest.fn(),
    createStatusBarItem: jest.fn(() => ({
      text: '',
      tooltip: '',
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    })),
    withProgress: jest.fn(),
  },
  commands: {
    registerCommand: jest.fn(),
    executeCommand: jest.fn(),
  },
  languages: {
    registerHoverProvider: jest.fn(),
    registerCompletionItemProvider: jest.fn(),
    registerDefinitionProvider: jest.fn(),
    createDiagnosticCollection: jest.fn(() => ({
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      dispose: jest.fn(),
    })),
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  TreeItem: class TreeItem {
    constructor(public label: string, public collapsibleState?: number) {}
  },
  ViewColumn: {
    One: 1,
    Two: 2,
    Three: 3,
    Active: -1,
    Beside: -2,
  },
  WebviewPanelOptions: {},
  WebviewOptions: {},
  TextDocumentContentChangeEvent: jest.fn(),
  Position: jest.fn(),
  Range: jest.fn(),
  Selection: jest.fn(),
  TextDocument: jest.fn(),
  TextEditor: jest.fn(),
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  env: {
    appName: 'Visual Studio Code',
    appRoot: '/path/to/vscode',
    language: 'en',
    machineId: 'test-machine-id',
    sessionId: 'test-session-id',
    shell: '/bin/bash',
    clipboard: {
      readText: jest.fn(),
      writeText: jest.fn(),
    },
    openExternal: jest.fn(),
  },
  version: '1.87.0',
}));

// Set up global test environment
global.console = {
  ...console,
  // Optionally suppress console.log in tests
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock performance for Node.js environment
if (typeof performance === 'undefined') {
  global.performance = {
    now: jest.fn(() => Date.now()),
    mark: jest.fn(),
    measure: jest.fn(),
    getEntriesByType: jest.fn(() => []),
    getEntriesByName: jest.fn(() => []),
    clearMarks: jest.fn(),
    clearMeasures: jest.fn(),
  } as any;
}

// Mock timers
jest.useFakeTimers();