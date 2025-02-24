import { SchemaMetadata } from '../types/schema';
import { ValidationResult, ValidationError } from '../types/validation';
import { LoggingService } from '../services/core/LoggingService';
import { SchemaService } from '../services/SchemaService';

interface SchemaValidationContext {
  schemaService: SchemaService;
}

/**
 * Schema validation decorator factory
 */
export function validateSchema() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const logger = LoggingService.getInstance();

    descriptor.value = async function (this: SchemaValidationContext, ...args: any[]) {
      try {
        if (!args[0] || !this.schemaService) {
          logger.debug('Skipping schema validation - no value or schema service', {
            hasValue: !!args[0],
            hasSchemaService: !!this.schemaService
          }, 'schemaValidation');
          return await originalMethod.apply(this, args);
        }

        const node = args[0];
        logger.debug('Starting schema validation', {
          path: node.jsonPath,
          value: node.value,
          type: typeof node.value
        }, 'schemaValidation');

        const schemaMetadata = await this.schemaService.getSchemaForPath(node.jsonPath);
        if (schemaMetadata) {
          logger.debug('Found schema metadata', {
            path: node.jsonPath,
            schema: schemaMetadata
          }, 'schemaValidation');

          const validationResult = await validateValue(node.value, schemaMetadata, node.jsonPath);
          if (!validationResult.isValid) {
            logger.warn('Schema validation failed', {
              property: propertyKey,
              path: node.jsonPath,
              value: node.value,
              schema: schemaMetadata,
              errors: validationResult.errors
            }, 'schemaValidation');
            return false;
          } else {
            logger.debug('Schema validation succeeded', {
              path: node.jsonPath,
              value: node.value,
              schema: schemaMetadata
            }, 'schemaValidation');
          }
        } else {
          logger.warn('No schema found for path', {
            path: node.jsonPath,
            value: node.value
          }, 'schemaValidation');
        }

        return await originalMethod.apply(this, args);
      } catch (error) {
        logger.error('Schema validation error', {
          property: propertyKey,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }, 'schemaValidation');
        return false;
      }
    };

    return descriptor;
  };
}

/**
 * Validates a value against schema metadata
 * @param value The value to validate
 * @param schema The schema metadata to validate against
 */
export async function validateValue(value: unknown, schema: SchemaMetadata, path: string = ''): Promise<ValidationResult> {
  const logger = LoggingService.getInstance();
  const errors: ValidationError[] = [];

  logger.debug('Validating value against schema', {
    value,
    schema
  }, 'schemaValidation');

  // Type validation
  if (schema.type && !validateType(value, schema.type)) {
    const error = {
      code: 'TYPE_ERROR',
      message: `Expected type ${schema.type}, got ${typeof value}`,
      path
    };
    logger.warn('Type validation failed', {
      expectedType: schema.type,
      actualType: typeof value,
      value
    }, 'schemaValidation');
    errors.push(error);
  }

  // Required validation
  if (schema.required && (value === undefined || value === null)) {
    const error = {
      code: 'REQUIRED_ERROR',
      message: 'Value is required',
      path
    };
    logger.warn('Required validation failed', {
      value
    }, 'schemaValidation');
    errors.push(error);
  }

  // Enum validation
  if (schema.enum && !schema.enum.includes(value as string)) {
    const error = {
      code: 'ENUM_ERROR',
      message: `Value must be one of: ${schema.enum.join(', ')}`,
      path
    };
    logger.warn('Enum validation failed', {
      allowedValues: schema.enum,
      actualValue: value
    }, 'schemaValidation');
    errors.push(error);
  }

  // Object property validation
  if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
    logger.debug('Validating object properties', {
      properties: Object.keys(schema.properties)
    }, 'schemaValidation');

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const propValue = (value as Record<string, unknown>)[key];
      const propPath = path ? `${path}.${key}` : key;
      const propResult = await validateValue(propValue, propSchema, propPath);
      if (!propResult.isValid && propResult.errors) {
        logger.warn('Object property validation failed', {
          property: key,
          value: propValue,
          errors: propResult.errors
        }, 'schemaValidation');
        errors.push(...propResult.errors);
      }
    }
  }

  // Array item validation
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    logger.debug('Validating array items', {
      arrayLength: value.length
    }, 'schemaValidation');

    for (let i = 0; i < value.length; i++) {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`;
      const itemResult = await validateValue(value[i], schema.items, itemPath);
      if (!itemResult.isValid && itemResult.errors) {
        logger.warn('Array item validation failed', {
          index: i,
          value: value[i],
          errors: itemResult.errors
        }, 'schemaValidation');
        errors.push(...itemResult.errors);
      }
    }
  }

  const result = {
    isValid: errors.length === 0,
    value: value,
    errors: errors.length > 0 ? errors : undefined
  };

  logger.debug('Validation result', result, 'schemaValidation');
  return result;
}

/**
 * Validates if a value matches the expected type
 * @param value The value to validate
 * @param expectedType The expected type
 */
function validateType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
} 