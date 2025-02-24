import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { ValidationRuleRegistry, InstallTypeRequiredRule, NoDuplicateConfigKeysRule } from '../../../types/validation/rules';

describe('Validation Rules Test Suite', () => {
  let registry: ValidationRuleRegistry;

  beforeEach(() => {
    console.log('Setting up test...');
    registry = ValidationRuleRegistry.getInstance();
    registry.resetInstance(); // Reset to default state before each test
  });

  it('InstallTypeRequiredRule - should be disabled by default', async () => {
    console.log('Running InstallTypeRequiredRule test...');
    const rule = new InstallTypeRequiredRule();

    // Test with missing install_type
    const invalidValue = {
      name: 'test'
    };

    // Should not report error when disabled (default state)
    const errors1 = await rule.validate(invalidValue, { enabled: false });
    console.log('Disabled validation errors:', errors1);
    assert.strictEqual(errors1.length, 0);

    // Should report error when enabled
    const errors2 = await rule.validate(invalidValue, { enabled: true });
    console.log('Enabled validation errors:', errors2);
    assert.strictEqual(errors2.length, 1);
    assert.strictEqual(errors2[0].code, 'INSTALL_TYPE_REQUIRED');
    assert.ok(errors2[0].range); // Should have range information
  });

  it('NoDuplicateConfigKeysRule - should validate within each configuration block independently', async () => {
    console.log('Running NoDuplicateConfigKeysRule test...');
    const rule = new NoDuplicateConfigKeysRule();

    // Create an object with duplicate keys by parsing JSON with duplicate keys
    const rawJson = `{
      "products": [{
        "flavors": [{
          "configuration": [
            {
              "key1": "value1",
              "key1": "value2"
            },
            {
              "key1": "value3"
            }
          ]
        }]
      }]
    }`;

    const invalidValue = JSON.parse(rawJson);
    console.log('Testing invalid value:', JSON.stringify(invalidValue, null, 2));

    const errors1 = await rule.validate(invalidValue, { enabled: true });
    console.log('Validation errors for invalid value:', errors1);
    assert.strictEqual(errors1.length, 1);
    assert.strictEqual(errors1[0].code, 'DUPLICATE_CONFIG_KEY');
    assert.ok(errors1[0].message.includes('in configuration block'));
    assert.ok(errors1[0].range); // Should have range information

    // Test with same keys in different configuration blocks (should be valid)
    const validValue = {
      products: [{
        flavors: [{
          configuration: [
            {
              key1: 'value1',
              key2: 'value2'
            },
            {
              key1: 'value3', // Same key but different block
              key3: 'value4'
            }
          ]
        }]
      }]
    };
    console.log('Testing valid value:', JSON.stringify(validValue, null, 2));

    const errors2 = await rule.validate(validValue, { enabled: true });
    console.log('Validation errors for valid value:', errors2);
    assert.strictEqual(errors2.length, 0);
  });

  it('ValidationRuleRegistry - should respect rule configuration', async () => {
    console.log('Running rule configuration test...');
    const registry = ValidationRuleRegistry.getInstance();

    // Create an object with duplicate keys
    const rawJson = `{
      "products": [{
        "flavors": [{
          "configuration": [{
            "key1": "value1",
            "key1": "value2"
          }]
        }]
      }]
    }`;

    const testValue = JSON.parse(rawJson);
    console.log('Testing value:', JSON.stringify(testValue, null, 2));

    // By default, install_type should be disabled and duplicate check enabled
    let errors = await registry.validateAll(testValue);
    console.log('Default configuration errors:', errors);
    assert.strictEqual(errors.length, 1); // Only duplicate key error
    assert.strictEqual(errors[0].code, 'DUPLICATE_CONFIG_KEY');

    // Enable install_type check
    registry.setRuleConfig('install_type_required', { enabled: true });
    errors = await registry.validateAll(testValue);
    console.log('After enabling install_type errors:', errors);
    assert.strictEqual(errors.length, 2); // Both install_type and duplicate key errors

    // Disable duplicate key check
    registry.setRuleConfig('no_duplicate_config_keys', { enabled: false });
    errors = await registry.validateAll(testValue);
    console.log('After disabling duplicate check errors:', errors);
    assert.strictEqual(errors.length, 1); // Only install_type error
  });

  it('ValidationRuleRegistry - should handle complex nested structures', async () => {
    console.log('Running complex structure test...');
    const registry = ValidationRuleRegistry.getInstance();
    registry.setRuleConfig('install_type_required', { enabled: true });

    // Create objects with duplicate keys
    const rawJson = `{
      "install_type": "operator",
      "products": [
        {
          "flavors": [
            {
              "configuration": [
                { "key1": "value1", "key2": "value2" },
                { "key3": "value3", "key4": "value4" }
              ]
            },
            {
              "configuration": [
                { 
                  "key5": "value5",
                  "key5": "value6"
                },
                { "key7": "value7" }
              ]
            }
          ]
        },
        {
          "flavors": [
            {
              "configuration": [{
                "key8": "value8",
                "key8": "value9"
              }]
            }
          ]
        }
      ]
    }`;

    const complexValue = JSON.parse(rawJson);
    console.log('Testing complex value:', JSON.stringify(complexValue, null, 2));

    const errors = await registry.validateAll(complexValue);
    console.log('Complex structure validation errors:', errors);
    assert.strictEqual(errors.length, 2); // Two duplicate key errors
    assert.ok(errors.every(e => e.code === 'DUPLICATE_CONFIG_KEY'));
    assert.ok(errors.every(e => e.range)); // All errors should have range information
  });

  it('ValidationRuleRegistry - should handle empty or invalid input', async () => {
    console.log('Running empty/invalid input test...');
    const registry = ValidationRuleRegistry.getInstance();

    // Test with null
    let errors = await registry.validateAll(null);
    console.log('Null input errors:', errors);
    assert.strictEqual(errors.length, 0);

    // Test with undefined
    errors = await registry.validateAll(undefined);
    console.log('Undefined input errors:', errors);
    assert.strictEqual(errors.length, 0);

    // Test with empty object
    errors = await registry.validateAll({});
    console.log('Empty object errors:', errors);
    assert.strictEqual(errors.length, 0);

    // Test with invalid structure
    const invalidInput = {
      products: 'not an array'
    };
    errors = await registry.validateAll(invalidInput);
    console.log('Invalid structure errors:', errors);
    assert.strictEqual(errors.length, 0);
  });
}); 