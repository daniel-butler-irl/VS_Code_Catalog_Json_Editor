// services/validation/ValidationRuleRegistry.ts
import { ValidationError } from '../../types/validation';
import { ValidationRule, ValidationRuleConfig } from '../../types/validation/rules';
import { NoDuplicateConfigKeysRule } from './NoDuplicateConfigKeysRule';
import { DuplicateConfigurationKeysRule } from './DuplicateConfigurationKeysRule';
import { ValidationConfigService } from './ValidationConfigService';
import { LoggingService } from '../core/LoggingService';

/**
 * Registry for validation rules
 */
export class ValidationRuleRegistry {
  private static instance: ValidationRuleRegistry;
  private rules: Map<string, ValidationRule> = new Map();
  private ruleConfigs: Map<string, ValidationRuleConfig> = new Map();
  private configService: ValidationConfigService;
  private readonly logger = LoggingService.getInstance();
  private readonly logChannel = 'schemaValidation';

  private constructor() {
    this.configService = ValidationConfigService.getInstance();

    // Register default rules
    this.registerRule(new NoDuplicateConfigKeysRule(), { enabled: true });
    this.registerRule(new DuplicateConfigurationKeysRule(), { enabled: true });

    this.logger.debug('Validation rules registered', {
      ruleCount: this.rules.size,
      rules: Array.from(this.rules.keys())
    }, this.logChannel);
  }

  public static getInstance(): ValidationRuleRegistry {
    if (!ValidationRuleRegistry.instance) {
      ValidationRuleRegistry.instance = new ValidationRuleRegistry();
    }
    return ValidationRuleRegistry.instance;
  }

  public registerRule(rule: ValidationRule, defaultConfig: ValidationRuleConfig): void {
    this.rules.set(rule.id, rule);

    // Get config from workspace settings or use default
    const savedConfig = this.configService.getRuleConfig(rule.id);
    this.ruleConfigs.set(rule.id, {
      enabled: savedConfig.enabled !== undefined ? savedConfig.enabled : defaultConfig.enabled,
      params: { ...defaultConfig.params, ...savedConfig.params }
    });

    this.logger.debug('Registered validation rule', {
      ruleId: rule.id,
      description: rule.description,
      enabled: this.ruleConfigs.get(rule.id)?.enabled
    }, this.logChannel);
  }

  public getRule(id: string): ValidationRule | undefined {
    return this.rules.get(id);
  }

  public getRuleConfig(id: string): ValidationRuleConfig | undefined {
    // Always get the latest config from the config service
    const rule = this.getRule(id);
    if (rule) {
      const config = this.configService.getRuleConfig(id);
      // Update the cached config
      this.ruleConfigs.set(id, config);
      return config;
    }
    return this.ruleConfigs.get(id);
  }

  public async setRuleConfig(id: string, config: ValidationRuleConfig): Promise<void> {
    if (this.rules.has(id)) {
      this.ruleConfigs.set(id, config);
      // Save to workspace settings
      await this.configService.setRuleConfig(id, config);
    }
  }

  public async ignoreRule(id: string, ignored: boolean): Promise<void> {
    if (this.rules.has(id)) {
      await this.configService.setRuleIgnored(id, ignored);
      // Update the cached config
      this.ruleConfigs.set(id, this.configService.getRuleConfig(id));
    }
  }

  public getAllRules(): ValidationRule[] {
    return Array.from(this.rules.values());
  }

  public async validateAll(value: unknown, rawText?: string): Promise<ValidationError[]> {
    const allErrors: ValidationError[] = [];

    this.logger.debug('Starting validation with all rules', {
      ruleCount: this.rules.size,
      rules: Array.from(this.rules.keys()).map(id => ({
        id,
        enabled: this.getRuleConfig(id)?.enabled,
        config: this.getRuleConfig(id)
      }))
    }, this.logChannel);

    for (const [id, rule] of this.rules) {
      // Always fetch the latest config
      const config = this.getRuleConfig(id);

      // Check if the rule is enabled
      const isEnabled = config?.enabled === true;

      this.logger.debug(`Rule ${id} configuration:`, {
        id,
        enabled: isEnabled,
        config
      }, this.logChannel);

      if (isEnabled) {
        this.logger.debug('Running validation rule', {
          ruleId: id,
          description: rule.description
        }, this.logChannel);

        const errors = await rule.validate(value, config, rawText);

        if (errors.length > 0) {
          this.logger.debug('Validation rule found errors', {
            ruleId: id,
            errorCount: errors.length,
            errors: errors.map(e => ({
              code: e.code,
              message: e.message,
              path: e.path
            }))
          }, this.logChannel);
        } else {
          this.logger.debug('Validation rule completed with no errors', { ruleId: id }, this.logChannel);
        }

        allErrors.push(...errors);
      } else {
        this.logger.debug('Skipping disabled validation rule', {
          ruleId: id,
          description: rule.description,
          config
        }, this.logChannel);
      }
    }

    this.logger.debug('Validation complete', {
      totalErrorCount: allErrors.length,
      errorsByRule: Array.from(this.rules.keys()).map(id => ({
        id,
        count: allErrors.filter(e => e.code?.startsWith(id.toUpperCase()) || e.path?.includes(id)).length
      }))
    }, this.logChannel);

    return allErrors;
  }

  // For testing purposes
  public resetInstance(): void {
    this.logger.debug('Resetting ValidationRuleRegistry instance for testing', {
      beforeReset: {
        ruleCount: this.rules.size,
        ruleConfigs: Array.from(this.ruleConfigs.entries()).map(([id, config]) => ({
          id,
          enabled: config?.enabled,
          params: config?.params
        }))
      }
    }, this.logChannel);

    // Clear the existing rules and configurations
    this.rules.clear();
    this.ruleConfigs.clear();

    // Re-register the default rules with default configurations
    this.registerRule(new NoDuplicateConfigKeysRule(), { enabled: true });
    this.registerRule(new DuplicateConfigurationKeysRule(), { enabled: true });

    // Update the static instance
    ValidationRuleRegistry.instance = this;

    this.logger.debug('ValidationRuleRegistry instance has been reset', {
      afterReset: {
        ruleCount: this.rules.size,
        ruleConfigs: Array.from(this.ruleConfigs.entries()).map(([id, config]) => ({
          id,
          enabled: config?.enabled,
          params: config?.params
        }))
      }
    }, this.logChannel);
  }
} 