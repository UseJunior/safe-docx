/**
 * Benchmark metric utilities.
 *
 * Timing and memory measurement helpers used by the quality benchmark runner.
 */

/**
 * Measure current RSS memory usage in megabytes.
 */
export function measureMemory(): number {
  const usage = process.memoryUsage();
  return usage.rss / (1024 * 1024);
}

/**
 * Create a high-resolution timer. Returns a function that, when called,
 * returns elapsed milliseconds since creation.
 */
export function createTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => {
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000;
  };
}
