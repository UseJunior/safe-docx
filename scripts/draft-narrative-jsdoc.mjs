#!/usr/bin/env node
// draft-narrative-jsdoc.mjs
//
// Local authoring helper for public OpenSpec tests that are missing narrative
// JSDoc. CI must stay deterministic, so Codex is invoked only from this script
// when a developer runs it explicitly.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const PROMPT_PATH = path.join(SCRIPT_DIR, 'narrative-prompt.md');
const TEST_GLOBS = [/^packages\/[^/]+\/src\/.*\.test\.ts$/, /^packages\/[^/]+\/test-primitives\/.*\.test\.ts$/];
const PLACEHOLDER = '<<INPUT_CONTEXT_JSON>>';

const USAGE = `Usage: node scripts/draft-narrative-jsdoc.mjs [--dry-run] [path ...]

Draft missing narrative JSDoc for public test.openspec scenarios.

Options:
  --dry-run     Print scenario context and assembled prompt without invoking Codex.
  --help, -h    Print this usage text.

When no path is provided, package test files are scanned. The script requires
packages/test-narrative to be built before scanning or patching.`;

export function parseArgs(argv) {
  const options = { dryRun: false, help: false, paths: [] };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else options.paths.push(arg);
  }
  return options;
}

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

function toRepoRelative(filePath) {
  const rel = path.relative(REPO_ROOT, filePath);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return rel.split(path.sep).join('/');
  return filePath;
}

function sourceRefToJson(sourceRef) {
  return {
    path: toRepoRelative(sourceRef.path),
    line: sourceRef.line
  };
}

function listDefaultTestFiles() {
  const all = [];
  for (const file of walkFiles(REPO_ROOT, (f) => f.endsWith('.ts'))) {
    const rel = toRepoRelative(file);
    if (TEST_GLOBS.some((re) => re.test(rel))) all.push(file);
  }
  return all;
}

function resolveInputPaths(paths) {
  if (paths.length === 0) return listDefaultTestFiles();
  const files = [];
  for (const input of paths) {
    const abs = path.resolve(REPO_ROOT, input);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const file of walkFiles(abs, (f) => f.endsWith('.test.ts'))) files.push(file);
    } else {
      files.push(abs);
    }
  }
  return files;
}

function literalStringFromArgument(source, start) {
  let i = start;
  while (/\s/.test(source[i] ?? '')) i += 1;
  const quote = source[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return undefined;
  let value = '';
  for (i += 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      value += source[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (ch === quote) return value;
    if (quote === '`' && ch === '$' && source[i + 1] === '{') return undefined;
    value += ch;
  }
  return undefined;
}

export function inferFeatureLabel(source, sourceLine) {
  const lines = source.split(/\r?\n/);
  const beforeScenario = lines.slice(0, Math.max(0, sourceLine)).join('\n');
  const marker = '.openspec(';
  const markerIndex = beforeScenario.lastIndexOf(marker);
  if (markerIndex === -1) return undefined;
  return literalStringFromArgument(beforeScenario, markerIndex + marker.length);
}

function evidenceToJson(value) {
  if (!value) return value;
  if (value.kind === 'literal') return value.value;
  return {
    unresolved: value.sourceText,
    sourceRef: sourceRefToJson(value.sourceRef)
  };
}

export function buildScenarioContext(file, scenario, scenarios, source) {
  const featureLabel = inferFeatureLabel(source, scenario.sourceRef.line);
  const siblingScenarioNames = scenarios
    .filter((candidate) => candidate !== scenario)
    .filter((candidate) => inferFeatureLabel(source, candidate.sourceRef.line) === featureLabel)
    .map((candidate) => candidate.scenarioName);

  return {
    scenarioName: scenario.scenarioName,
    sourceRef: sourceRefToJson(scenario.sourceRef),
    featureLabel,
    bddSteps: scenario.bddSteps.map((step) => ({
      keyword: step.keyword,
      value: evidenceToJson(step.value),
      sourceRef: sourceRefToJson(step.sourceRef)
    })),
    fixtures: scenario.fixtures.map((fixture) => ({
      name: fixture.name,
      value: evidenceToJson(fixture.value),
      sourceRef: sourceRefToJson(fixture.sourceRef)
    })),
    expectArgs: scenario.expectArgs.map((arg) => ({
      value: evidenceToJson(arg.value),
      sourceText: arg.sourceText,
      sourceRef: sourceRefToJson(arg.sourceRef)
    })),
    siblingScenarioNames
  };
}

export function assemblePrompt(template, context) {
  const input = JSON.stringify(context, null, 2);
  if (template.includes(PLACEHOLDER)) return template.replace(PLACEHOLDER, input);
  return `${template.trim()}\n\n${input}\n`;
}

export function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('Codex output did not contain a JSON object');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('Codex output contained an unterminated JSON object');
}

export function parseAndValidateCodexOutput(output, validateTags) {
  const jsonText = extractFirstJsonObject(output);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Failed to parse Codex JSON response: ${e.message}`);
  }

  const result = validateTags(parsed, { visibility: 'public' });
  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${where}${issue.message}`;
    });
    const error = new Error(`Codex response failed narrative validation:\n${messages.join('\n')}`);
    error.issues = result.error.issues;
    throw error;
  }
  return result.data;
}

function escapeJsDocValue(value) {
  return String(value).replace(/\*\//g, '* /').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatJsDocBlock(tags, indent = '') {
  const order = [
    'motivatingProblem',
    'implementationLimitation',
    'testScopeExclusion',
    'observedPerformance',
    'potentialMisconception',
    'implementationAlternativeRejected',
    'ecma376Difficulty'
  ];
  const lines = [`${indent}/**`];
  for (const tag of order) {
    if (tags[tag] !== undefined) lines.push(`${indent} * @${tag} ${escapeJsDocValue(tags[tag])}`);
  }
  lines.push(`${indent} */`);
  return lines.join('\n');
}

/**
 * Symbol returned by insertJsDocAboveScenario when the scenario already has a
 * leading JSDoc block. The drafter must NOT add a second consecutive JSDoc
 * block — that would orphan the original and confuse formatters. Caller
 * surfaces a clear "please update manually" message instead.
 */
export const REFUSED_EXISTING_JSDOC = Symbol.for('draft-narrative-jsdoc/refused-existing-jsdoc');

function detectLineEnding(source) {
  // Choose the dominant line-ending in the source. A pure-LF file emits LF;
  // a file with any `\r\n` is treated as CRLF and the patch emits CRLF too.
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function lineHasContent(line) {
  return line.trim().length > 0;
}

function hasLeadingJsDocBlock(lines, scenarioIndex) {
  // Walk up from the scenario line; skip pure-whitespace lines; if the first
  // non-empty line above ends with `*/`, this scenario has an existing JSDoc
  // block immediately above it.
  for (let i = scenarioIndex - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined) return false;
    if (!lineHasContent(line)) continue;
    return line.trimEnd().endsWith('*/');
  }
  return false;
}

export function insertJsDocAboveScenario(source, sourceLine, tags) {
  const eol = detectLineEnding(source);
  const hasTrailingNewline = /\r?\n$/.test(source);
  const body = hasTrailingNewline ? source.replace(/\r?\n$/, '') : source;
  const lines = body.split(/\r?\n/);
  const index = sourceLine - 1;
  if (index < 0 || index >= lines.length) {
    throw new Error(`Scenario line ${sourceLine} is outside the source file`);
  }
  if (hasLeadingJsDocBlock(lines, index)) {
    return REFUSED_EXISTING_JSDOC;
  }
  const indent = lines[index].match(/^\s*/)?.[0] ?? '';
  const block = formatJsDocBlock(tags, indent);
  lines.splice(index, 0, ...block.split('\n'));
  return lines.join(eol) + (hasTrailingNewline ? eol : '');
}

export function runCodex(prompt, options = {}) {
  const {
    timeoutMs,
    codexCmd = 'codex',
    captureLastMessage
  } = options;
  const args = ['exec', '--sandbox', 'workspace-write', '-C', REPO_ROOT];
  if (captureLastMessage) {
    args.push('--output-last-message', captureLastMessage);
  }
  args.push(prompt);
  return spawnSync(codexCmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    timeout: timeoutMs
  });
}

async function loadNarrativePackage() {
  const overridePath = process.env.SAFE_DOCX_TEST_NARRATIVE_DIST;
  const packagePath = overridePath
    ? path.resolve(REPO_ROOT, overridePath)
    : path.join(REPO_ROOT, 'packages/test-narrative/dist/index.js');
  return import(pathToFileURL(packagePath).href);
}

function printDryRun(file, scenario, context, prompt) {
  console.log(`${toRepoRelative(file)}:${scenario.sourceRef.line}`);
  console.log(`  scenario: ${scenario.scenarioName}`);
  console.log(`  missing tags: motivatingProblem`);
  console.log('  context:');
  console.log(JSON.stringify(context, null, 2));
  console.log('  prompt:');
  console.log(prompt);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error(USAGE);
    process.exit(2);
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const promptTemplate = fs.readFileSync(PROMPT_PATH, 'utf8');
  const { extractScenarios, validateTags } = await loadNarrativePackage();
  const files = resolveInputPaths(options.paths);
  const patches = [];
  let candidateCount = 0;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const scenarios = extractScenarios(file);
    for (const scenario of scenarios) {
      const visibility = scenario.visibility ?? 'internal';
      if (visibility !== 'public' || scenario.narrative.motivatingProblem !== undefined) continue;

      candidateCount += 1;
      const context = buildScenarioContext(file, scenario, scenarios, source);
      const prompt = assemblePrompt(promptTemplate, context);
      if (options.dryRun) {
        printDryRun(file, scenario, context, prompt);
        continue;
      }

      const result = runCodex(prompt);
      if (result.error) {
        if (result.error.code === 'ENOENT') {
          throw new Error(
            "Codex CLI not found on PATH. Install with `npm install -g @openai/codex` " +
              "and authenticate it, then re-run. Use --dry-run if you only want to inspect the prompt without invoking Codex."
          );
        }
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`codex exec failed for ${toRepoRelative(file)}:${scenario.sourceRef.line}\n${result.stderr || result.stdout}`);
      }
      const tags = parseAndValidateCodexOutput(`${result.stdout}\n${result.stderr}`, validateTags);
      patches.push({ file, sourceLine: scenario.sourceRef.line, tags });
      console.log(`${toRepoRelative(file)}:${scenario.sourceRef.line}: drafted narrative tags`);
    }
  }

  if (options.dryRun) {
    console.log(`draft-narrative-jsdoc: dry run complete (${candidateCount} scenario${candidateCount === 1 ? '' : 's'} needing narrative)`);
    return;
  }

  const grouped = new Map();
  for (const patch of patches) {
    if (!grouped.has(patch.file)) grouped.set(patch.file, []);
    grouped.get(patch.file).push(patch);
  }
  let patchedCount = 0;
  let refusedCount = 0;
  for (const [file, filePatches] of grouped.entries()) {
    let source = fs.readFileSync(file, 'utf8');
    let modified = false;
    for (const patch of filePatches.sort((a, b) => b.sourceLine - a.sourceLine)) {
      const next = insertJsDocAboveScenario(source, patch.sourceLine, patch.tags);
      if (next === REFUSED_EXISTING_JSDOC) {
        console.error(
          `${toRepoRelative(file)}:${patch.sourceLine}: refusing to patch — scenario already has a leading JSDoc block. ` +
            "Update it manually to add the missing tags rather than stacking two blocks."
        );
        refusedCount += 1;
        continue;
      }
      source = next;
      modified = true;
      patchedCount += 1;
    }
    if (modified) fs.writeFileSync(file, source);
  }
  console.log(`draft-narrative-jsdoc: patched ${patchedCount} scenario${patchedCount === 1 ? '' : 's'}`);
  if (refusedCount > 0) {
    console.log(`draft-narrative-jsdoc: refused ${refusedCount} (existing JSDoc; update manually)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
