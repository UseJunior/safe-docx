#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const PACKAGES = [
  {
    name: '@usejunior/docx-core',
    id: 'docx-core',
    summaryPath: path.join(ROOT, 'packages/docx-core/coverage/coverage-summary.json'),
  },
  {
    name: '@usejunior/docx-mcp',
    id: 'docx-mcp',
    summaryPath: path.join(ROOT, 'packages/docx-mcp/coverage/coverage-summary.json'),
  },
];
// v8 coverage can fluctuate slightly run-to-run on branch counters.
// Treat tiny deltas as noise to keep ratchet checks stable.
const RATCHET_TOLERANCE = 0.1;

function parseArgs(argv) {
  const out = {
    baseline: null,
    output: null,
    enforce: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--baseline') out.baseline = argv[++i] ?? null;
    else if (arg === '--output') out.output = argv[++i] ?? null;
    else if (arg === '--enforce') out.enforce = true;
  }
  return out;
}

function fixed2(value) {
  return Number(value.toFixed(2));
}

function toDelta(current, baseline) {
  if (typeof baseline !== 'number') return null;
  return fixed2(current - baseline);
}

function formatDelta(delta) {
  if (delta === null) return 'n/a';
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(2)}%`;
}

async function loadJsonOrNull(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractTotals(summaryJson) {
  const total = summaryJson?.total;
  if (!total) throw new Error('Invalid coverage summary: missing total');
  const lines = Number(total.lines?.pct ?? 0);
  const branches = Number(total.branches?.pct ?? 0);
  const functions = Number(total.functions?.pct ?? 0);
  const statements = Number(total.statements?.pct ?? 0);
  return {
    lines: fixed2(lines),
    branches: fixed2(branches),
    functions: fixed2(functions),
    statements: fixed2(statements),
  };
}

function printTable(rows, baselineByPackage) {
  const header = [
    'Package'.padEnd(36),
    'Lines'.padStart(8),
    'Branches'.padStart(10),
    'Functions'.padStart(11),
    'Statements'.padStart(12),
    'ΔLines'.padStart(9),
    'ΔBranches'.padStart(11),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of rows) {
    const base = baselineByPackage?.[row.id] ?? null;
    const dLines = formatDelta(toDelta(row.lines, base?.lines));
    const dBranches = formatDelta(toDelta(row.branches, base?.branches));
    console.log(
      [
        row.name.padEnd(36),
        `${row.lines.toFixed(2)}%`.padStart(8),
        `${row.branches.toFixed(2)}%`.padStart(10),
        `${row.functions.toFixed(2)}%`.padStart(11),
        `${row.statements.toFixed(2)}%`.padStart(12),
        dLines.padStart(9),
        dBranches.padStart(11),
      ].join(' | ')
    );
  }
}

function weightedAverage(rows, key) {
  // We don't have file-level totals here; use simple mean for dashboard summary.
  if (rows.length === 0) return 0;
  return fixed2(rows.reduce((sum, row) => sum + row[key], 0) / rows.length);
}

function enforceRatchet(rows, baselineByPackage) {
  const failures = [];
  for (const row of rows) {
    const base = baselineByPackage?.[row.id];
    if (!base) continue;

    const lineDelta = toDelta(row.lines, base.lines);
    const branchDelta = toDelta(row.branches, base.branches);
    if (lineDelta !== null && lineDelta < -RATCHET_TOLERANCE) {
      failures.push(`${row.name} lines regressed: ${row.lines.toFixed(2)}% < baseline ${base.lines.toFixed(2)}%`);
    }
    if (branchDelta !== null && branchDelta < -RATCHET_TOLERANCE) {
      failures.push(`${row.name} branches regressed: ${row.branches.toFixed(2)}% < baseline ${base.branches.toFixed(2)}%`);
    }
  }
  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baselinePath = args.baseline ? path.resolve(ROOT, args.baseline) : null;
  const outputPath = args.output ? path.resolve(ROOT, args.output) : null;

  const rows = [];
  for (const pkg of PACKAGES) {
    const summary = await loadJsonOrNull(pkg.summaryPath);
    if (!summary) {
      throw new Error(
        `Missing coverage summary for ${pkg.name}: ${pkg.summaryPath}\n` +
        'Run package coverage first (npm run test:coverage:packages).'
      );
    }
    rows.push({
      name: pkg.name,
      id: pkg.id,
      ...extractTotals(summary),
    });
  }

  const baselineRaw = baselinePath ? await loadJsonOrNull(baselinePath) : null;
  const baselineByPackage = baselineRaw?.packages ?? null;

  printTable(rows, baselineByPackage);

  const summary = {
    generated_at: new Date().toISOString(),
    packages: Object.fromEntries(
      rows.map((row) => [
        row.id,
        {
          lines: row.lines,
          branches: row.branches,
          functions: row.functions,
          statements: row.statements,
          deltas: {
            lines: toDelta(row.lines, baselineByPackage?.[row.id]?.lines),
            branches: toDelta(row.branches, baselineByPackage?.[row.id]?.branches),
            functions: toDelta(row.functions, baselineByPackage?.[row.id]?.functions),
            statements: toDelta(row.statements, baselineByPackage?.[row.id]?.statements),
          },
        },
      ])
    ),
    aggregate: {
      lines_mean: weightedAverage(rows, 'lines'),
      branches_mean: weightedAverage(rows, 'branches'),
      functions_mean: weightedAverage(rows, 'functions'),
      statements_mean: weightedAverage(rows, 'statements'),
    },
  };

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`\nWrote coverage dashboard summary: ${path.relative(ROOT, outputPath)}`);
  }

  if (args.enforce && baselineByPackage) {
    const failures = enforceRatchet(rows, baselineByPackage);
    if (failures.length > 0) {
      console.error('\nCoverage ratchet failed:');
      for (const f of failures) console.error(`- ${f}`);
      process.exit(1);
    }
    console.log('\nCoverage ratchet check passed (no line/branch regressions vs baseline).');
  }
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
