import { ValidationError } from '../../types/validation';
import { ValidationRuleConfig } from '../../types/validation/rules';
import { BaseValidationRule } from './BaseValidationRule';

/**
 * Validation rule that ensures the install_type property is present
 */
export class InstallTypeRequiredRule extends BaseValidationRule {
  constructor() {
    super('install_type_required', 'Validates that install_type property is present');
  }

  /**
   * Validates that the install_type property is present
   * @param value The value to validate
   * @param config The rule configuration
   * @param rawText The raw JSON text
   * @returns Array of validation errors
   */
  async validate(value: unknown, config: ValidationRuleConfig = { enabled: false }, rawText?: string): Promise<ValidationError[]> {
    if (!rawText) {
      return [];
    }

    return this.validateInstallType(value as any, config, rawText);
  }
} 