#!/usr/bin/env node

/**
 * Offline schema/shape validator for changelog.json.
 *
 * Validates that the changelog data file exists and matches the expected schema.
 * No network calls — runs entirely offline for local developer flow.
 *
 * Usage:
 *   node scripts/check_changelog_data.mjs
 *   node scripts/check_changelog_data.mjs --input site/src/_data/changelog.json
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  let inputPath = resolve(REPO_ROOT, 'site', 'src', '_data', 'changelog.json');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input') {
      const value = args[i + 1];
      if (!value) throw new Error('--input requires a path value');
      inputPath = resolve(process.cwd(), value);
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${args[i]}`);
  }

  return { inputPath };
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  const { inputPath } = parseArgs();

  if (!existsSync(inputPath)) {
    fail(`changelog.json not found at ${inputPath}`);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  } catch (err) {
    fail(`changelog.json is not valid JSON: ${err.message}`);
  }

  // Top-level shape
  if (!('generated_at_utc' in data)) {
    fail('Missing required field: generated_at_utc');
  }

  if (!Array.isArray(data.releases)) {
    fail('Field "releases" must be an array');
  }

  // Per-release shape
  const requiredFields = ['tag', 'version', 'published_at', 'url', 'body_md'];

  for (let i = 0; i < data.releases.length; i++) {
    const release = data.releases[i];
    for (const field of requiredFields) {
      if (!(field in release)) {
        fail(`releases[${i}] is missing required field: ${field}`);
      }
    }
  }

  const relative = inputPath.replace(REPO_ROOT + '/', '');
  console.log(`OK: ${relative} — valid schema (${data.releases.length} release(s))`);
}

main();
