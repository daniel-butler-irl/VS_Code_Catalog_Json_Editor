import * as assert from 'assert';
import { describe, it, beforeEach } from 'mocha';
import { ValidationRuleRegistry } from '../../../services/validation';
import { DeprecatedInstallTypeRule } from '../../../services/validation/DeprecatedInstallTypeRule';

describe('DeprecatedInstallTypeRule Test Suite', () => {
  let registry: ValidationRuleRegistry;
  let rule: DeprecatedInstallTypeRule;

  beforeEach(() => {
    // Create a fresh instance before each test
    registry = ValidationRuleRegistry.getInstance();
    registry.resetInstance();

    // Create and register our rule
    rule = new DeprecatedInstallTypeRule();
    registry.registerRule(rule, { enabled: true });
  });

  it('should detect deprecated install_type="extension" with dependency_version_2=true', async () => {
    console.log('Setting up test...');

    // Ensure the rule is enabled
    await registry.setRuleConfig('deprecated_install_type', { enabled: true });
    const ruleConfig = registry.getRuleConfig('deprecated_install_type');
    assert.strictEqual(ruleConfig?.enabled, true, 'Rule should be enabled');

    console.log('Running DeprecatedInstallTypeRule test...');

    // Test with a JSON that has install_type="extension" and dependency_version_2=true
    const invalidValue = {
      "products": [
        {
          "flavors": [
            {
              "name": "basic",
              "install_type": "extension",
              "dependency_version_2": true
            }
          ]
        }
      ]
    };

    console.log('Testing invalid value:', JSON.stringify(invalidValue, null, 2));

    // Should detect the deprecated pattern
    const errors = await registry.validateAll(invalidValue);
    console.log('Validation errors for invalid value:', errors);

    assert.strictEqual(errors.length, 1, 'Should detect 1 error for deprecated install_type');
    assert.strictEqual(errors[0].code, 'DEPRECATED_INSTALL_TYPE', 'Should have DEPRECATED_INSTALL_TYPE error code');
    assert.ok(errors[0].message.includes('dependency_version_2=true'), 'Error message should mention dependency_version_2');
  });

  it('should use 0-based line numbers in diagnostic ranges', async () => {
    // Test with raw text to ensure line numbers are calculated correctly
    const rawText = `{
  "products": [
    {
      "flavors": [
        {
          "name": "basic",
          "install_type": "extension",
          "dependency_version_2": true
        }
      ]
    }
  ]
}`;

    const value = JSON.parse(rawText);
    const errors = await rule.validate(value, { enabled: true }, rawText);

    assert.strictEqual(errors.length, 1, 'Should detect 1 error');
    assert.ok(errors[0].range, 'Error should have a range');
    assert.ok(errors[0].range?.start, 'Range should have a start position');
    assert.ok(errors[0].range?.end, 'Range should have an end position');

    // The install_type property is on line 7 (0-based) in our test JSON
    assert.strictEqual(errors[0].range?.start.line, 6, 'Should use 0-based line numbers');
    assert.ok(errors[0].range?.start.character >= 0, 'Should have valid character position');
  });

  it('should not flag install_type="extension" without dependency_version_2=true', async () => {
    console.log('Setting up test...');

    // Ensure the rule is enabled
    await registry.setRuleConfig('deprecated_install_type', { enabled: true });

    console.log('Running valid install_type test...');

    // Test with a JSON that has install_type="extension" but dependency_version_2 is not true
    const validValue1 = {
      "products": [
        {
          "flavors": [
            {
              "name": "basic",
              "install_type": "extension",
              "dependency_version_2": false
            }
          ]
        }
      ]
    };

    console.log('Testing valid value 1:', JSON.stringify(validValue1, null, 2));

    // Should not detect any issues
    const errors1 = await registry.validateAll(validValue1);
    console.log('Validation errors for valid value 1:', errors1);

    assert.strictEqual(
      errors1.filter(e => e.code === 'DEPRECATED_INSTALL_TYPE').length,
      0,
      'Should not flag install_type="extension" when dependency_version_2=false'
    );

    // Test with a JSON that has install_type="extension" but no dependency_version_2
    const validValue2 = {
      "products": [
        {
          "flavors": [
            {
              "name": "basic",
              "install_type": "extension"
            }
          ]
        }
      ]
    };

    console.log('Testing valid value 2:', JSON.stringify(validValue2, null, 2));

    // Should not detect any issues
    const errors2 = await registry.validateAll(validValue2);
    console.log('Validation errors for valid value 2:', errors2);

    assert.strictEqual(
      errors2.filter(e => e.code === 'DEPRECATED_INSTALL_TYPE').length,
      0,
      'Should not flag install_type="extension" when dependency_version_2 is not present'
    );
  });

  it('should not flag install_type="fullstack" with dependency_version_2=true', async () => {
    console.log('Setting up test...');

    // Ensure the rule is enabled
    await registry.setRuleConfig('deprecated_install_type', { enabled: true });

    console.log('Running fullstack install_type test...');

    // Test with a JSON that has install_type="fullstack" and dependency_version_2=true
    const validValue = {
      "products": [
        {
          "flavors": [
            {
              "name": "basic",
              "install_type": "fullstack",
              "dependency_version_2": true
            }
          ]
        }
      ]
    };

    console.log('Testing valid fullstack value:', JSON.stringify(validValue, null, 2));

    // Should not detect any issues
    const errors = await registry.validateAll(validValue);
    console.log('Validation errors for valid fullstack value:', errors);

    assert.strictEqual(
      errors.filter(e => e.code === 'DEPRECATED_INSTALL_TYPE').length,
      0,
      'Should not flag install_type="fullstack" when dependency_version_2=true'
    );
  });

  it('should respect rule configuration (disabled)', async () => {
    console.log('Setting up test...');

    // Disable the rule
    await registry.setRuleConfig('deprecated_install_type', { enabled: false });
    const ruleConfig = registry.getRuleConfig('deprecated_install_type');
    assert.strictEqual(ruleConfig?.enabled, false, 'Rule should be disabled');

    console.log('Running rule disabled test...');

    // Test with a JSON that would normally trigger a warning
    const invalidValue = {
      "products": [
        {
          "flavors": [
            {
              "name": "basic",
              "install_type": "extension",
              "dependency_version_2": true
            }
          ]
        }
      ]
    };

    console.log('Testing invalid value with rule disabled:', JSON.stringify(invalidValue, null, 2));

    // Should NOT detect issues when rule is disabled
    const errors = await registry.validateAll(invalidValue);
    console.log('Validation errors with rule disabled:', errors);

    assert.strictEqual(
      errors.filter(e => e.code === 'DEPRECATED_INSTALL_TYPE').length,
      0,
      'Should not flag anything when rule is disabled'
    );
  });
}); 