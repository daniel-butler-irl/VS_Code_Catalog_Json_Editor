// services/validation/ValidationConfigService.ts
import * as vscode from 'vscode';
import { ValidationRuleConfig } from '../../types/validation/rules';

/**
 * Service for managing validation rule configurations
 */
export class ValidationConfigService {
  private static instance: ValidationConfigService;
  private readonly configSection = 'ibmCatalog.validation';

  private constructor() { }

  public static getInstance(): ValidationConfigService {
    if (!ValidationConfigService.instance) {
      ValidationConfigService.instance = new ValidationConfigService();
    }
    return ValidationConfigService.instance;
  }

  /**
   * Gets the configuration for a specific validation rule
   * @param ruleId The ID of the validation rule
   * @returns The rule configuration
   */
  public getRuleConfig(ruleId: string): ValidationRuleConfig {
    const config = vscode.workspace.getConfiguration(this.configSection);
    const rules = config.get<Record<string, any>>('rules') || {};
    const ruleConfig = rules[ruleId] || {};

    return {
      enabled: ruleConfig.enabled !== undefined ? ruleConfig.enabled : true,
      params: ruleConfig.params || {}
    };
  }

  /**
   * Sets the configuration for a specific validation rule
   * @param ruleId The ID of the validation rule
   * @param config The rule configuration
   */
  public async setRuleConfig(ruleId: string, config: ValidationRuleConfig): Promise<void> {
    const vsConfig = vscode.workspace.getConfiguration(this.configSection);
    const rules = vsConfig.get<Record<string, any>>('rules') || {};

    rules[ruleId] = config;

    await vsConfig.update('rules', rules, vscode.ConfigurationTarget.Workspace);
  }

  /**
   * Checks if a specific validation rule should be ignored
   * @param ruleId The ID of the validation rule
   * @returns True if the rule should be ignored
   */
  public isRuleIgnored(ruleId: string): boolean {
    const config = this.getRuleConfig(ruleId);
    return !config.enabled || (config.params?.ignoreValidation === true);
  }

  /**
   * Sets whether a specific validation rule should be ignored
   * @param ruleId The ID of the validation rule
   * @param ignored Whether the rule should be ignored
   */
  public async setRuleIgnored(ruleId: string, ignored: boolean): Promise<void> {
    const config = this.getRuleConfig(ruleId);

    if (ignored) {
      config.params = config.params || {};
      config.params.ignoreValidation = true;
    } else if (config.params) {
      delete config.params.ignoreValidation;
    }

    await this.setRuleConfig(ruleId, config);
  }
} 