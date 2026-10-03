#!/usr/bin/env node
/**
 * Fetch the SHA-256-pinned differential-testing corpus into a local cache.
 *
 * Extends the `scripts/prepare_real_comparison_corpus.mjs` pattern: the committed
 * artifact is `differential-corpus-manifest.json` (hashes, URLs, licenses, and the
 * derived feature index produced by `classify_docx_features.mjs`); document BYTES are
 * never committed and are cached only under the directory given on the command line
 * (conventionally exported as `SAFE_DOCX_DIFF_CORPUS_DIR`).
 *
 * Sources and their resolution:
 *   - https URLs           downloaded (3 attempts), SHA-256 verified, cached as
 *                          `<cache>/<source>/<sha256>.docx`.
 *   - docx-platform-tests: copied from a local clone; set DOCX_PLATFORM_TESTS_DIR
 *                          (the repo is not publicly fetchable).
 *   - container: "zip"     the archive is downloaded + verified, then its members are
 *                          extracted under `<cache>/<source>/`.
 *
 * Licensing note (see the corpus report): only open-agreements (CC-BY-4.0),
 * docx-platform-tests (Apache-2.0), and open-xml-sdk (MIT) grant redistribution of the
 * documents themselves. The LibreOffice fuzzer seeds and the SuperDoc docx-corpus
 * entries are LOCAL TESTING ONLY: their collection licenses (MPL-2.0 / ODC-BY) do not
 * establish rights in the underlying third-party documents, so nothing beyond hash,
 * URL, and derived feature flags may enter the repository for them.
 *
 * Usage:
 *   node scripts/corpus/fetch_differential_corpus.mjs "$SAFE_DOCX_DIFF_CORPUS_DIR" [--source NAME]
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(SCRIPT_DIR, 'differential-corpus-manifest.json');

const args = process.argv.slice(2);
const destinationRoot = args[0];
const sourceFilter = (() => {
  const i = args.indexOf('--source');
  return i >= 0 ? args[i + 1] : null;
})();

if (!destinationRoot) {
  console.error('Usage: node scripts/corpus/fetch_differential_corpus.mjs <corpus-cache-directory> [--source NAME]');
  process.exit(2);
}

const SOURCE_DIRS = {
  'open-agreements': 'open-agreements',
  'docx-platform-tests': 'docx-platform-tests',
  'open-xml-sdk': 'open-xml-sdk',
  'superdoc-docx-corpus': 'superdoc',
  'libreoffice-fuzzer-seeds': 'lo-fuzz-seeds',
};

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function downloadWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      console.warn(`[diff-corpus] download attempt ${attempt}/3 failed: ${error}`);
    }
  }
  throw lastError;
}

async function resolveBytes(entry) {
  if (entry.url.startsWith('docx-platform-tests:')) {
    const root = process.env.DOCX_PLATFORM_TESTS_DIR;
    if (!root) throw new Error(`${entry.id}: set DOCX_PLATFORM_TESTS_DIR to a local docx-platform-tests clone`);
    const rel = entry.url.slice('docx-platform-tests:'.length).split('@')[0];
    return readFileSync(join(root, rel));
  }
  return downloadWithRetry(entry.url);
}

let verified = 0;
let fetched = 0;
let failed = 0;

for (const entry of manifest) {
  if (sourceFilter && entry.source !== sourceFilter) continue;
  const dir = join(destinationRoot, SOURCE_DIRS[entry.source] ?? entry.source);
  const ext = entry.container === 'zip' ? 'zip' : 'docx';
  const destination = join(dir, `${entry.sha256}.${ext}`);
  if (existsSync(destination) && sha256(readFileSync(destination)) === entry.sha256) {
    verified += 1;
    continue;
  }
  let bytes;
  try {
    bytes = await resolveBytes(entry);
  } catch (error) {
    failed += 1;
    console.error(`[diff-corpus] ${entry.id}: fetch failed: ${error}`);
    continue;
  }
  const actual = sha256(bytes);
  if (actual !== entry.sha256) {
    failed += 1;
    console.error(`[diff-corpus] ${entry.id}: SHA-256 mismatch (expected ${entry.sha256}, got ${actual}); refusing to cache`);
    continue;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(destination, bytes);
  if (entry.container === 'zip') {
    const zip = await JSZip.loadAsync(bytes);
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const memberPath = join(dir, name.replaceAll('..', '_'));
      mkdirSync(dirname(memberPath), { recursive: true });
      writeFileSync(memberPath, await file.async('nodebuffer'));
    }
  }
  fetched += 1;
  console.log(`[diff-corpus] cached verified ${entry.id}`);
}

console.log(`[diff-corpus] done: ${verified} verified in cache, ${fetched} fetched, ${failed} failed`);
if (failed > 0) process.exit(1);
