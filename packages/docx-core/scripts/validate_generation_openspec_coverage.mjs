#!/usr/bin/env node

/**
 * Spec-coverage validator for the docx-generation capability.
 *
 * Modeled on validate_primitives_openspec_coverage.mjs with three deliberate
 * differences:
 *  - Scan roots are src/generation/ and src/integration/ (generation tests do
 *    not live under the primitives roots).
 *  - The canonical spec (openspec/specs/docx-generation/spec.md) is optional:
 *    it only exists once the add-docx-generation change archives. Until then
 *    coverage is validated against change deltas (specs/docx-generation/).
 *  - --report-only downgrades every failure to a warning and always exits 0.
 *    The add-docx-generation change lands across phased PRs, so scenarios are
 *    intentionally unmapped mid-stream; the final phase removes --report-only
 *    from the gate wiring and the validator becomes enforcing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const SCAN_ROOTS = [
  path.join(PACKAGE_ROOT, 'src', 'generation'),
  path.join(PACKAGE_ROOT, 'src', 'integration'),
];
const CANONICAL_SPEC = path.join(REPO_ROOT, 'openspec', 'specs', 'docx-generation', 'spec.md');
const CHANGES_ROOT = path.join(REPO_ROOT, 'openspec', 'changes');
const CAPABILITY_DIR = 'docx-generation';

const SERIAL_ID_RE = /^(?:SDX|OA)-[\w-]+-?\d+$/;

function normalizeScenarioName(value) {
  return value
    .trim()
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\s+/g, ' ');
}

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

function parseScenarioEntriesFromSpec(content) {
  const entries = [];
  const seen = new Set();
  const scenarioHeader = /^\s*####\s+Scenario:\s*(.+?)\s*$/gm;
  let m;
  while ((m = scenarioHeader.exec(content))) {
    const raw = m[1].trim();
    const name = normalizeScenarioName(raw);
    if (!seen.has(name)) {
      seen.add(name);
      entries.push({ name, id: extractScenarioId(raw) });
    }
  }
  return entries;
}

function parseFeatureIdFromTest(content) {
  const direct = content.match(/const\s+TEST_FEATURE\s*=\s*['"]([^'"]+)['"]/);
  if (direct) return direct[1];
  const described = content.match(/OpenSpec traceability:\s*([A-Za-z0-9_-]+)/);
  return described ? described[1] : null;
}

function parseStoriesFromTest(content) {
  const stories = new Set();
  const storyIdsByName = new Map();

  function addStory(rawValue) {
    const normalized = normalizeScenarioName(rawValue);
    stories.add(normalized);
    const id = extractScenarioId(rawValue) ?? (SERIAL_ID_RE.test(normalized) ? normalized : null);
    if (!id) return;
    const ids = storyIdsByName.get(normalized) ?? new Set();
    ids.add(id);
    storyIdsByName.set(normalized, ids);
  }

  for (const re of [/\.openspec\(\s*(['"`])([\s\S]*?)\1\s*\)/g, /allure\.story\(\s*(['"`])([\s\S]*?)\1\s*\)/g]) {
    let m;
    while ((m = re.exec(content))) addStory(m[2]);
  }
  return { stories, storyIdsByName };
}

async function listTestFiles(rootDir) {
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
      if (entry.isDirectory()) await walk(full);
      else if (full.endsWith('.test.ts')) out.push(full);
    }
  }
  await walk(rootDir);
  return out.sort();
}

function featureIdFromArchivedDirectory(directoryName) {
  const match = directoryName.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return match ? match[1] : null;
}

/** Discover docx-generation spec deltas from active and archived changes. */
async function discoverGenerationDeltas() {
  const featureSpecFiles = new Map();
  const push = (feature, specPath) => {
    const list = featureSpecFiles.get(feature) ?? [];
    list.push(specPath);
    featureSpecFiles.set(feature, list);
  };

  let entries;
  try {
    entries = await fs.readdir(CHANGES_ROOT, { withFileTypes: true });
  } catch {
    return featureSpecFiles;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue;
    const specPath = path.join(CHANGES_ROOT, entry.name, 'specs', CAPABILITY_DIR, 'spec.md');
    try {
      if ((await fs.stat(specPath)).isFile()) push(entry.name, specPath);
    } catch {
      // Change has no docx-generation delta.
    }
  }
  const archiveRoot = path.join(CHANGES_ROOT, 'archive');
  try {
    for (const entry of await fs.readdir(archiveRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const feature = featureIdFromArchivedDirectory(entry.name);
      if (!feature) continue;
      const specPath = path.join(archiveRoot, entry.name, 'specs', CAPABILITY_DIR, 'spec.md');
      try {
        if ((await fs.stat(specPath)).isFile()) push(feature, specPath);
      } catch {
        // No delta in this archived change.
      }
    }
  } catch {
    // Archive directory is optional.
  }
  return featureSpecFiles;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const features = [];
  let strict = false;
  let reportOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--feature') {
      const value = args[i + 1];
      if (!value) throw new Error('--feature requires a value');
      features.push(value);
      i += 1;
    } else if (arg === '--strict') {
      strict = true;
    } else if (arg === '--report-only') {
      reportOnly = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { features, strict, reportOnly };
}

function evaluateFeature({ scenarios, scenarioEntries, storySet, storyIdsByName }) {
  const sortedScenarios = [...scenarios].sort();
  const missing = sortedScenarios.filter((s) => !storySet.has(s));
  const extra = [...storySet].filter((s) => !scenarios.has(s)).sort();
  const scenarioIdIssues = [];
  for (const scenario of scenarioEntries) {
    if (!scenario.id || !storySet.has(scenario.name)) continue;
    const mappedIds = storyIdsByName.get(scenario.name) ?? new Set();
    if (mappedIds.size === 0) {
      scenarioIdIssues.push(`${scenario.name}: expected ID [${scenario.id}] in test .openspec(...) mapping, but no ID was found`);
    } else if (!mappedIds.has(scenario.id)) {
      scenarioIdIssues.push(`${scenario.name}: expected ID [${scenario.id}], but found [${[...mappedIds].sort().join(', ')}]`);
    }
  }
  return { sortedScenarios, missing, extra, scenarioIdIssues };
}

async function main() {
  const { features: requestedFeatures, strict, reportOnly } = parseArgs();

  // Canonical spec is optional pre-archive.
  let serialIdMap = new Map();
  let canonicalEntries = [];
  try {
    const canonicalContent = await fs.readFile(CANONICAL_SPEC, 'utf-8');
    canonicalEntries = parseScenarioEntriesFromSpec(canonicalContent);
    serialIdMap = parseSerialIdMap(canonicalContent);
  } catch {
    // Not archived yet — delta-only validation.
  }

  const deltaFeatureSpecFiles = await discoverGenerationDeltas();
  const deltaFeatureScenarios = new Map();
  const deltaFeatureScenarioEntries = new Map();
  for (const [feature, specFiles] of deltaFeatureSpecFiles) {
    const scenarios = new Set();
    const entriesByName = new Map();
    for (const sf of specFiles) {
      const content = await fs.readFile(sf, 'utf-8');
      for (const entry of parseScenarioEntriesFromSpec(content)) {
        scenarios.add(entry.name);
        const existing = entriesByName.get(entry.name);
        if (!existing || (!existing.id && entry.id)) entriesByName.set(entry.name, entry);
      }
      for (const [id, name] of parseSerialIdMap(content)) serialIdMap.set(id, name);
    }
    deltaFeatureScenarios.set(feature, scenarios);
    deltaFeatureScenarioEntries.set(feature, [...entriesByName.values()]);
  }

  // Scan generation/integration test files, grouped by TEST_FEATURE.
  const testFiles = (await Promise.all(SCAN_ROOTS.map((root) => listTestFiles(root)))).flat();
  const storyByFeature = new Map();
  const allStorySet = new Set();
  const allStoryIdsByName = new Map();
  for (const tf of testFiles) {
    const content = await fs.readFile(tf, 'utf-8');
    const featureId = parseFeatureIdFromTest(content);
    const { stories, storyIdsByName } = parseStoriesFromTest(content);
    const resolve = (story) => (SERIAL_ID_RE.test(story) && serialIdMap.has(story) ? serialIdMap.get(story) : story);

    const bucket = featureId
      ? (storyByFeature.get(featureId) ?? { storySet: new Set(), storyIdsByName: new Map() })
      : null;
    if (featureId) storyByFeature.set(featureId, bucket);

    for (const story of stories) {
      const resolved = resolve(story);
      allStorySet.add(resolved);
      if (bucket) bucket.storySet.add(resolved);
    }
    for (const [story, ids] of storyIdsByName) {
      const resolved = resolve(story);
      const mergeInto = (map) => {
        const existing = map.get(resolved) ?? new Set();
        for (const id of ids) existing.add(id);
        map.set(resolved, existing);
      };
      mergeInto(allStoryIdsByName);
      if (bucket) mergeInto(bucket.storyIdsByName);
    }
  }

  let failures = 0;
  const report = (feature, evaluation) => {
    const { sortedScenarios, missing, extra, scenarioIdIssues } = evaluation;
    if (missing.length === 0 && scenarioIdIssues.length === 0) {
      const extraSuffix = extra.length > 0 ? ` (+${extra.length} bonus tests beyond spec)` : '';
      console.log(`PASS ${feature}: ${sortedScenarios.length} scenarios covered${extraSuffix}`);
      return;
    }
    const label = reportOnly ? 'WARN' : 'FAIL';
    if (!reportOnly) failures += 1;
    console.error(`${label} ${feature}: ${missing.length}/${sortedScenarios.length} scenarios unmapped, ${scenarioIdIssues.length} scenario ID mismatch(es)`);
    for (const s of missing) console.error(`  - missing: ${s}`);
    for (const issue of scenarioIdIssues) console.error(`  - id: ${issue}`);
  };

  if (requestedFeatures.length > 0) {
    for (const feature of requestedFeatures) {
      const scenarios = deltaFeatureScenarios.get(feature);
      if (!scenarios || scenarios.size === 0) {
        console.error(`No ${CAPABILITY_DIR} spec delta found for feature '${feature}'.`);
        if (!reportOnly) failures += 1;
        continue;
      }
      const bucket = storyByFeature.get(feature) ?? { storySet: new Set(), storyIdsByName: new Map() };
      report(
        feature,
        evaluateFeature({
          scenarios,
          scenarioEntries: deltaFeatureScenarioEntries.get(feature) ?? [],
          storySet: bucket.storySet,
          storyIdsByName: bucket.storyIdsByName,
        }),
      );
    }
    if (failures > 0) process.exitCode = 1;
    return;
  }

  // Default mode: canonical (when archived) + every discovered delta.
  if (canonicalEntries.length > 0) {
    const canonicalScenarios = new Set(canonicalEntries.map((e) => e.name));
    report(
      'docx-generation (canonical)',
      evaluateFeature({
        scenarios: canonicalScenarios,
        scenarioEntries: canonicalEntries,
        storySet: allStorySet,
        storyIdsByName: allStoryIdsByName,
      }),
    );
  }
  for (const feature of [...deltaFeatureScenarios.keys()].sort()) {
    const bucket = storyByFeature.get(feature) ?? { storySet: new Set(), storyIdsByName: new Map() };
    const evaluation = evaluateFeature({
      scenarios: deltaFeatureScenarios.get(feature),
      scenarioEntries: deltaFeatureScenarioEntries.get(feature) ?? [],
      storySet: bucket.storySet,
      storyIdsByName: bucket.storyIdsByName,
    });
    if (strict || reportOnly) report(feature, evaluation);
    else if (evaluation.missing.length > 0 || evaluation.scenarioIdIssues.length > 0) {
      console.error(`WARN ${feature}: ${evaluation.missing.length}/${evaluation.sortedScenarios.length} scenarios unmapped (non-strict)`);
    } else {
      console.log(`PASS ${feature}: ${evaluation.sortedScenarios.length} scenarios covered`);
    }
  }

  if (canonicalEntries.length === 0 && deltaFeatureScenarios.size === 0) {
    console.log('No docx-generation canonical spec or change deltas found; nothing to validate.');
  }
  if (failures > 0) process.exitCode = 1;
}

await main();
