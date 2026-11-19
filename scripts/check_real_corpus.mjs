#!/usr/bin/env node
/**
 * Local mirror of CI's required "Real-corpus comparison gates" job
 * (`.github/workflows/ci.yml`, job `real-corpus-comparison`).
 *
 * Without SAFE_DOCX_REAL_CORPUS_DIR the real-corpus suites skip, so a branch
 * could pass the documented local pre-submit and still fail this required
 * check (issue #1256: a stale strategy-differential manifest was first caught
 * in CI on PR #1248). This wrapper runs the same two steps CI runs:
 *
 *   1. node scripts/prepare_real_comparison_corpus.mjs <corpus-dir>
 *   2. npm run test:real-corpus -w @usejunior/docx-compare
 *      with SAFE_DOCX_REAL_CORPUS_REQUIRED=1 and
 *      SAFE_DOCX_STRATEGY_DIFFERENTIAL_REQUIRED=1
 *
 * The corpus is cached in `.tmp/real-comparison-corpus/` (gitignored) unless
 * SAFE_DOCX_REAL_CORPUS_DIR or `--corpus-dir <dir>` names another directory.
 * The prepare step reuses cached files whose SHA-256 still matches the
 * manifest, so only the first run needs the network.
 *
 * `--skip-prepare` runs the gate against the cache as it stands (offline).
 * Because the REQUIRED variables are set, a missing or stale cache then fails
 * the gate rather than skipping it.
 *
 * Exit status: the first failing step's exit status; 0 when both pass.
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
export const DEFAULT_CORPUS_DIR = join(PROJECT_ROOT, '.tmp', 'real-comparison-corpus');

export const CORPUS_DIR_ENV = 'SAFE_DOCX_REAL_CORPUS_DIR';
/** The variables CI's gate step sets to "1" so an absent corpus fails, not skips. */
export const REQUIRED_ENV_VARS = Object.freeze([
  'SAFE_DOCX_REAL_CORPUS_REQUIRED',
  'SAFE_DOCX_STRATEGY_DIFFERENTIAL_REQUIRED',
]);
export const PREPARE_SCRIPT = 'scripts/prepare_real_comparison_corpus.mjs';
export const GATE_NPM_ARGS = Object.freeze([
  'run',
  'test:real-corpus',
  '-w',
  '@usejunior/docx-compare',
]);

const USAGE =
  'Usage: node scripts/check_real_corpus.mjs [--corpus-dir <dir>] [--skip-prepare]';

export function parseArgs(argv) {
  const options = { corpusDir: null, skipPrepare: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--skip-prepare') {
      options.skipPrepare = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--corpus-dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--corpus-dir requires a directory');
      }
      options.corpusDir = value;
      index += 1;
    } else if (arg.startsWith('--corpus-dir=')) {
      const value = arg.slice('--corpus-dir='.length);
      if (!value) throw new Error('--corpus-dir requires a directory');
      options.corpusDir = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/** `--corpus-dir` wins, then SAFE_DOCX_REAL_CORPUS_DIR, then the `.tmp/` cache. */
export function resolveCorpusDir(options, env, cwd = process.cwd()) {
  const chosen = options.corpusDir ?? (env[CORPUS_DIR_ENV] || null);
  return chosen ? resolve(cwd, chosen) : DEFAULT_CORPUS_DIR;
}

export function buildGateEnv(baseEnv, corpusDir) {
  const env = { ...baseEnv, [CORPUS_DIR_ENV]: corpusDir };
  for (const name of REQUIRED_ENV_VARS) env[name] = '1';
  return env;
}

export function planSteps({ corpusDir, skipPrepare, env }) {
  const gateEnv = buildGateEnv(env, corpusDir);
  const steps = [];
  if (!skipPrepare) {
    steps.push({
      label: 'prepare SHA-256-verified comparison corpus',
      command: process.execPath,
      args: [PREPARE_SCRIPT, corpusDir],
      env: gateEnv,
    });
  }
  steps.push({
    label: 'real-corpus comparison gates',
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: [...GATE_NPM_ARGS],
    env: gateEnv,
  });
  return steps;
}

/** Maps a spawnSync result to an exit status; signals and spawn errors are failures. */
export function exitStatusOf(result) {
  if (result.error) return 1;
  if (typeof result.status === 'number') return result.status;
  return 1;
}

function defaultRunner(step) {
  return spawnSync(step.command, step.args, {
    cwd: PROJECT_ROOT,
    env: step.env,
    stdio: 'inherit',
  });
}

export function runCheck({
  argv = [],
  env = process.env,
  runner = defaultRunner,
  log = console.log,
  error = console.error,
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (parseError) {
    error(`[check:real-corpus] ${parseError.message}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    log(USAGE);
    return 0;
  }

  const corpusDir = resolveCorpusDir(options, env);
  log(`[check:real-corpus] corpus directory: ${corpusDir}`);
  for (const step of planSteps({ corpusDir, skipPrepare: options.skipPrepare, env })) {
    log(`[check:real-corpus] ${step.label}: ${[step.command, ...step.args].join(' ')}`);
    const result = runner(step);
    const status = exitStatusOf(result);
    if (status !== 0) {
      const reason = result.error
        ? `could not start (${result.error.message})`
        : result.signal
          ? `was killed by ${result.signal}`
          : `exited with status ${status}`;
      error(`[check:real-corpus] FAILED: ${step.label} ${reason}.`);
      return status;
    }
  }
  log('[check:real-corpus] passed.');
  return 0;
}

function invokedDirectly() {
  // A node_modules/.bin symlink makes import.meta.url and argv[1] differ, so
  // both sides are resolved through realpath before comparison.
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = runCheck({ argv: process.argv.slice(2) });
}
