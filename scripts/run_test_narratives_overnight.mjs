#!/usr/bin/env node
// run_test_narratives_overnight.mjs
//
// Long-running local batch driver for promoting selected OpenSpec test
// scenarios to public visibility and adding narrative JSDoc. The ledger is
// telemetry only; resume decisions always come from re-parsing source files.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from '@typescript-eslint/parser';

import {
  assemblePrompt,
  buildScenarioContext,
  insertJsDocAboveScenario,
  parseAndValidateCodexOutput,
  REFUSED_EXISTING_JSDOC,
  runCodex
} from './draft-narrative-jsdoc.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const PROMPT_PATH = path.join(SCRIPT_DIR, 'narrative-prompt.md');
const DEFAULT_LEDGER = path.join(REPO_ROOT, 'data/test-narrative-batch/ledger.jsonl');
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

const USAGE = `Usage: node scripts/run_test_narratives_overnight.mjs --include-list <path> [options]

Batch-promote selected test scenarios to public visibility, draft narrative
JSDoc with Codex, validate, and create one unsigned local commit per scenario.

Options:
  --include-list <path>  File containing test paths or <file>::<scenario> lines.
  --max <N>             Stop after N successful commits.
  --ledger <path>       JSONL ledger path (default: data/test-narrative-batch/ledger.jsonl).
  --codex-cmd <cmd>     Codex executable to invoke (default: codex).
  --branch <name>       Expected current git branch; fail if the checkout differs.
  --dry-run             Log planned work without invoking Codex, patching, or committing.
  --fail-fast           Stop on the first per-item failure and exit non-zero.
  --help, -h            Print this usage text.

The script never pushes to GitHub. Resume is filesystem-as-ground-truth:
items already parsed as visibility: 'public' with @motivatingProblem are skipped.`;

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(filePath) {
  const rel = path.relative(REPO_ROOT, path.resolve(filePath));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return rel.split(path.sep).join('/');
  return filePath;
}

function parseArgs(argv) {
  const options = {
    includeList: undefined,
    max: undefined,
    ledger: DEFAULT_LEDGER,
    codexCmd: 'codex',
    dryRun: false,
    branch: undefined,
    failFast: false,
    help: false
  };

  const readValue = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--fail-fast') options.failFast = true;
    else if (arg === '--include-list') {
      options.includeList = readValue(i, arg);
      i += 1;
    } else if (arg === '--max') {
      const raw = readValue(i, arg);
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--max must be a positive integer');
      options.max = parsed;
      i += 1;
    } else if (arg === '--ledger') {
      options.ledger = readValue(i, arg);
      i += 1;
    } else if (arg === '--codex-cmd') {
      options.codexCmd = readValue(i, arg);
      i += 1;
    } else if (arg === '--branch') {
      options.branch = readValue(i, arg);
      i += 1;
    } else if (arg.startsWith('--include-list=')) {
      options.includeList = arg.slice('--include-list='.length);
    } else if (arg.startsWith('--max=')) {
      const parsed = Number.parseInt(arg.slice('--max='.length), 10);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--max must be a positive integer');
      options.max = parsed;
    } else if (arg.startsWith('--ledger=')) {
      options.ledger = arg.slice('--ledger='.length);
    } else if (arg.startsWith('--codex-cmd=')) {
      options.codexCmd = arg.slice('--codex-cmd='.length);
    } else if (arg.startsWith('--branch=')) {
      options.branch = arg.slice('--branch='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help && !options.includeList) throw new Error('--include-list is required');
  return {
    ...options,
    ledger: path.resolve(REPO_ROOT, options.ledger),
    includeList: options.includeList ? path.resolve(REPO_ROOT, options.includeList) : undefined
  };
}

class Ledger {
  constructor(filePath) {
    this.path = filePath;
  }

  append(event) {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const line = JSON.stringify({ ts: nowIso(), ...event }, null, 0);
    const handle = fs.openSync(this.path, 'a');
    try {
      fs.writeSync(handle, `${line}\n`);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  }
}

class BatchLock {
  constructor(ledgerPath) {
    this.path = `${ledgerPath}.lock`;
    this.fd = undefined;
    this.released = false;
  }

  acquire() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    try {
      this.fd = fs.openSync(this.path, 'wx');
    } catch (error) {
      if (error?.code === 'EEXIST') {
        const holder = readFileIfExists(this.path).trim();
        const detail = holder ? ` (pid ${holder.split(/\s+/)[0]})` : '';
        throw new Error(`Another test-narrative batch already holds ${repoRelative(this.path)}${detail}`);
      }
      throw error;
    }
    fs.writeSync(this.fd, `${process.pid}\n${nowIso()}\n`);
    fs.fsyncSync(this.fd);
    process.once('exit', () => this.release());
  }

  release() {
    if (this.released) return;
    this.released = true;
    if (this.fd !== undefined) {
      fs.closeSync(this.fd);
      this.fd = undefined;
    }
    try {
      fs.unlinkSync(this.path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function parseIncludeList(includeListPath) {
  const lines = fs.readFileSync(includeListPath, 'utf8').split(/\r?\n/);
  const items = [];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('::');
    const filePart = separator === -1 ? line : line.slice(0, separator);
    const scenarioName = separator === -1 ? undefined : line.slice(separator + 2);
    if (!filePart) throw new Error(`include-list line ${index + 1} is missing a file path`);
    if (separator !== -1 && !scenarioName) throw new Error(`include-list line ${index + 1} is missing a scenario name`);
    items.push({
      includeLine: index + 1,
      file: path.resolve(REPO_ROOT, filePart),
      scenarioName
    });
  }
  return items;
}

function loadNarrativePackage() {
  const overridePath = process.env.SAFE_DOCX_TEST_NARRATIVE_DIST;
  const packagePath = overridePath
    ? path.resolve(REPO_ROOT, overridePath)
    : path.join(REPO_ROOT, 'packages/test-narrative/dist/index.js');
  return import(pathToFileURL(packagePath).href);
}

function parseTsSource(source) {
  return parse(source, {
    loc: true,
    range: true,
    comment: true,
    jsx: false
  });
}

function walk(node, visit) {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'range' || key === 'loc') continue;
    const value = node[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && 'type' in item) walk(item, visit);
      }
    } else if (typeof value === 'object' && 'type' in value) {
      walk(value, visit);
    }
  }
}

function literalString(expression) {
  if (!expression) return undefined;
  if (expression.type === 'Literal' && typeof expression.value === 'string') return expression.value;
  if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? expression.quasis[0]?.value.raw ?? '';
  }
  return undefined;
}

function propertyName(property) {
  if (!property || property.type === 'SpreadElement' || property.computed) return undefined;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return undefined;
}

function findScenarioCall(source, scenario) {
  const ast = parseTsSource(source);
  const matches = [];
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    if (node.loc?.start.line !== scenario.sourceRef.line) return;
    const name = literalString(node.arguments?.[0]);
    if (name !== scenario.scenarioName) return;
    const body = node.arguments?.[1];
    if (body?.type !== 'ArrowFunctionExpression' && body?.type !== 'FunctionExpression') return;
    matches.push(node);
  });
  if (matches.length !== 1) {
    throw new Error(`expected one scenario call at line ${scenario.sourceRef.line}, found ${matches.length}`);
  }
  return matches[0];
}

function replaceRange(source, range, replacement) {
  return `${source.slice(0, range[0])}${replacement}${source.slice(range[1])}`;
}

function objectHasVisibilityPublic(objectExpression) {
  for (const property of objectExpression.properties ?? []) {
    if (propertyName(property) !== 'visibility') continue;
    return literalString(property.value) === 'public';
  }
  return false;
}

function promoteObjectExpression(source, objectExpression) {
  if (!objectExpression.range) throw new Error('metadata object is missing a source range');
  for (const property of objectExpression.properties ?? []) {
    if (propertyName(property) !== 'visibility') continue;
    if (!property.value?.range) throw new Error('visibility value is missing a source range');
    if (literalString(property.value) === 'public') return source;
    return replaceRange(source, property.value.range, "'public'");
  }

  if ((objectExpression.properties ?? []).length === 0) {
    return replaceRange(source, objectExpression.range, "{ visibility: 'public' }");
  }
  return replaceRange(source, [objectExpression.range[0] + 1, objectExpression.range[0] + 1], " visibility: 'public',");
}

function promoteVisibilityInSource(source, scenario) {
  const scenarioCall = findScenarioCall(source, scenario);
  if (!scenarioCall.callee?.range) throw new Error('scenario callee is missing a source range');

  if (scenarioCall.callee.type === 'CallExpression') {
    const firstArg = scenarioCall.callee.arguments?.[0];
    if (firstArg?.type === 'ObjectExpression') {
      return promoteObjectExpression(source, firstArg);
    }
    const calleeText = source.slice(scenarioCall.callee.range[0], scenarioCall.callee.range[1]);
    if (firstArg === scenarioCall.arguments?.[0]) {
      return replaceRange(source, scenarioCall.callee.range, `${calleeText}({ visibility: 'public' })`);
    }
  }

  if (scenarioCall.callee.type === 'MemberExpression' && scenarioCall.callee.object?.range) {
    const objectText = source.slice(scenarioCall.callee.object.range[0], scenarioCall.callee.object.range[1]);
    return replaceRange(source, scenarioCall.callee.object.range, `${objectText}({ visibility: 'public' })`);
  }

  if (objectHasVisibilityPublic(scenarioCall.callee)) return source;
  const calleeText = source.slice(scenarioCall.callee.range[0], scenarioCall.callee.range[1]);
  return replaceRange(source, scenarioCall.callee.range, `${calleeText}({ visibility: 'public' })`);
}

function findScenario(scenarios, scenarioName) {
  if (scenarioName === undefined) return undefined;
  return scenarios.find((scenario) => scenario.scenarioName === scenarioName);
}

function isDone(scenario) {
  return (scenario.visibility ?? 'internal') === 'public' && scenario.narrative.motivatingProblem !== undefined;
}

function expandIncludeItems(includeItems, extractScenarios) {
  const expanded = [];
  for (const item of includeItems) {
    const scenarios = extractScenarios(item.file);
    if (item.scenarioName !== undefined) {
      const scenario = findScenario(scenarios, item.scenarioName);
      if (!scenario) {
        expanded.push({ ...item, missingAtExpand: true });
      } else {
        expanded.push({ ...item, scenarioName: scenario.scenarioName });
      }
      continue;
    }
    for (const scenario of scenarios) {
      expanded.push({ ...item, scenarioName: scenario.scenarioName });
    }
  }
  return expanded;
}

function runGit(args, options = {}) {
  return spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
    ...options
  });
}

function requireGitOk(args, description) {
  const result = runGit(args);
  if (result.status !== 0 || result.error) {
    throw new Error(`${description} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  return result.stdout.trim();
}

function currentBranch() {
  return requireGitOk(['branch', '--show-current'], 'git branch --show-current');
}

function gitCommitForItem(file, scenarioName) {
  requireGitOk(['add', '--', repoRelative(file)], 'git add');
  const subjectScenario = scenarioName.length > 60 ? `${scenarioName.slice(0, 57)}...` : scenarioName;
  const message = [
    `test(test-narrative): add narrative for ${subjectScenario}`,
    '',
    'Promote one selected test scenario to public visibility and add the narrative metadata needed by the test corpus.',
    '',
    'Ref: #256'
  ].join('\n');
  const commit = runGit(['-c', 'commit.gpgsign=false', 'commit', '-m', message]);
  if (commit.status !== 0 || commit.error) {
    throw new Error(commit.error?.message ?? commit.stderr ?? commit.stdout);
  }
  return requireGitOk(['rev-parse', '--short=12', 'HEAD'], 'git rev-parse HEAD');
}

function runNarrativeCheck() {
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'check_test_narratives.mjs')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0 || result.error) {
    throw new Error(result.error?.message ?? result.stderr ?? result.stdout);
  }
}

function codexVersion(codexCmd) {
  const result = spawnSync(codexCmd, ['--version'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  if (result.error) return `unavailable: ${result.error.message}`;
  return (result.stdout || result.stderr || '').trim() || `exit ${result.status}`;
}

function shortError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 500);
}

async function processOne(item, context) {
  const { extractScenarios, validateTags, promptTemplate, ledger, options } = context;
  const scenarioKey = `${repoRelative(item.file)}::${item.scenarioName}`;
  ledger.append({
    event: 'item-started',
    scenario: scenarioKey,
    file: repoRelative(item.file),
    scenarioName: item.scenarioName
  });

  const source = fs.readFileSync(item.file, 'utf8');
  const scenarios = extractScenarios(item.file);
  const scenario = findScenario(scenarios, item.scenarioName);
  if (!scenario) {
    throw new Error(`scenario not found: ${scenarioKey}`);
  }
  if (isDone(scenario)) {
    ledger.append({ event: 'skipped-already-done', scenario: scenarioKey });
    return 'skipped';
  }

  const scenarioContext = buildScenarioContext(item.file, scenario, scenarios, source);
  const prompt = assemblePrompt(promptTemplate, scenarioContext);
  if (options.dryRun) {
    ledger.append({ event: 'dry-run', scenario: scenarioKey, visibility: scenario.visibility ?? 'internal' });
    console.log(`[dry-run] ${scenarioKey}`);
    return 'skipped';
  }

  const lastMessagePath = path.join(
    os.tmpdir(),
    `safe-docx-test-narrative-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  const codex = runCodex(prompt, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    codexCmd: options.codexCmd,
    captureLastMessage: lastMessagePath
  });
  if (codex.error) throw codex.error;
  if (codex.status !== 0) throw new Error(`codex exec failed: ${codex.stderr || codex.stdout}`);

  const lastMessage = readFileIfExists(lastMessagePath);
  try {
    fs.unlinkSync(lastMessagePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const tags = parseAndValidateCodexOutput(`${lastMessage}\n${codex.stdout}\n${codex.stderr}`, validateTags);

  let patched = promoteVisibilityInSource(source, scenario);
  patched = insertJsDocAboveScenario(patched, scenario.sourceRef.line, tags);
  if (patched === REFUSED_EXISTING_JSDOC) {
    throw new Error('scenario already has a leading JSDoc block; refusing to stack a second block');
  }
  fs.writeFileSync(item.file, patched);

  const reparsed = extractScenarios(item.file);
  const updated = findScenario(reparsed, item.scenarioName);
  if (!updated) throw new Error('post-patch AST round-trip could not find the scenario');
  if (!isDone(updated)) {
    throw new Error('post-patch AST round-trip did not find visibility public plus @motivatingProblem');
  }

  runNarrativeCheck();
  const commit = gitCommitForItem(item.file, item.scenarioName);
  ledger.append({ event: 'committed', scenario: scenarioKey, commit });
  console.log(`[committed] ${scenarioKey} ${commit}`);
  return 'committed';
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 2;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const lock = new BatchLock(options.ledger);
  const ledger = new Ledger(options.ledger);
  try {
    lock.acquire();
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  const counts = { committed: 0, failed: 0, skipped: 0 };
  let exitCode = 0;
  try {
    const branch = currentBranch();
    if (options.branch && branch !== options.branch) {
      throw new Error(`expected branch ${options.branch}, found ${branch}`);
    }

    ledger.append({
      event: 'run-started',
      codex_version: codexVersion(options.codexCmd),
      argv: [process.execPath, fileURLToPath(import.meta.url), ...argv],
      codex_argv: [
        options.codexCmd,
        'exec',
        '--sandbox',
        'workspace-write',
        '-C',
        REPO_ROOT,
        '--output-last-message',
        '<per-item-path>',
        '<prompt>'
      ],
      include_list: repoRelative(options.includeList),
      branch,
      dry_run: options.dryRun
    });

    const { extractScenarios, validateTags } = await loadNarrativePackage();
    const promptTemplate = fs.readFileSync(PROMPT_PATH, 'utf8');
    const includeItems = parseIncludeList(options.includeList);
    const workItems = expandIncludeItems(includeItems, extractScenarios);

    for (const item of workItems) {
      if (options.max !== undefined && counts.committed >= options.max) break;
      const scenarioKey = `${repoRelative(item.file)}::${item.scenarioName ?? '(missing)'}`;
      try {
        if (item.missingAtExpand) throw new Error(`scenario not found: ${scenarioKey}`);
        const outcome = await processOne(item, { extractScenarios, validateTags, promptTemplate, ledger, options });
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      } catch (error) {
        counts.failed += 1;
        ledger.append({ event: 'failed', scenario: scenarioKey, reason: shortError(error) });
        console.error(`[failed] ${scenarioKey}: ${shortError(error)}`);
        if (options.failFast) {
          exitCode = 1;
          break;
        }
      }
    }

    ledger.append({ event: 'run-completed', counts });
    console.log(`run_test_narratives_overnight: committed=${counts.committed} failed=${counts.failed} skipped=${counts.skipped}`);
    return exitCode;
  } catch (error) {
    ledger.append({ event: 'run-failed', reason: shortError(error), counts });
    console.error(shortError(error));
    return 1;
  } finally {
    lock.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(shortError(error));
      process.exitCode = 1;
    }
  );
}

export {
  BatchLock,
  Ledger,
  expandIncludeItems,
  isDone,
  main,
  parseArgs,
  parseIncludeList,
  promoteVisibilityInSource
};
