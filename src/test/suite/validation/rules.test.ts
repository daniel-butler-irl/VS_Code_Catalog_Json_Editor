import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { ValidationRuleRegistry, NoDuplicateConfigKeysRule } from '../../../services/validation';

describe('Validation Rules Test Suite', () => {
  let registry: ValidationRuleRegistry;

  beforeEach(() => {
    // Create a fresh instance before each test
    registry = ValidationRuleRegistry.getInstance();
    registry.resetInstance();
  });

  it('NoDuplicateConfigKeysRule - should validate within each configuration block independently', async () => {
    console.log('Setting up test...');

    // Ensure the rule is enabled
    await registry.setRuleConfig('no_duplicate_config_keys', { enabled: true });
    const ruleConfig = registry.getRuleConfig('no_duplicate_config_keys');
    assert.strictEqual(ruleConfig?.enabled, true, 'Rule should be enabled');

    console.log('Running NoDuplicateConfigKeysRule test...');

    // Test with a JSON that has duplicate keys in configuration blocks
    const invalidValue = {
      "products": [
        {
          "flavors": [
            {
              "configuration": [
                {
                  "key": "key1",
                  "type": "string",
                  "required": true
                },
                {
                  "key": "key1",
                  "type": "string",
                  "required": false
                }
              ]
            }
          ]
        }
      ]
    };

    console.log('Testing invalid value:', JSON.stringify(invalidValue, null, 2));

    // Should detect duplicate keys
    const errors = await registry.validateAll(invalidValue);
    console.log('Validation errors for invalid value:', errors);

    assert.strictEqual(errors.length, 2, 'Should detect 2 errors for duplicate keys');
    assert.ok(errors.some(e => e.code === 'DUPLICATE_CONFIG_KEY'), 'Should have DUPLICATE_CONFIG_KEY error');
    assert.ok(errors[0].message.includes('key1'), 'Error message should mention the duplicate key name');

    // Test with valid configuration (no duplicates)
    const validValue = {
      "products": [
        {
          "flavors": [
            {
              "configuration": [
                {
                  "key": "key1",
                  "type": "string"
                },
                {
                  "key": "key2",
                  "type": "string"
                }
              ]
            }
          ]
        }
      ]
    };

    const validErrors = await registry.validateAll(validValue);
    assert.strictEqual(validErrors.length, 0, 'Should not have any errors for unique keys');
  });

  it('ValidationRuleRegistry - should respect rule configuration', async () => {
    console.log('Setting up test...');

    // Initially enable the rule
    await registry.setRuleConfig('no_duplicate_config_keys', { enabled: true });
    const ruleConfig = registry.getRuleConfig('no_duplicate_config_keys');
    assert.strictEqual(ruleConfig?.enabled, true, 'Rule should be enabled initially');

    console.log('Running rule configuration test...');

    // Test with a JSON that has duplicate keys
    const testValue = {
      "products": [
        {
          "flavors": [
            {
              "configuration": [
                {
                  "key": "key1",
                  "type": "string"
                },
                {
                  "key": "key1",
                  "type": "string"
                }
              ]
            }
          ]
        }
      ]
    };

    console.log('Testing value:', JSON.stringify(testValue, null, 2));

    // Should detect errors with default configuration (rule enabled)
    const defaultErrors = await registry.validateAll(testValue);
    console.log('Default configuration errors:', defaultErrors);
    assert.ok(defaultErrors.length > 0, 'Should detect errors with default configuration');
    assert.strictEqual(defaultErrors.length, 2, 'Should detect 2 errors for duplicate keys');

    // Now disable the rule
    await registry.setRuleConfig('no_duplicate_config_keys', { enabled: false });

    // Verify the rule is now disabled
    const updatedConfig = registry.getRuleConfig('no_duplicate_config_keys');
    assert.strictEqual(updatedConfig?.enabled, false, 'Rule should be disabled');

    // Should NOT detect errors with rule disabled
    const afterDisableErrors = await registry.validateAll(testValue);
    assert.strictEqual(afterDisableErrors.length, 0, 'Should not detect errors when rule is disabled');
  });

  it('ValidationRuleRegistry - should handle complex nested structures', async () => {
    console.log('Setting up test...');

    // Ensure the rule is enabled
    await registry.setRuleConfig('no_duplicate_config_keys', { enabled: true });

    console.log('Running complex structure test...');

    // Test with complex structure containing multiple duplicate keys in different places
    const complexValue = {
      "install_type": "operator",
      "products": [
        {
          "flavors": [
            {
              "configuration": [
                {
                  "key": "key1",
                  "type": "string"
                },
                {
                  "key": "key2",
                  "type": "string"
                }
              ]
            },
            {
              "configuration": [
                {
                  "key": "key3",
                  "type": "string"
                },
                {
                  "key": "key3",
                  "type": "string"
                }
              ]
            }
          ]
        },
        {
          "flavors": [
            {
              "configuration": [
                {
                  "key": "key4",
                  "type": "string"
                },
                {
                  "key": "key4",
                  "type": "string"
                }
              ]
            }
          ]
        }
      ]
    };

    console.log('Testing complex value:', JSON.stringify(complexValue, null, 2));

    // Should find all duplicate key instances across the complex structure
    const complexErrors = await registry.validateAll(complexValue);
    console.log('Complex structure validation errors:', complexErrors);

    // There should be 4 errors total (2 for each duplicate key)
    assert.strictEqual(complexErrors.length, 4, 'Should find all duplicate key instances');

    // Check for duplicate key3 in the first product's second flavor
    assert.ok(complexErrors.some(e => e.path && e.path.includes('flavors.1') && e.message.includes('key3')),
      'Should detect duplicate key3 in first product\'s second flavor');

    // Check for duplicate key4 in the second product's flavor
    assert.ok(complexErrors.some(e => e.path && e.path.includes('products.1') && e.message.includes('key4')),
      'Should detect duplicate key4 in second product\'s flavor');
  });

  it('ValidationRuleRegistry - should handle empty or invalid input', async () => {
    console.log('Setting up test...');

    // No rule setup needed for this test

    console.log('Running empty/invalid input test...');

    // Test with null
    const nullErrors = await registry.validateAll(null);
    console.log('Null input errors:', nullErrors);
    assert.strictEqual(nullErrors.length, 0, 'Should not error on null input');

    // Test with undefined
    const undefinedErrors = await registry.validateAll(undefined);
    console.log('Undefined input errors:', undefinedErrors);
    assert.strictEqual(undefinedErrors.length, 0, 'Should not error on undefined input');

    // Test with empty object
    const emptyErrors = await registry.validateAll({});
    console.log('Empty object errors:', emptyErrors);
    assert.strictEqual(emptyErrors.length, 0, 'Should not error on empty object');

    // Test with invalid structure
    const invalidStructure = { notAProduct: true };
    const invalidErrors = await registry.validateAll(invalidStructure);
    console.log('Invalid structure errors:', invalidErrors);
    assert.strictEqual(invalidErrors.length, 0, 'Should not error on invalid structure');
  });
}); 