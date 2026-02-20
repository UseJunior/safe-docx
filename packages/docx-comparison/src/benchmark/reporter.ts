/**
 * Benchmark result reporter.
 *
 * Formats benchmark results for different output modes.
 */

import { BenchmarkResult, ComparisonMetrics } from './metrics.js';

/**
 * Format metrics as a markdown table row.
 */
function formatMetricsRow(
  name: string,
  metrics: ComparisonMetrics | null,
  error?: string
): string {
  if (error) {
    return `| ${name} | Error: ${error.slice(0, 50)}... | - | - | - | - |`;
  }
  if (!metrics) {
    return `| ${name} | Skipped | - | - | - | - |`;
  }

  return `| ${name} | ${metrics.insertions} | ${metrics.deletions} | ${metrics.wallTimeMs.toFixed(1)}ms | ${metrics.peakRssMb.toFixed(1)}MB | ${(metrics.outputSizeBytes / 1024).toFixed(1)}KB |`;
}

/**
 * Generate a markdown report from benchmark results.
 */
export function generateMarkdownReport(results: BenchmarkResult[]): string {
  const lines: string[] = [];

  lines.push('# Document Comparison Benchmark Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  for (const result of results) {
    lines.push(`## Fixture: ${result.fixture}`);
    lines.push('');
    lines.push('| Baseline | Insertions | Deletions | Time | Memory | Output Size |');
    lines.push('|----------|------------|-----------|------|--------|-------------|');
    lines.push(formatMetricsRow('A (WmlComparer)', result.baselineA, result.baselineAError));
    lines.push(formatMetricsRow('B (Pure TS)', result.baselineB, result.baselineBError));
    if (result.wordOracle) {
      lines.push(formatMetricsRow('Word Oracle', result.wordOracle));
    }
    lines.push('');
  }

  // Summary statistics
  lines.push('## Summary');
  lines.push('');

  const successfulA = results.filter(r => r.baselineA !== null);
  const successfulB = results.filter(r => r.baselineB !== null);

  if (successfulA.length > 0) {
    const avgTimeA = successfulA.reduce((sum, r) => sum + (r.baselineA?.wallTimeMs ?? 0), 0) / successfulA.length;
    lines.push(`- Baseline A: ${successfulA.length}/${results.length} successful, avg time: ${avgTimeA.toFixed(1)}ms`);
  }

  if (successfulB.length > 0) {
    const avgTimeB = successfulB.reduce((sum, r) => sum + (r.baselineB?.wallTimeMs ?? 0), 0) / successfulB.length;
    lines.push(`- Baseline B: ${successfulB.length}/${results.length} successful, avg time: ${avgTimeB.toFixed(1)}ms`);
  }

  return lines.join('\n');
}

/**
 * Generate a console table from benchmark results.
 */
export function generateConsoleTable(results: BenchmarkResult[]): string {
  const lines: string[] = [];

  // Header
  lines.push('┌────────────────────────┬──────────┬─────────────┬─────────────┬──────────┬──────────┐');
  lines.push('│ Fixture                │ Baseline │ Insertions  │ Deletions   │ Time     │ Memory   │');
  lines.push('├────────────────────────┼──────────┼─────────────┼─────────────┼──────────┼──────────┤');

  for (const result of results) {
    const fixtureName = result.fixture.padEnd(22).slice(0, 22);

    // Baseline A row
    if (result.baselineAError) {
      lines.push(`│ ${fixtureName} │ A        │ ERROR       │             │          │          │`);
    } else if (result.baselineA) {
      const m = result.baselineA;
      lines.push(
        `│ ${fixtureName} │ A        │ ${String(m.insertions).padStart(11)} │ ${String(m.deletions).padStart(11)} │ ${m.wallTimeMs.toFixed(0).padStart(6)}ms │ ${m.peakRssMb.toFixed(1).padStart(6)}MB │`
      );
    }

    // Baseline B row
    if (result.baselineBError) {
      lines.push(`│                        │ B        │ ERROR       │             │          │          │`);
    } else if (result.baselineB) {
      const m = result.baselineB;
      lines.push(
        `│                        │ B        │ ${String(m.insertions).padStart(11)} │ ${String(m.deletions).padStart(11)} │ ${m.wallTimeMs.toFixed(0).padStart(6)}ms │ ${m.peakRssMb.toFixed(1).padStart(6)}MB │`
      );
    }

    lines.push('├────────────────────────┼──────────┼─────────────┼─────────────┼──────────┼──────────┤');
  }

  // Remove last separator and add bottom border
  lines.pop();
  lines.push('└────────────────────────┴──────────┴─────────────┴─────────────┴──────────┴──────────┘');

  return lines.join('\n');
}

/**
 * Generate JSON output from benchmark results.
 */
export function generateJsonReport(results: BenchmarkResult[]): string {
  return JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      results: results.map(r => ({
        fixture: r.fixture,
        timestamp: r.timestamp.toISOString(),
        baselineA: r.baselineA
          ? {
              success: true,
              ...r.baselineA,
            }
          : {
              success: false,
              error: r.baselineAError,
            },
        baselineB: r.baselineB
          ? {
              success: true,
              ...r.baselineB,
            }
          : {
              success: false,
              error: r.baselineBError,
            },
        wordOracle: r.wordOracle ?? null,
      })),
    },
    null,
    2
  );
}

/**
 * Print a comparison summary to console.
 */
export function printSummary(results: BenchmarkResult[]): void {
  console.log('\n=== Benchmark Summary ===\n');

  for (const result of results) {
    console.log(`Fixture: ${result.fixture}`);

    if (result.baselineA) {
      console.log(
        `  Baseline A: ${result.baselineA.insertions} ins, ${result.baselineA.deletions} del, ${result.baselineA.wallTimeMs.toFixed(0)}ms`
      );
    } else if (result.baselineAError) {
      console.log(`  Baseline A: Error - ${result.baselineAError}`);
    } else {
      console.log('  Baseline A: Skipped');
    }

    if (result.baselineB) {
      console.log(
        `  Baseline B: ${result.baselineB.insertions} ins, ${result.baselineB.deletions} del, ${result.baselineB.wallTimeMs.toFixed(0)}ms`
      );
    } else if (result.baselineBError) {
      console.log(`  Baseline B: Error - ${result.baselineBError}`);
    } else {
      console.log('  Baseline B: Skipped');
    }

    console.log('');
  }
}
