#!/usr/bin/env node
// check_conformance_doc.mjs
//
// Drift gate for the generated conformance artifacts. Runs
// `generate_conformance_doc.mjs`, then verifies that the generated outputs
// match the committed working tree. Fails if
// `spec-compliance/CONFORMANCE.md` differs from generator output.
// Mirrors the package-script pattern used by `check:tool-docs` and
// `check:trust-metrics`.

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run() {
  // 1. Regenerate.
  const gen = spawnSync(process.execPath, ['scripts/generate_conformance_doc.mjs'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (gen.status !== 0) {
    console.error('check_conformance_doc: generator failed');
    process.exit(gen.status ?? 1);
  }

  // 2. Diff the working tree against HEAD for the relevant paths. Only the
  const paths = ['spec-compliance/CONFORMANCE.md'];
  const diff = spawnSync('git', ['diff', '--exit-code', '--', ...paths], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (diff.status !== 0) {
    console.error('\ncheck_conformance_doc: FAIL — generated outputs disagree with the working tree.');
    console.error('Run `node scripts/generate_conformance_doc.mjs` and commit the result.');
    process.exit(diff.status ?? 1);
  }

  console.log('check_conformance_doc: OK');
}

run();
