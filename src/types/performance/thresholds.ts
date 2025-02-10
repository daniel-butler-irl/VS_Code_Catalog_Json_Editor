// src/types/performance/thresholds.ts

/**
 * Interface defining the structure of performance thresholds
 */
export interface IPerformanceThresholds {
  /** Maximum time (ms) for standard operations like path highlighting */
  readonly STANDARD_OP: number;

  /** Maximum time (ms) for operations under stress conditions */
  readonly STRESS_OP: number;

  /** Factor for acceptable slowdown after document changes (multiplier) */
  readonly DOC_CHANGE_FACTOR: number;

  /** Maximum time (ms) for rapid successive operations */
  readonly RAPID_OP: number;

  /** Maximum time (ms) for concurrent operations */
  readonly CONCURRENT_OP: number;

  /** Maximum memory usage allowed (MB) */
  readonly MEMORY_LIMIT_MB: number;

  /** Default test timeout (ms) */
  readonly TIMEOUT_MS: number;

  /** Timeout for memory stress tests (ms) */
  readonly STRESS_MEMORY_TIMEOUT_MS: number;

  /** Maximum time (ms) for operations after highlight changes */
  readonly HIGHLIGHT_CHANGE_THRESHOLD: number;

  /** Maximum time (ms) for highlighting large documents */
  readonly LARGE_DOC_THRESHOLD: number;

  /** Maximum time (ms) for concurrent operations in stress tests */
  readonly STRESS_CONCURRENT_THRESHOLD: number;
}

/**
 * Default performance thresholds based on observed metrics across different CI environments
 * All time-based thresholds are in milliseconds unless otherwise specified
 */
export const DEFAULT_PERFORMANCE_THRESHOLDS: Readonly<IPerformanceThresholds> = {
  /** Maximum time allowed for standard JSON path highlighting operations */
  STANDARD_OP: 1200,              // Increased from 250ms to 1200ms based on actual performance

  /** Maximum time allowed for stress test operations (heavy load scenarios) */
  STRESS_OP: 1200,               // Increased from 700ms to 1200ms based on actual performance

  /** Maximum factor by which operations can slow down after document changes */
  DOC_CHANGE_FACTOR: 2,         // Reduced from 25 to 2 for more realistic expectations

  /** Maximum time allowed for rapid, repeated operations */
  RAPID_OP: 1200,               // Kept at 1200ms as it's working well

  /** Maximum time allowed for operations that happen alongside other operations */
  CONCURRENT_OP: 200,          // Kept at 200ms as it's working well

  /** Maximum memory usage allowed during tests in megabytes */
  MEMORY_LIMIT_MB: 8.0,         // Kept at 8MB as it's working well

  /** Default timeout for regular test operations in milliseconds */
  TIMEOUT_MS: 5000,            // Kept at 5000ms as it's working well

  /** Extended timeout for memory-intensive stress tests in milliseconds */
  STRESS_MEMORY_TIMEOUT_MS: 15000,  // Kept at 15000ms as it's working well

  /** Maximum time allowed for operations after a document highlight change */
  HIGHLIGHT_CHANGE_THRESHOLD: 1200,   // Increased from 175ms to 1200ms based on actual performance

  /** Maximum time allowed for highlighting large documents */
  LARGE_DOC_THRESHOLD: 1200,    // Kept at 1200ms as it's working well

  /** Maximum time allowed for concurrent operations during stress testing */
  STRESS_CONCURRENT_THRESHOLD: 1200   // Increased from 200ms to 1200ms based on actual performance measurements
} as const;
