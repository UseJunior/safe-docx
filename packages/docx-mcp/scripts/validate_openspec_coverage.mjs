#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const TEST_ROOT = path.join(PACKAGE_ROOT, 'src');
const CHANGES_ROOT = path.join(REPO_ROOT, 'openspec', 'changes');
const DEFAULT_MATRIX_PATH = path.join(TEST_ROOT, 'testing', 'SAFE_DOCX_OPENSPEC_TRACEABILITY.md');

function isTraceabilityTestFile(filePath) {
  return filePath.endsWith('.test.ts');
}

function normalizeScenarioName(value) {
  return value
    .trim()
    // Optional ID prefix support: [ABC-123] Scenario name
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\s+/g, ' ');
}

function extractScenarioId(value) {
  const match = value.trim().match(/^\[([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

const SERIAL_ID_RE = /^(?:SDX|OA)-[\w-]+-?\d+$/;

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

async function listFilesRecursively(rootDir, predicate) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
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

function parseFeatureIdFromTest(content, testFile) {
  const direct = content.match(/const\s+TEST_FEATURE\s*=\s*['"]([^'"]+)['"]/);
  if (direct) return direct[1];

  if (!content.includes('OpenSpec traceability')) {
    return null;
  }

  const described = content.match(/OpenSpec traceability:\s*([A-Za-z0-9_-]+)/);
  if (described) return described[1];

  throw new Error(`Cannot infer TEST_FEATURE from ${testFile}`);
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

  const viaHelper = /tagScenario\(\s*(['"`])([\s\S]*?)\1\s*,/g;
  let m = viaHelper.exec(content);
  while (m) {
    addStory(m[2]);
    m = viaHelper.exec(content);
  }

  const direct = /allure\.story\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  m = direct.exec(content);
  while (m) {
    addStory(m[2]);
    m = direct.exec(content);
  }

  const viaOpenspec = /\.openspec\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  m = viaOpenspec.exec(content);
  while (m) {
    addStory(m[2]);
    m = viaOpenspec.exec(content);
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

function parsePendingMarkersFromTest(content) {
  const markers = new Set();
  if (/\bpending_impl\b/i.test(content)) {
    markers.add('pending_impl');
  }
  if (/pending parity work/i.test(content)) {
    markers.add('pending parity work');
  }
  return [...markers].sort();
}

function parseScenariosFromSpec(content) {
  const scenarioEntries = [];
  const seen = new Set();
  const scenarioHeader = /^\s*####\s+Scenario:\s*(.+?)\s*$/gm;
  let m = scenarioHeader.exec(content);
  while (m) {
    const raw = m[1].trim();
    const name = normalizeScenarioName(raw);
    if (seen.has(name)) {
      m = scenarioHeader.exec(content);
      continue;
    }
    seen.add(name);
    scenarioEntries.push({
      raw,
      name,
      id: extractScenarioId(raw),
    });
    m = scenarioHeader.exec(content);
  }
  return scenarioEntries;
}

async function listSpecFilesForFeature(feature) {
  const specRoot = path.join(CHANGES_ROOT, feature, 'specs');
  try {
    const stat = await fs.stat(specRoot);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  return listFilesRecursively(specRoot, (f) => f.endsWith('.md'));
}

function featureIdFromArchivedDirectory(directoryName) {
  const match = directoryName.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return match ? match[1] : null;
}

function pushFeatureSpec(featureSpecFiles, feature, specPath) {
  const list = featureSpecFiles.get(feature) ?? [];
  list.push(specPath);
  featureSpecFiles.set(feature, list);
}

async function listMcpServerSpecFeatures() {
  const entries = await fs.readdir(CHANGES_ROOT, { withFileTypes: true });
  const featureSpecFiles = new Map();
  const activeFeatures = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue;
    const specPath = path.join(CHANGES_ROOT, entry.name, 'specs', 'mcp-server', 'spec.md');
    try {
      const stat = await fs.stat(specPath);
      if (stat.isFile()) {
        pushFeatureSpec(featureSpecFiles, entry.name, specPath);
        activeFeatures.add(entry.name);
      }
    } catch {
      // Ignore non-mcp-server changes for safe-docx coverage checks.
    }
  }

  const archiveRoot = path.join(CHANGES_ROOT, 'archive');
  try {
    const archiveEntries = await fs.readdir(archiveRoot, { withFileTypes: true });
    for (const entry of archiveEntries) {
      if (!entry.isDirectory()) continue;
      const feature = featureIdFromArchivedDirectory(entry.name);
      if (!feature) continue;
      const specPath = path.join(archiveRoot, entry.name, 'specs', 'mcp-server', 'spec.md');
      try {
        const stat = await fs.stat(specPath);
        if (stat.isFile()) {
          pushFeatureSpec(featureSpecFiles, feature, specPath);
        }
      } catch {
        // Ignore archived changes without mcp-server spec deltas.
      }
    }
  } catch {
    // Archive directory is optional.
  }

  const allFeatures = [...featureSpecFiles.keys()].sort();
  return {
    activeFeatures: [...activeFeatures].sort(),
    allFeatures,
    featureSpecFiles,
  };
}

function printSet(title, values) {
  if (values.length === 0) return;
  console.error(`  ${title}:`);
  for (const value of values) {
    console.error(`    - ${value}`);
  }
}

async function validateFeatureCoverage({ feature, testFiles, featureSpecFiles }) {
  const storySet = new Set();
  const skippedStorySet = new Set();
  const pendingMarkerSet = new Set();
  const storyIdsByName = new Map();
  const storyToFiles = new Map();
  for (const tf of testFiles) {
    const content = await fs.readFile(tf, 'utf-8');
    const relTestFile = path.relative(PACKAGE_ROOT, tf).split(path.sep).join('/');
    const parsedStories = parseStoriesFromTest(content);
    for (const story of parsedStories.stories) {
      storySet.add(story);
      const files = storyToFiles.get(story) ?? new Set();
      files.add(relTestFile);
      storyToFiles.set(story, files);
    }
    for (const [story, ids] of parsedStories.storyIdsByName.entries()) {
      const existing = storyIdsByName.get(story) ?? new Set();
      for (const id of ids) {
        existing.add(id);
      }
      storyIdsByName.set(story, existing);
    }
    for (const story of parseSkippedStoriesFromTest(content)) skippedStorySet.add(story);
    for (const marker of parsePendingMarkersFromTest(content)) pendingMarkerSet.add(marker);
  }

  const specFiles = featureSpecFiles.get(feature) ?? await listSpecFilesForFeature(feature);
  if (specFiles.length === 0) {
    return {
      feature,
      ok: false,
      reason: `No OpenSpec files found for feature '${feature}' in active/archive mcp-server deltas`,
      missing: [],
      extra: [],
      scenarioIdIssues: [],
      skippedStories: [...skippedStorySet].sort(),
      pendingMarkers: [...pendingMarkerSet].sort(),
      stories: [...storySet].sort(),
      scenarios: [],
      storyToFiles: Object.fromEntries(
        [...storyToFiles.entries()].map(([k, v]) => [k, [...v].sort()]),
      ),
    };
  }

  const scenarioEntries = [];
  const seenScenarios = new Set();
  const serialIdMap = new Map();
  for (const sf of specFiles) {
    const content = await fs.readFile(sf, 'utf-8');
    for (const [id, name] of parseSerialIdMap(content)) serialIdMap.set(id, name);
    for (const scenario of parseScenariosFromSpec(content)) {
      if (seenScenarios.has(scenario.name)) {
        continue;
      }
      seenScenarios.add(scenario.name);
      scenarioEntries.push(scenario);
    }
  }

  if (scenarioEntries.length === 0) {
    return {
      feature,
      ok: false,
      reason: `No '#### Scenario:' entries found for feature '${feature}'`,
      missing: [],
      extra: [],
      scenarioIdIssues: [],
      skippedStories: [...skippedStorySet].sort(),
      pendingMarkers: [...pendingMarkerSet].sort(),
      stories: [...storySet].sort(),
      scenarios: [],
      storyToFiles: Object.fromEntries(
        [...storyToFiles.entries()].map(([k, v]) => [k, [...v].sort()]),
      ),
    };
  }

  // Resolve serial-ID-only stories to full scenario names
  const resolvedStorySet = resolveSerialIds(storySet, serialIdMap);
  const resolvedStoryToFiles = new Map();
  for (const [story, files] of storyToFiles) {
    if (SERIAL_ID_RE.test(story) && serialIdMap.has(story)) {
      const resolved = serialIdMap.get(story);
      const existing = resolvedStoryToFiles.get(resolved) ?? new Set();
      for (const f of files) existing.add(f);
      resolvedStoryToFiles.set(resolved, existing);
    } else {
      const existing = resolvedStoryToFiles.get(story) ?? new Set();
      for (const f of files) existing.add(f);
      resolvedStoryToFiles.set(story, existing);
    }
  }

  const scenarios = scenarioEntries.map((entry) => entry.name).sort();
  const stories = [...resolvedStorySet].sort();
  const storyLookup = new Set(stories);
  const scenarioLookup = new Set(scenarios);

  const missing = scenarios.filter((s) => !storyLookup.has(s));
  const extra = stories.filter((s) => !scenarioLookup.has(s));
  const scenarioIdIssues = [];
  for (const scenario of scenarioEntries) {
    if (!scenario.id) {
      continue;
    }
    if (!storyLookup.has(scenario.name)) {
      continue;
    }
    const mappedIds = storyIdsByName.get(scenario.name) ?? new Set();
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
  const skippedStories = [...skippedStorySet].sort();
  const pendingMarkers = [...pendingMarkerSet].sort();

  return {
    feature,
    // Extra stories beyond the spec are fine — more coverage is better.
    // Only missing spec scenarios and skipped/pending tests are failures.
    ok: missing.length === 0
      && scenarioIdIssues.length === 0
      && skippedStories.length === 0
      && pendingMarkers.length === 0,
    reason: '',
    missing,
    extra,
    scenarioIdIssues,
    skippedStories,
    pendingMarkers,
    stories,
    scenarios,
    storyToFiles: Object.fromEntries(
      [...resolvedStoryToFiles.entries()].map(([k, v]) => [k, [...v].sort()]),
    ),
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const features = [];
  let writeMatrixPath = null;
  let strict = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--feature') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('--feature requires a value');
      }
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

function mdEscapeTableCell(value) {
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function buildMatrixMarkdown({ reports, unknownTraceabilityFeatures }) {
  const lines = [];
  lines.push('# Safe-Docx TS OpenSpec Traceability Matrix');
  lines.push('');
  lines.push('> Auto-generated by `packages/safe-docx/scripts/validate_openspec_coverage.mjs`.');
  lines.push('> Do not hand-edit this file.');
  lines.push('');
  lines.push('This matrix maps OpenSpec `#### Scenario:` entries to Allure story mappings extracted from `*.test.ts` files.');
  lines.push('');

  for (const report of reports) {
    lines.push(`## Change: \`${report.feature}\``);
    lines.push('');
    lines.push('| Scenario | Status | Allure Test Files | Notes |');
    lines.push('|---|---|---|---|');

    if (!report.scenarios || report.scenarios.length === 0) {
      lines.push(`| _No scenarios discovered_ | n/a | n/a | ${mdEscapeTableCell(report.reason || 'No scenarios found.')} |`);
      lines.push('');
      continue;
    }

    const skippedLookup = new Set(report.skippedStories ?? []);
    const missingLookup = new Set(report.missing ?? []);
    for (const scenario of report.scenarios) {
      const mappedFiles = report.storyToFiles?.[scenario] ?? [];
      const status = skippedLookup.has(scenario)
        ? 'pending_impl'
        : missingLookup.has(scenario)
          ? 'missing'
          : mappedFiles.length > 0
            ? 'covered'
            : 'missing';

      const fileCell = mappedFiles.length > 0
        ? mappedFiles.map((f) => `\`${f}\``).join(', ')
        : 'n/a';

      let notes = '';
      if (skippedLookup.has(scenario)) notes = 'Mapped scenario is marked skip/todo in tests.';
      else if (missingLookup.has(scenario)) notes = 'No Allure story mapping found.';

      lines.push(
        `| ${mdEscapeTableCell(scenario)} | ${status} | ${mdEscapeTableCell(fileCell)} | ${mdEscapeTableCell(notes)} |`,
      );
    }

    if (report.extra && report.extra.length > 0) {
      lines.push('');
      lines.push('Extra stories not found in spec:');
      for (const value of report.extra) lines.push(`- ${value}`);
    }

    if (report.pendingMarkers && report.pendingMarkers.length > 0) {
      lines.push('');
      lines.push('Pending markers found in tests:');
      for (const value of report.pendingMarkers) lines.push(`- ${value}`);
    }

    if (report.scenarioIdIssues && report.scenarioIdIssues.length > 0) {
      lines.push('');
      lines.push('Scenario ID mismatches:');
      for (const value of report.scenarioIdIssues) lines.push(`- ${value}`);
    }

    lines.push('');
  }

  if (unknownTraceabilityFeatures.length > 0) {
    lines.push('## Unknown Traceability Features');
    lines.push('');
    lines.push('The following `TEST_FEATURE` values appear in tests but do not have a matching active/archive `mcp-server` OpenSpec delta:');
    lines.push('');
    for (const feature of unknownTraceabilityFeatures) lines.push(`- ${feature}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function writeMatrixFile(matrixPath, payload) {
  const matrix = buildMatrixMarkdown(payload);
  await fs.mkdir(path.dirname(matrixPath), { recursive: true });
  await fs.writeFile(matrixPath, matrix, 'utf-8');
}

async function main() {
  const { features: requestedFeatures, writeMatrixPath, strict } = parseArgs();
  const { activeFeatures, allFeatures, featureSpecFiles } = await listMcpServerSpecFeatures();
  const knownFeatures = [...allFeatures];
  const activeRealFeatures = [...activeFeatures];

  const traceabilityTestFiles = await listFilesRecursively(
    TEST_ROOT,
    isTraceabilityTestFile,
  );

  const byFeature = new Map();
  for (const file of traceabilityTestFiles) {
    const content = await fs.readFile(file, 'utf-8');
    const feature = parseFeatureIdFromTest(content, file);
    if (!feature) continue;
    const list = byFeature.get(feature) ?? [];
    list.push(file);
    byFeature.set(feature, list);
  }

  const mappedTraceabilityFeatures = [...byFeature.keys()]
    .filter((feature) => knownFeatures.includes(feature))
    .sort();

  const featuresToValidate = requestedFeatures.length > 0
    ? requestedFeatures
    : [...new Set([...activeRealFeatures, ...mappedTraceabilityFeatures])].sort();

  if (featuresToValidate.length === 0) {
    console.log('No OpenSpec mcp-server specs found under openspec/changes (active or archive).');
    return;
  }

  let hasFailures = false;
  const reports = [];

  const unknownTraceabilityFeatures = [...byFeature.keys()]
    .filter((feature) => !knownFeatures.includes(feature))
    .sort();
  if (requestedFeatures.length === 0 && unknownTraceabilityFeatures.length > 0) {
    const header = strict
      ? 'Found OpenSpec traceability tests with unknown feature IDs (no matching active/archive mcp-server spec delta):'
      : 'WARN: OpenSpec traceability tests with unknown feature IDs (treated as non-fatal without --strict):';
    if (strict) {
      hasFailures = true;
    }
    console.error(header);
    for (const feature of unknownTraceabilityFeatures) {
      console.error(`  - ${feature}`);
    }
  }

  for (const feature of featuresToValidate) {
    const files = byFeature.get(feature) ?? [];
    if (files.length === 0) {
      reports.push({
        feature,
        ok: !strict && requestedFeatures.length === 0,
        reason: `Feature '${feature}' is missing traceability tests.`,
        missing: [],
        extra: [],
        scenarioIdIssues: [],
        skippedStories: [],
        pendingMarkers: [],
        stories: [],
        scenarios: [],
        storyToFiles: {},
      });
      if (strict || requestedFeatures.length > 0) {
        hasFailures = true;
        console.error(`Feature '${feature}' is missing traceability tests. Add a *.test.ts file with TEST_FEATURE='${feature}' and .openspec() mappings.`);
      } else {
        console.warn(`WARN ${feature}: missing traceability tests (non-fatal without --strict).`);
      }
      continue;
    }

    const report = await validateFeatureCoverage({ feature, testFiles: files, featureSpecFiles });
    reports.push(report);
    if (report.ok) {
      const extraSuffix = report.extra.length > 0
        ? ` (+${report.extra.length} bonus tests beyond spec)`
        : '';
      console.log(`PASS ${feature}: ${report.scenarios.length} scenarios covered by ${report.stories.length} story mappings${extraSuffix}`);
      continue;
    }

    hasFailures = true;
    console.error(`FAIL ${feature}`);
    if (report.reason) {
      console.error(`  ${report.reason}`);
    }
    printSet('Missing stories for spec scenarios', report.missing);
    printSet('Scenario ID mismatches', report.scenarioIdIssues ?? []);
    if (report.extra.length > 0) {
      printSet('Extra stories beyond spec (informational, not a failure)', report.extra);
    }
    printSet('Skipped/todo scenarios in traceability tests', report.skippedStories);
    printSet('Pending markers in traceability tests', report.pendingMarkers);
  }

  if (writeMatrixPath) {
    await writeMatrixFile(writeMatrixPath, { reports, unknownTraceabilityFeatures });
    console.log(`Wrote traceability matrix: ${path.relative(REPO_ROOT, writeMatrixPath)}`);
  }

  if (hasFailures) {
    process.exitCode = 1;
    return;
  }
}

await main();
