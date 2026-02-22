#!/usr/bin/env node

/**
 * Test quality linter for OpenSpec-traced tests.
 *
 * Detects common quality defects in .test.ts files that use .openspec().
 * Complements validate_allure_test_labels.mjs (structural) with body-level
 * quality checks.
 *
 * Modes:
 *   Default (advisory): Print warnings, exit 0.
 *   --strict:           Exit 1 on errors.
 *
 * Usage:
 *   node scripts/validate_allure_test_quality.mjs [files...]
 *   node scripts/validate_allure_test_quality.mjs --strict
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TEST_PATH_RE = /^packages\/[^/]+\/(src|test)\/.+\.test\.ts$/;

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      walk(absolute, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.test.ts')) continue;
    const relative = absolute.slice(`${ROOT}/`.length);
    if (TEST_PATH_RE.test(relative)) out.push(relative);
  }
}

function discoverTestFiles() {
  const files = [];
  walk(join(ROOT, 'packages'), files);
  return [...new Set(files)].sort();
}

function normalizeInputFiles(rawFiles) {
  return rawFiles
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .map((f) => f.replace(/^\.\//, ''))
    .filter((f) => TEST_PATH_RE.test(f));
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

const openspecRe = /\.openspec\(/;
const serialIdRe = /(?:SDX|OA)-[\w-]+-?\d+/;
const allureStepRe = /allureStep\s*\(/;
const bddGivenRe = /\bgiven\s*\(/;
const bddWhenRe = /\bwhen\s*\(/;
const bddThenRe = /\bthen\s*\(/;
const expectRe = /\bexpect\s*\(/g;
const attachmentRe = /(?:allureJsonAttachment|allureAttachment|attachPrettyXml|attachPrettyJson|attachJson|attachHtml|attachMarkdown|attachWordLikePreview|attachDocPreview|attachXmlPreviews|attachJsonLastStep)\s*\(/;
// Detect step parameters: third argument object in given/when/then/and calls
// Pattern: given('...', async () => {...}, { ... })
const stepParamsRe = /\b(?:given|when|then|and)\s*\(\s*['"`][\s\S]*?['"`]\s*,\s*(?:async\s+)?\(\)\s*=>\s*[\s\S]*?,\s*\{/;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * @typedef {{ level: 'error'|'warning'|'info', message: string }} Finding
 */

/**
 * @param {string} body
 * @param {boolean} strict
 * @returns {Finding[]}
 */
function lintOpenspecTest(body, strict) {
  const findings = [];

  const hasAllureStep = allureStepRe.test(body);
  const hasBddGiven = bddGivenRe.test(body);
  const hasBddWhen = bddWhenRe.test(body);
  const hasBddThen = bddThenRe.test(body);
  const hasAnySteps = hasAllureStep || hasBddGiven || hasBddWhen || hasBddThen;

  // Rule: No BDD steps at all
  if (!hasAnySteps) {
    findings.push({
      level: strict ? 'error' : 'warning',
      message: 'No BDD steps found (allureStep, given, when, or then).',
    });
  }

  // Rule: Missing Given/When/Then (has some steps but not the full triad)
  if (hasAnySteps) {
    const hasBddContext = hasBddGiven || hasBddWhen || hasBddThen;
    if (hasBddContext && (!hasBddGiven || !hasBddWhen || !hasBddThen)) {
      const missing = [];
      if (!hasBddGiven) missing.push('given');
      if (!hasBddWhen) missing.push('when');
      if (!hasBddThen) missing.push('then');
      findings.push({
        level: 'warning',
        message: `BDD context used but missing: ${missing.join(', ')}.`,
      });
    }
  }

  // Rule: No attachments
  if (!attachmentRe.test(body)) {
    findings.push({
      level: 'warning',
      message: 'No attachment function calls found.',
    });
  }

  // Rule: No scenario ID
  if (!serialIdRe.test(body)) {
    findings.push({
      level: 'warning',
      message: 'Uses .openspec() but no SDX-/OA- serial ID found.',
    });
  }

  // Rule: < 2 assertions
  const expectMatches = body.match(expectRe);
  const assertionCount = expectMatches ? expectMatches.length : 0;
  if (assertionCount < 2) {
    findings.push({
      level: strict ? 'warning' : 'info',
      message: `Only ${assertionCount} expect() call(s) found (recommend >= 2).`,
    });
  }

  // Rule: No step parameters (uses BDD context but no third-arg params)
  if ((hasBddGiven || hasBddWhen || hasBddThen) && !stepParamsRe.test(body)) {
    findings.push({
      level: 'info',
      message: 'BDD context used but no step parameters found (third-arg objects on given/when/then).',
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  const files = [];
  let strict = false;
  for (const arg of rawArgs) {
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
    files.push(arg);
  }
  return { files, strict };
}

const { files: cliFiles, strict } = parseArgs();
const filesToCheck = cliFiles.length > 0
  ? normalizeInputFiles(cliFiles)
  : discoverTestFiles();

if (filesToCheck.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

let checkedCount = 0;
let skippedCount = 0;
let errorCount = 0;
let warningCount = 0;
let infoCount = 0;
const fileResults = [];

for (const file of filesToCheck) {
  const absolutePath = join(ROOT, file);
  const body = readFileSync(absolutePath, 'utf-8');

  // Only lint tests that use .openspec()
  if (!openspecRe.test(body)) {
    skippedCount += 1;
    continue;
  }

  checkedCount += 1;
  const findings = lintOpenspecTest(body, strict);

  if (findings.length > 0) {
    fileResults.push({ file, findings });
    for (const f of findings) {
      if (f.level === 'error') errorCount += 1;
      else if (f.level === 'warning') warningCount += 1;
      else infoCount += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const LEVEL_LABELS = { error: 'ERROR', warning: 'WARN', info: 'INFO' };

if (fileResults.length > 0) {
  for (const { file, findings } of fileResults) {
    console.log(`\n${file}`);
    for (const f of findings) {
      console.log(`  [${LEVEL_LABELS[f.level]}] ${f.message}`);
    }
  }
  console.log('');
}

console.log(
  `Checked ${checkedCount} OpenSpec test file(s), skipped ${skippedCount} non-OpenSpec file(s).`,
);
console.log(
  `Results: ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info(s).`,
);

if (strict && errorCount > 0) {
  console.error(`\nFAIL: ${errorCount} error(s) found in --strict mode.`);
  process.exit(1);
}
