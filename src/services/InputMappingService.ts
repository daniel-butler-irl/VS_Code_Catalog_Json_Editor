// src/services/InputMappingService.ts

import { IBMCloudService } from './IBMCloudService';
import { CacheService } from './CacheService';
import { LoggingService } from './core/LoggingService';
import type { InputMappingContext, MappingOption } from '../types/catalog';
import { compareSemVer } from '../utils/semver';
import type { Configuration, Output } from '../types/ibmCloud';

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
            if (!version) {
                this.logger.error('No matching version found for constraint', context.version);
                return [];
            }

            this.logger.debug('Version Configuration', version.configuration);
            this.logger.debug('Version Outputs', version.outputs);

            const options: MappingOption[] = [];

            // Add configuration inputs with required flag
            if (Array.isArray(version.configuration)) {
                for (const config of version.configuration) {
                    options.push(this.createConfigurationOption(config));
                }
            }

            // Add outputs
            if (Array.isArray(version.outputs)) {
                for (const output of version.outputs) {
                    options.push(this.createOutputOption(output));
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
     * Creates a MappingOption from a configuration item
     * @param config The configuration item from the IBM Cloud API
     * @returns MappingOption
     */
    private createConfigurationOption(config: Configuration): MappingOption {
        return {
            label: config.key,
            value: config.key,
            description: config.description || '',
            type: config.type || 'string',
            required: config.required || false,
            defaultValue: config.default_value !== undefined ? config.default_value : 'Not Set',
            detail: '', // Will be formatted later
            mappingType: 'input' // Indicates this is an input
        };
    }

    /**
     * Creates a MappingOption from an output item
     * @param output The output item from the IBM Cloud API
     * @returns MappingOption
     */
    private createOutputOption(output: Output): MappingOption {
        return {
            label: output.key,
            value: output.key,
            description: output.description || '',
            type: 'string', // Outputs do not have type, assume 'string'
            required: false, // Outputs are always optional
            defaultValue: 'Not Set', // Outputs do not have default values
            detail: '', // Will be formatted later
            mappingType: 'output' // Indicates this is an output
        };
    }

    /**
     * Formats the detail string for a mapping option
     * @param option The mapping option to format
     * @returns Formatted detail string
     */
    private formatMappingDetail(option: MappingOption): string {
        return `Default: ${option.defaultValue} • ${option.description || ''}`;
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
}
