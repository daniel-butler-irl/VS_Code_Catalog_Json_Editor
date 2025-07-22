// Mock implementation of VS Code API for Jest tests
/// <reference types="jest" />
export const EventEmitter = jest.fn();

export const Uri = {
  file: jest.fn((path: string) => ({ fsPath: path, path })),
  parse: jest.fn(),
  joinPath: jest.fn(),
};

export const workspace = {
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
};

export const window = {
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
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
};

export const languages = {
  registerHoverProvider: jest.fn(),
  registerCompletionItemProvider: jest.fn(),
  registerDefinitionProvider: jest.fn(),
  createDiagnosticCollection: jest.fn(() => ({
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
  })),
};

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3,
  Active: -1,
  Beside: -2,
};

export const WebviewPanelOptions = {};
export const WebviewOptions = {};

export const TextDocumentContentChangeEvent = jest.fn();
export const Position = jest.fn();
export const Range = jest.fn();
export const Selection = jest.fn();
export const TextDocument = jest.fn();
export const TextEditor = jest.fn();

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

export const env = {
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
};

export const version = '1.87.0';

export const ExtensionContext = jest.fn();
export const ExtensionMode = {
  Production: 1,
  Development: 2,
  Test: 3,
};

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

export const ThemeColor = jest.fn().mockImplementation((id: string) => ({ id }));
export const ThemeIcon = jest.fn().mockImplementation((id: string) => ({ id }));

export const MarkdownString = jest.fn();

export const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
};

export const CodeActionKind = {
  QuickFix: 'quickfix',
  Refactor: 'refactor',
  RefactorExtract: 'refactor.extract',
  RefactorInline: 'refactor.inline',
  RefactorRewrite: 'refactor.rewrite',
  Source: 'source',
  SourceOrganizeImports: 'source.organizeImports',
  SourceFixAll: 'source.fixAll',
};