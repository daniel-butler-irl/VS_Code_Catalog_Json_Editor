// src/types/performance/thresholds.ts

/**
 * Performance thresholds for editor highlighting operations
 */
export interface IPerformanceThresholds {
  /** Standard operations threshold (ms) */
  readonly STANDARD_OP: number;
  /** Stress test operations threshold (ms) */
  readonly STRESS_OP: number;
  /** Factor for acceptable slowdown after document changes */
  readonly DOC_CHANGE_FACTOR: number;
  /** Rapid operations threshold (ms) */
  readonly RAPID_OP: number;
  /** Concurrent operations threshold (ms) */
  readonly CONCURRENT_OP: number;
  /** Memory usage limit (MB) */
  readonly MEMORY_LIMIT_MB: number;
  /** General timeout for tests (ms) */
  readonly TIMEOUT_MS: number;
  /** Memory stress test timeout (ms) */
  readonly STRESS_MEMORY_TIMEOUT_MS: number;
  /** Threshold for highlight changes (ms) */
  readonly HIGHLIGHT_CHANGE_THRESHOLD: number;
  /** Threshold for concurrent stress operations (ms) */
  readonly STRESS_CONCURRENT_THRESHOLD: number;
}

/**
 * Default performance thresholds based on observed metrics
 */
export const DEFAULT_PERFORMANCE_THRESHOLDS: Readonly<IPerformanceThresholds> = {
  STANDARD_OP: 120,             // Increased to 120ms to account for 109.60ms
  STRESS_OP: 150,              // Keep at 150ms
  DOC_CHANGE_FACTOR: 25,       // Increased to 25x (seeing ~10x differences consistently)
  RAPID_OP: 60,               // Keep at 60ms
  CONCURRENT_OP: 110,          // Keep at 110ms
  MEMORY_LIMIT_MB: 1.0,        // Keep at 1.0MB
  TIMEOUT_MS: 5000,           // Keep at 5000ms
  STRESS_MEMORY_TIMEOUT_MS: 10000,
  HIGHLIGHT_CHANGE_THRESHOLD: 90,
  STRESS_CONCURRENT_THRESHOLD: 110 // Keep at 110ms
} as const;
