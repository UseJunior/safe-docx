#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const TEST_ROOT = path.join(PACKAGE_ROOT, 'test');
const SRC_ROOT = path.join(PACKAGE_ROOT, 'src');
const CANONICAL_SPEC = path.join(REPO_ROOT, 'openspec', 'specs', 'docx-primitives', 'spec.md');
const CHANGES_ROOT = path.join(REPO_ROOT, 'openspec', 'changes');
const DEFAULT_MATRIX_PATH = path.join(TEST_ROOT, 'DOCX_PRIMITIVES_OPENSPEC_TRACEABILITY.md');

function isTraceabilityTestFile(filePath) {
  return filePath.endsWith('.test.ts');
}

/**
 * Requirements tested in the docx-comparison package, NOT in docx-primitives-ts.
 * These are excluded from coverage checks here.
 */
const PACKAGE_REQUIREMENTS = new Set([
  'Comparator Round-Trip Semantic Invariants',
  'Inplace Bookmark Safety Uses Semantic Parity',
  'Inplace Paragraph-Boundary Bookmark Preservation',
]);

function normalizeScenarioName(value) {
  return value
    .trim()
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\s+/g, ' ');
}

function parseScenariosFromSpec(content) {
  const scenarios = new Set();
  const scenarioHeader = /^\s*####\s+Scenario:\s*(.+?)\s*$/gm;
  let m = scenarioHeader.exec(content);
  while (m) {
    scenarios.add(normalizeScenarioName(m[1]));
    m = scenarioHeader.exec(content);
  }
  return scenarios;
}

function parseRequirementForScenario(content) {
  const requirementMap = new Map();
  let currentRequirement = null;
  for (const line of content.split('\n')) {
    const reqMatch = line.match(/^###\s+Requirement:\s*(.+?)\s*$/);
    if (reqMatch) {
      currentRequirement = reqMatch[1].trim();
      continue;
    }
    const scenarioMatch = line.match(/^####\s+Scenario:\s*(.+?)\s*$/);
    if (scenarioMatch && currentRequirement) {
      requirementMap.set(normalizeScenarioName(scenarioMatch[1]), currentRequirement);
    }
  }
  return requirementMap;
}

function parseFeatureIdFromTest(content, testFile) {
  const direct = content.match(/const\s+TEST_FEATURE\s*=\s*['"]([^'"]+)['"]/);
  if (direct) return direct[1];

  if (!content.includes('OpenSpec traceability')) {
    return null;
  }

  const described = content.match(/OpenSpec traceability:\s*([A-Za-z0-9_-]+)/);
  if (described) return described[1];

  return null;
}

function parseStoriesFromTest(content) {
  const stories = new Set();

  const viaOpenspec = /\.openspec\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  let m = viaOpenspec.exec(content);
  while (m) {
    stories.add(normalizeScenarioName(m[2]));
    m = viaOpenspec.exec(content);
  }

  const direct = /allure\.story\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  m = direct.exec(content);
  while (m) {
    stories.add(normalizeScenarioName(m[2]));
    m = direct.exec(content);
  }

  return stories;
}

function parseSkippedStoriesFromTest(content) {
  const skipped = new Set();
  const skippedPattern = /(?:test|it)\.(?:skip|todo)\(\s*(['"`])(?:Scenario:\s*)?([\s\S]*?)\1/g;
  let m = skippedPattern.exec(content);
  while (m) {
    skipped.add(normalizeScenarioName(m[2]));
    m = skippedPattern.exec(content);
  }
  return skipped;
}

async function listFilesRecursively(rootDir, predicate) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (predicate(full)) out.push(full);
    }
  }
  await walk(rootDir);
  return out.sort();
}

// ---------------------------------------------------------------------------
// Change delta discovery
// ---------------------------------------------------------------------------

function featureIdFromArchivedDirectory(directoryName) {
  const match = directoryName.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return match ? match[1] : null;
}

/**
 * Discover docx-primitives spec deltas from active and archived changes.
 * Returns Map<featureId, specFilePaths[]>.
 */
async function discoverDocxPrimitivesDeltas() {
  const featureSpecFiles = new Map();

  function push(feature, specPath) {
    const list = featureSpecFiles.get(feature) ?? [];
    list.push(specPath);
    featureSpecFiles.set(feature, list);
  }

  // Active changes
  let entries;
  try {
    entries = await fs.readdir(CHANGES_ROOT, { withFileTypes: true });
  } catch {
    return featureSpecFiles;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue;
    const specPath = path.join(CHANGES_ROOT, entry.name, 'specs', 'docx-primitives', 'spec.md');
    try {
      const stat = await fs.stat(specPath);
      if (stat.isFile()) push(entry.name, specPath);
    } catch {
      // Change doesn't have a docx-primitives spec delta.
    }
  }

  // Archived changes
  const archiveRoot = path.join(CHANGES_ROOT, 'archive');
  try {
    const archiveEntries = await fs.readdir(archiveRoot, { withFileTypes: true });
    for (const entry of archiveEntries) {
      if (!entry.isDirectory()) continue;
      const feature = featureIdFromArchivedDirectory(entry.name);
      if (!feature) continue;
      const specPath = path.join(archiveRoot, entry.name, 'specs', 'docx-primitives', 'spec.md');
      try {
        const stat = await fs.stat(specPath);
        if (stat.isFile()) push(feature, specPath);
      } catch {
        // No docx-primitives spec delta in this archived change.
      }
    }
  } catch {
    // Archive directory is optional.
  }

  return featureSpecFiles;
}

// ---------------------------------------------------------------------------
// Markdown matrix
// ---------------------------------------------------------------------------

function mdEscapeTableCell(value) {
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function buildMatrixMarkdown({ canonicalScenarios, deltaFeatureScenarios, storySet, storyToFiles, skippedStorySet, excludedScenarios, featureReports }) {
  const lines = [];
  lines.push('# DOCX Primitives TS OpenSpec Traceability Matrix');
  lines.push('');
  lines.push('> Auto-generated by `packages/docx-primitives/scripts/validate_openspec_coverage.mjs`.');
  lines.push('> Do not hand-edit this file.');
  lines.push('');

  // Canonical spec section
  lines.push('## Canonical Spec Coverage');
  lines.push('');
  lines.push('| Scenario | Status | Allure Test Files | Notes |');
  lines.push('|---|---|---|---|');

  for (const scenario of canonicalScenarios) {
    if (excludedScenarios.has(scenario)) continue;

    const mappedFiles = storyToFiles.get(scenario) ?? [];
    const status = skippedStorySet.has(scenario)
      ? 'pending_impl'
      : mappedFiles.length > 0
        ? 'covered'
        : 'missing';

    const fileCell = mappedFiles.length > 0
      ? mappedFiles.map((f) => `\`${f}\``).join(', ')
      : 'n/a';

    let notes = '';
    if (skippedStorySet.has(scenario)) notes = 'skip/todo in tests';
    else if (mappedFiles.length === 0) notes = 'No Allure story mapping found';

    lines.push(
      `| ${mdEscapeTableCell(scenario)} | ${status} | ${mdEscapeTableCell(fileCell)} | ${mdEscapeTableCell(notes)} |`,
    );
  }

  if (excludedScenarios.size > 0) {
    lines.push('');
    lines.push('### Excluded (tested in docx-comparison)');
    lines.push('');
    for (const scenario of [...excludedScenarios].sort()) {
      lines.push(`- ${scenario}`);
    }
  }

  // Per-feature delta sections
  if (featureReports.length > 0) {
    lines.push('');
    lines.push('## Change Delta Coverage');
    lines.push('');
    for (const report of featureReports) {
      lines.push(`### Change: \`${report.feature}\``);
      lines.push('');
      lines.push('| Scenario | Status | Allure Test Files | Notes |');
      lines.push('|---|---|---|---|');

      for (const scenario of report.scenarios) {
        const mappedFiles = report.storyToFiles.get(scenario) ?? [];
        const status = mappedFiles.length > 0 ? 'covered' : 'missing';
        const fileCell = mappedFiles.length > 0
          ? mappedFiles.map((f) => `\`${f}\``).join(', ')
          : 'n/a';
        const notes = mappedFiles.length === 0 ? 'No Allure story mapping found' : '';
        lines.push(
          `| ${mdEscapeTableCell(scenario)} | ${status} | ${mdEscapeTableCell(fileCell)} | ${mdEscapeTableCell(notes)} |`,
        );
      }

      if (report.extra.length > 0) {
        lines.push('');
        lines.push('Extra stories beyond spec (informational):');
        for (const s of report.extra) lines.push(`- ${s}`);
      }
      lines.push('');
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const features = [];
  let writeMatrixPath = null;
  let strict = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--feature') {
      const value = args[i + 1];
      if (!value) throw new Error('--feature requires a value');
      features.push(value);
      i += 1;
      continue;
    }
    if (arg === '--write-matrix') {
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        writeMatrixPath = path.resolve(process.cwd(), value);
        i += 1;
      } else {
        writeMatrixPath = DEFAULT_MATRIX_PATH;
      }
      continue;
    }
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { features, writeMatrixPath, strict };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { features: requestedFeatures, writeMatrixPath, strict } = parseArgs();

  // 1. Read canonical spec
  let specContent;
  try {
    specContent = await fs.readFile(CANONICAL_SPEC, 'utf-8');
  } catch {
    console.error(`Cannot read canonical spec: ${CANONICAL_SPEC}`);
    process.exitCode = 1;
    return;
  }

  const allCanonicalScenarios = parseScenariosFromSpec(specContent);
  const requirementMap = parseRequirementForScenario(specContent);

  const excludedScenarios = new Set();
  const canonicalScenarios = new Set();
  for (const scenario of allCanonicalScenarios) {
    const req = requirementMap.get(scenario);
    if (req && PACKAGE_REQUIREMENTS.has(req)) {
      excludedScenarios.add(scenario);
    } else {
      canonicalScenarios.add(scenario);
    }
  }

  // 2. Discover change deltas
  const deltaFeatureSpecFiles = await discoverDocxPrimitivesDeltas();

  // Parse scenarios per feature delta
  const deltaFeatureScenarios = new Map();
  for (const [feature, specFiles] of deltaFeatureSpecFiles) {
    const scenarios = new Set();
    for (const sf of specFiles) {
      const content = await fs.readFile(sf, 'utf-8');
      for (const scenario of parseScenariosFromSpec(content)) scenarios.add(scenario);
    }
    deltaFeatureScenarios.set(feature, scenarios);
  }

  // 3. Read all traceability test files (feature-aware) — search both test/ and src/
  const traceabilityTestFiles = [
    ...(await listFilesRecursively(TEST_ROOT, isTraceabilityTestFile)),
    ...(await listFilesRecursively(SRC_ROOT, isTraceabilityTestFile)),
  ];

  const allStorySet = new Set();
  const allSkippedStorySet = new Set();
  const allStoryToFiles = new Map();
  const testsByFeature = new Map();

  for (const tf of traceabilityTestFiles) {
    const content = await fs.readFile(tf, 'utf-8');
    const relTestFile = path.relative(PACKAGE_ROOT, tf).split(path.sep).join('/');
    const featureId = parseFeatureIdFromTest(content, tf);

    // Group by feature
    if (featureId) {
      const list = testsByFeature.get(featureId) ?? [];
      list.push(tf);
      testsByFeature.set(featureId, list);
    }

    for (const story of parseStoriesFromTest(content)) {
      allStorySet.add(story);
      const files = allStoryToFiles.get(story) ?? [];
      files.push(relTestFile);
      allStoryToFiles.set(story, files);
    }
    for (const story of parseSkippedStoriesFromTest(content)) {
      allSkippedStorySet.add(story);
    }
  }

  // 4. Handle --feature mode
  if (requestedFeatures.length > 0) {
    let hasFailures = false;
    for (const feature of requestedFeatures) {
      const featureScenarios = deltaFeatureScenarios.get(feature);
      if (!featureScenarios || featureScenarios.size === 0) {
        console.error(`No docx-primitives spec delta found for feature '${feature}'.`);
        hasFailures = true;
        continue;
      }

      const featureTestFiles = testsByFeature.get(feature) ?? [];
      const featureStorySet = new Set();
      const featureStoryToFiles = new Map();
      for (const tf of featureTestFiles) {
        const content = await fs.readFile(tf, 'utf-8');
        const relTestFile = path.relative(PACKAGE_ROOT, tf).split(path.sep).join('/');
        for (const story of parseStoriesFromTest(content)) {
          featureStorySet.add(story);
          const files = featureStoryToFiles.get(story) ?? [];
          files.push(relTestFile);
          featureStoryToFiles.set(story, files);
        }
      }

      const sortedScenarios = [...featureScenarios].sort();
      const missing = sortedScenarios.filter((s) => !featureStorySet.has(s));
      const extra = [...featureStorySet].filter((s) => !featureScenarios.has(s)).sort();

      if (missing.length === 0) {
        const extraSuffix = extra.length > 0
          ? ` (+${extra.length} bonus tests beyond spec)`
          : '';
        console.log(`PASS ${feature}: ${sortedScenarios.length} scenarios covered by ${featureStorySet.size} story mappings${extraSuffix}`);
      } else {
        hasFailures = true;
        console.error(`FAIL ${feature}`);
        console.error(`  Missing stories for spec scenarios:`);
        for (const s of missing) console.error(`    - ${s}`);
        if (extra.length > 0) {
          console.error(`  Extra stories beyond spec (informational, not a failure):`);
          for (const s of extra) console.error(`    - ${s}`);
        }
      }
    }
    if (hasFailures) process.exitCode = 1;
    return;
  }

  // 5. Default mode: canonical validation + delta awareness
  const allDeltaScenarios = new Set();
  for (const scenarios of deltaFeatureScenarios.values()) {
    for (const s of scenarios) allDeltaScenarios.add(s);
  }

  const allKnownScenarios = new Set([...canonicalScenarios, ...allDeltaScenarios]);

  const sortedCanonical = [...canonicalScenarios].sort();
  const canonicalMissing = sortedCanonical.filter((s) => !allStorySet.has(s));
  const canonicalCovered = sortedCanonical.filter((s) => allStorySet.has(s));
  const trulyExtra = [...allStorySet].filter((s) => !allKnownScenarios.has(s)).sort();

  // Print canonical summary
  console.log(`Canonical spec: ${sortedCanonical.length} scenarios (${excludedScenarios.size} excluded)`);
  console.log(`Covered: ${canonicalCovered.length}/${sortedCanonical.length}`);

  if (canonicalMissing.length > 0) {
    console.error(`\nMISSING from canonical spec (${canonicalMissing.length}):`);
    for (const s of canonicalMissing) console.error(`  - ${s}`);
  }

  if (trulyExtra.length > 0) {
    console.log(`\nExtra stories not in any spec (${trulyExtra.length}):`);
    for (const s of trulyExtra) console.log(`  - ${s}`);
  }

  // Per-feature delta reporting
  const featureReports = [];
  let deltaFailures = 0;
  const activeFeatures = [...deltaFeatureScenarios.keys()].sort();
  if (activeFeatures.length > 0) {
    console.log('');
    for (const feature of activeFeatures) {
      const featureScenarios = deltaFeatureScenarios.get(feature);
      const featureTestFiles = testsByFeature.get(feature) ?? [];
      const featureStorySet = new Set();
      const featureStoryToFiles = new Map();
      for (const tf of featureTestFiles) {
        const content = await fs.readFile(tf, 'utf-8');
        const relTestFile = path.relative(PACKAGE_ROOT, tf).split(path.sep).join('/');
        for (const story of parseStoriesFromTest(content)) {
          featureStorySet.add(story);
          const files = featureStoryToFiles.get(story) ?? [];
          files.push(relTestFile);
          featureStoryToFiles.set(story, files);
        }
      }

      const sortedScenarios = [...featureScenarios].sort();
      const missing = sortedScenarios.filter((s) => !featureStorySet.has(s));
      const extra = [...featureStorySet].filter((s) => !featureScenarios.has(s)).sort();

      featureReports.push({
        feature,
        scenarios: sortedScenarios,
        missing,
        extra,
        storyToFiles: featureStoryToFiles,
      });

      if (missing.length === 0) {
        const extraSuffix = extra.length > 0
          ? ` (+${extra.length} bonus tests beyond spec)`
          : '';
        console.log(`PASS ${feature}: ${sortedScenarios.length} scenarios covered by ${featureStorySet.size} story mappings${extraSuffix}`);
      } else {
        if (strict) {
          deltaFailures += 1;
          console.error(`FAIL ${feature}: ${missing.length}/${sortedScenarios.length} delta scenarios missing`);
        } else {
          console.error(`WARN ${feature}: ${missing.length}/${sortedScenarios.length} delta scenarios missing`);
        }
        for (const s of missing) console.error(`  - ${s}`);
      }
    }
  }

  if (writeMatrixPath) {
    const matrix = buildMatrixMarkdown({
      canonicalScenarios: sortedCanonical,
      deltaFeatureScenarios,
      storySet: allStorySet,
      storyToFiles: allStoryToFiles,
      skippedStorySet: allSkippedStorySet,
      excludedScenarios,
      featureReports,
    });
    await fs.mkdir(path.dirname(writeMatrixPath), { recursive: true });
    await fs.writeFile(writeMatrixPath, matrix, 'utf-8');
    console.log(`\nWrote traceability matrix: ${path.relative(REPO_ROOT, writeMatrixPath)}`);
  }

  // Exit code: fail only for canonical spec gaps
  if (canonicalMissing.length > 0 || (strict && deltaFailures > 0)) {
    process.exitCode = 1;
    if (canonicalMissing.length > 0) {
      console.error('\nFAIL: Canonical spec coverage gaps detected.');
    }
    if (strict && deltaFailures > 0) {
      console.error(`FAIL: ${deltaFailures} change delta(s) contain unmapped scenarios.`);
    }
  } else {
    console.log('\nPASS: Canonical scenarios covered.');
  }
}

await main();
