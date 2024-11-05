// types/decorators/index.ts

export interface DeduplicationOptions {
    /** Custom key generator function */
    keyGenerator?: (...args: any[]) => string;
    /** Timeout in milliseconds */
    timeoutMs?: number;
    /** Callback for duplicate requests */
    onDuplicate?: (key: string) => void;
}

// New interfaces to better type the decorators
export interface CacheDecoratorOptions {
    /** Cache key prefix or generator */
    key?: string | ((...args: any[]) => string);
    /** Time-to-live in seconds */
    ttl?: number;
    /** Whether to persist across sessions */
    persistent?: boolean;
}

export interface LogDecoratorOptions {
    /** Whether to log arguments */
    logArgs?: boolean;
    /** Whether to log return value */
    logResult?: boolean;
    /** Custom message */
    message?: string;
}

export interface RetryDecoratorOptions {
    /** Maximum number of retries */
    maxRetries?: number;
    /** Delay between retries in ms */
    delayMs?: number;
    /** Whether to use exponential backoff */
    useExponentialBackoff?: boolean;
}