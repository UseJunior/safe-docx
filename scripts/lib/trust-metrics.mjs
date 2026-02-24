/**
 * Shared trust-metrics helpers.
 *
 * Extracted from generate_system_card.mjs so that both the system card generator
 * and the trust-metrics generator can reuse the same parsing logic.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const TRACEABILITY_SOURCES = {
  docxMcp: path.join(REPO_ROOT, 'packages', 'docx-mcp', 'src', 'testing', 'SAFE_DOCX_OPENSPEC_TRACEABILITY.md'),
  docxCore: path.join(REPO_ROOT, 'packages', 'docx-core', 'src', 'testing', 'DOCX_COMPARISON_OPENSPEC_TRACEABILITY.md'),
};

const ALLURE_SOURCES = {
  docxMcp: path.join(REPO_ROOT, 'packages', 'docx-mcp', 'allure-results'),
  docxCore: path.join(REPO_ROOT, 'packages', 'docx-core', 'allure-results'),
};

/**
 * Parse a traceability matrix markdown file and return a summary object.
 */
export function parseMatrixMarkdown(markdown, label) {
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

/**
 * Parse Allure result JSON files from a package's allure-results directory.
 */
export async function parseAllureResults(packageLabel, dirPath) {
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

/**
 * Collect unique Allure label values (story, epic, feature) from result files.
 */
export async function collectAllureLabels(dirPath) {
  const stories = new Set();
  const epics = new Set();
  const features = new Set();

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return { stories: 0, epics: 0, features: 0 };
  }

  const resultFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('-result.json'))
    .map((entry) => path.join(dirPath, entry.name));

  for (const filePath of resultFiles) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const labels = parsed.labels ?? [];

      for (const label of labels) {
        if (label.name === 'story' && label.value) {
          stories.add(label.value);
        } else if (label.name === 'epic' && label.value) {
          epics.add(label.value);
        } else if (label.name === 'feature' && label.value) {
          features.add(label.value);
        }
      }
    } catch {
      // skip unparseable files
    }
  }

  return {
    stories: stories.size,
    epics: epics.size,
    features: features.size,
  };
}

/**
 * Build the complete metrics object used by generate_trust_metrics.mjs.
 *
 * Reads all traceability matrices and allure result directories, then composes
 * them into the canonical trust-metrics JSON shape.
 */
export async function buildMetricsObject() {
  // Read traceability matrices
  const [docxMcpMatrixRaw, docxCoreMatrixRaw] = await Promise.all([
    fs.readFile(TRACEABILITY_SOURCES.docxMcp, 'utf-8'),
    fs.readFile(TRACEABILITY_SOURCES.docxCore, 'utf-8'),
  ]);

  const traceabilityData = {
    docxMcp: parseMatrixMarkdown(docxMcpMatrixRaw, 'DOCX MCP'),
    docxCore: parseMatrixMarkdown(docxCoreMatrixRaw, 'DOCX Core'),
  };

  // Parse allure results
  const allureResults = await Promise.all([
    parseAllureResults('DOCX MCP', ALLURE_SOURCES.docxMcp),
    parseAllureResults('DOCX Core', ALLURE_SOURCES.docxCore),
  ]);

  // Collect allure labels across all packages
  const allLabels = await Promise.all([
    collectAllureLabels(ALLURE_SOURCES.docxMcp),
    collectAllureLabels(ALLURE_SOURCES.docxCore),
  ]);

  // Aggregate allure stats
  const resultsTotal = allureResults.reduce((sum, r) => sum + r.total, 0);
  const uniqueStoriesTotal = allLabels.reduce((sum, l) => sum + l.stories, 0);
  const uniqueEpicsTotal = allLabels.reduce((sum, l) => sum + l.epics, 0);
  const uniqueFeaturesTotal = allLabels.reduce((sum, l) => sum + l.features, 0);

  const aggregatedStatusCounts = {};
  for (const report of allureResults) {
    for (const [status, count] of Object.entries(report.statusCounts)) {
      aggregatedStatusCounts[status] = (aggregatedStatusCounts[status] ?? 0) + count;
    }
  }

  // Sort status counts
  const sortedStatusCounts = Object.fromEntries(
    Object.entries(aggregatedStatusCounts).sort(([a], [b]) => a.localeCompare(b)),
  );

  let latestRunUtc = null;
  for (const report of allureResults) {
    if (typeof report.latestStop === 'number') {
      latestRunUtc = latestRunUtc == null ? report.latestStop : Math.max(latestRunUtc, report.latestStop);
    }
  }

  // Aggregate traceability stats
  const packages = [traceabilityData.docxMcp, traceabilityData.docxCore];
  const totalScenarios = packages.reduce((sum, p) => sum + p.total, 0);
  const coveredScenarios = packages.reduce((sum, p) => sum + p.covered, 0);
  const coveragePercent = totalScenarios > 0 ? Math.round((coveredScenarios / totalScenarios) * 1000) / 10 : 0;

  return {
    generated_at_utc: new Date().toISOString(),
    allure: {
      results_total: resultsTotal,
      unique_stories_total: uniqueStoriesTotal,
      unique_epics_total: uniqueEpicsTotal,
      unique_features_total: uniqueFeaturesTotal,
      status_counts: sortedStatusCounts,
      latest_run_utc: latestRunUtc ? new Date(latestRunUtc).toISOString() : null,
    },
    traceability: {
      total_scenarios: totalScenarios,
      covered_scenarios: coveredScenarios,
      coverage_percent: coveragePercent,
    },
  };
}
