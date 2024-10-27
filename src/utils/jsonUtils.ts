// src/utils/jsonUtils.ts

import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

export interface JsonValidationResult {
    isValid: boolean;
    errors?: string[];
}

/**
 * Utility class for JSON operations.
 */
export class JsonUtils {
    private static ajv: Ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
    private static initialized = false;

    /**
     * Initializes Ajv with necessary plugins.
     */
    public static initialize(): void {
        if (!this.initialized) {
            addFormats(this.ajv);
            this.initialized = true;
        }
    }

    /**
     * Parses a JSON string, removing comments and handling special characters.
     * @param jsonString 
     * @returns 
     */
    public static parseJson(jsonString: string): any {
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
 * Stringifies a JSON object with indentation.
 * @param jsonData The data to stringify
 * @param indent The number of spaces for indentation (default: 4)
 * @returns Formatted JSON string
 */
public static stringifyJson(jsonData: any, indent: number = 4): string {
    return JSON.stringify(jsonData, null, indent);
}

    /**
     * Validates JSON data against a schema.
     * @param jsonData 
     * @param schema 
     * @returns 
     */
    public static validateJson(jsonData: any, schema: any): JsonValidationResult {
        this.initialize();
        const validate = this.ajv.compile(schema);
        const valid = validate(jsonData);
        if (valid) {
            return { isValid: true };
        } else {
            const errors = validate.errors?.map((err: ErrorObject) => `${err.instancePath} ${err.message}`) || [];
            return { isValid: false, errors };
        }
    }

    /**
     * Formats a JSON value for display.
     * @param value 
     * @returns 
     */
    public static stringifyValue(value: any): string {
        if (typeof value === 'string') {
            return `"${value}"`;
        }
        return String(value);
    }
}
