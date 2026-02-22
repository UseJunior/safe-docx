#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const TRACEABILITY_SOURCES = {
  safeDocx: path.join(REPO_ROOT, 'packages', 'safe-docx', 'src', 'testing', 'SAFE_DOCX_OPENSPEC_TRACEABILITY.md'),
  docxPrimitives: path.join(REPO_ROOT, 'packages', 'docx-primitives', 'test', 'DOCX_PRIMITIVES_OPENSPEC_TRACEABILITY.md'),
  docxComparison: path.join(REPO_ROOT, 'packages', 'docx-comparison', 'src', 'testing', 'DOCX_COMPARISON_OPENSPEC_TRACEABILITY.md'),
};

const ALLURE_SOURCES = {
  safeDocx: path.join(REPO_ROOT, 'packages', 'safe-docx', 'allure-results'),
  docxPrimitives: path.join(REPO_ROOT, 'packages', 'docx-primitives', 'allure-results'),
  docxComparison: path.join(REPO_ROOT, 'packages', 'docx-comparison', 'allure-results'),
};

function parseArgs() {
  const args = process.argv.slice(2);
  let outputPath = path.join(REPO_ROOT, 'site', 'src', 'trust', 'system-card.md');
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--output') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('--output requires a path value');
      }
      outputPath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${args[i]}`);
  }
  return { outputPath };
}

function runNodeScript(scriptRelativePath, scriptArgs = []) {
  const scriptPath = path.join(REPO_ROOT, scriptRelativePath);
  execFileSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

function parseMatrixMarkdown(markdown, label) {
  const rows = [];
  let currentChange = null;

  for (const line of markdown.split('\n')) {
    const headingMatch = line.match(/^#{2,3}\s+Change:\s+`([^`]+)`/);
    if (headingMatch) {
      currentChange = headingMatch[1];
      continue;
    }

    if (!line.startsWith('|')) {
      continue;
    }

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((value) => value.trim());

    if (cells.length < 2) {
      continue;
    }

    if (cells[0] === 'Scenario' || cells[0] === '---') {
      continue;
    }

    const status = cells[1];
    if (!['covered', 'missing', 'pending_impl'].includes(status)) {
      continue;
    }

    rows.push({
      scenario: cells[0],
      status,
      fileCell: cells[2] ?? 'n/a',
      notes: cells[3] ?? '',
      change: currentChange,
    });
  }

  const summary = {
    label,
    total: rows.length,
    covered: rows.filter((row) => row.status === 'covered').length,
    missing: rows.filter((row) => row.status === 'missing').length,
    pending: rows.filter((row) => row.status === 'pending_impl').length,
    changes: [...new Set(rows.map((row) => row.change).filter(Boolean))],
    missingScenarios: rows
      .filter((row) => row.status === 'missing' || row.status === 'pending_impl')
      .map((row) => ({ scenario: row.scenario, status: row.status, change: row.change })),
  };

  return summary;
}

async function parseAllureResults(packageLabel, dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return {
      packageLabel,
      available: false,
      total: 0,
      latestStop: null,
      statusCounts: {},
    };
  }

  const resultFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('-result.json'))
    .map((entry) => path.join(dirPath, entry.name));

  const statusCounts = new Map();
  let latestStop = null;

  for (const filePath of resultFiles) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const status = String(parsed.status ?? 'unknown');
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

      if (typeof parsed.stop === 'number') {
        latestStop = latestStop == null ? parsed.stop : Math.max(latestStop, parsed.stop);
      }
    } catch {
      statusCounts.set('unknown', (statusCounts.get('unknown') ?? 0) + 1);
    }
  }

  return {
    packageLabel,
    available: true,
    total: resultFiles.length,
    latestStop,
    statusCounts: Object.fromEntries([...statusCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function utcTimestamp(value) {
  if (value == null) {
    return 'n/a';
  }
  return new Date(value).toISOString().replace('.000', '');
}

function pct(covered, total) {
  if (!total) {
    return '0.0%';
  }
  return `${((covered / total) * 100).toFixed(1)}%`;
}

function formatStatusCount(statusCounts, key) {
  return statusCounts[key] ?? 0;
}

function latestTimestampFromAllure(allureReports) {
  let latest = null;
  for (const report of allureReports) {
    if (typeof report.latestStop !== 'number') {
      continue;
    }
    latest = latest == null ? report.latestStop : Math.max(latest, report.latestStop);
  }
  return latest;
}

function percentValue(numerator, denominator) {
  if (!denominator) {
    return null;
  }
  return (numerator / denominator) * 100;
}

function fixedPercent(value) {
  if (value == null || Number.isNaN(value)) {
    return 'n/a';
  }
  return `${value.toFixed(1)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function passRatePercent(report) {
  if (!report.available || !report.total) {
    return null;
  }
  return percentValue(formatStatusCount(report.statusCounts, 'passed'), report.total);
}

function nonPassingCount(report) {
  return formatStatusCount(report.statusCounts, 'failed')
    + formatStatusCount(report.statusCounts, 'broken')
    + formatStatusCount(report.statusCounts, 'unknown');
}

function chartClassForPercent(value) {
  if (value == null) return 'is-na';
  if (value >= 99) return 'is-good';
  if (value >= 95) return 'is-mid';
  return 'is-low';
}

function chartRowHtml({ label, detail, percent }) {
  const width = percent == null ? 100 : Math.max(0, Math.min(100, percent));
  const valueText = fixedPercent(percent);
  const cssClass = chartClassForPercent(percent);
  return [
    '<div class="chart-row">',
    `<div class="chart-label">${escapeHtml(label)}<span class="chart-detail">${escapeHtml(detail)}</span></div>`,
    `<div class="chart-track"><span class="chart-fill ${cssClass}" style="width:${width.toFixed(1)}%"></span></div>`,
    `<div class="chart-value">${escapeHtml(valueText)}</div>`,
    '</div>',
  ].join('');
}

function reliabilityVerdict({ unmappedScenarioCount, totalNonPassingChecks }) {
  if (unmappedScenarioCount === 0 && totalNonPassingChecks === 0) {
    return 'Strong signal in measured scope';
  }
  if (unmappedScenarioCount <= 2 && totalNonPassingChecks <= 2) {
    return 'Moderate signal; review caveats';
  }
  return 'Needs attention before relying on this run';
}

function makeSystemCardMarkdown({ traceability, allure }) {
  const safeDocx = traceability.safeDocx;
  const docxPrimitives = traceability.docxPrimitives;
  const docxComparison = traceability.docxComparison;

  const mappingScope = [safeDocx, docxPrimitives, docxComparison];
  const totalScenarios = mappingScope.reduce((sum, item) => sum + item.total, 0);
  const totalMapped = mappingScope.reduce((sum, item) => sum + item.covered, 0);
  const totalUnmapped = mappingScope.reduce((sum, item) => sum + item.missing + item.pending, 0);
  const mappingCoverage = percentValue(totalMapped, totalScenarios);

  const totalChecks = allure.reduce((sum, report) => sum + report.total, 0);
  const totalNonPassingChecks = allure.reduce((sum, report) => sum + nonPassingCount(report), 0);
  const latestAllureTimestamp = latestTimestampFromAllure(allure);

  const unresolved = [
    ...safeDocx.missingScenarios.map((item) => ({ packageLabel: safeDocx.label, ...item })),
    ...docxPrimitives.missingScenarios.map((item) => ({ packageLabel: docxPrimitives.label, ...item })),
    ...docxComparison.missingScenarios.map((item) => ({ packageLabel: docxComparison.label, ...item })),
  ];

  const conclusion = reliabilityVerdict({
    unmappedScenarioCount: totalUnmapped,
    totalNonPassingChecks,
  });

  const safeDocxPassRate = passRatePercent(allure.find((report) => report.packageLabel === 'Safe DOCX') ?? {});
  const docxPrimitivesPassRate = passRatePercent(allure.find((report) => report.packageLabel === 'DOCX Primitives') ?? {});
  const docxComparisonPassRate = passRatePercent(allure.find((report) => report.packageLabel === 'DOCX Comparison') ?? {});

  const chartRows = [
    chartRowHtml({
      label: 'Safe DOCX: spec scenario mapping',
      detail: `${safeDocx.covered}/${safeDocx.total} scenarios`,
      percent: percentValue(safeDocx.covered, safeDocx.total),
    }),
    chartRowHtml({
      label: 'DOCX Primitives: spec scenario mapping',
      detail: `${docxPrimitives.covered}/${docxPrimitives.total} scenarios`,
      percent: percentValue(docxPrimitives.covered, docxPrimitives.total),
    }),
    chartRowHtml({
      label: 'DOCX Comparison: spec scenario mapping',
      detail: `${docxComparison.covered}/${docxComparison.total} scenarios`,
      percent: percentValue(docxComparison.covered, docxComparison.total),
    }),
    chartRowHtml({
      label: 'Safe DOCX: test run pass rate',
      detail: `${formatStatusCount((allure.find((report) => report.packageLabel === 'Safe DOCX') ?? { statusCounts: {} }).statusCounts ?? {}, 'passed')} passing checks`,
      percent: safeDocxPassRate,
    }),
    chartRowHtml({
      label: 'DOCX Primitives: test run pass rate',
      detail: `${formatStatusCount((allure.find((report) => report.packageLabel === 'DOCX Primitives') ?? { statusCounts: {} }).statusCounts ?? {}, 'passed')} passing checks`,
      percent: docxPrimitivesPassRate,
    }),
    chartRowHtml({
      label: 'DOCX Comparison: test run pass rate',
      detail: `${formatStatusCount((allure.find((report) => report.packageLabel === 'DOCX Comparison') ?? { statusCounts: {} }).statusCounts ?? {}, 'passed')} passing checks`,
      percent: docxComparisonPassRate,
    }),
  ];

  const lines = [];
  lines.push('---');
  lines.push('layout: layouts/base.njk');
  lines.push('title: System Card | Safe DOCX');
  lines.push('description: Reliability summary and evidence for Safe DOCX.');
  lines.push('contentClass: content');
  lines.push('---');
  lines.push('');
  lines.push('# Safe DOCX System Card');
  lines.push('');
  lines.push(`Evidence snapshot (UTC): \`${utcTimestamp(latestAllureTimestamp)}\``);
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('<div class="summary-banner">');
  lines.push(`<h2>${escapeHtml(conclusion)}</h2>`);
  lines.push(`<p>${escapeHtml(totalMapped)} of ${escapeHtml(totalScenarios)} spec scenarios are mapped to tests in the currently measured packages. ${escapeHtml(totalChecks)} automated checks were recorded, with ${escapeHtml(totalNonPassingChecks)} non-passing outcomes.</p>`);
  lines.push('</div>');
  lines.push('');
  lines.push('- This card focuses on reliability signals developers can scan quickly.');
  lines.push('- Scope note: all three packages shown here now include scenario-mapping and run-status summaries.');
  lines.push('');
  lines.push('## Visual Snapshot');
  lines.push('');
  lines.push('<div class="chart">');
  for (const row of chartRows) {
    lines.push(row);
  }
  lines.push('</div>');
  lines.push('');
  lines.push('## Key Results');
  lines.push('');
  lines.push('### 1) Spec Scenario Mapping');
  lines.push('');
  lines.push('This is **spec scenario mapping coverage**, not line/branch code coverage.');
  lines.push('');
  lines.push('| Package | Spec scenarios | Mapped | Unmapped | Coverage |');
  lines.push('|---|---:|---:|---:|---:|');
  lines.push(`| ${safeDocx.label} | ${safeDocx.total} | ${safeDocx.covered} | ${safeDocx.missing + safeDocx.pending} | ${pct(safeDocx.covered, safeDocx.total)} |`);
  lines.push(`| ${docxPrimitives.label} | ${docxPrimitives.total} | ${docxPrimitives.covered} | ${docxPrimitives.missing + docxPrimitives.pending} | ${pct(docxPrimitives.covered, docxPrimitives.total)} |`);
  lines.push(`| ${docxComparison.label} | ${docxComparison.total} | ${docxComparison.covered} | ${docxComparison.missing + docxComparison.pending} | ${pct(docxComparison.covered, docxComparison.total)} |`);
  lines.push(`| Combined measured scope | ${totalScenarios} | ${totalMapped} | ${totalUnmapped} | ${fixedPercent(mappingCoverage)} |`);
  lines.push('');
  if (unresolved.length === 0) {
    lines.push('No unmapped scenarios were found in the currently measured scope for this run.');
    lines.push('');
  } else {
    const previewCount = 10;
    lines.push(`Unmapped scenarios found in this run: ${unresolved.length}`);
    lines.push('Top items:');
    for (const item of unresolved.slice(0, previewCount)) {
      const location = item.change ? ` (${item.change})` : '';
      lines.push(`- [${item.packageLabel}] ${item.scenario}${location} - ${item.status}`);
    }
    if (unresolved.length > previewCount) {
      lines.push(`- ...and ${unresolved.length - previewCount} more (see detailed tables in appendix).`);
    }
    lines.push('');
  }
  lines.push('### 2) Automated Test Run Status');
  lines.push('');
  lines.push('| Package | Recorded checks | Passing | Non-passing | Skipped | Last observed update (UTC) |');
  lines.push('|---|---:|---:|---:|---:|---|');
  for (const report of allure) {
    if (!report.available) {
      lines.push(`| ${report.packageLabel} | 0 | 0 | 0 | 0 | n/a |`);
      continue;
    }
    lines.push(
      `| ${report.packageLabel} | ${report.total} | ${formatStatusCount(report.statusCounts, 'passed')} | ${nonPassingCount(report)} | ${formatStatusCount(report.statusCounts, 'skipped')} | ${utcTimestamp(report.latestStop)} |`,
    );
  }
  lines.push('');
  lines.push('## Discussion');
  lines.push('');
  lines.push('- A high mapping percentage means each spec scenario is represented by at least one test.');
  lines.push('- A high pass rate means recent automated runs did not surface failures in the current result set.');
  lines.push('- Both signals should be read together, along with known limitations below.');
  lines.push('');
  lines.push('## Limitations');
  lines.push('');
  lines.push('- This card does not report line or branch code coverage.');
  lines.push('- Mapping coverage can be 100% and defects can still exist.');
  lines.push('- Run-status counts depend on the current contents of package test-result directories; stale results should be cleaned before release reporting.');
  lines.push('');
  lines.push('## Appendix: Methods (Technical)');
  lines.push('');
  lines.push('- Mapping numbers are read from generated spec-scenario mapping files for Safe DOCX, DOCX Primitives, and DOCX Comparison.');
  lines.push('- Run-status numbers are read from structured test result files in each package result directory.');
  lines.push('- This page is regenerated by running `npm run generate:system-card`.');
  lines.push('');
  lines.push('## Appendix: Detailed Tables');
  lines.push('');
  lines.push('- [Safe DOCX scenario mapping table](../traceability/safe-docx/index.html)');
  lines.push('- [DOCX Primitives scenario mapping table](../traceability/docx-primitives/index.html)');
  lines.push('- [DOCX Comparison scenario mapping table](../traceability/docx-comparison/index.html)');
  lines.push('');
  lines.push(`Data snapshot timestamp for run-status metrics: \`${utcTimestamp(latestAllureTimestamp)}\``);
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function wrapMatrixAsPage(title, description, permalink, body) {
  return `---\nlayout: layouts/base.njk\ntitle: ${title}\ndescription: ${description}\ncontentClass: content\npermalink: ${permalink}\n---\n\n${body}`;
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const { outputPath } = parseArgs();

  // Recompute matrices before reading them to avoid drift.
  // Use default mode so the system card still renders during active feature work
  // while surfacing any unmapped scenarios in the generated output.
  runNodeScript('packages/docx-comparison/scripts/validate_openspec_coverage.mjs');
  runNodeScript('packages/docx-primitives/scripts/validate_openspec_coverage.mjs');
  runNodeScript('packages/safe-docx/scripts/validate_openspec_coverage.mjs');

  const [safeDocxMatrixRaw, docxPrimitivesMatrixRaw, docxComparisonMatrixRaw] = await Promise.all([
    fs.readFile(TRACEABILITY_SOURCES.safeDocx, 'utf-8'),
    fs.readFile(TRACEABILITY_SOURCES.docxPrimitives, 'utf-8'),
    fs.readFile(TRACEABILITY_SOURCES.docxComparison, 'utf-8'),
  ]);

  const traceability = {
    safeDocx: parseMatrixMarkdown(safeDocxMatrixRaw, 'Safe DOCX'),
    docxPrimitives: parseMatrixMarkdown(docxPrimitivesMatrixRaw, 'DOCX Primitives'),
    docxComparison: parseMatrixMarkdown(docxComparisonMatrixRaw, 'DOCX Comparison'),
  };

  const allure = await Promise.all([
    parseAllureResults('Safe DOCX', ALLURE_SOURCES.safeDocx),
    parseAllureResults('DOCX Primitives', ALLURE_SOURCES.docxPrimitives),
    parseAllureResults('DOCX Comparison', ALLURE_SOURCES.docxComparison),
  ]);

  const systemCard = makeSystemCardMarkdown({
    traceability,
    allure,
  });

  await ensureDir(outputPath);
  await fs.writeFile(outputPath, systemCard, 'utf-8');

  const traceabilityDir = path.join(path.dirname(outputPath), 'traceability');
  const safeDocxTraceabilityPagePath = path.join(traceabilityDir, 'safe-docx.md');
  const docxPrimitivesTraceabilityPagePath = path.join(traceabilityDir, 'docx-primitives.md');
  const docxComparisonTraceabilityPagePath = path.join(traceabilityDir, 'docx-comparison.md');

  await ensureDir(safeDocxTraceabilityPagePath);

  await fs.writeFile(
    safeDocxTraceabilityPagePath,
    wrapMatrixAsPage(
      'Safe DOCX Traceability Matrix | Safe DOCX',
      'Generated OpenSpec-to-test scenario mapping for the Safe DOCX package.',
      '/trust/traceability/safe-docx/',
      safeDocxMatrixRaw,
    ),
    'utf-8',
  );

  await fs.writeFile(
    docxPrimitivesTraceabilityPagePath,
    wrapMatrixAsPage(
      'DOCX Primitives Traceability Matrix | Safe DOCX',
      'Generated OpenSpec-to-test scenario mapping for the DOCX Primitives package.',
      '/trust/traceability/docx-primitives/',
      docxPrimitivesMatrixRaw,
    ),
    'utf-8',
  );

  await fs.writeFile(
    docxComparisonTraceabilityPagePath,
    wrapMatrixAsPage(
      'DOCX Comparison Traceability Matrix | Safe DOCX',
      'Generated spec-to-test scenario mapping for the DOCX Comparison package.',
      '/trust/traceability/docx-comparison/',
      docxComparisonMatrixRaw,
    ),
    'utf-8',
  );

  const relativeOutput = path.relative(REPO_ROOT, outputPath).split(path.sep).join('/');
  console.log(`Generated system card: ${relativeOutput}`);
}

await main();
