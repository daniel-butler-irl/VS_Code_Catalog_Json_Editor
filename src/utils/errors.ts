// src/utils/errors.ts
export class WorkspaceRequiredError extends Error {
    constructor(message: string = 'This operation requires a workspace to be open.') {
        super(message);
        this.name = 'WorkspaceRequiredError';
    }
}

export class ApiKeyRequiredError extends Error {
    constructor(message: string = 'This operation requires an API key.') {
        super(message);
        this.name = 'ApiKeyRequiredError';
    }
}

export class FileOperationError extends Error {
    constructor(message: string, public readonly path?: string) {
        super(message);
        this.name = 'FileOperationError';
    }
}