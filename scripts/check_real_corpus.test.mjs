import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  CORPUS_DIR_ENV,
  DEFAULT_CORPUS_DIR,
  GATE_NPM_ARGS,
  PREPARE_SCRIPT,
  PROJECT_ROOT,
  REQUIRED_ENV_VARS,
  buildGateEnv,
  exitStatusOf,
  parseArgs,
  planSteps,
  resolveCorpusDir,
  runCheck,
} from './check_real_corpus.mjs';

function recordingRunner(statuses) {
  const calls = [];
  const runner = (step) => {
    calls.push(step);
    const next = statuses[calls.length - 1];
    return typeof next === 'object' ? next : { status: next ?? 0, signal: null };
  };
  return { calls, runner };
}

const quiet = { log: () => {}, error: () => {} };

// ── corpus directory resolution ─────────────────────────────────────────────
test('default corpus cache lives under the gitignored .tmp/ directory', () => {
  assert.equal(DEFAULT_CORPUS_DIR, join(PROJECT_ROOT, '.tmp', 'real-comparison-corpus'));
  assert.equal(resolveCorpusDir(parseArgs([]), {}), DEFAULT_CORPUS_DIR);
});

test('SAFE_DOCX_REAL_CORPUS_DIR overrides the default cache', () => {
  assert.equal(resolveCorpusDir(parseArgs([]), { [CORPUS_DIR_ENV]: '/shared/cache' }), '/shared/cache');
});

test('--corpus-dir overrides the environment and resolves relative paths', () => {
  const options = parseArgs(['--corpus-dir', 'rel/cache']);
  assert.equal(resolveCorpusDir(options, { [CORPUS_DIR_ENV]: '/shared/cache' }, '/work'), resolve('/work', 'rel/cache'));
  assert.equal(parseArgs(['--corpus-dir=/x']).corpusDir, '/x');
});

test('argument errors exit 2 without running anything', () => {
  for (const argv of [['--bogus'], ['--corpus-dir'], ['--corpus-dir', '--skip-prepare'], ['--corpus-dir=']]) {
    const { calls, runner } = recordingRunner([]);
    assert.equal(runCheck({ argv, env: {}, runner, ...quiet }), 2, argv.join(' '));
    assert.equal(calls.length, 0);
  }
});

// ── environment mirrors CI ──────────────────────────────────────────────────
test('gate environment sets the corpus dir and every REQUIRED variable to 1', () => {
  const env = buildGateEnv({ PATH: '/bin', SAFE_DOCX_REAL_CORPUS_REQUIRED: '0' }, '/c');
  assert.equal(env.PATH, '/bin');
  assert.equal(env[CORPUS_DIR_ENV], '/c');
  for (const name of REQUIRED_ENV_VARS) assert.equal(env[name], '1', name);
});

test('steps mirror CI: prepare into the corpus dir, then the docx-compare real-corpus run', () => {
  const steps = planSteps({ corpusDir: '/c', skipPrepare: false, env: {} });
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0].args, [PREPARE_SCRIPT, '/c']);
  assert.deepEqual(steps[1].args, ['run', 'test:real-corpus', '-w', '@usejunior/docx-compare']);
  for (const step of steps) assert.equal(step.env[CORPUS_DIR_ENV], '/c');
});

test('--skip-prepare runs only the gate', () => {
  const steps = planSteps({ corpusDir: '/c', skipPrepare: true, env: {} });
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].args, [...GATE_NPM_ARGS]);
});

test('CI real-corpus job runs the same commands with the same REQUIRED variables', () => {
  const ci = readFileSync(join(PROJECT_ROOT, '.github/workflows/ci.yml'), 'utf8');
  const start = ci.indexOf('\n  real-corpus-comparison:');
  assert.ok(start >= 0, 'ci.yml has a real-corpus-comparison job');
  // The job ends where the next two-space-indented mapping key (the next job) begins.
  const nextJob = ci.slice(start + 1).search(/\n {2}["']?[\w-]+["']?:[ \t]*(?:#.*)?\n/);
  const job = nextJob < 0 ? ci.slice(start) : ci.slice(start, start + 1 + nextJob);
  assert.ok(job.includes(`node ${PREPARE_SCRIPT} "$${CORPUS_DIR_ENV}"`), 'prepare command matches');
  assert.ok(job.includes(`npm ${GATE_NPM_ARGS.join(' ')}`), 'gate command matches');
  // YAML spells "1" several equivalent ways; accept quoted and bare values.
  const ciRequired = [...job.matchAll(/(SAFE_DOCX_[A-Z_]+_REQUIRED):\s*(["']?)1\2\s*(?:#.*)?$/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(ciRequired)].sort(), [...REQUIRED_ENV_VARS].sort());
});

// ── exit-status propagation ─────────────────────────────────────────────────
test('passes when both steps exit 0', () => {
  const { calls, runner } = recordingRunner([0, 0]);
  assert.equal(runCheck({ argv: ['--corpus-dir', '/c'], env: {}, runner, ...quiet }), 0);
  assert.equal(calls.length, 2);
});

test('a failed prepare stops before the gate and propagates its status', () => {
  const { calls, runner } = recordingRunner([3]);
  assert.equal(runCheck({ argv: ['--corpus-dir', '/c'], env: {}, runner, ...quiet }), 3);
  assert.equal(calls.length, 1);
});

test('a failed gate propagates its status', () => {
  const { runner } = recordingRunner([0, 1]);
  assert.equal(runCheck({ argv: ['--corpus-dir', '/c'], env: {}, runner, ...quiet }), 1);
});

test('signals and spawn errors are failures, never passes', () => {
  assert.equal(exitStatusOf({ status: null, signal: 'SIGTERM' }), 1);
  assert.equal(exitStatusOf({ status: null, signal: null, error: new Error('ENOENT') }), 1);
  const { runner } = recordingRunner([{ status: null, signal: 'SIGKILL' }]);
  const errors = [];
  const status = runCheck({ argv: ['--corpus-dir', '/c'], env: {}, runner, log: () => {}, error: (m) => errors.push(m) });
  assert.equal(status, 1);
  assert.match(errors.join('\n'), /FAILED: prepare .* killed by SIGKILL/);
});
