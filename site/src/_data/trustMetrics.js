import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function formatNumber(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('en-US');
}

function loadJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

const metricsPath = resolve(__dirname, '..', 'trust', 'metrics.json');
const allureSummaryPath = resolve(__dirname, '..', 'trust', 'allure-summary.json');

const metrics = loadJson(metricsPath);
const allureSummary = loadJson(allureSummaryPath);

const allure = metrics?.allure ?? {};
const traceability = metrics?.traceability ?? {};

const resultsTotal = allure.results_total ?? 0;
const passedCount = allure.status_counts?.passed ?? 0;
const passRate = resultsTotal > 0 ? ((passedCount / resultsTotal) * 100).toFixed(1) : '0.0';

export default {
  generated_at_utc: metrics?.generated_at_utc ?? null,
  allure: {
    results_total: resultsTotal,
    results_total_display: `${formatNumber(resultsTotal)} automated checks`,
    unique_stories_total: allure.unique_stories_total ?? 0,
    unique_epics_total: allure.unique_epics_total ?? 0,
    unique_features_total: allure.unique_features_total ?? 0,
    status_counts: allure.status_counts ?? {},
    latest_run_utc: allure.latest_run_utc ?? null,
    pass_rate: `${passRate}%`,
    passed_count: passedCount,
    passed_count_display: formatNumber(passedCount),
  },
  traceability: {
    total_scenarios: traceability.total_scenarios ?? 0,
    covered_scenarios: traceability.covered_scenarios ?? 0,
    coverage_percent: traceability.coverage_percent ?? 0,
    coverage_display: `${traceability.coverage_percent ?? 0}%`,
  },
  allureSummary: allureSummary ?? null,
  reportUrl: allureSummary?.report_url ?? 'https://tests.safedocx.com',
};
