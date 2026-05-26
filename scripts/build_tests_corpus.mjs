#!/usr/bin/env node
// build_tests_corpus.mjs
//
// Emits the generated root `tests-corpus.json` release artifact. The artifact
// is intentionally not checked in; `tests-corpus.schema.json` is the committed
// contract for consumers.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';

import {
  CANONICAL_SECTION_ORDER,
  extractScenarios,
  validateTags,
} from '../packages/test-narrative/dist/index.js';
import { loadRegistry } from './lib/conformance-registry.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_CORPUS = path.join(REPO_ROOT, 'tests-corpus.json');
const SCHEMA_PATH = path.join(REPO_ROOT, 'tests-corpus.schema.json');
const TEST_GLOBS = [/^packages\/[^/]+\/src\/.*\.test\.ts$/, /^packages\/[^/]+\/test-primitives\/.*\.test\.ts$/];
const ENGINEER_ONLY_LABELS = new Set(['framework', 'host', 'language', 'thread']);

function* walkFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      yield* walkFiles(full, predicate);
    } else if (predicate(full)) {
      yield full;
    }
  }
}

function repoRelative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function listTestFiles() {
  const files = [];
  for (const file of walkFiles(REPO_ROOT, (f) => f.endsWith('.ts'))) {
    const rel = repoRelative(file);
    if (TEST_GLOBS.some((re) => re.test(rel))) {
      files.push({ abs: file, rel });
    }
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

function listAllureResultFiles(packageName) {
  const dir = path.join(REPO_ROOT, 'packages', packageName, 'allure-results');
  if (!fs.existsSync(dir)) return [];
  return [...walkFiles(dir, (f) => f.endsWith('-result.json'))].sort();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeScenarioName(value) {
  return String(value ?? '').replace(/^Scenario:\s*/i, '').trim();
}

function labelsFromResult(result) {
  return (Array.isArray(result.labels) ? result.labels : [])
    .filter((label) => label && typeof label.name === 'string' && typeof label.value === 'string')
    .map((label) => ({ name: label.name, value: label.value }));
}

function labelsByName(labels, name) {
  return labels.filter((label) => label.name === name).map((label) => label.value);
}

function hasPublicCorpusVisibility(result) {
  return labelsFromResult(result).some((label) => label.name === 'corpusVisibility' && label.value === 'public');
}

function resultNameCandidates(result) {
  return [
    result.name,
    result.fullName,
    result.testCaseName,
    result.title,
    ...labelsByName(labelsFromResult(result), 'story'),
  ].map(normalizeScenarioName).filter(Boolean);
}

function buildAllureIndex() {
  const byPackage = new Map();
  for (const pkgDir of fs.readdirSync(path.join(REPO_ROOT, 'packages'), { withFileTypes: true })) {
    if (!pkgDir.isDirectory()) continue;
    const results = [];
    for (const resultFile of listAllureResultFiles(pkgDir.name)) {
      try {
        results.push({ file: resultFile, result: readJson(resultFile) });
      } catch (error) {
        throw new Error(`${repoRelative(resultFile)}: failed to parse Allure result JSON: ${error.message}`);
      }
    }
    byPackage.set(pkgDir.name, results);
  }
  return byPackage;
}

function findAllureResults(allureIndex, packageName, scenarioName) {
  const wanted = normalizeScenarioName(scenarioName);
  const results = allureIndex.get(packageName) ?? [];
  return results.filter(({ result }) => {
    if (!hasPublicCorpusVisibility(result)) return false;
    return resultNameCandidates(result).includes(wanted);
  });
}

function packageNameFromRel(rel) {
  const match = rel.match(/^packages\/([^/]+)\//);
  if (!match) throw new Error(`${rel}: test file is not under packages/<name>/`);
  return match[1];
}

function stableEntryId(packageName, scenario) {
  return [
    packageName,
    repoRelative(scenario.sourceRef.path),
    scenario.sourceRef.line,
    normalizeScenarioName(scenario.scenarioName),
  ].join('#');
}

function serializeSourceRef(sourceRef) {
  return {
    path: repoRelative(sourceRef.path),
    line: sourceRef.line,
  };
}

function serializeEvidenceValue(value) {
  if (value.kind === 'literal') return { kind: 'literal', value: value.value };
  return {
    kind: 'unresolved',
    sourceText: value.sourceText,
    sourceRef: serializeSourceRef(value.sourceRef),
  };
}

function serializeBddStep(step) {
  return {
    keyword: step.keyword,
    value: serializeEvidenceValue(step.value),
    sourceRef: serializeSourceRef(step.sourceRef),
  };
}

function serializeFixture(fixture) {
  return {
    name: fixture.name,
    value: serializeEvidenceValue(fixture.value),
    sourceRef: serializeSourceRef(fixture.sourceRef),
  };
}

function serializeExpectArg(expectArg) {
  return {
    value: serializeEvidenceValue(expectArg.value),
    sourceText: expectArg.sourceText,
    sourceRef: serializeSourceRef(expectArg.sourceRef),
  };
}

function trimProse(prose) {
  return prose.join('\n').trim();
}

function parseConformanceLabel(value) {
  const match = String(value).match(/^([^/]+)\/edition-(\d+)\/part-(\d+)\/(.+)$/);
  if (!match) return undefined;
  return {
    spec: match[1],
    edition: Number(match[2]),
    part: Number(match[3]),
    section: match[4],
  };
}

function registryKeyForClaim(claim) {
  if (claim.spec === 'ECMA-376') {
    return `ECMA-PART${claim.part}-${claim.section.replace(/\./g, '-')}`;
  }
  return undefined;
}

function resolveConformanceClaims(result, registry) {
  const claims = [];
  for (const value of labelsByName(labelsFromResult(result), 'conformance')) {
    const parsed = parseConformanceLabel(value);
    if (!parsed) continue;
    const registryKey = registryKeyForClaim(parsed);
    const target = registryKey ? registry.targets.get(registryKey) : undefined;
    claims.push({
      id: target?.id ?? value,
      spec: parsed.spec,
      edition: parsed.edition,
      part: parsed.part,
      section: parsed.section,
      title: target?.title ?? parsed.section,
      text: target ? trimProse(target.prose) : '',
    });
  }
  return claims.filter((claim) => claim.text.length > 0);
}

function serializeResult(result) {
  const labels = labelsFromResult(result)
    .filter((label) => !ENGINEER_ONLY_LABELS.has(label.name))
    .filter((label) => label.name !== 'tag' || label.value !== 'human-readable')
    .sort((a, b) => `${a.name}\0${a.value}`.localeCompare(`${b.name}\0${b.value}`));

  return {
    name: normalizeScenarioName(result.name),
    status: String(result.status ?? 'unknown'),
    labels,
  };
}

function sectionsForEntry(scenario, result, conformanceClaims) {
  const present = new Set();
  present.add('breadcrumb');
  present.add('statusStrip');
  if (conformanceClaims.length > 0) present.add('citationsStrip');
  for (const key of Object.keys(scenario.narrative)) present.add(key);
  present.add('scenario');
  if (result) present.add('results');
  if (conformanceClaims.length > 0) present.add('specCitations');
  present.add('sourceLink');
  return CANONICAL_SECTION_ORDER.filter((section) => present.has(section));
}

function buildCorpusEntries() {
  const registry = loadRegistry();
  if (registry.errors.length > 0) {
    const first = registry.errors[0];
    throw new Error(`${repoRelative(first.file)}:${first.line}: ${first.message}`);
  }

  const allureIndex = buildAllureIndex();
  const entries = [];
  for (const file of listTestFiles()) {
    const packageName = packageNameFromRel(file.rel);
    let scenarios;
    try {
      scenarios = extractScenarios(file.abs);
    } catch (error) {
      throw new Error(`${file.rel}: failed to extract test narratives: ${error.message}`);
    }

    for (const scenario of scenarios) {
      const visibility = scenario.visibility ?? 'internal';
      if (visibility !== 'public') continue;

      const validation = validateTags(scenario.narrative, { visibility });
      if (!validation.success) {
        const issues = validation.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; ');
        throw new Error(`${file.rel}:${scenario.sourceRef.line}: invalid public narrative tags: ${issues}`);
      }

      // Visibility model (per spec): both the AST-side `visibility: 'public'`
      // marker AND the runtime `corpusVisibility=public` Allure label must
      // agree before a scenario enters the corpus. The previous-step check
      // (visibility !== 'public' continue) gates on the AST side; the Allure
      // lookup gates on the runtime side. A mismatch between them indicates
      // either a stale `allure-results/` directory (test source was promoted
      // to public AFTER the last CI run) or a missing `corpusVisibility`
      // emission (allure-test-factory wasn't built before tests ran). Either
      // way it's developer error — fail loudly with the file:line + expected
      // label rather than silently dropping the scenario from the release.
      const matched = findAllureResults(allureIndex, packageName, scenario.scenarioName);
      if (matched.length === 0) {
        throw new Error(
          `${file.rel}:${scenario.sourceRef.line}: scenario "${scenario.scenarioName}" is marked ` +
            `visibility: 'public' in source but no matching Allure result with ` +
            `corpusVisibility=public was found under packages/${packageName}/allure-results/. ` +
            `Likely causes: tests not run, allure-results was cleaned, scenario renamed since last ` +
            `CI run, or @usejunior/allure-test-factory wasn't rebuilt before the run that produced ` +
            `these results.`
        );
      }
      if (matched.length > 1) {
        const candidates = matched
          .map((m) => repoRelative(m.file))
          .join(', ');
        throw new Error(
          `${file.rel}:${scenario.sourceRef.line}: scenario "${scenario.scenarioName}" matches ` +
            `${matched.length} Allure results (${candidates}). Scenario names must be unique within a ` +
            `package; rename one of the conflicting scenarios.`
        );
      }
      const matchedResult = matched[0];

      const conformanceClaims = resolveConformanceClaims(matchedResult.result, registry);
      const results = serializeResult(matchedResult.result);
      entries.push({
        id: stableEntryId(packageName, scenario),
        package: packageName,
        scenarioName: normalizeScenarioName(scenario.scenarioName),
        sourceRef: serializeSourceRef(scenario.sourceRef),
        sections: sectionsForEntry(scenario, results, conformanceClaims),
        narrative: { ...scenario.narrative },
        scenario: {
          bddSteps: scenario.bddSteps.map(serializeBddStep),
          fixtures: scenario.fixtures.map(serializeFixture),
          expectArgs: scenario.expectArgs.map(serializeExpectArg),
        },
        results,
        conformanceClaims,
      });
    }
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
}

function validateCorpus(corpus) {
  const schema = readJson(SCHEMA_PATH);
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);
  if (validate(corpus)) return;

  const errors = validate.errors ?? [];
  const detail = errors
    .slice(0, 10)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('\n');
  throw new Error(`tests-corpus.json failed schema validation:\n${detail}`);
}

function main() {
  const corpus = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    safeDocxCommit: gitHead(),
    entries: buildCorpusEntries(),
  };
  validateCorpus(corpus);
  fs.writeFileSync(OUT_CORPUS, `${JSON.stringify(corpus, null, 2)}\n`);
  console.log(`build_tests_corpus: wrote ${repoRelative(OUT_CORPUS)} (${corpus.entries.length} entries)`);
}

main();
