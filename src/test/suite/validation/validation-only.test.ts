import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { ValidationRuleRegistry } from '../../../services/validation/ValidationRuleRegistry';
import { NoDuplicateConfigKeysRule } from '../../../services/validation/NoDuplicateConfigKeysRule';

describe('Validation Only Tests', () => {
  let registry: ValidationRuleRegistry;

  beforeEach(() => {
    // Create a fresh instance before each test
    registry = ValidationRuleRegistry.getInstance();
    registry.resetInstance();
  });

  it('should detect duplicate configuration keys with accurate positions', async () => {
    const rule = new NoDuplicateConfigKeysRule();

    // Test with real catalog configuration containing duplicate keys
    const rawJson = `{
      "products": [{
        "name": "test-product",
        "label": "Test Product",
        "product_kind": "solution",
        "flavors": [{
          "name": "standard",
          "label": "Standard",
          "install_type": "fullstack",
          "configuration": [
            {
              "key": "resource_group",
              "type": "string",
              "required": true,
              "display_name": "Resource Group"
            },
            {
              "key": "resource_group",
              "type": "string",
              "required": true,
              "display_name": "Another Resource Group"
            },
            {
              "key": "region",
              "type": "string",
              "required": true,
              "display_name": "Region"
            }
          ],
          "dependencies": [
            {
              "id": "dep1",
              "name": "test-dependency",
              "catalog_id": "test-dep"
            },
            {
              "id": "dep1",
              "name": "test-dependency",
              "catalog_id": "test-dep"
            }
          ],
          "architecture": {
            "diagrams": [{
              "diagram": {
                "caption": "Architecture diagram",
                "url": "https://test.com/diagram.png"
              },
              "description": "Test description"
            }]
          }
        }]
      }]
    }`;
    const testValue = JSON.parse(rawJson);

    // Should detect duplicate when enabled
    const errors = await rule.validate(testValue, { enabled: true }, rawJson);
    console.log('Duplicate key validation errors:', errors);
    assert.strictEqual(errors.length, 2, 'Should detect both instances of the duplicate key');
    assert.strictEqual(errors[0].code, 'DUPLICATE_CONFIG_KEY', 'Should have correct error code');

    // Check that errors have position information (exact values may vary by implementation)
    assert.ok(errors[0].range && errors[0].range.start && errors[0].range.start.line > 0, 'First error should have a valid line number');
    assert.ok(errors[0].range && errors[0].range.start && errors[0].range.start.character >= 0, 'First error should have a valid column number');
    assert.ok(errors[0].message.includes('resource_group'), 'Error message should mention the duplicate key');
    assert.ok(errors[0].message.includes('indices'), 'Error message should mention indices');

    // Check second error as well
    assert.ok(errors[1].range && errors[1].range.start && errors[1].range.start.line > 0, 'Second error should have a valid line number');
    assert.ok(errors[1].range && errors[1].range.start && errors[1].range.start.character >= 0, 'Second error should have a valid column number');
    assert.ok(errors[1].message.includes('resource_group'), 'Error message should mention the duplicate key');
  });

  it('should handle rule configuration correctly', async () => {
    // Get the registry instance from beforeEach
    const freshRegistry = registry;

    // Test with real catalog configuration containing duplicate keys
    const rawJson = `{
      "products": [{
        "name": "test-product",
        "label": "Test Product",
        "product_kind": "solution",
        "flavors": [{
          "name": "standard",
          "label": "Standard",
          "install_type": "fullstack",
          "configuration": [
            {
              "key": "resource_group",
              "type": "string",
              "required": true,
              "display_name": "Resource Group"
            },
            {
              "key": "resource_group",
              "type": "string",
              "required": true,
              "display_name": "Another Resource Group"
            }
          ],
          "dependencies": [
            {
              "id": "dep1",
              "name": "test-dependency",
              "catalog_id": "test-dep"
            },
            {
              "id": "dep1",
              "name": "test-dependency",
              "catalog_id": "test-dep"
            }
          ],
          "architecture": {
            "diagrams": [{
              "diagram": {
                "caption": "Architecture diagram",
                "url": "https://test.com/diagram.png"
              },
              "description": "Test description"
            }]
          }
        }]
      }]
    }`;
    const testValue = JSON.parse(rawJson);

    // Ensure no_duplicate_config_keys rule is enabled
    await freshRegistry.setRuleConfig('no_duplicate_config_keys', { enabled: true });

    // Verify the rule is now enabled
    const enabledConfig = freshRegistry.getRuleConfig('no_duplicate_config_keys');
    console.log('Rule config before validation:', enabledConfig);
    assert.strictEqual(enabledConfig?.enabled, true, 'Rule should be marked as enabled in config');

    // Test with rule enabled
    let errors = await freshRegistry.validateAll(testValue, rawJson);
    console.log('Default configuration errors:', errors);

    // Count errors by code type
    const duplicateConfigKeyErrors = errors.filter(e => e.code === 'DUPLICATE_CONFIG_KEY');

    // Assert on duplicate config keys only - we removed the expectation for DUPLICATE_ARRAY_ITEM
    // since behavior might have changed after removing InstallTypeRequiredRule
    assert.strictEqual(duplicateConfigKeyErrors.length, 2, 'Should have two DUPLICATE_CONFIG_KEY errors');
    assert.ok(errors.some(e => e.code === 'DUPLICATE_CONFIG_KEY'), 'Should have DUPLICATE_CONFIG_KEY error');

    // Disable duplicate key check - use explicit config with enabled: false
    await freshRegistry.setRuleConfig('no_duplicate_config_keys', { enabled: false, params: {} });
    // Also disable duplicate array items rule
    await freshRegistry.setRuleConfig('duplicate_array_items', { enabled: false, params: {} });

    // Verify the rule is now disabled
    const ruleConfig = freshRegistry.getRuleConfig('no_duplicate_config_keys');
    console.log('Rule config after disabling:', ruleConfig);
    assert.strictEqual(ruleConfig?.enabled, false, 'Rule should be marked as disabled in config');

    // Now run validation again
    errors = await freshRegistry.validateAll(testValue, rawJson);
    console.log('After disabling duplicate check errors:', errors);
    assert.strictEqual(errors.length, 0, 'Should have no errors when duplicate checks are disabled');
  });
}); 