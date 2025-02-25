// src/test/suite/validation/DuplicateConfigurationKeysRule.test.ts
import * as assert from 'assert';
import { DuplicateConfigurationKeysRule } from '../../../services/validation/DuplicateConfigurationKeysRule';

describe('DuplicateConfigurationKeysRule Tests', () => {
  let rule: DuplicateConfigurationKeysRule;

  beforeEach(() => {
    rule = new DuplicateConfigurationKeysRule();
  });

  it('should detect duplicate keys in configuration objects', async () => {
    // Create a test JSON with duplicate keys
    const rawJson = `{
      "configuration": [
        {
          "key": "prefix",
          "type": "string",
          "required": true,
          "display_name": "Prefix"
        },
        {
          "key": "prefix",
          "type": "string",
          "required": true,
          "display_name": "Another Prefix"
        }
      ],
      "nested": {
        "ibmcloud_api_key": "value1",
        "ibmcloud_api_key": "value2"
      }
    }`;

    const testValue = JSON.parse(rawJson);

    // Test with rule enabled
    const errors = await rule.validate(testValue, { enabled: true }, rawJson);

    // Should find both sets of duplicate keys
    assert.strictEqual(errors.length, 4, 'Should detect all duplicate key instances');

    // Check that we found the duplicate 'prefix' keys
    const prefixErrors = errors.filter(e => e.message.includes('prefix'));
    assert.strictEqual(prefixErrors.length, 2, 'Should detect both prefix duplicates');

    // Check that we found the duplicate 'ibmcloud_api_key' keys
    const apiKeyErrors = errors.filter(e => e.message.includes('ibmcloud_api_key'));
    assert.strictEqual(apiKeyErrors.length, 2, 'Should detect both ibmcloud_api_key duplicates');

    // Verify error details
    errors.forEach(error => {
      assert.strictEqual(error.code, 'DUPLICATE_CONFIGURATION_KEY');
      assert.ok(error.range, 'Error should have range information');
      assert.ok(error.path, 'Error should have path information');
    });
  });

  it('should not report errors when no duplicates exist', async () => {
    // Create a test JSON with no duplicate keys
    const rawJson = `{
      "configuration": [
        {
          "key": "prefix",
          "type": "string",
          "required": true,
          "display_name": "Prefix"
        },
        {
          "key": "region",
          "type": "string",
          "required": true,
          "display_name": "Region"
        }
      ],
      "nested": {
        "ibmcloud_api_key": "value1",
        "resource_group": "value2"
      }
    }`;

    const testValue = JSON.parse(rawJson);

    // Test with rule enabled
    const errors = await rule.validate(testValue, { enabled: true }, rawJson);

    // Should find no errors
    assert.strictEqual(errors.length, 0, 'Should not detect any errors when no duplicates exist');
  });

  it('should respect the enabled flag', async () => {
    // Create a test JSON with duplicate keys
    const rawJson = `{
      "configuration": [
        {
          "key": "prefix",
          "type": "string",
          "required": true,
          "display_name": "Prefix"
        },
        {
          "key": "prefix",
          "type": "string",
          "required": true,
          "display_name": "Another Prefix"
        }
      ]
    }`;

    const testValue = JSON.parse(rawJson);

    // Test with rule disabled
    const errors = await rule.validate(testValue, { enabled: false }, rawJson);

    // Should find no errors when disabled
    assert.strictEqual(errors.length, 0, 'Should not detect any errors when rule is disabled');
  });
}); 