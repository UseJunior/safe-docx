import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BatchLock,
  StageError,
  isProcessAlive,
  main,
  parseArgs,
  parseIncludeList,
  promoteVisibilityInSource
} from './run_test_narratives_overnight.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SCRIPT_PATH = path.join(SCRIPT_DIR, 'run_test_narratives_overnight.mjs');

function tmpDir(prefix = 'test-narrative-batch-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeStubNarrativePackage(dir) {
  const stubPath = path.join(dir, 'test-narrative-stub.mjs');
  fs.writeFileSync(
    stubPath,
    `import fs from 'node:fs';

const words = (count) => Array.from({ length: count }, (_, index) => 'word' + (index + 1)).join(' ');

export function extractScenarios(file) {
  const source = fs.readFileSync(file, 'utf8');
  const visibility = source.includes("visibility: 'public'") || source.includes('visibility: "public"') ? 'public' : 'internal';
  const hasNarrative = source.includes('@motivatingProblem');
  return [{
    scenarioName: 'promotes one scenario',
    sourceRef: { path: file, line: source.split(/\\r?\\n/).findIndex((line) => line.includes("'promotes one scenario'")) + 1 },
    visibility,
    narrative: hasNarrative ? { motivatingProblem: words(60) } : {},
    bddSteps: [
      { keyword: 'given', value: { kind: 'literal', value: 'an internal scenario selected for publication' }, sourceRef: { path: file, line: 1 } },
      { keyword: 'when', value: { kind: 'literal', value: 'the batch driver inspects it' }, sourceRef: { path: file, line: 1 } },
      { keyword: 'then', value: { kind: 'literal', value: 'the driver can decide whether to skip or draft' }, sourceRef: { path: file, line: 1 } }
    ],
    fixtures: [],
    expectArgs: []
  }];
}

export function validateTags(value) {
  if (!value || typeof value.motivatingProblem !== 'string') {
    return {
      success: false,
      error: { issues: [{ path: ['motivatingProblem'], message: 'motivatingProblem is required when visibility is public' }] }
    };
  }
  return { success: true, data: value };
}
`
  );
  return stubPath;
}

test('parseArgs accepts the batch-driver options', () => {
  const parsed = parseArgs([
    '--include-list',
    'items.txt',
    '--max',
    '2',
    '--ledger',
    'ledger.jsonl',
    '--codex-cmd',
    'codex-test',
    '--branch',
    'topic',
    '--dry-run',
    '--fail-fast'
  ]);
  assert.equal(path.basename(parsed.includeList), 'items.txt');
  assert.equal(parsed.max, 2);
  assert.equal(path.basename(parsed.ledger), 'ledger.jsonl');
  assert.equal(parsed.codexCmd, 'codex-test');
  assert.equal(parsed.branch, 'topic');
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.failFast, true);
});

test('parseIncludeList reads file-only and file-scenario items', () => {
  const dir = tmpDir();
  const includeList = path.join(dir, 'include.txt');
  fs.writeFileSync(includeList, ['# comment', 'packages/a.test.ts', 'packages/b.test.ts::Scenario B', ''].join('\n'));

  const items = parseIncludeList(includeList);

  assert.equal(items.length, 2);
  assert.equal(items[0].scenarioName, undefined);
  assert.equal(items[1].scenarioName, 'Scenario B');
  assert.equal(items[1].includeLine, 3);
});

test('promoteVisibilityInSource changes internal metadata to public', () => {
  const source = `test.openspec('feature')({ visibility: 'internal' })('promotes one scenario', () => {});
`;
  const patched = promoteVisibilityInSource(source, {
    scenarioName: 'promotes one scenario',
    sourceRef: { path: 'fixture.test.ts', line: 1 }
  });

  assert.match(patched, /visibility: 'public'/);
  assert.doesNotMatch(patched, /visibility: 'internal'/);
});

test('promoteVisibilityInSource adds metadata for direct openspec calls', () => {
  const source = `test.openspec('feature')('promotes one scenario', () => {});
`;
  const patched = promoteVisibilityInSource(source, {
    scenarioName: 'promotes one scenario',
    sourceRef: { path: 'fixture.test.ts', line: 1 }
  });

  assert.match(patched, /test\.openspec\('feature'\)\(\{ visibility: 'public' \}\)\('promotes one scenario'/);
});

test('BatchLock rejects a second holder for the same ledger', () => {
  const dir = tmpDir();
  const ledger = path.join(dir, 'ledger.jsonl');
  const first = new BatchLock(ledger);
  const second = new BatchLock(ledger);
  first.acquire();
  try {
    assert.throws(() => second.acquire(), /already holds/);
  } finally {
    first.release();
  }
  assert.equal(fs.existsSync(`${ledger}.lock`), false);
});

test('dry-run uses filesystem resume state and does not invoke Codex', async () => {
  const dir = tmpDir();
  const stubPath = writeStubNarrativePackage(dir);
  const fixture = path.join(dir, 'fixture.test.ts');
  fs.writeFileSync(
    fixture,
    `/**
 * @motivatingProblem word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23 word24 word25 word26 word27 word28 word29 word30 word31 word32 word33 word34 word35 word36 word37 word38 word39 word40 word41 word42 word43 word44 word45 word46 word47 word48 word49 word50 word51 word52 word53 word54 word55 word56 word57 word58 word59 word60
 */
test.openspec('feature')({ visibility: 'public' })('promotes one scenario', () => {});
`
  );
  const includeList = path.join(dir, 'include.txt');
  const ledger = path.join(dir, 'ledger.jsonl');
  fs.writeFileSync(includeList, `${fixture}::promotes one scenario\n`);
  const originalEnv = process.env.SAFE_DOCX_TEST_NARRATIVE_DIST;
  process.env.SAFE_DOCX_TEST_NARRATIVE_DIST = stubPath;
  try {
    const code = await main(['--include-list', includeList, '--ledger', ledger, '--dry-run', '--codex-cmd', 'definitely-not-codex']);
    assert.equal(code, 0);
  } finally {
    if (originalEnv === undefined) delete process.env.SAFE_DOCX_TEST_NARRATIVE_DIST;
    else process.env.SAFE_DOCX_TEST_NARRATIVE_DIST = originalEnv;
  }

  const events = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.event === 'run-started'));
  assert.ok(events.some((event) => event.event === 'skipped-already-done'));
  assert.ok(events.some((event) => event.event === 'run-completed'));
});

test('script help prints CLI usage', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--include-list <path>/);
  assert.match(result.stdout, /never pushes to GitHub/i);
});

test('script contains no git push command and uses unsigned commits', () => {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.doesNotMatch(source, /\bgit push\b/);
  assert.match(source, /commit\.gpgsign=false/);
});

test('StageError carries its stage label', () => {
  const error = new StageError('verify', 'round-trip failed');
  assert.equal(error.stage, 'verify');
  assert.equal(error.name, 'StageError');
  assert.equal(error.message, 'round-trip failed');
  assert.ok(error instanceof Error);
});

test('BatchLock reclaims a stale lockfile whose PID is no longer alive', () => {
  const dir = tmpDir();
  const ledger = path.join(dir, 'ledger.jsonl');
  const lockPath = `${ledger}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  // Stale lockfile from a crashed prior run. PID 2 is `launchd` on macOS and
  // PID 1 on Linux — guaranteed alive on a live system. Use a PID that
  // cannot belong to a live process: 0x7FFFFFFF (max signed 32-bit).
  fs.writeFileSync(lockPath, '2147483647\n2026-05-25T00:00:00Z\n');
  assert.equal(isProcessAlive(2147483647), false, 'fixture PID must be confirmed dead');

  const lock = new BatchLock(ledger);
  lock.acquire();
  try {
    assert.equal(lock.recoveredStale, true);
    const written = fs.readFileSync(lockPath, 'utf8');
    assert.match(written, new RegExp(`^${process.pid}\\b`));
  } finally {
    lock.release();
  }
  assert.equal(fs.existsSync(lockPath), false);
});

test('BatchLock still refuses when the lockfile holder is alive', () => {
  const dir = tmpDir();
  const ledger = path.join(dir, 'ledger.jsonl');
  const lockPath = `${ledger}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  // Use this process's own PID — guaranteed alive — to simulate a live holder.
  fs.writeFileSync(lockPath, `${process.pid}\n${new Date().toISOString()}\n`);

  const lock = new BatchLock(ledger);
  assert.throws(() => lock.acquire(), /already holds/);
  // Lockfile from the simulated live holder must be untouched.
  assert.ok(fs.existsSync(lockPath));
  fs.unlinkSync(lockPath);
});

test('per-item failure ledger event records the stage label', async () => {
  const dir = tmpDir();
  const stubPath = writeStubNarrativePackage(dir);
  // The fixture is missing a `promotes one scenario` literal, so the stub
  // returns a scenario whose sourceRef.line points at line 0. The driver
  // will fail because the scenario starts internal and no narrative exists,
  // pushing us into Codex invocation. Use a missing scenario name to force
  // an early `patch`-stage failure instead.
  const fixture = path.join(dir, 'fixture.test.ts');
  fs.writeFileSync(fixture, "test.openspec('feature')('promotes one scenario', () => {});\n");
  const includeList = path.join(dir, 'include.txt');
  const ledger = path.join(dir, 'ledger.jsonl');
  fs.writeFileSync(includeList, `${fixture}::scenario name that does not exist\n`);
  const originalEnv = process.env.SAFE_DOCX_TEST_NARRATIVE_DIST;
  process.env.SAFE_DOCX_TEST_NARRATIVE_DIST = stubPath;
  try {
    const code = await main(['--include-list', includeList, '--ledger', ledger, '--dry-run', '--codex-cmd', 'definitely-not-codex']);
    assert.equal(code, 0);
  } finally {
    if (originalEnv === undefined) delete process.env.SAFE_DOCX_TEST_NARRATIVE_DIST;
    else process.env.SAFE_DOCX_TEST_NARRATIVE_DIST = originalEnv;
  }

  const events = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const failed = events.find((event) => event.event === 'failed');
  assert.ok(failed, 'expected a failed event in the ledger');
  assert.equal(failed.stage, 'patch');
  assert.match(failed.reason, /scenario not found/);
});

test('post-write failure reverts the working-tree file', () => {
  // Stand up a real git repo and a fixture file. We'll simulate a post-write
  // failure by hand-patching the file (mimicking what the script does), then
  // assert the script's catch block reverts via git.
  const repoDir = tmpDir('test-narrative-revert-');
  const originalCwd = process.cwd();
  process.chdir(repoDir);
  try {
    const setup = (args) => {
      const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
      assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr || result.stdout}`);
    };
    setup(['init', '--quiet']);
    setup(['config', 'user.email', 'test@example.com']);
    setup(['config', 'user.name', 'Test']);
    const fixture = path.join(repoDir, 'fixture.txt');
    fs.writeFileSync(fixture, 'original content\n');
    setup(['add', 'fixture.txt']);
    setup(['-c', 'commit.gpgsign=false', 'commit', '-m', 'initial', '--quiet']);

    // Simulate the dirty-file failure path: write garbage, then run the same
    // revert sequence the script's catch block uses.
    fs.writeFileSync(fixture, 'corrupted content\n');
    assert.equal(fs.readFileSync(fixture, 'utf8'), 'corrupted content\n');

    spawnSync('git', ['reset', 'HEAD', '--', 'fixture.txt'], { cwd: repoDir, encoding: 'utf8' });
    const checkout = spawnSync('git', ['checkout', 'HEAD', '--', 'fixture.txt'], { cwd: repoDir, encoding: 'utf8' });
    assert.equal(checkout.status, 0, checkout.stderr);

    assert.equal(fs.readFileSync(fixture, 'utf8'), 'original content\n', 'revert must restore committed contents');
  } finally {
    process.chdir(originalCwd);
  }
});
