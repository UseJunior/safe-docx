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
    name: '@usejunior/docx-compare',
    id: 'docx-compare',
    summaryPath: path.join(ROOT, 'packages/docx-compare/coverage/coverage-summary.json'),
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
// A ratchet that only rejects regressions can remain silently stale after a large
// deletion or refactor. Require maintainers to refresh any floor that trails a
// clean run by more than one percentage point.
const MAX_POSITIVE_DRIFT = {
  lines: 1,
  branches: 2,
};

function parseArgs(argv) {
  const out = {
    baseline: null,
    output: null,
    enforce: false,
    writeBaseline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--baseline') out.baseline = argv[++i] ?? null;
    else if (arg === '--output') out.output = argv[++i] ?? null;
    else if (arg === '--enforce') out.enforce = true;
    else if (arg === '--write-baseline') out.writeBaseline = true;
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
  const metrics = Object.fromEntries(
    ['lines', 'branches', 'functions', 'statements'].map((metric) => {
      const value = Number(total[metric]?.pct);
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid coverage summary: ${metric}.pct must be a finite number`);
      }
      return [metric, value];
    })
  );
  return {
    lines: fixed2(metrics.lines),
    branches: fixed2(metrics.branches),
    functions: fixed2(metrics.functions),
    statements: fixed2(metrics.statements),
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

function buildBaseline(rows) {
  return {
    generated_at: new Date().toISOString(),
    policy: {
      ratchet_tolerance_percentage_points: RATCHET_TOLERANCE,
      max_positive_drift_percentage_points: MAX_POSITIVE_DRIFT,
    },
    packages: Object.fromEntries(
      rows.map((row) => [
        row.id,
        {
          lines: row.lines,
          branches: row.branches,
          // Functions and statements remain dashboard metrics; only lines and
          // branches are governed floors in enforceRatchet/findFloorRegressions.
          functions: row.functions,
          statements: row.statements,
          deltas: {
            lines: null,
            branches: null,
            functions: null,
            statements: null,
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
}

function enforceRatchet(rows, baselineByPackage) {
  const failures = [];
  for (const row of rows) {
    const base = baselineByPackage?.[row.id];
    if (!base) {
      failures.push(`${row.name} has no committed coverage baseline`);
      continue;
    }

    if (typeof base.lines !== 'number' || typeof base.branches !== 'number') {
      failures.push(`${row.name} coverage baseline must contain numeric lines and branches`);
      continue;
    }

    const lineDelta = toDelta(row.lines, base.lines);
    const branchDelta = toDelta(row.branches, base.branches);
    if (lineDelta !== null && lineDelta < -RATCHET_TOLERANCE) {
      failures.push(`${row.name} lines regressed: ${row.lines.toFixed(2)}% < baseline ${base.lines.toFixed(2)}%`);
    }
    if (branchDelta !== null && branchDelta < -RATCHET_TOLERANCE) {
      failures.push(`${row.name} branches regressed: ${row.branches.toFixed(2)}% < baseline ${base.branches.toFixed(2)}%`);
    }
    if (lineDelta !== null && lineDelta > MAX_POSITIVE_DRIFT.lines) {
      failures.push(
        `${row.name} line baseline is stale: current ${row.lines.toFixed(2)}% exceeds baseline ${base.lines.toFixed(2)}% by ${lineDelta.toFixed(2)} points`
      );
    }
    if (branchDelta !== null && branchDelta > MAX_POSITIVE_DRIFT.branches) {
      failures.push(
        `${row.name} branch baseline is stale: current ${row.branches.toFixed(2)}% exceeds baseline ${base.branches.toFixed(2)}% by ${branchDelta.toFixed(2)} points`
      );
    }
  }
  return failures;
}

function findFloorRegressions(rows, baselineByPackage) {
  const regressions = [];
  for (const row of rows) {
    const base = baselineByPackage?.[row.id];
    if (!base) continue;
    for (const metric of ['lines', 'branches']) {
      const delta = toDelta(row[metric], base[metric]);
      if (delta !== null && delta < -RATCHET_TOLERANCE) {
        regressions.push(
          `${row.name} ${metric} would lower the floor: ${row[metric].toFixed(2)}% < ${base[metric].toFixed(2)}%`
        );
      }
    }
  }
  return regressions;
}

function validateBaselinePolicy(baselineRaw) {
  const policy = baselineRaw?.policy;
  if (
    policy?.ratchet_tolerance_percentage_points !== RATCHET_TOLERANCE ||
    policy?.max_positive_drift_percentage_points?.lines !== MAX_POSITIVE_DRIFT.lines ||
    policy?.max_positive_drift_percentage_points?.branches !== MAX_POSITIVE_DRIFT.branches
  ) {
    throw new Error(
      'Coverage baseline policy is missing or stale; regenerate it with npm run coverage:packages:rebaseline.'
    );
  }
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

  if ((args.enforce || args.writeBaseline) && !baselinePath) {
    throw new Error('--enforce and --write-baseline require --baseline <path>.');
  }
  if ((args.enforce || args.writeBaseline) && !baselineByPackage) {
    throw new Error(`Coverage baseline is missing or invalid: ${baselinePath}`);
  }
  if (args.enforce || args.writeBaseline) validateBaselinePolicy(baselineRaw);

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

  if (args.writeBaseline) {
    const regressions = findFloorRegressions(rows, baselineByPackage);
    if (regressions.length > 0) {
      console.error('\nRefusing to lower package coverage floors:');
      for (const regression of regressions) console.error(`- ${regression}`);
      process.exit(1);
    }
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    await fs.writeFile(baselinePath, `${JSON.stringify(buildBaseline(rows), null, 2)}\n`, 'utf8');
    console.log(`\nWrote package coverage baseline: ${path.relative(ROOT, baselinePath)}`);
  }

  if (args.enforce && baselineByPackage) {
    const failures = enforceRatchet(rows, baselineByPackage);
    if (failures.length > 0) {
      console.error('\nCoverage ratchet failed:');
      for (const f of failures) console.error(`- ${f}`);
      console.error(
        '\nRestore any regressions; if only stale floors remain, run npm run coverage:packages:rebaseline.'
      );
      process.exit(1);
    }
    console.log('\nCoverage ratchet check passed (no regressions or stale line/branch floors).');
  }
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
