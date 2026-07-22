#!/usr/bin/env node
// Drift gate for verification/INVARIANTS.md.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = path.join(REPO_ROOT, 'verification', 'INVARIANTS.md');

const before = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;
const gen = spawnSync(process.execPath, ['scripts/generate_invariants_doc.mjs'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});
if (gen.status !== 0) {
  console.error('check_invariants_doc: generator failed');
  process.exit(gen.status ?? 1);
}

const after = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;
if (before !== after) {
  console.error('\ncheck_invariants_doc: FAIL — generated output disagrees with the working tree.');
  console.error('Run `node scripts/generate_invariants_doc.mjs` and commit the result.');
  process.exit(1);
}

console.log('check_invariants_doc: OK');
