// src/test/suite/validation/DuplicateConfigurationKeysRule.test.ts
import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { DuplicateConfigurationKeysRule } from '../../../services/validation/DuplicateConfigurationKeysRule';
import { ValidationError } from '../../../types/validation';

describe('DuplicateConfigurationKeysRule Tests', () => {
  let rule: DuplicateConfigurationKeysRule;

  beforeEach(() => {
    // Create a fresh rule instance before each test
    rule = new DuplicateConfigurationKeysRule();
  });

  it('should detect duplicate property keys in JSON objects', async () => {
    // Test with JSON containing duplicate property keys
    const rawJson = `{
      "rootKey": "value",
      "object": {
        "duplicateKey": 1,
        "normalKey": true,
        "duplicateKey": 2,
        "nestedObject": {
          "anotherDuplicate": "first",
          "uniqueKey": "value",
          "anotherDuplicate": "second"
        }
      }
    }`;

    // Parse the JSON to create a JavaScript object to validate
    const testValue = JSON.parse(rawJson);

    // Pass both the parsed value and the raw text to the validate method
    const errors = await rule.validate(testValue, { enabled: true }, rawJson);

    console.log('DuplicateConfigurationKeysRule validation errors:', errors);

    // The exact number of errors may vary depending on implementation, but there should be some
    assert.ok(errors.length > 0, 'Should detect multiple duplicate property keys');

    // Verify that errors include duplicate key information
    errors.forEach((error: ValidationError) => {
      assert.strictEqual(error.code, 'DUPLICATE_CONFIGURATION_KEY', 'Should have correct error code');
      assert.ok(error.message.includes('Duplicate key'), 'Error message should mention duplicate');
      assert.ok(error.range, 'Should include position information');
    });

    // Check for specific duplicates
    assert.ok(errors.some((error: ValidationError) => error.path.includes('duplicateKey')), 'Should detect duplicateKey');
    assert.ok(errors.some((error: ValidationError) => error.path.includes('anotherDuplicate')), 'Should detect anotherDuplicate');
  });

  it('should not report errors when no duplicates exist', async () => {
    // Test with JSON containing no duplicate keys
    const rawJson = `{
      "key1": "value1",
      "key2": "value2",
      "object": {
        "nestedKey1": true,
        "nestedKey2": false
      }
    }`;

    const testValue = JSON.parse(rawJson);
    const errors = await rule.validate(testValue, { enabled: true }, rawJson);
    assert.strictEqual(errors.length, 0, 'Should not report errors when no duplicates exist');
  });

  it('should respect the enabled flag', async () => {
    // Test with JSON containing duplicate keys
    const rawJson = `{
      "duplicateKey": 1,
      "duplicateKey": 2
    }`;

    const testValue = JSON.parse(rawJson);

    // First test with rule enabled
    let errors = await rule.validate(testValue, { enabled: true }, rawJson);
    assert.ok(errors.length > 0, 'Should detect errors when enabled');

    // Then test with rule disabled
    errors = await rule.validate(testValue, { enabled: false }, rawJson);
    assert.strictEqual(errors.length, 0, 'Should not detect errors when disabled');
  });
}); 