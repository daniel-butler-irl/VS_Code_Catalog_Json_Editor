// src/ui/AddElementDialog.ts

import * as vscode from 'vscode';
import { SchemaService } from '../services/SchemaService';
import { CatalogTreeItem } from '../models/CatalogTreeItem';

/**
 * Class responsible for displaying a dynamic form based on schema
 * to add new elements to the catalog.
 */
export class AddElementDialog {
  /**
   * Shows the dialog to add a new element.
   * @param parentItem The parent tree item where the new element will be added.
   * @param schemaService The schema service instance.
   */
  public static async show(
    parentNode: CatalogTreeItem,
    schemaService: SchemaService
  ): Promise<any | undefined> {
    const schema = schemaService.getSchemaForPath(parentNode.jsonPath);
    if (!schema) {
      vscode.window.showErrorMessage('Schema not found for the selected item.');
      return undefined;
    }

    // For arrays, we need to get the schema for array items
    const effectiveSchema = schema.items || schema;

    // Generate form fields based on the schema
    try {
      return await this.generateForm(effectiveSchema);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to generate form: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return undefined;
    }
  }

  /**
   * Recursively generates form fields based on the schema.
   * @param schema The schema definition.
   * @param parentKey The parent key for nested fields.
   */
  private static async generateForm(
    schema: any,
    parentKey: string = ''
  ): Promise<any> {
    const result: any = {};

    if (schema.type === 'object' && schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;

        // Handle required fields
        const isRequired = schema.required && schema.required.includes(key);

        // Get user input for the field
        const input = await this.getInputForField(key, value, isRequired);

        if (input !== undefined) {
          result[key] = input;
        } else if (isRequired) {
          // If a required field is not provided, abort the process
          vscode.window.showWarningMessage(`Field "${key}" is required.`);
          return undefined;
        }
      }
    } else if (schema.type === 'array' && schema.items) {
      // Handle array type fields if necessary
      // For simplicity, we can prompt the user to enter multiple values
      const items = [];
      let addMore = true;

      while (addMore) {
        const item = await this.generateForm(schema.items, parentKey);
        if (item !== undefined) {
          items.push(item);
        }

        const response = await vscode.window.showQuickPick(['Yes', 'No'], {
          placeHolder: 'Add another item?',
        });

        addMore = response === 'Yes';
      }

      result[parentKey] = items;
    } else {
      // Handle primitive types
      const input = await this.getInputForField(parentKey, schema);

      if (input !== undefined) {
        return input;
      }
    }

    return result;
  }

  /**
   * Prompts the user for input based on the field schema.
   * @param key The field name.
   * @param schema The schema definition for the field.
   * @param isRequired Whether the field is required.
   */
  private static async getInputForField(
    key: string,
    schema: any,
    isRequired: boolean = false
  ): Promise<any | undefined> {
    let prompt = `Enter value for ${key}`;
    if (schema.description) {
      prompt += ` (${schema.description})`;
    }

    if (schema.enum) {
      // Use QuickPick for enum values
      const options = schema.enum.map((val: any) => val.toString());
      const selection = await vscode.window.showQuickPick(options, {
        placeHolder: prompt,
        canPickMany: false,
      });

      if (selection !== undefined) {
        return this.castValue(selection, schema.type);
      }
    } else {
      // Use InputBox for other types
      const input = await vscode.window.showInputBox({
        prompt: prompt,
        validateInput: (value) => {
          if (isRequired && !value) {
            return 'This field is required.';
          }
          return null;
        },
      });

      if (input !== undefined) {
        return this.castValue(input, schema.type);
      }
    }

    return undefined;
  }

  /**
   * Casts the input value to the appropriate type based on the schema.
   * @param value The input value as a string.
   * @param type The expected type from the schema.
   */
  private static castValue(value: string, type: string): any {
    switch (type) {
      case 'string':
        return value;
      case 'number':
        return Number(value);
      case 'boolean':
        return value.toLowerCase() === 'true';
      default:
        return value;
    }
  }
}
