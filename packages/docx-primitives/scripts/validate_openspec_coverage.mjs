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

const SERIAL_ID_RE = /^(?:SDX|OA)-[\w-]+-?\d+$/;

function extractScenarioId(rawScenario) {
  const match = rawScenario.trim().match(/^\[([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

function parseSerialIdMap(specContent) {
  const map = new Map();
  const re = /^\s*####\s+Scenario:\s*\[([^\]]+)\]\s*(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(specContent))) {
    map.set(m[1], m[2].replace(/\s+/g, ' ').trim());
  }
  return map;
}

function resolveSerialIds(stories, serialIdMap) {
  const resolved = new Set();
  for (const story of stories) {
    if (SERIAL_ID_RE.test(story) && serialIdMap.has(story)) {
      resolved.add(serialIdMap.get(story));
    } else {
      resolved.add(story);
    }
  }
  return resolved;
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

function parseScenarioEntriesFromSpec(content) {
  const entries = [];
  const seen = new Set();
  const scenarioHeader = /^\s*####\s+Scenario:\s*(.+?)\s*$/gm;
  let m = scenarioHeader.exec(content);
  while (m) {
    const raw = m[1].trim();
    const name = normalizeScenarioName(raw);
    if (!seen.has(name)) {
      seen.add(name);
      entries.push({ name, id: extractScenarioId(raw) });
    }
    m = scenarioHeader.exec(content);
  }
  return entries;
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
  const storyIdsByName = new Map();

  function addStory(rawValue) {
    const normalized = normalizeScenarioName(rawValue);
    stories.add(normalized);
    const id = extractScenarioId(rawValue);
    if (!id) {
      return;
    }
    const ids = storyIdsByName.get(normalized) ?? new Set();
    ids.add(id);
    storyIdsByName.set(normalized, ids);
  }

  const viaOpenspec = /\.openspec\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  let m = viaOpenspec.exec(content);
  while (m) {
    addStory(m[2]);
    m = viaOpenspec.exec(content);
  }

  const direct = /allure\.story\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  m = direct.exec(content);
  while (m) {
    addStory(m[2]);
    m = direct.exec(content);
  }

  return { stories, storyIdsByName };
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
      if (report.scenarioIdIssues && report.scenarioIdIssues.length > 0) {
        lines.push('');
        lines.push('Scenario ID mismatches:');
        for (const issue of report.scenarioIdIssues) lines.push(`- ${issue}`);
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

  const canonicalScenarioEntries = parseScenarioEntriesFromSpec(specContent);
  const allCanonicalScenarios = new Set(canonicalScenarioEntries.map((entry) => entry.name));
  const requirementMap = parseRequirementForScenario(specContent);
  const serialIdMap = parseSerialIdMap(specContent);

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

  // Parse scenarios per feature delta (and extend serialIdMap)
  const deltaFeatureScenarios = new Map();
  const deltaFeatureScenarioEntries = new Map();
  for (const [feature, specFiles] of deltaFeatureSpecFiles) {
    const scenarios = new Set();
    const scenarioEntriesByName = new Map();
    for (const sf of specFiles) {
      const content = await fs.readFile(sf, 'utf-8');
      for (const scenario of parseScenariosFromSpec(content)) scenarios.add(scenario);
      for (const entry of parseScenarioEntriesFromSpec(content)) {
        const existing = scenarioEntriesByName.get(entry.name);
        if (!existing || (!existing.id && entry.id)) {
          scenarioEntriesByName.set(entry.name, entry);
        }
      }
      for (const [id, name] of parseSerialIdMap(content)) serialIdMap.set(id, name);
    }
    deltaFeatureScenarios.set(feature, scenarios);
    deltaFeatureScenarioEntries.set(feature, [...scenarioEntriesByName.values()]);
  }

  // 3. Read all traceability test files (feature-aware) — search both test/ and src/
  const traceabilityTestFiles = [
    ...(await listFilesRecursively(TEST_ROOT, isTraceabilityTestFile)),
    ...(await listFilesRecursively(SRC_ROOT, isTraceabilityTestFile)),
  ];

  const allStorySet = new Set();
  const allStoryIdsByName = new Map();
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

    const parsedStories = parseStoriesFromTest(content);
    for (const story of resolveSerialIds(parsedStories.stories, serialIdMap)) {
      allStorySet.add(story);
      const files = allStoryToFiles.get(story) ?? [];
      files.push(relTestFile);
      allStoryToFiles.set(story, files);
    }
    for (const [story, ids] of parsedStories.storyIdsByName.entries()) {
      const resolvedName = SERIAL_ID_RE.test(story) && serialIdMap.has(story)
        ? serialIdMap.get(story)
        : story;
      const existing = allStoryIdsByName.get(resolvedName) ?? new Set();
      for (const id of ids) {
        existing.add(id);
      }
      allStoryIdsByName.set(resolvedName, existing);
    }
    for (const story of resolveSerialIds(parseSkippedStoriesFromTest(content), serialIdMap)) {
      allSkippedStorySet.add(story);
    }
  }

  // 4. Handle --feature mode
  if (requestedFeatures.length > 0) {
    let hasFailures = false;
    for (const feature of requestedFeatures) {
      const featureScenarios = deltaFeatureScenarios.get(feature);
      const featureScenarioEntries = deltaFeatureScenarioEntries.get(feature) ?? [];
      if (!featureScenarios || featureScenarios.size === 0) {
        console.error(`No docx-primitives spec delta found for feature '${feature}'.`);
        hasFailures = true;
        continue;
      }

      const featureTestFiles = testsByFeature.get(feature) ?? [];
      const featureStorySet = new Set();
      const featureStoryToFiles = new Map();
      const featureStoryIdsByName = new Map();
      for (const tf of featureTestFiles) {
        const content = await fs.readFile(tf, 'utf-8');
        const relTestFile = path.relative(PACKAGE_ROOT, tf).split(path.sep).join('/');
        const parsedStories = parseStoriesFromTest(content);
        for (const story of resolveSerialIds(parsedStories.stories, serialIdMap)) {
          featureStorySet.add(story);
          const files = featureStoryToFiles.get(story) ?? [];
          files.push(relTestFile);
          featureStoryToFiles.set(story, files);
        }
        for (const [story, ids] of parsedStories.storyIdsByName.entries()) {
          const resolvedName = SERIAL_ID_RE.test(story) && serialIdMap.has(story)
            ? serialIdMap.get(story)
            : story;
          const existing = featureStoryIdsByName.get(resolvedName) ?? new Set();
          for (const id of ids) {
            existing.add(id);
          }
          featureStoryIdsByName.set(resolvedName, existing);
        }
      }

      const sortedScenarios = [...featureScenarios].sort();
      const missing = sortedScenarios.filter((s) => !featureStorySet.has(s));
      const extra = [...featureStorySet].filter((s) => !featureScenarios.has(s)).sort();
      const scenarioIdIssues = [];
      for (const scenario of featureScenarioEntries) {
        if (!scenario.id) {
          continue;
        }
        if (!featureStorySet.has(scenario.name)) {
          continue;
        }
        const mappedIds = featureStoryIdsByName.get(scenario.name) ?? new Set();
        if (mappedIds.size === 0) {
          scenarioIdIssues.push(
            `${scenario.name}: expected ID [${scenario.id}] in test .openspec(...) mapping, but no ID was found`,
          );
          continue;
        }
        if (!mappedIds.has(scenario.id)) {
          scenarioIdIssues.push(
            `${scenario.name}: expected ID [${scenario.id}], but found [${[...mappedIds].sort().join(', ')}]`,
          );
        }
      }

      if (missing.length === 0 && scenarioIdIssues.length === 0) {
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
        if (scenarioIdIssues.length > 0) {
          console.error(`  Scenario ID mismatches:`);
          for (const issue of scenarioIdIssues) console.error(`    - ${issue}`);
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
  const canonicalScenarioIdIssues = [];
  for (const scenario of canonicalScenarioEntries) {
    if (!scenario.id || excludedScenarios.has(scenario.name)) {
      continue;
    }
    if (!allStorySet.has(scenario.name)) {
      continue;
    }
    const mappedIds = allStoryIdsByName.get(scenario.name) ?? new Set();
    if (mappedIds.size === 0) {
      canonicalScenarioIdIssues.push(
        `${scenario.name}: expected ID [${scenario.id}] in test .openspec(...) mapping, but no ID was found`,
      );
      continue;
    }
    if (!mappedIds.has(scenario.id)) {
      canonicalScenarioIdIssues.push(
        `${scenario.name}: expected ID [${scenario.id}], but found [${[...mappedIds].sort().join(', ')}]`,
      );
    }
  }

  // Print canonical summary
  console.log(`Canonical spec: ${sortedCanonical.length} scenarios (${excludedScenarios.size} excluded)`);
  console.log(`Covered: ${canonicalCovered.length}/${sortedCanonical.length}`);

  if (canonicalMissing.length > 0) {
    console.error(`\nMISSING from canonical spec (${canonicalMissing.length}):`);
    for (const s of canonicalMissing) console.error(`  - ${s}`);
  }
  if (canonicalScenarioIdIssues.length > 0) {
    console.error(`\nScenario ID mismatches in canonical spec coverage (${canonicalScenarioIdIssues.length}):`);
    for (const issue of canonicalScenarioIdIssues) console.error(`  - ${issue}`);
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
      const featureScenarioEntries = deltaFeatureScenarioEntries.get(feature) ?? [];
      const featureTestFiles = testsByFeature.get(feature) ?? [];
      const featureStorySet = new Set();
      const featureStoryToFiles = new Map();
      const featureStoryIdsByName = new Map();
      for (const tf of featureTestFiles) {
        const content = await fs.readFile(tf, 'utf-8');
        const relTestFile = path.relative(PACKAGE_ROOT, tf).split(path.sep).join('/');
        const parsedStories = parseStoriesFromTest(content);
        for (const story of resolveSerialIds(parsedStories.stories, serialIdMap)) {
          featureStorySet.add(story);
          const files = featureStoryToFiles.get(story) ?? [];
          files.push(relTestFile);
          featureStoryToFiles.set(story, files);
        }
        for (const [story, ids] of parsedStories.storyIdsByName.entries()) {
          const resolvedName = SERIAL_ID_RE.test(story) && serialIdMap.has(story)
            ? serialIdMap.get(story)
            : story;
          const existing = featureStoryIdsByName.get(resolvedName) ?? new Set();
          for (const id of ids) {
            existing.add(id);
          }
          featureStoryIdsByName.set(resolvedName, existing);
        }
      }

      const sortedScenarios = [...featureScenarios].sort();
      const missing = sortedScenarios.filter((s) => !featureStorySet.has(s));
      const extra = [...featureStorySet].filter((s) => !featureScenarios.has(s)).sort();
      const scenarioIdIssues = [];
      for (const scenario of featureScenarioEntries) {
        if (!scenario.id) {
          continue;
        }
        if (!featureStorySet.has(scenario.name)) {
          continue;
        }
        const mappedIds = featureStoryIdsByName.get(scenario.name) ?? new Set();
        if (mappedIds.size === 0) {
          scenarioIdIssues.push(
            `${scenario.name}: expected ID [${scenario.id}] in test .openspec(...) mapping, but no ID was found`,
          );
          continue;
        }
        if (!mappedIds.has(scenario.id)) {
          scenarioIdIssues.push(
            `${scenario.name}: expected ID [${scenario.id}], but found [${[...mappedIds].sort().join(', ')}]`,
          );
        }
      }

      featureReports.push({
        feature,
        scenarios: sortedScenarios,
        missing,
        extra,
        scenarioIdIssues,
        storyToFiles: featureStoryToFiles,
      });

      if (missing.length === 0 && scenarioIdIssues.length === 0) {
        const extraSuffix = extra.length > 0
          ? ` (+${extra.length} bonus tests beyond spec)`
          : '';
        console.log(`PASS ${feature}: ${sortedScenarios.length} scenarios covered by ${featureStorySet.size} story mappings${extraSuffix}`);
      } else {
        if (strict) {
          deltaFailures += 1;
          console.error(`FAIL ${feature}: ${missing.length}/${sortedScenarios.length} delta scenarios missing, ${scenarioIdIssues.length} scenario ID mismatch(es)`);
        } else {
          console.error(`WARN ${feature}: ${missing.length}/${sortedScenarios.length} delta scenarios missing, ${scenarioIdIssues.length} scenario ID mismatch(es)`);
        }
        for (const s of missing) console.error(`  - ${s}`);
        for (const issue of scenarioIdIssues) console.error(`  - ${issue}`);
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
  if (canonicalMissing.length > 0 || canonicalScenarioIdIssues.length > 0 || (strict && deltaFailures > 0)) {
    process.exitCode = 1;
    if (canonicalMissing.length > 0) {
      console.error('\nFAIL: Canonical spec coverage gaps detected.');
    }
    if (canonicalScenarioIdIssues.length > 0) {
      console.error('\nFAIL: Canonical scenario ID mismatches detected.');
    }
    if (strict && deltaFailures > 0) {
      console.error(`FAIL: ${deltaFailures} change delta(s) contain unmapped scenarios.`);
    }
  } else {
    console.log('\nPASS: Canonical scenarios covered.');
  }
}

await main();
