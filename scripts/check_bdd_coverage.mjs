#!/usr/bin/env node

/**
 * BDD enrichment coverage tracker for tests.safedocx.com
 *
 * Reports per-file status of BDD step enrichment across all test files.
 * Outputs both a human-readable table and a machine-readable JSON summary.
 *
 * Usage:
 *   node scripts/check_bdd_coverage.mjs           # Human-readable table
 *   node scripts/check_bdd_coverage.mjs --json     # JSON output
 *   node scripts/check_bdd_coverage.mjs --summary  # Compact summary only
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// ── File discovery ───────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);
const TEST_PATH_RE = /^packages\/[^/]+\/(src|test|test-primitives)\/.+\.test\.ts$/;

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.test.ts')) continue;
    const rel = relative(ROOT, join(dir, entry.name));
    if (TEST_PATH_RE.test(rel)) out.push(rel);
  }
}

function discoverTestFiles() {
  const files = [];
  walk(join(ROOT, 'packages'), files);
  return [...new Set(files)].sort();
}

// ── Detection patterns ───────────────────────────────────────────────────────

const PATTERNS = {
  hasBddGiven: /\bgiven\s*\(/,
  hasBddWhen: /\bwhen\s*\(/,
  hasBddThen: /\bthen\s*\(/,
  hasTestAllure: /\btestAllure\b/,
  hasItAllure: /\bitAllure\b/,
  hasEpic: /\.epic\s*\(/,
  hasFeature: /feature\s*:/,
  hasAttachments: /(?:allureJsonAttachment|allureAttachment|attachPrettyXml|attachPrettyJson|attachJson|attachHtml|attachMarkdown|attachWordLikePreview|attachDocPreview|attachXmlPreviews|attachJsonLastStep)\s*\(/,
  hasDocPreview: /xmlToDocPreviewRuns/,
  hasAllureStep: /allureStep\s*\(/,
};

function analyzeFile(filePath) {
  const body = readFileSync(join(ROOT, filePath), 'utf-8');

  const result = {};
  for (const [key, re] of Object.entries(PATTERNS)) {
    result[key] = re.test(body);
  }

  // Count tests (rough: it( or test( at start of line/indented, plus testAllure/itAllure calls)
  const testCount = (body.match(/\b(?:it|test)\s*\(/g) || []).length;
  result.testCount = testCount;

  // Determine enrichment status
  const hasBdd = result.hasBddGiven && result.hasBddWhen && result.hasBddThen;
  const hasMetadata = result.hasEpic || result.hasFeature;
  const usesNewPattern = result.hasTestAllure;
  const usesOldPattern = result.hasItAllure && !result.hasTestAllure;

  result.hasBdd = hasBdd;
  result.hasMetadata = hasMetadata;
  result.usesNewPattern = usesNewPattern;
  result.usesOldPattern = usesOldPattern;

  // Enrichment level: full | partial | none
  if (hasBdd && hasMetadata && usesNewPattern) {
    result.status = 'full';
  } else if (hasBdd || result.hasAllureStep) {
    result.status = 'partial';
  } else {
    result.status = 'none';
  }

  return result;
}

// ── Package classification ───────────────────────────────────────────────────

function getPackageGroup(filePath) {
  if (filePath.startsWith('packages/docx-core/test-primitives/')) return 'docx-core/test-primitives';
  if (filePath.startsWith('packages/docx-core/src/')) return 'docx-core/src';
  if (filePath.startsWith('packages/docx-mcp/')) return 'docx-mcp';
  if (filePath.startsWith('packages/safe-docx-mcpb/')) return 'safe-docx-mcpb';
  if (filePath.startsWith('packages/docx-primitives/')) return 'docx-primitives';
  return 'other';
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const summaryMode = args.includes('--summary');

const files = discoverTestFiles();
const results = [];

for (const file of files) {
  const analysis = analyzeFile(file);
  results.push({ file, ...analysis });
}

// Group by package
const groups = {};
for (const r of results) {
  const group = getPackageGroup(r.file);
  if (!groups[group]) groups[group] = [];
  groups[group].push(r);
}

// Compute summary
const summary = {
  totalFiles: results.length,
  totalTests: results.reduce((s, r) => s + r.testCount, 0),
  full: results.filter((r) => r.status === 'full').length,
  partial: results.filter((r) => r.status === 'partial').length,
  none: results.filter((r) => r.status === 'none').length,
  byGroup: {},
};

for (const [group, items] of Object.entries(groups)) {
  summary.byGroup[group] = {
    files: items.length,
    tests: items.reduce((s, r) => s + r.testCount, 0),
    full: items.filter((r) => r.status === 'full').length,
    partial: items.filter((r) => r.status === 'partial').length,
    none: items.filter((r) => r.status === 'none').length,
  };
}

// ── Output ───────────────────────────────────────────────────────────────────

if (jsonMode) {
  console.log(JSON.stringify({ summary, files: results }, null, 2));
  process.exit(0);
}

const STATUS_ICONS = { full: '\u2705', partial: '\u26A0\uFE0F ', none: '\u274C' };

if (!summaryMode) {
  // Per-group tables
  for (const [group, items] of Object.entries(groups)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${group} (${items.length} files)`);
    console.log('='.repeat(60));

    const sorted = [...items].sort((a, b) => {
      const order = { none: 0, partial: 1, full: 2 };
      return order[a.status] - order[b.status];
    });

    for (const r of sorted) {
      const shortPath = r.file.replace(/^packages\/[^/]+\//, '');
      const icon = STATUS_ICONS[r.status];
      const flags = [];
      if (r.hasBdd) flags.push('BDD');
      if (r.hasMetadata) flags.push('META');
      if (r.hasAttachments) flags.push('ATT');
      if (r.hasDocPreview) flags.push('PREVIEW');
      if (r.usesOldPattern) flags.push('OLD-PATTERN');
      console.log(`  ${icon} ${shortPath.padEnd(55)} [${flags.join(', ')}]`);
    }
  }
}

// Summary
console.log(`\n${'─'.repeat(60)}`);
console.log('  BDD Enrichment Summary');
console.log('─'.repeat(60));
console.log(`  Total files:  ${summary.totalFiles}`);
console.log(`  Total tests:  ~${summary.totalTests}`);
console.log(`  Full:         ${summary.full} (${((summary.full / summary.totalFiles) * 100).toFixed(1)}%)`);
console.log(`  Partial:      ${summary.partial} (${((summary.partial / summary.totalFiles) * 100).toFixed(1)}%)`);
console.log(`  Not started:  ${summary.none} (${((summary.none / summary.totalFiles) * 100).toFixed(1)}%)`);
console.log('');

for (const [group, stats] of Object.entries(summary.byGroup)) {
  const pct = stats.files > 0 ? ((stats.full / stats.files) * 100).toFixed(0) : '0';
  console.log(`  ${group.padEnd(30)} ${stats.full}/${stats.files} done (${pct}%)`);
}
console.log('─'.repeat(60));
