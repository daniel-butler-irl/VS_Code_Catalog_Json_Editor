// src/utils/jsonUtils.ts
import stripJsonComments from 'strip-json-comments';

export class JsonUtils {
    /**
     * Parses a JSON string, handling special characters and comments
     * @param jsonString The JSON string to parse
     * @returns Parsed JSON object
     */
    public static parseJson(jsonString: string): any {
        try {
            // Remove any BOM and special characters
            const cleanedString = jsonString
                .replace(/^\uFEFF/, '') // Remove BOM
                .replace(/[^\x20-\x7E\s]/g, '') // Remove non-printable characters
                .trim();

            // Remove comments and parse
            const strippedString = stripJsonComments(cleanedString);
            return JSON.parse(strippedString);
        } catch (error) {
            // Log the problematic JSON for debugging
            console.error('Invalid JSON:', jsonString);
            if (error instanceof SyntaxError) {
                const position = this.findErrorPosition(error);
                throw new Error(`JSON Syntax Error at position ${position}: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Stringifies JSON data with proper formatting
     */
    public static stringifyJson(jsonData: any): string {
        return JSON.stringify(jsonData, null, 2);
    }

    /**
     * Attempts to find the position of a JSON syntax error
     */
    private static findErrorPosition(error: SyntaxError): number {
        const match = error.message.match(/at position (\d+)/);
        return match ? parseInt(match[1], 10) : -1;
    }

    /**
     * Validates if a string is valid JSON
     */
    public static isValidJson(str: string): boolean {
        try {
            this.parseJson(str);
            return true;
        } catch {
            return false;
        }
    }
}