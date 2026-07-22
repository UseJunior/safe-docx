/**
 * Quality benchmark reporter.
 *
 * Formats gate-then-score results as Markdown, JSON, or console output.
 */

import type { FixtureBenchmarkResult } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────

function gateIcon(passed: boolean): string {
  return passed ? 'PASS' : 'FAIL';
}

// ── Markdown ────────────────────────────────────────────────────────

export function generateMarkdownReport(results: FixtureBenchmarkResult[]): string {
  const lines: string[] = [];

  lines.push('# Quality Benchmark Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| Fixture | Engine | G1a | G1b | G1c | G2* | G3 | Q1 | Q3(ms) | Q4 |');
  lines.push('|---------|--------|-----|-----|-----|-----|----|----|--------|----|');

  for (const result of results) {
    for (const [engineName, er] of Object.entries(result.engines)) {
      const g1 = er.gates.textRoundTrip;
      const g1a = gateIcon(g1.normalizedTextParity.passed);
      const g1b = gateIcon(g1.paragraphCountParity.passed);
      const g1c = gateIcon(g1.xmlParseValidity.passed);
      const g2 = gateIcon(er.gates.formattingProjection.passed);
      const g3 = gateIcon(er.gates.structuralIntegrity.passed);

      const q1 = er.scores?.diffMinimality
        ? String(er.scores.diffMinimality.engineRuns)
        : '-';
      const q3 = er.scores?.performance
        ? er.scores.performance.wallTimeMs.toFixed(0)
        : '-';
      const q4parts: string[] = [];
      if (er.scores?.extras.moveDetection) q4parts.push('moves');
      if (er.scores?.extras.tableCellDiff) q4parts.push('tables');
      const q4 = q4parts.length > 0 ? q4parts.join('+') : '-';

      lines.push(
        `| ${result.fixture} | ${engineName} | ${g1a} | ${g1b} | ${g1c} | ${g2} | ${g3} | ${q1} | ${q3} | ${q4} |`,
      );
    }
  }

  lines.push('');
  lines.push('*G2 is a soft gate (diagnostic only in v1)*');
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');

  const engineStats = new Map<string, { total: number; hardPass: number; softPass: number }>();
  for (const result of results) {
    for (const [engineName, er] of Object.entries(result.engines)) {
      const stats = engineStats.get(engineName) ?? { total: 0, hardPass: 0, softPass: 0 };
      stats.total++;
      if (er.hardGatesPassed) stats.hardPass++;
      if (er.softGatesPassed) stats.softPass++;
      engineStats.set(engineName, stats);
    }
  }

  for (const [engine, stats] of engineStats) {
    lines.push(`- **${engine}**: ${stats.hardPass}/${stats.total} hard gates passed, ${stats.softPass}/${stats.total} soft gates passed`);
  }

  return lines.join('\n');
}

// ── JSON ────────────────────────────────────────────────────────────

export function generateJsonReport(results: FixtureBenchmarkResult[]): string {
  return JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      results,
    },
    null,
    2,
  );
}

// ── Console ─────────────────────────────────────────────────────────

export function printSummary(results: FixtureBenchmarkResult[]): void {
  console.log('\n=== Quality Benchmark Summary ===\n');

  for (const result of results) {
    console.log(`Fixture: ${result.fixture} [${result.tags.join(', ')}]`);

    for (const [engineName, er] of Object.entries(result.engines)) {
      const hard = er.hardGatesPassed ? 'PASS' : 'FAIL';
      const soft = er.softGatesPassed ? 'PASS' : 'FAIL';
      const time = er.scores?.performance
        ? `${er.scores.performance.wallTimeMs.toFixed(0)}ms`
        : 'N/A';
      const q1 = er.scores?.diffMinimality
        ? `${er.scores.diffMinimality.engineRuns} runs`
        : 'N/A';

      console.log(`  ${engineName}: hard=${hard} soft=${soft} time=${time} q1=${q1}`);

      if (er.error) {
        console.log(`    Error: ${er.error}`);
      }
    }

    console.log('');
  }
}
