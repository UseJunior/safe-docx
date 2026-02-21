#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SUMMARY_FILES = [
  path.join(ROOT, 'packages/docx-comparison/coverage/coverage-summary.json'),
  path.join(ROOT, 'packages/docx-primitives/coverage/coverage-summary.json'),
  path.join(ROOT, 'packages/safe-docx/coverage/coverage-summary.json'),
];

const DEFAULT_TOP = 15;

function parseArgs(argv) {
  const out = { top: DEFAULT_TOP };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--top') {
      const next = Number.parseInt(argv[i + 1] ?? '', 10);
      if (Number.isFinite(next) && next > 0) out.top = next;
      i += 1;
    }
  }
  return out;
}

function fixed2(value) {
  return Number(value.toFixed(2));
}

function pad(value, width, align = 'left') {
  const text = String(value);
  if (text.length >= width) return text;
  return align === 'right'
    ? `${' '.repeat(width - text.length)}${text}`
    : `${text}${' '.repeat(width - text.length)}`;
}

async function loadCoverageSummary(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function relativePath(absolute) {
  const prefix = `${ROOT}/`;
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute;
}

function collectRows(summary) {
  const rows = [];
  for (const [file, stats] of Object.entries(summary)) {
    if (file === 'total') continue;
    const lines = stats.lines;
    const branches = stats.branches;
    rows.push({
      file: relativePath(file),
      linePct: Number(lines.pct),
      branchPct: Number(branches.pct),
      uncoveredLines: Number(lines.total) - Number(lines.covered),
      uncoveredBranches: Number(branches.total) - Number(branches.covered),
      lineTotal: Number(lines.total),
      branchTotal: Number(branches.total),
    });
  }
  return rows;
}

function printSection(title, rows, top, sortKey, columns) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
  const sorted = [...rows].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, top);

  const header = columns.map((c) => pad(c.label, c.width, c.align)).join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of sorted) {
    const line = columns.map((c) => pad(c.value(row), c.width, c.align)).join('  ');
    console.log(line);
  }
}

function aggregateTotals(packageTotals) {
  const sums = packageTotals.reduce(
    (acc, pkg) => {
      acc.linesCovered += pkg.lines.covered;
      acc.linesTotal += pkg.lines.total;
      acc.branchesCovered += pkg.branches.covered;
      acc.branchesTotal += pkg.branches.total;
      return acc;
    },
    { linesCovered: 0, linesTotal: 0, branchesCovered: 0, branchesTotal: 0 },
  );

  return {
    linesPct: sums.linesTotal > 0 ? fixed2((sums.linesCovered / sums.linesTotal) * 100) : 0,
    branchesPct: sums.branchesTotal > 0 ? fixed2((sums.branchesCovered / sums.branchesTotal) * 100) : 0,
  };
}

function printPackageSummary(packageSummaries) {
  console.log('\nPackage Coverage');
  console.log('----------------');
  const header = [
    pad('Package', 22),
    pad('Lines', 9, 'right'),
    pad('Branches', 11, 'right'),
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const pkg of packageSummaries) {
    console.log([
      pad(pkg.name, 22),
      pad(`${pkg.lines.pct.toFixed(2)}%`, 9, 'right'),
      pad(`${pkg.branches.pct.toFixed(2)}%`, 11, 'right'),
    ].join('  '));
  }

  const aggregate = aggregateTotals(packageSummaries);
  console.log('-'.repeat(header.length));
  console.log([
    pad('Aggregate', 22),
    pad(`${aggregate.linesPct.toFixed(2)}%`, 9, 'right'),
    pad(`${aggregate.branchesPct.toFixed(2)}%`, 11, 'right'),
  ].join('  '));
}

async function main() {
  const { top } = parseArgs(process.argv.slice(2));
  const packageSummaries = [];
  const allRows = [];

  for (const summaryPath of SUMMARY_FILES) {
    let summary;
    try {
      summary = await loadCoverageSummary(summaryPath);
    } catch {
      throw new Error(`Missing coverage summary: ${relativePath(summaryPath)}\nRun npm run test:coverage:packages first.`);
    }
    const packageName = summaryPath.includes('docx-primitives')
      ? 'docx-primitives'
      : summaryPath.includes('docx-comparison')
        ? 'docx-comparison'
        : 'safe-docx';

    packageSummaries.push({
      name: packageName,
      lines: summary.total.lines,
      branches: summary.total.branches,
    });
    allRows.push(...collectRows(summary));
  }

  printPackageSummary(packageSummaries);

  printSection(
    `Top ${top} Files by Uncovered Branches`,
    allRows,
    top,
    'uncoveredBranches',
    [
      { label: 'Uncovered', width: 10, align: 'right', value: (r) => r.uncoveredBranches },
      { label: 'Branch %', width: 9, align: 'right', value: (r) => `${r.branchPct.toFixed(2)}%` },
      { label: 'Uncov L', width: 8, align: 'right', value: (r) => r.uncoveredLines },
      { label: 'Line %', width: 8, align: 'right', value: (r) => `${r.linePct.toFixed(2)}%` },
      { label: 'File', width: 0, align: 'left', value: (r) => r.file },
    ],
  );

  printSection(
    `Top ${top} Files by Uncovered Lines`,
    allRows,
    top,
    'uncoveredLines',
    [
      { label: 'Uncovered', width: 10, align: 'right', value: (r) => r.uncoveredLines },
      { label: 'Line %', width: 8, align: 'right', value: (r) => `${r.linePct.toFixed(2)}%` },
      { label: 'Uncov B', width: 8, align: 'right', value: (r) => r.uncoveredBranches },
      { label: 'Branch %', width: 9, align: 'right', value: (r) => `${r.branchPct.toFixed(2)}%` },
      { label: 'File', width: 0, align: 'left', value: (r) => r.file },
    ],
  );
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
