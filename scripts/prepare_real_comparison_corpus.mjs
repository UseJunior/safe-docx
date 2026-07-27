#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
const MANIFEST_PATH = join(
  PROJECT_ROOT,
  'packages/docx-compare/src/integration/real-corpus-manifest.json',
);
const destinationRoot = process.argv[2];

if (!destinationRoot) {
  console.error(
    'Usage: node scripts/prepare_real_comparison_corpus.mjs <corpus-cache-directory>',
  );
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function downloadWithRetry(entry) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(entry.sourceUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      console.warn(
        `[real-comparison-corpus] ${entry.id} download attempt ${attempt}/3 failed: ${error}`,
      );
    }
  }
  throw lastError;
}

for (const entry of manifest) {
  const destination = join(destinationRoot, entry.id, 'source.docx');
  if (existsSync(destination)) {
    const cached = readFileSync(destination);
    if (sha256(cached) === entry.sha256) {
      console.log(`[real-comparison-corpus] verified cached ${entry.id}`);
      continue;
    }
    console.warn(
      `[real-comparison-corpus] cached ${entry.id} failed SHA-256 verification; downloading again`,
    );
  }

  console.log(`[real-comparison-corpus] downloading ${entry.id}`);
  const downloaded = await downloadWithRetry(entry);
  const actualSha256 = sha256(downloaded);
  if (actualSha256 !== entry.sha256) {
    throw new Error(
      `${entry.id} SHA-256 mismatch: expected ${entry.sha256}, received ${actualSha256}`,
    );
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, downloaded);
  console.log(`[real-comparison-corpus] cached verified ${entry.id}`);
}
