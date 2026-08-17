#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { startBridge } from './bridge.mjs';
import { WordOracleJob, createCredentials, normalizeCompareOptions, sha256 } from './protocol.mjs';
import { embedAutoOpenAddin, stagedFileName } from './stage.mjs';

const { values } = parseArgs({
  options: {
    original: { type: 'string' }, revised: { type: 'string' }, output: { type: 'string' },
    cert: { type: 'string' }, key: { type: 'string' }, timeout: { type: 'string', default: '300' },
    author: { type: 'string' }, 'compare-formatting': { type: 'boolean', default: true },
    'no-open': { type: 'boolean', default: false },
  },
  strict: true,
});

for (const required of ['original', 'revised', 'output', 'cert', 'key']) {
  if (!values[required]) throw new Error(`--${required} is required`);
}

const paths = {
  original: resolve(values.original), revised: resolve(values.revised), output: resolve(values.output),
  cert: resolve(values.cert), key: resolve(values.key),
};
if (paths.output === paths.original || paths.output === paths.revised) {
  throw new Error('--output must not overwrite either source document');
}
await Promise.all([access(paths.original, constants.R_OK), access(paths.revised, constants.R_OK)]);
await mkdir(dirname(paths.output), { recursive: true });
const [originalBytes, revisedBytes] = await Promise.all([readFile(paths.original), readFile(paths.revised)]);
const startedAt = new Date().toISOString();
const credentials = createCredentials();
const stagingDir = await mkdtemp(`${tmpdir()}/safe-docx-word-oracle-`);

const options = normalizeCompareOptions({ authorName: values.author, compareFormatting: values['compare-formatting'] });
const job = new WordOracleJob({
  revisedBytes,
  original: { sha256: sha256(originalBytes), bytes: originalBytes.length, stagedFileName: 'pending.docx' },
  options,
  credentials,
});
const bridge = await startBridge({ job, certPath: paths.cert, keyPath: paths.key });
const bridgePort = Number(new URL(bridge.origin).port);
const stagedName = stagedFileName({ port: bridgePort, jobId: job.jobId, token: job.token, originalFileName: basename(paths.original) });
job.original.stagedFileName = stagedName;
const stagedOriginal = resolve(stagingDir, stagedName);
await writeFile(stagedOriginal, await embedAutoOpenAddin(originalBytes), { flag: 'wx' });
const connectUrl = `https://localhost:38491/taskpane.html#bridge=${encodeURIComponent(bridge.origin)}&job=${encodeURIComponent(job.jobId)}&token=${encodeURIComponent(job.token)}`;
const timeoutMs = parsePositiveSeconds(values.timeout) * 1000;

console.log(`Staged original (open this in Microsoft Word): ${stagedOriginal}`);
console.log(`Fallback task-pane job URL: ${connectUrl}`);
console.log('Waiting for Word; no keyboard or window-activation automation will be used.');
if (!values['no-open']) await openInWordBackground(stagedOriginal);

await waitForTerminal(job, timeoutMs);
await bridge.close();
if (job.status === 'succeeded') {
  const partial = `${paths.output}.partial-${job.jobId}`;
  await writeFile(partial, job.resultBytes, { flag: 'wx' });
  await rename(partial, paths.output);
}

const endedAt = new Date().toISOString();
const manifest = {
  schemaVersion: 1, protocolVersion: 1, jobId: job.jobId, status: job.status,
  startedAt, endedAt, options,
  inputs: {
    original: await fileDigest(paths.original),
    revised: await fileDigest(paths.revised),
  },
  output: job.status === 'succeeded' ? await fileDigest(paths.output) : null,
  word: job.host,
  diagnostic: job.failure,
};
await writeFile(`${paths.output}.word-oracle.json`, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });

const unchanged = sha256(originalBytes) === manifest.inputs.original.sha256 && sha256(revisedBytes) === manifest.inputs.revised.sha256;
if (!unchanged) throw new Error('source immutability check failed');
if (job.status !== 'succeeded') {
  console.error(`Word oracle ended with ${job.status}: ${job.failure?.code ?? 'TIMEOUT'}`);
  process.exitCode = 1;
} else {
  console.log(`Word comparison written to ${paths.output}`);
}

function parsePositiveSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--timeout must be a positive number of seconds');
  return seconds;
}

async function waitForTerminal(activeJob, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!['succeeded', 'failed'].includes(activeJob.status) && Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  if (!['succeeded', 'failed'].includes(activeJob.status)) activeJob.expire();
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  const details = await stat(path);
  return { sha256: sha256(bytes), bytes: details.size };
}

function openInWordBackground(path) {
  return new Promise((resolveOpen, rejectOpen) => {
    const child = spawn('open', ['-g', '-a', 'Microsoft Word', path], { stdio: 'ignore' });
    child.once('error', rejectOpen);
    child.once('exit', code => code === 0 ? resolveOpen() : rejectOpen(new Error(`macOS open exited with ${code}`)));
  });
}
