// The AppleScript driver's cache and retry logic, with osascript replaced by a fake Word.
// Needs the built docx-core oracle module (`npm run build`).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPackage } from './fixtures/package.mjs';
import { createWordDriver } from './word.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ORACLE = path.join(ROOT, 'packages/docx-core/dist/integration/word-accept-reject-oracle.js');
const REV = 'w:id="1" w:author="T" w:date="2026-01-01T00:00:00Z"';
const skip = existsSync(ORACLE) ? false : 'run `npm run build` first';

let oracle;
let dir;
before(async () => {
  if (!skip) oracle = await import(pathToFileURL(ORACLE).href);
  dir = await mkdtemp(path.join(os.tmpdir(), 'word-driver-test-'));
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

const resolved = () => buildPackage('<w:p><w:r><w:t>done</w:t></w:r></w:p><w:sectPr/>');
const unresolved = () => buildPackage(`<w:p><w:ins ${REV}><w:r><w:t>left</w:t></w:r></w:ins></w:p><w:sectPr/>`);

/** A fake osascript: `apply` writes `outputs.shift()` to the output path (or fails), `close-run` succeeds. */
function fakeWord(outputs, calls) {
  return async (args) => {
    calls.push(path.basename(args[0]));
    if (!args[0].endsWith('apply.applescript')) return { code: 0, stdout: '0', stderr: '', timedOut: false };
    const next = outputs.shift();
    if (next === 'timeout') return { code: null, stdout: '', stderr: '', timedOut: true };
    if (next === 'denied') return { code: 1, stdout: '', stderr: 'Not authorized to send Apple events to Microsoft Word. (-1743)', timedOut: false };
    await writeFile(args[3], next);
    return { code: 0, stdout: 'OK', stderr: '', timedOut: false };
  };
}

async function driver(name, outputs, calls, extra = {}) {
  const runDir = path.join(dir, name, 'run');
  const cacheDir = path.join(dir, name, 'cache');
  await mkdir(runDir, { recursive: true });
  const word = createWordDriver({ runDir, cacheDir, version: '16.0', refresh: false, timeoutSeconds: 5, oracle, osascript: fakeWord(outputs, calls), retryDelayMs: 1, ...extra });
  return { word, runDir, cacheDir };
}

test('a resolved Word output is cached and reused', { skip }, async () => {
  const calls = [];
  const { word, cacheDir } = await driver('cache', [await resolved()], calls);
  const input = await unresolved();
  const first = await word({ caseId: 'c', mode: 'accept', input });
  const second = await word({ caseId: 'c', mode: 'accept', input });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.ok(second.output.equals(first.output));
  assert.deepEqual(calls, ['apply.applescript']);
  assert.equal((await readdir(cacheDir)).length, 1);
});

test('an unresolved Word output is returned but never cached', { skip }, async () => {
  const calls = [];
  const { word, cacheDir } = await driver('unresolved', [await unresolved()], calls);
  const output = await word({ caseId: 'u', mode: 'reject', input: await unresolved() });
  assert.equal(output.cached, false);
  assert.equal((await oracle.projectDocx(output.output)).revisionsRemaining, 1);
  assert.deepEqual(await readdir(cacheDir).catch(() => []), []);
});

test('an unresolved cache entry (from an older runner) is discarded and Word runs again', { skip }, async () => {
  const calls = [];
  const input = await unresolved();
  const { word, cacheDir } = await driver('stale-cache', [await resolved()], calls);
  await word({ caseId: 'u', mode: 'reject', input });
  const [entry] = await readdir(cacheDir);
  await writeFile(path.join(cacheDir, entry), await unresolved());
  const logs = [];
  const { word: again } = await driver('stale-cache', [await resolved()], calls, { log: (l) => logs.push(l) });
  const result = await again({ caseId: 'u', mode: 'reject', input });
  assert.equal(result.cached, false);
  assert.equal((await oracle.projectDocx(result.output)).revisionsRemaining, 0);
  assert.deepEqual(calls, ['apply.applescript', 'apply.applescript']);
  assert.match(logs.join('\n'), /discarding an unusable cached Word output/);
});

test('a stalled call is retried once after closing the run documents, then reported as STALL', { skip }, async () => {
  const calls = [];
  const { word } = await driver('stall', ['timeout', 'timeout'], calls);
  await assert.rejects(word({ caseId: 's', mode: 'accept', input: await unresolved() }), (err) => err.kind === 'STALL');
  assert.deepEqual(calls, ['apply.applescript', 'close-run.applescript', 'apply.applescript']);

  const recovered = [];
  const { word: second } = await driver('stall2', ['timeout', await resolved()], recovered);
  assert.equal((await second({ caseId: 's', mode: 'accept', input: await unresolved() })).cached, false);
});

test('a permission failure is not retried', { skip }, async () => {
  const calls = [];
  const { word } = await driver('denied', ['denied'], calls);
  await assert.rejects(word({ caseId: 'd', mode: 'accept', input: await unresolved() }), (err) => err.kind === 'PERMISSION');
  assert.deepEqual(calls, ['apply.applescript']);
});
