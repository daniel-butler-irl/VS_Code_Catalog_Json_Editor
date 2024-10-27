// src/utils/errors.ts

export class WorkspaceRequiredError extends Error {
    constructor(message: string = 'A workspace is required to use this extension.') {
        super(message);
        this.name = 'WorkspaceRequiredError';
    }
}

export class ApiKeyRequiredError extends Error {
    constructor(message: string = 'API key is required to authenticate with IBM Cloud.') {
        super(message);
        this.name = 'ApiKeyRequiredError';
    }
}

export class FileOperationError extends Error {
    constructor(message: string = 'An error occurred during a file operation.') {
        super(message);
        this.name = 'FileOperationError';
    }
}

// Add more custom error classes as needed
