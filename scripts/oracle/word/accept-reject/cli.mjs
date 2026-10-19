#!/usr/bin/env node
// npm run oracle:word:accept-reject -- [--suite matrix|round-trip|all] [--fixture x.docx]... [--pair orig.docx,rev.docx]...
//                                      [--only <id-substring>]... [--refresh] [--timeout 120] [--keep] [--json out.json] [--strict]
//
// Checks safe-docx Accept All / Reject All against Microsoft Word 16 for Mac. macOS-only and
// opt-in: it skips with exit 0 (or 3 with --strict) when Word, automation permission, or macOS is
// missing, and always in CI. Exit 1 = a mismatch, 2 = Word or harness error. See README.md.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { KNOWN_DIVERGENCES } from './known-divergences.mjs';
import { buildMatrixFixture, matrixFixtures } from './fixtures/section-boundary-matrix.mjs';
import { ROUND_TRIP_CASES, buildRoundTripSide } from './fixtures/section-break-round-trip.mjs';
import { WORD_APP, closeRunDocuments, createWordDriver, probeWordAutomation, removeRunDir, wordVersion } from './word.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-10-07T00:00:00.000Z') };

const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'all' },
    fixture: { type: 'string', multiple: true, default: [] },
    pair: { type: 'string', multiple: true, default: [] },
    refresh: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '120' },
    keep: { type: 'boolean', default: false },
    json: { type: 'string' },
    strict: { type: 'boolean', default: false },
    only: { type: 'string', multiple: true, default: [] },
  },
  strict: true,
});

function skip(reason) {
  console.log(`SKIPPED Word Accept/Reject oracle: ${reason}`);
  process.exit(values.strict ? 3 : 0);
}

if (process.env.CI) skip('CI is set; this oracle drives a local Microsoft Word and never runs in CI.');
if (process.platform !== 'darwin') skip(`needs macOS with Microsoft Word (platform is ${process.platform}).`);
const version = wordVersion();
if (!version) skip(`Microsoft Word is not installed at ${WORD_APP}.`);

const suites = values.suite === 'all' ? ['matrix', 'round-trip'] : values.suite === 'none' ? [] : [values.suite];
for (const s of suites) if (!['matrix', 'round-trip'].includes(s)) throw new Error(`--suite must be matrix, round-trip, all or none (got ${s})`);
const timeoutSeconds = Number(values.timeout);
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error('--timeout must be a positive number of seconds');

const dist = (pkg, file) => path.join(ROOT, 'packages', pkg, 'dist', file);
for (const file of [dist('docx-core', 'integration/word-accept-reject-oracle.js'), dist('docx-core', 'index.js'), dist('docx-compare', 'index.js')]) {
  if (!existsSync(file)) {
    console.error(`Missing ${path.relative(ROOT, file)}; run \`npm run build\` first.`);
    process.exit(2);
  }
}
const oracle = await import(pathToFileURL(dist('docx-core', 'integration/word-accept-reject-oracle.js')).href);
const { DocxDocument } = await import(pathToFileURL(dist('docx-core', 'index.js')).href);
const { acceptAllChanges, rejectAllChanges, compareDocuments } = await import(pathToFileURL(dist('docx-compare', 'index.js')).href);

const container = oracle.wordContainerDataDir();
if (!existsSync(container)) skip(`Word's container ${container} does not exist; open Word once, then rerun.`);

// ---- cases -------------------------------------------------------------------------------------
const MODES = oracle.ORACLE_MODES;
const cases = [];
if (suites.includes('matrix')) {
  for (const f of matrixFixtures()) cases.push({ suite: 'matrix', id: f.id, modes: MODES, input: () => buildMatrixFixture(f) });
}
async function redline(originalBytes, revisedBytes) {
  return (await compareDocuments(Buffer.from(originalBytes), Buffer.from(revisedBytes), COMPARE_OPTIONS)).document;
}
if (suites.includes('round-trip')) {
  for (const c of ROUND_TRIP_CASES) {
    cases.push({
      suite: 'round-trip', id: c.id, modes: MODES,
      input: async () => redline(await buildRoundTripSide(c.original), await buildRoundTripSide(c.revised)),
      expected: { accept: () => buildRoundTripSide(c.revised), reject: () => buildRoundTripSide(c.original) },
    });
  }
}
const externalId = (file) => path.basename(file).replace(/\.docx$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-');
for (const file of values.fixture) {
  const abs = path.resolve(file);
  cases.push({ suite: 'external', id: externalId(abs), modes: MODES, input: () => readFile(abs) });
}
for (const spec of values.pair) {
  const [original, revised] = spec.split(',').map((p) => path.resolve(p));
  if (!original || !revised) throw new Error(`--pair takes ORIGINAL,REVISED (got ${spec})`);
  cases.push({
    suite: 'external-pair', id: `${externalId(original)}--${externalId(revised)}`, modes: MODES,
    input: async () => redline(await readFile(original), await readFile(revised)),
    expected: { accept: () => readFile(revised), reject: () => readFile(original) },
  });
}
if (values.only.length) {
  const keep = cases.filter((c) => values.only.some((needle) => c.id.includes(needle)));
  cases.splice(0, cases.length, ...keep);
}
if (cases.length === 0) throw new Error('nothing to run: choose a --suite or pass --fixture/--pair');

// ---- our implementations -----------------------------------------------------------------------
const implementations = [
  {
    name: 'docx-core',
    apply: async (input, mode) => {
      const doc = await DocxDocument.load(Buffer.from(input));
      if (mode === 'accept') await doc.acceptChanges(); else await doc.rejectChanges();
      return (await doc.toBuffer({ cleanBookmarks: true, fileDate: oracle.FIXED_ZIP_DATE })).buffer;
    },
  },
  {
    name: 'docx-compare',
    apply: (input, mode) => oracle.applyToStoryParts(input, mode === 'accept' ? acceptAllChanges : rejectAllChanges),
  },
];

// ---- run -----------------------------------------------------------------------------------------
const oracleDir = path.join(container, 'safe-docx-oracle');
const runDir = path.join(oracleDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
const cacheDir = path.join(oracleDir, 'cache');
const lockPath = oracle.wordOracleLockPath();
const started = Date.now();

console.log(`Word Accept/Reject oracle: Microsoft Word ${version}; ${cases.length} cases x ${MODES.length} modes`);
if (existsSync(lockPath)) {
  let holder = '';
  try { holder = ` (held by pid ${JSON.parse(readFileSync(lockPath, 'utf8')).pid})`; } catch { /* being written */ }
  console.log(`Waiting for the Word oracle lock ${lockPath}${holder}...`);
}

let result;
let exitCode;
let skipReason;
await oracle.withWordLock(async () => {
  const denied = await probeWordAutomation();
  if (denied) {
    const failure = oracle.classifyOsascriptFailure(denied);
    if (failure.kind === 'PERMISSION') { skipReason = failure.message; return; }
    console.error(`Word did not answer the automation probe: ${failure.kind}: ${failure.message}`);
    exitCode = 2;
    return;
  }
  await mkdir(runDir, { recursive: true });
  try {
    const word = createWordDriver({ runDir, cacheDir, version, refresh: values.refresh, timeoutSeconds, oracle, log: (l) => console.log(l) });
    result = await oracle.runAcceptRejectOracle({
      cases, word, implementations, knownDivergences: KNOWN_DIVERGENCES,
      onUnit: (unit, i, total) => console.log(oracle.formatUnitLine(unit, i, total)),
    });
  } finally {
    await closeRunDocuments(runDir);
    if (!values.keep) await removeRunDir(runDir);
    else console.log(`Kept staged inputs and Word outputs in ${runDir}`);
  }
}, { lockPath });
if (skipReason) skip(skipReason);

if (result) {
  console.log('');
  console.log(oracle.formatOracleReport(result, { wordVersion: version }));
  console.log(`\nFinished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (values.json) await writeFile(path.resolve(values.json), `${JSON.stringify({ wordVersion: version, ...result }, null, 2)}\n`);
  exitCode = oracle.oracleExitCode(result);
}
process.exit(exitCode ?? 2);
