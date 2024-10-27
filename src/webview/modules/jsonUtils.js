// src/webview/modules/jsonUtils.js

/**
 * Utility functions for handling JSON data.
 */
export class JsonUtils {
    /**
     * Parses a JSON string into an object.
     * @param {string} jsonString The JSON string to parse.
     * @returns {any} The parsed JSON object.
     */
    static parseJson(jsonString) {
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            throw new Error('Invalid JSON format.');
        }
    }

    /**
     * Stringifies a JSON object into a formatted string.
     * @param {any} jsonData The JSON data to stringify.
     * @param {number} indent The number of spaces for indentation.
     * @returns {string} The stringified JSON.
     */
    static stringifyJson(jsonData, indent = 2) {
        return JSON.stringify(jsonData, null, indent);
    }

    /**
     * Converts a value to its string representation.
     * @param {any} value The value to convert.
     * @returns {string} The string representation.
     */
    static stringifyValue(value) {
        if (typeof value === 'string') {
            return `"${value}"`;
        }
        return String(value);
    }

    /**
     * Validates JSON data against a schema.
     * @param {any} jsonData The JSON data to validate.
     * @param {Object} schema The JSON schema to validate against.
     * @returns {Object} The validation result.
     */
    static validateJson(jsonData, schema) {
        // Implement validation logic using a library like Ajv if possible.
        // For simplicity, this function returns a dummy validation.
        // Replace with actual validation in a real implementation.
        const isValid = true; // Placeholder
        const errors = []; // Placeholder

        if (!isValid) {
            return { isValid, errors };
        }

        return { isValid, errors };
    }
}
