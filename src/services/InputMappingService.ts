// src/services/InputMappingService.ts

import * as vscode from 'vscode';
import { IBMCloudService, Configuration } from './IBMCloudService';
import { CacheService } from './CacheService';
import { LoggingService } from './LoggingService';
import type { InputMapping, InputMappingContext, MappingOption } from '../types/inputMapping';
import { compareSemVer } from '../utils/semver';

export class InputMappingService {
    private logger = LoggingService.getInstance();
    private cacheService: CacheService;

    constructor(private ibmCloudService?: IBMCloudService) {
        this.cacheService = CacheService.getInstance();
    }

    /**
     * Fetches available mapping options for inputs/outputs based on offering version
     */
    public async fetchMappingOptions(context: InputMappingContext): Promise<MappingOption[]> {
        this.logger.debug('Fetching mapping options with context', context);
        if (!this.ibmCloudService) {
            return [];
        }

        const cacheKey = `mapping_options:${context.catalogId}:${context.offeringId}:${context.version || ''}`;
        const cached = this.cacheService.get<MappingOption[]>(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const offerings = await this.ibmCloudService.getOfferingsForCatalog(context.catalogId);
            const offering = offerings.find(o => o.id === context.offeringId);

            if (!offering?.kinds?.[0]?.versions?.length) {
                return [];
            }

            this.logger.debug('Available Versions', offering.kinds[0].versions);
            this.logger.debug('Version Constraint', context.version);

            const version = this.findLowestMatchingVersion(offering.kinds[0].versions, context.version);
            // After finding the version
            if (!version) {
                this.logger.error('No matching version found for constraint', context.version);
                return [];
            }

            this.logger.debug('Version Configuration', version.configuration);
            this.logger.debug('Version Outputs', version.outputs);

            const options: MappingOption[] = [];

            // Add configuration inputs
            if (Array.isArray(version.configuration)) {
                for (const config of version.configuration) {
                    options.push({
                        label: config.key,
                        value: config.key,
                        description: config.description || 'Input parameter',
                        type: 'input',
                        detail: this.formatConfigDetail(config)
                    });
                }
            }

            // Add outputs
            if (Array.isArray(version.outputs)) {
                for (const output of version.outputs) {
                    options.push({
                        label: output.key,
                        value: output.key,
                        description: output.description || 'Output value',
                        type: 'output'
                    });
                }
            }
            this.cacheService.set(cacheKey, options, {
                timestamp: new Date().toISOString(),
                offeringVersion: version.version
            });
            this.logger.debug('Generated Mapping Options', options);

            return options;

        } catch (error) {
            this.logger.error('Failed to fetch mapping options', error);
            return [];
        }
    }

    /**
     * Gets available config keys from the current version
     */
    public async getConfigKeys(context: InputMappingContext): Promise<string[]> {
        if (!this.ibmCloudService) {
            return [];
        }

        const cacheKey = `config_keys:${context.catalogId}:${context.offeringId}:${context.version || ''}`;
        const cached = this.cacheService.get<string[]>(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const offerings = await this.ibmCloudService.getOfferingsForCatalog(context.catalogId);
            const offering = offerings.find(o => o.id === context.offeringId);

            if (!offering?.kinds?.[0]?.versions?.length) {
                return [];
            }

            const version = this.findLowestMatchingVersion(offering.kinds[0].versions, context.version);
            if (!version?.configuration) {
                return [];
            }

            let keys: string[] = [];

            if (version?.configuration) {
                keys = version.configuration.map((config: Configuration) => config.key);
            }

            if (!keys.length) {
                return [];
            }
            this.cacheService.set(cacheKey, keys, {
                timestamp: new Date().toISOString(),
                offeringVersion: version.version
            });

            return keys;

        } catch (error) {
            this.logger.error('Failed to get config keys', error);
            return [];
        }
    }

    /**
     * Gets the lowest version that satisfies the version constraint
     */
    private findLowestMatchingVersion(versions: any[], constraint?: string): any {
        if (!versions.length) {
            return undefined;
        }

        if (!constraint) {
            return versions[0];
        }

        const sortedVersions = [...versions].sort((a, b) =>
            compareSemVer(a.version, b.version)
        );
        this.logger.debug('Sorted Versions', sortedVersions);
        const matchingVersion = sortedVersions.find(v => this.satisfiesConstraint(v.version, constraint));
        this.logger.debug('Matching Version Found', matchingVersion);

        return matchingVersion;
    }

    /**
     * Checks if a version satisfies a semver constraint
     */
    private satisfiesConstraint(version: string, constraint: string): boolean {
        const normalizeVersion = (v: string) => v.replace(/^[\^~><=v]/, '').split(/[\.-]/)[0];
        const plainVersion = normalizeVersion(version);
        const plainConstraint = normalizeVersion(constraint);

        return compareSemVer(plainVersion, plainConstraint) >= 0;
    }

    private formatConfigDetail(config: any): string {
        const parts = [];

        if (config.type) {
            parts.push(`Type: ${config.type}`);
        }

        if (config.default_value !== undefined) {
            parts.push(`Default: ${config.default_value}`);
        }

        if (config.required) {
            parts.push('Required');
        }

        return parts.join(' • ');
    }
}