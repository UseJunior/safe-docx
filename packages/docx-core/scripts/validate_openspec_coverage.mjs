#!/usr/bin/env node

import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const TEST_ROOT = path.join(PACKAGE_ROOT, 'src');
const TEST_ROOTS = [
  TEST_ROOT,
  path.join(REPO_ROOT, 'packages', 'docx-compare', 'src'),
];
const DEFAULT_MATRIX_PATH = path.join(TEST_ROOT, 'testing', 'DOCX_COMPARISON_OPENSPEC_TRACEABILITY.md');
const SPEC_CONFIGS = [
  {
    id: 'docx-comparison',
    title: 'DOCX Comparison',
    specPath: path.join(REPO_ROOT, 'openspec', 'specs', 'docx-comparison', 'spec.md'),
  },
  {
    id: 'cross-implementation-conformance',
    title: 'Cross-Implementation Conformance',
    specPath: path.join(REPO_ROOT, 'openspec', 'specs', 'cross-implementation-conformance', 'spec.md'),
  },
];

export function normalizeScenarioName(value) {
  return value
    .replace(/^Scenario:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

const SERIAL_ID_RE = /^(?:SDX|OA|XIMPL)-[\w-]+-?\d+$/;

function extractScenarioId(rawScenario) {
  const match = rawScenario.trim().match(/^\[([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

// Scenarios whose tagged test genuinely exercises the scenario but cannot
// reference the scenario's tokens in its own body — because the observable is
// asserted by an external suite runner or compiled Lean proof, or through a
// shared assertion helper that wraps the primitive the spec names. Each is a
// real, peer-reviewed mapping, not a stuffed tag. Keep this list short; every
// entry carries a one-line justification. It is NOT a place to silence a
// genuinely stuffed tag — fix those by asserting the scenario in the test.
const THEN_CHECK_ALLOWLIST = new Set([
  // External docx-platform-tests suite runner asserts acceptChanges semantics
  // (no remaining w:ins) in a separate process; the TS test only drives it.
  'acceptAllTrackedChanges round-trip through the adapter',
  // Lean proof-closure ([LEAN-RT-03]) is validated by `lake build` / Spec.lean
  // in the lean-build workflow; this TS bridge is the falsifiability layer, not
  // the proof, so it cannot reference the proof's identifiers.
  '`inv_rt_001` sorry is replaced by a proof composing the named residual axiom and the lemmas',
  // The round-trip observable is asserted via the `assertRoundTripInvariant`
  // helper, which wraps `normalizeText`/`extractTextWithParagraphs`; the
  // property-test body references the wrapper, not the wrapped primitives.
  'Field-bearing arbitrary drives INV-RT-001 round-trip',
]);

// Generic words that appear inside backtick spans but carry no scenario-specific
// signal. Kept tiny and lowercase-compared so the THEN-token check stays a
// fail-closed guard against tag-stuffing, not a prose linter.
const TOKEN_STOPLIST = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'nan',
]);

// Pull code-like tokens out of a single backtick code span. Splits dotted
// property paths (`OpcPart.uri` -> `OpcPart`, `uri`) and value expressions
// (`reconstructionModeUsed: rebuild` -> `reconstructionModeUsed`, `rebuild`)
// into individual identifiers, while keeping OOXML namespace-prefixed names
// (`w:tbl`, `pt14:Unid`) intact.
export function tokenizeCodeSpan(span) {
  const tokens = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*/g;
  let m;
  while ((m = re.exec(span))) {
    const token = m[0];
    if (token.length < 2) continue;
    if (TOKEN_STOPLIST.has(token.toLowerCase())) continue;
    tokens.push(token);
  }
  return tokens;
}

function collectSpanTokens(line, sink) {
  const spanRe = /`([^`]+)`/g;
  let m;
  while ((m = spanRe.exec(line))) {
    for (const token of tokenizeCodeSpan(m[1])) {
      sink.add(token);
    }
  }
}

// Mine a scenario's code-like tokens into two sets:
//
//   gateTokens  — tokens in the observable (THEN and any trailing AND clauses).
//                 The check only fires for a scenario when this set is non-empty.
//                 A pure-prose observable (documentation/proof scenarios like the
//                 Lean bridge cases) yields nothing here and is exempt — this is
//                 the issue's "fail-closed only when THEN has a code token" rule,
//                 auto-detected with no allowlist.
//
//   matchTokens — gateTokens plus the action that produces the observable (the
//                 WHEN). A tagged test passes if its body references any of these.
//                 The WHEN is in the match set because a genuine test almost
//                 always invokes the subject under test even when it asserts the
//                 THEN through a returned value or variable rather than repeating
//                 the THEN's literal element name; including it is what keeps real
//                 unit tests from being flagged. The GIVEN (pure setup) is
//                 excluded from both sets so shared fixture vocabulary can neither
//                 trigger nor mask a finding.
//
// Only backtick-delimited code spans are mined: the spec wraps every concrete
// identifier/literal/element name in backticks.
export function extractThenTokens(bodyLines) {
  const gateTokens = new Set();
  const matchTokens = new Set();
  let inWhen = false;
  let inThen = false;
  for (const line of bodyLines) {
    const keyword = line.match(/^\s*[-*]\s*\*\*([A-Z]+)\*\*/);
    if (keyword) {
      const kw = keyword[1];
      if (kw === 'WHEN') {
        inWhen = true;
        inThen = false;
      } else if (kw === 'THEN') {
        inWhen = false;
        inThen = true;
      } else if (kw === 'AND') {
        // AND inherits whichever clause is open (WHEN or THEN); an AND under
        // GIVEN leaves both closed and contributes nothing.
      } else {
        inWhen = false;
        inThen = false;
      }
    }
    if (inThen) {
      collectSpanTokens(line, gateTokens);
      collectSpanTokens(line, matchTokens);
    } else if (inWhen) {
      collectSpanTokens(line, matchTokens);
    }
  }
  return { gateTokens, matchTokens };
}

// Narrow a tagged-test slice to just the test's body — everything from the
// callback's opening (the first `=>` or `function`) onward. The preamble that is
// dropped is the tag chain (`.openspec('…')`) and the test title string, which
// echoes the scenario name and would otherwise let a title like
// "Scenario: Cross-run pass rescues inplace output" satisfy the `inplace` token
// on its own — defeating the check for exactly the kind of tag-stuffing it
// targets. Tokens are only credible when the test body itself uses them. If no
// callback is found, the whole slice is returned (fail-open for that slice).
export function extractTestBody(slice) {
  const arrow = slice.indexOf('=>');
  const fn = slice.indexOf('function');
  const candidates = [arrow, fn].filter((i) => i !== -1);
  if (candidates.length === 0) return slice;
  return slice.slice(Math.min(...candidates));
}

// Returns true if `slice` references `token` as a standalone identifier (not as
// a substring of a longer identifier). Lookaround on identifier characters lets
// `Equal` match `CorrelationStatus.Equal` but not `toEqual`, and keeps
// namespace-prefixed names like `w:tbl` matchable.
export function sliceReferencesToken(slice, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
  return re.test(slice);
}

// The deterministic THEN-keyword check, as a pure function over already-parsed
// inputs so it can be unit-tested without filesystem access.
//
//   scenarioEntries — `{ name, gateTokens, matchTokens }[]` from parseScenariosFromSpec.
//   storyToSlices   — Map<resolvedScenarioName, { file, slice }[]> of tagged-test bodies.
//
// A scenario is checked only when its observable carries at least one code token
// (gateTokens non-empty) and it is not on the allowlist. Each tagged test must
// reference at least one of the scenario's matchTokens; otherwise it is a
// violation (a tag whose test does not exercise the scenario — i.e. stuffing).
export function findThenKeywordViolations(scenarioEntries, storyToSlices, allowlist = THEN_CHECK_ALLOWLIST) {
  const violations = [];
  for (const scenario of scenarioEntries) {
    if (scenario.gateTokens.size === 0) continue;
    if (allowlist.has(scenario.name)) continue;
    const tagged = storyToSlices.get(scenario.name);
    if (!tagged || tagged.length === 0) continue;

    const matchTokens = [...scenario.matchTokens];
    for (const { file, slice } of tagged) {
      const body = extractTestBody(slice);
      const matched = matchTokens.some((token) => sliceReferencesToken(body, token));
      if (!matched) {
        violations.push({ scenario: scenario.name, file, tokens: matchTokens });
      }
    }
  }
  return violations;
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

export function parseScenariosFromSpec(content) {
  const scenarios = [];
  const seen = new Set();
  const lines = content.split(/\r?\n/);
  const headerRe = /^\s*####\s+Scenario:\s*(.+?)\s*$/;
  const sectionRe = /^\s*#{1,6}\s/;

  for (let i = 0; i < lines.length; i += 1) {
    const headerMatch = lines[i].match(headerRe);
    if (!headerMatch) continue;

    const raw = headerMatch[1].trim();
    // Collect the scenario body — every line up to the next markdown heading.
    const bodyLines = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (sectionRe.test(lines[j])) break;
      bodyLines.push(lines[j]);
    }

    const name = normalizeScenarioName(raw);
    if (seen.has(name)) continue;
    seen.add(name);
    const { gateTokens, matchTokens } = extractThenTokens(bodyLines);
    scenarios.push({
      name,
      id: extractScenarioId(raw),
      gateTokens,
      matchTokens,
    });
  }
  return scenarios;
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

  const viaOpenspec = /\.openspec\(\s*(["'`])([\s\S]*?)\1\s*\)/g;
  let m = viaOpenspec.exec(content);
  while (m) {
    addStory(m[2]);
    m = viaOpenspec.exec(content);
  }

  const viaAllureStory = /allure\.story\(\s*(["'`])([\s\S]*?)\1\s*\)/g;
  m = viaAllureStory.exec(content);
  while (m) {
    addStory(m[2]);
    m = viaAllureStory.exec(content);
  }

  return { stories, storyIdsByName };
}

// Slice the source of each tagged test so the THEN-token check can scope its
// assertion to the body of the specific `test(...)` that carries a tag, rather
// than the whole file. Each tag-introducing call (`.openspec('…')` or
// `allure.story('…')`) is located, then tags are grouped per test: a test may
// chain several tags before its body (`test.openspec(a).openspec(b)('title', fn)`),
// so all tags in one chain must share that test's body. A chain breaks when the
// gap between two consecutive tags contains a test body (an arrow `=>` or a
// `function` literal); tags before the body are chained, the next tag after it
// starts a new test. Every tag is then assigned its whole test's slice (its
// chain's first tag through the next chain's first tag, or EOF).
// Returns `{ rawStory, slice }[]`, one entry per tag.
export function parseTaggedTestSlices(content) {
  const tagRe = /\.openspec\(\s*(["'`])([\s\S]*?)\1\s*\)|allure\.story\(\s*(["'`])([\s\S]*?)\3\s*\)/g;
  const tags = [];
  let m = tagRe.exec(content);
  while (m) {
    tags.push({ rawStory: m[2] ?? m[4], start: m.index, end: m.index + m[0].length });
    m = tagRe.exec(content);
  }

  // Group consecutive tags that belong to the same test (one chain → one body).
  const groups = [];
  let group = null;
  for (let i = 0; i < tags.length; i += 1) {
    if (i === 0) {
      group = [tags[0]];
      continue;
    }
    const between = content.slice(tags[i - 1].end, tags[i].start);
    if (/=>|\bfunction\b/.test(between)) {
      groups.push(group);
      group = [tags[i]];
    } else {
      group.push(tags[i]);
    }
  }
  if (group) groups.push(group);

  const slices = [];
  for (let gi = 0; gi < groups.length; gi += 1) {
    const start = groups[gi][0].start;
    const end = gi + 1 < groups.length ? groups[gi + 1][0].start : content.length;
    const slice = content.slice(start, end);
    for (const tag of groups[gi]) {
      slices.push({ rawStory: tag.rawStory, slice });
    }
  }
  return slices;
}

function parseSkippedStoriesFromTest(content) {
  const skipped = new Set();
  const skippedPattern = /(?:test|it)\.(?:skip|todo)\(\s*(["'`])(?:Scenario:\s*)?([\s\S]*?)\1/g;
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

function mdEscapeTableCell(value) {
  return String(value)
    // Escape backslashes first so a literal "\" in the value cannot combine
    // with the pipe-escape below to form an unintended "\|" sequence.
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function buildMatrixMarkdown({ reports, storyToFiles, skippedStories }) {
  const lines = [];
  lines.push('# DOCX Core OpenSpec Traceability Matrix');
  lines.push('');
  lines.push('> Auto-generated by `packages/docx-core/scripts/validate_openspec_coverage.mjs`.');
  lines.push('> Do not hand-edit this file.');
  lines.push('');
  lines.push('This matrix maps docx-core OpenSpec `#### Scenario:` entries to scenario mappings extracted from `src/**/*.test.ts`.');
  lines.push('');

  for (const report of reports) {
    lines.push(`## ${report.title}`);
    lines.push('');
    lines.push('| Scenario | Status | Test Files | Notes |');
    lines.push('|---|---|---|---|');

    for (const scenario of report.scenarios) {
      const files = storyToFiles.get(scenario) ?? [];
      const isSkipped = skippedStories.has(scenario);

      const status = isSkipped
        ? 'pending_impl'
        : files.length > 0
          ? 'covered'
          : 'missing';

      const fileCell = files.length > 0
        ? files.map((f) => `\`${f}\``).join(', ')
        : 'n/a';

      let notes = '';
      if (isSkipped) notes = 'skip/todo in tests';
      else if (files.length === 0) notes = 'No scenario mapping found in current tests';

      lines.push(
        `| ${mdEscapeTableCell(scenario)} | ${status} | ${mdEscapeTableCell(fileCell)} | ${mdEscapeTableCell(notes)} |`,
      );
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let writeMatrixPath = DEFAULT_MATRIX_PATH;
  let strict = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--write-matrix') {
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        writeMatrixPath = path.resolve(process.cwd(), value);
        i += 1;
      }
      continue;
    }
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { writeMatrixPath, strict };
}

async function main() {
  const { writeMatrixPath, strict } = parseArgs();

  const serialIdMap = new Map();
  const specReports = [];
  const allScenarioLookup = new Set();

  for (const config of SPEC_CONFIGS) {
    let specContent;
    try {
      specContent = await fs.readFile(config.specPath, 'utf-8');
    } catch {
      console.error(`Cannot read canonical spec: ${config.specPath}`);
      process.exitCode = 1;
      return;
    }

    const scenarioEntries = parseScenariosFromSpec(specContent);
    const scenarios = scenarioEntries.map((entry) => entry.name).sort();
    if (scenarios.length === 0) {
      console.error(`No '#### Scenario:' entries found in ${config.specPath}`);
      process.exitCode = 1;
      return;
    }

    for (const [id, name] of parseSerialIdMap(specContent)) {
      serialIdMap.set(id, name);
    }
    for (const scenario of scenarios) {
      allScenarioLookup.add(scenario);
    }

    specReports.push({
      ...config,
      scenarioEntries,
      scenarios,
      scenarioLookup: new Set(scenarios),
    });
  }

  const testFiles = (
    await Promise.all(TEST_ROOTS.map((root) => listFilesRecursively(root, (f) => f.endsWith('.test.ts'))))
  ).flat().sort();

  const storyToFiles = new Map();
  const storySet = new Set();
  const storyIdsByName = new Map();
  const skippedStorySet = new Set();
  // resolved scenario name -> [{ file, slice }] for each test carrying that tag.
  const storyToSlices = new Map();

  function resolveStoryName(rawStory) {
    const bare = rawStory.trim();
    if (SERIAL_ID_RE.test(bare) && serialIdMap.has(bare)) {
      return serialIdMap.get(bare);
    }
    return normalizeScenarioName(rawStory);
  }

  for (const tf of testFiles) {
    const content = await fs.readFile(tf, 'utf-8');
    const rel = path.relative(REPO_ROOT, tf).split(path.sep).join('/');

    for (const { rawStory, slice } of parseTaggedTestSlices(content)) {
      const resolved = resolveStoryName(rawStory);
      const entries = storyToSlices.get(resolved) ?? [];
      entries.push({ file: rel, slice });
      storyToSlices.set(resolved, entries);
    }

    const parsedStories = parseStoriesFromTest(content);
    for (const story of resolveSerialIds(parsedStories.stories, serialIdMap)) {
      storySet.add(story);
      const files = storyToFiles.get(story) ?? [];
      if (!files.includes(rel)) files.push(rel);
      storyToFiles.set(story, files);
    }
    for (const [story, ids] of parsedStories.storyIdsByName.entries()) {
      const resolvedName = SERIAL_ID_RE.test(story) && serialIdMap.has(story)
        ? serialIdMap.get(story)
        : story;
      const existing = storyIdsByName.get(resolvedName) ?? new Set();
      for (const id of ids) {
        existing.add(id);
      }
      storyIdsByName.set(resolvedName, existing);
    }

    for (const skipped of resolveSerialIds(parseSkippedStoriesFromTest(content), serialIdMap)) {
      skippedStorySet.add(skipped);
    }
  }

  for (const report of specReports) {
    const missing = report.scenarios.filter((scenario) => !storySet.has(scenario));
    const pending = report.scenarios.filter((scenario) => skippedStorySet.has(scenario));
    const covered = report.scenarios.length - missing.length;
    const scenarioIdIssues = [];
    for (const scenario of report.scenarioEntries) {
      if (!scenario.id) {
        continue;
      }
      if (!storySet.has(scenario.name)) {
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

    report.missing = missing;
    report.pending = pending;
    report.covered = covered;
    report.scenarioIdIssues = scenarioIdIssues;

    const pct = ((covered / report.scenarios.length) * 100).toFixed(1);
    if (missing.length === 0 && pending.length === 0 && scenarioIdIssues.length === 0) {
      console.log(`PASS ${report.id}: ${covered}/${report.scenarios.length} scenarios mapped (${pct}%)`);
    } else {
      const label = strict ? 'FAIL' : 'WARN';
      console.error(`${label} ${report.id}: ${covered}/${report.scenarios.length} scenarios mapped (${pct}%)`);
      if (missing.length > 0) {
        console.error(`  Missing scenarios (${missing.length}):`);
        for (const scenario of missing) {
          console.error(`    - ${scenario}`);
        }
      }
      if (pending.length > 0) {
        console.error(`  Pending scenarios (${pending.length}):`);
        for (const scenario of pending) {
          console.error(`    - ${scenario}`);
        }
      }
      if (scenarioIdIssues.length > 0) {
        console.error(`  Scenario ID mismatches (${scenarioIdIssues.length}):`);
        for (const issue of scenarioIdIssues) {
          console.error(`    - ${issue}`);
        }
      }
      if (strict) process.exitCode = 1;
    }
  }

  // THEN-keyword check (deterministic, no LLM). For every mapped scenario whose
  // observable contains at least one code-like token, require the body of each
  // test carrying that scenario's tag to reference at least one of those tokens.
  // This catches tag-stuffing — a tag slapped on a test that never asserts the
  // scenario — which the presence-only coverage check above cannot see. It
  // fails closed regardless of --strict: validity is not negotiable the way the
  // coverage ratio is. Scenarios with a pure-prose observable yield no tokens
  // and are exempt, so doc/proof-style mappings never produce a false positive.
  const thenViolations = [];
  for (const report of specReports) {
    for (const violation of findThenKeywordViolations(report.scenarioEntries, storyToSlices)) {
      thenViolations.push({ id: report.id, ...violation });
    }
  }

  if (thenViolations.length > 0) {
    console.error(`THEN-keyword check FAILED (${thenViolations.length} stuffed mapping(s)):`);
    for (const violation of thenViolations) {
      console.error(`  - [${violation.id}] "${violation.scenario}"`);
      console.error(`      tagged in ${violation.file}, but its test body references none of:`);
      console.error(`      ${violation.tokens.map((t) => `\`${t}\``).join(', ')}`);
    }
    console.error(
      '  A tagged test must assert its scenario\'s observable. Either fix the mapping, ' +
        'or assert the scenario\'s THEN inside the tagged test.',
    );
    process.exitCode = 1;
  } else {
    console.log('PASS THEN-keyword check: every tagged test references its scenario observable.');
  }

  const matrix = buildMatrixMarkdown({
    reports: specReports,
    storyToFiles,
    skippedStories: skippedStorySet,
  });

  await fs.mkdir(path.dirname(writeMatrixPath), { recursive: true });
  await fs.writeFile(writeMatrixPath, matrix, 'utf-8');

  const extra = [...storySet].filter((story) => !allScenarioLookup.has(story)).sort();
  if (extra.length > 0) {
    console.log(`Extra scenario stories not in spec (${extra.length}):`);
    for (const scenario of extra) {
      console.log(`  - ${scenario}`);
    }
  }

  const relative = path.relative(REPO_ROOT, writeMatrixPath).split(path.sep).join('/');
  console.log(`Wrote traceability matrix: ${relative}`);
}

// Run only when executed directly (`node scripts/validate_openspec_coverage.mjs`),
// not when imported by unit tests. realpathSync(argv[1]) resolves any symlink so
// the comparison holds however the script is invoked.
function isDirectRun() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  await main();
}
