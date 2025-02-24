import * as assert from 'assert';
import { describe, it } from 'mocha';
import { ValidationRuleRegistry, InstallTypeRequiredRule, NoDuplicateConfigKeysRule } from '../../../types/validation/rules';

describe('Validation Only Tests', () => {
  it('should validate install_type requirement in flavor objects', async () => {
    const rule = new InstallTypeRequiredRule();

    // Test with a real catalog flavor object missing install_type
    const rawJson = `{
      "name": "standard",
      "label": "Standard",
      "working_directory": "terraform",
      "architecture": {
        "diagrams": [{
          "diagram": {
            "caption": "Architecture diagram",
            "url": "https://test.com/diagram.png"
          },
          "description": "Test description"
        }]
      }
    }`;
    const invalidValue = JSON.parse(rawJson);

    // Should not report error when disabled
    const errors1 = await rule.validate(invalidValue, { enabled: false }, rawJson);
    console.log('Disabled validation errors:', errors1);
    assert.strictEqual(errors1.length, 0, 'Should have no errors when disabled');

    // Should report error when enabled
    const errors2 = await rule.validate(invalidValue, { enabled: true }, rawJson);
    console.log('Enabled validation errors:', errors2);
    assert.strictEqual(errors2.length, 1, 'Should have one error when enabled');
    assert.strictEqual(errors2[0].code, 'INSTALL_TYPE_REQUIRED', 'Should have correct error code');
    assert.ok(errors2[0].path === 'install_type', 'Should have correct path');

    // Should not report error for products array
    const productsRawJson = `{
      "products": [{
        "name": "test-product",
        "label": "Test Product",
        "product_kind": "solution",
        "flavors": [{
          "name": "standard",
          "label": "Standard",
          "working_directory": "terraform",
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
    const productsValue = JSON.parse(productsRawJson);
    const errors3 = await rule.validate(productsValue, { enabled: true }, productsRawJson);
    console.log('Products array validation errors:', errors3);
    assert.strictEqual(errors3.length, 0, 'Should not validate products array');
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

    // Verify first error position
    assert.ok(errors[0].range?.start?.line === 11, 'First error should point to first key line');
    assert.ok(errors[0].range?.start?.character === 16, 'First error should point to first key column');
    assert.ok(errors[0].message.includes('index 0'), 'Should mention first instance index');
    assert.ok(errors[0].message.includes('1'), 'Should mention other instance index');

    // Verify second error position
    assert.ok(errors[1].range?.start?.line === 17, 'Second error should point to second key line');
    assert.ok(errors[1].range?.start?.character === 16, 'Second error should point to second key column');
  });

  it('should handle rule configuration correctly', async () => {
    const registry = ValidationRuleRegistry.getInstance();
    registry.resetInstance();

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

    // Test default configuration
    let errors = await registry.validateAll(testValue, rawJson);
    console.log('Default configuration errors:', errors);
    assert.strictEqual(errors.length, 2, 'Should have two errors for duplicate key instances by default');
    assert.ok(errors[0].range?.start?.line === 11, 'Should have correct line number for first error');
    assert.ok(errors[0].range?.start?.character === 16, 'Should have correct column number for first error');

    // Enable install_type check
    registry.setRuleConfig('install_type_required', { enabled: true });
    errors = await registry.validateAll(testValue, rawJson);
    console.log('After enabling install_type errors:', errors);
    assert.strictEqual(errors.length, 2, 'Should still only have duplicate key errors (install_type not checked for products)');

    // Disable duplicate key check
    registry.setRuleConfig('no_duplicate_config_keys', { enabled: false });
    errors = await registry.validateAll(testValue, rawJson);
    console.log('After disabling duplicate check errors:', errors);
    assert.strictEqual(errors.length, 0, 'Should have no errors when duplicate check is disabled');
  });
}); 