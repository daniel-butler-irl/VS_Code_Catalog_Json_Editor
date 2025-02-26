import * as assert from 'assert';
import { describe, it, beforeEach, afterEach } from 'mocha';
import * as sinon from 'sinon';
import { DuplicateDependencyInputRule } from '../../../services/validation/DuplicateDependencyInputRule';
import { ValidationRuleConfig } from '../../../types/validation/rules';
import { LoggingService } from '../../../services/core/LoggingService';

describe('DuplicateDependencyInputRule', () => {
  let rule: DuplicateDependencyInputRule;
  let sandbox: sinon.SinonSandbox;
  let debugStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    rule = new DuplicateDependencyInputRule();
    const loggingService = LoggingService.getInstance();
    debugStub = sandbox.stub(loggingService, 'debug');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should skip validation when the rule is disabled', async () => {
    const config: ValidationRuleConfig = { enabled: false };
    const result = await rule.validate({}, config);
    assert.strictEqual(result.length, 0);
    sinon.assert.calledWith(debugStub, 'DuplicateDependencyInputRule is disabled, skipping validation', sinon.match.any, sinon.match.any);
  });

  it('should skip validation for non-object values', async () => {
    const result = await rule.validate('string value', { enabled: true });
    assert.strictEqual(result.length, 0);
    sinon.assert.calledWith(debugStub, 'Invalid value type for DuplicateDependencyInputRule, skipping validation', sinon.match.any, sinon.match.any);
  });

  it('should return no errors when no products exist', async () => {
    const result = await rule.validate({}, { enabled: true });
    assert.strictEqual(result.length, 0);
  });

  it('should return no errors when dependencies array is empty', async () => {
    const data = {
      products: [
        {
          dependencies: []
        }
      ]
    };

    const result = await rule.validate(data, { enabled: true });
    assert.strictEqual(result.length, 0);
  });

  it('should return no errors when there are no duplicates in input_mapping', async () => {
    const data = {
      products: [
        {
          dependencies: [
            {
              input_mapping: [
                {
                  dependency_input: 'region',
                  version_input: 'region'
                },
                {
                  dependency_input: 'zone',
                  version_input: 'zone'
                }
              ]
            }
          ]
        }
      ]
    };

    const result = await rule.validate(data, { enabled: true });
    assert.strictEqual(result.length, 0);
  });

  it('should detect duplicate dependency_input values in top-level dependencies', async () => {
    const data = {
      products: [
        {
          dependencies: [
            {
              input_mapping: [
                {
                  dependency_input: 'region',
                  version_input: 'region1'
                }
              ]
            },
            {
              input_mapping: [
                {
                  dependency_input: 'region',
                  version_input: 'region2'
                }
              ]
            }
          ]
        }
      ]
    };

    const rawJson = JSON.stringify(data, null, 2);
    const result = await rule.validate(data, { enabled: true }, rawJson);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].code, 'DUPLICATE_DEPENDENCY_INPUT');
    assert.ok(result[0].message.includes('Duplicate dependency_input \'region\''));
  });

  it('should detect duplicate dependency_input values in flavor dependencies', async () => {
    const data = {
      products: [
        {
          flavors: [
            {
              dependencies: [
                {
                  input_mapping: [
                    {
                      dependency_input: 'region',
                      version_input: 'region1'
                    }
                  ]
                },
                {
                  input_mapping: [
                    {
                      dependency_input: 'region',
                      version_input: 'region2'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const rawJson = JSON.stringify(data, null, 2);
    const result = await rule.validate(data, { enabled: true }, rawJson);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].code, 'DUPLICATE_DEPENDENCY_INPUT');
    assert.ok(result[0].message.includes('Duplicate dependency_input \'region\''));
  });

  it('should detect duplicate dependency_input values within the same dependency', async () => {
    const data = {
      products: [
        {
          dependencies: [
            {
              input_mapping: [
                {
                  dependency_input: 'region',
                  version_input: 'region1'
                },
                {
                  dependency_input: 'region',
                  version_input: 'region2'
                }
              ]
            }
          ]
        }
      ]
    };

    const rawJson = JSON.stringify(data, null, 2);
    const result = await rule.validate(data, { enabled: true }, rawJson);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].code, 'DUPLICATE_DEPENDENCY_INPUT');
    assert.ok(result[0].message.includes('Duplicate dependency_input \'region\''));
  });

  it('should treat different reference_version settings as duplicates', async () => {
    const data = {
      products: [
        {
          dependencies: [
            {
              input_mapping: [
                {
                  dependency_input: 'region',
                  version_input: 'region',
                  reference_version: true
                }
              ]
            },
            {
              input_mapping: [
                {
                  dependency_input: 'region',
                  version_input: 'region',
                  reference_version: false
                }
              ]
            }
          ]
        }
      ]
    };

    const rawJson = JSON.stringify(data, null, 2);
    const result = await rule.validate(data, { enabled: true }, rawJson);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].code, 'DUPLICATE_DEPENDENCY_INPUT');
    assert.ok(result[0].message.includes('Duplicate dependency_input \'region\''));
  });

  it('should handle error reporting with proper location when raw JSON is provided', async () => {
    const data = {
      products: [
        {
          dependencies: [
            {
              input_mapping: [
                {
                  dependency_input: 'region',
                  version_input: 'region1'
                }
              ]
            },
            {
              input_mapping: [
                {
                  dependency_input: 'region',
                  version_input: 'region2'
                }
              ]
            }
          ]
        }
      ]
    };

    const rawJson = JSON.stringify(data, null, 2);
    const result = await rule.validate(data, { enabled: true }, rawJson);

    assert.strictEqual(result.length, 2);

    // Both errors should have range information
    assert.ok(result[0].range);
    assert.ok(result[1].range);

    // Verify paths are correct
    assert.ok(result[0].path.includes('dependency_input'));
    assert.ok(result[1].path.includes('dependency_input'));
  });
}); 