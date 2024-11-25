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
  STANDARD_OP: 250,              // Regular operations like highlighting a single path (seeing up to ~200ms in CI)

  /** Maximum time allowed for stress test operations (heavy load scenarios) */
  STRESS_OP: 700,               // Seeing up to 685ms in macOS CI for stress operations

  /** Maximum factor by which operations can slow down after document changes */
  DOC_CHANGE_FACTOR: 25,        // Multiplier for acceptable slowdown after document modifications

  /** Maximum time allowed for rapid, repeated operations */
  RAPID_OP: 250,               // Used when testing quick successive highlighting requests

  /** Maximum time allowed for operations that happen alongside other operations */
  CONCURRENT_OP: 200,          // Operations happening simultaneously

  /** Maximum memory usage allowed during tests in megabytes */
  MEMORY_LIMIT_MB: 8.0,         // Memory consumption limit

  /** Default timeout for regular test operations in milliseconds */
  TIMEOUT_MS: 5000,            // General test timeout

  /** Extended timeout for memory-intensive stress tests in milliseconds */
  STRESS_MEMORY_TIMEOUT_MS: 15000,  // Increased from 10s to 15s as macOS CI needs more time

  /** Maximum time allowed for operations after a document highlight change */
  HIGHLIGHT_CHANGE_THRESHOLD: 175,   // Increased from 150ms as we're seeing 151.84ms in macOS

  /** Maximum time allowed for highlightinh large documents */
  LARGE_DOC_THRESHOLD: 300,    // Increased from 200 as we're seeing 260ms in Windows CI

  /** Maximum time allowed for concurrent operations during stress testing */
  STRESS_CONCURRENT_THRESHOLD: 200   // For concurrent operations in stress tests
} as const;
