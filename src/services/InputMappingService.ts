// src/services/InputMappingService.ts

import { IBMCloudService } from './IBMCloudService';
import { CacheService } from './CacheService';
import { LoggingService } from './core/LoggingService';
import type { InputMappingContext, MappingOption } from '../types/catalog';
import { compareSemVer } from '../utils/semver';
import type { Configuration, Output } from '../types/ibmCloud';
import { CacheKeys, CacheConfigurations, CacheConfig } from '../types/cache/cacheConfig';

/**
 * Service responsible for fetching and caching input mapping options for dependencies.
 * It interacts with IBM Cloud services to retrieve configurations and outputs for offerings.
 */
export class InputMappingService {
    private logger = LoggingService.getInstance();
    private cacheService: CacheService;

    /**
     * Constructs the InputMappingService.
     * @param ibmCloudService - Instance of IBMCloudService for making API calls.
     */
    constructor(private ibmCloudService?: IBMCloudService) {
        this.cacheService = CacheService.getInstance();
    }

    /**
     * Fetches available mapping options for inputs/outputs based on offering version.
     * @param context - The context containing catalogId, offeringId, and version.
     * @returns Promise resolving to an array of MappingOption.
     */
    public async fetchMappingOptions(context: InputMappingContext): Promise<MappingOption[]> {
        this.logger.debug('Fetching mapping options with context', { context });
        if (!this.ibmCloudService) {
            return [];
        }

        const cacheKey = `mapping_options:${context.catalogId}:${context.offeringId}:${context.version || ''}`;
        const cached = this.cacheService.get<MappingOption[]>(cacheKey);
        if (cached) {
            this.logger.debug('Using cached mapping options', { options: cached });
            return cached;
        }

        try {
            const offerings = await this.ibmCloudService.getOfferingsForCatalog(context.catalogId);
            const offering = offerings.find(o => o.id === context.offeringId);

            if (!offering?.kinds?.[0]?.versions?.length) {
                return [];
            }

            this.logger.debug('Available versions', { versions: offering.kinds[0].versions.map(v => v.version) });
            this.logger.debug('Version constraint', { constraint: context.version });

            const version = this.findLowestMatchingVersion(offering.kinds[0].versions, context.version);
            if (!version) {
                this.logger.error('No matching version found', { constraint: context.version });
                return [];
            }

            this.logger.debug('Selected version configuration', {
                version: version.version,
                configCount: version.configuration?.length || 0,
                outputCount: version.outputs?.length || 0
            });

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

            // Define cache configuration for mapping options
            const cacheConfig: CacheConfig = {
                ttlSeconds: 3600, // Cache for 1 hour
                persistent: false, // Not persisted across sessions
                storagePrefix: 'mapping_options',
            };

            // Cache the generated options
            this.cacheService.set(cacheKey, options, cacheConfig);
            this.logger.debug('Generated mapping options', {
                count: options.length,
                types: options.map(o => o.mappingType)
            });

            return options;

        } catch (error) {
            this.logger.error('Failed to fetch mapping options', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Creates a MappingOption from a configuration item.
     * @param config - The configuration item from the IBM Cloud API.
     * @returns MappingOption object.
     */
    private createConfigurationOption(config: Configuration): MappingOption {
        return {
            label: config.key,
            value: config.key,
            description: config.description || '',
            type: config.type || 'string',
            required: config.required || false,
            defaultValue: config.default_value !== undefined ? config.default_value : 'Not Set',
            detail: this.formatMappingDetail({
                defaultValue: config.default_value !== undefined ? config.default_value : 'Not Set',
                description: config.description || '',
            }),
            mappingType: 'input', // Indicates this is an input
        };
    }

    /**
     * Creates a MappingOption from an output item.
     * @param output - The output item from the IBM Cloud API.
     * @returns MappingOption object.
     */
    private createOutputOption(output: Output): MappingOption {
        return {
            label: output.key,
            value: output.key,
            description: output.description || '',
            type: 'string', // Outputs do not have type, assume 'string'
            required: false, // Outputs are always optional
            defaultValue: 'Not Set', // Outputs do not have default values
            detail: this.formatMappingDetail({
                defaultValue: 'Not Set',
                description: output.description || '',
            }),
            mappingType: 'output', // Indicates this is an output
        };
    }

    /**
     * Formats the detail string for a mapping option.
     * @param option - The mapping option to format.
     * @returns Formatted detail string.
     */
    private formatMappingDetail(option: { defaultValue: any; description: string }): string {
        return `Default: ${option.defaultValue} • ${option.description || ''}`;
    }

    /**
     * Gets the lowest version that satisfies the version constraint.
     * @param versions - Array of versions.
     * @param constraint - Version constraint string.
     * @returns The matching version object or undefined if not found.
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
        this.logger.debug('Sorted versions', { versions: sortedVersions.map(v => v.version) });
        const matchingVersion = sortedVersions.find(v => this.satisfiesConstraint(v.version, constraint));
        this.logger.debug('Matching version found', {
            constraint,
            matchedVersion: matchingVersion?.version || 'none'
        });

        return matchingVersion;
    }

    /**
     * Checks if a version satisfies a semver constraint.
     * @param version - The version to check.
     * @param constraint - The semver constraint.
     * @returns True if version satisfies the constraint.
     */
    private satisfiesConstraint(version: string, constraint: string): boolean {
        const normalizeVersion = (v: string) => v.replace(/^[\^~><=v]/, '').split(/[\.-]/)[0];
        const plainVersion = normalizeVersion(version);
        const plainConstraint = normalizeVersion(constraint);

        return compareSemVer(plainVersion, plainConstraint) >= 0;
    }
}
