#!/usr/bin/env node
// check_conformance_doc.mjs
//
// Drift gate for the generated conformance artifacts. Runs
// `generate_conformance_doc.mjs`, then verifies that the generated outputs
// match the committed working tree. Fails if either:
//   - `spec-compliance/CONFORMANCE.md` differs from generator output, or
//   - the canonical `README.md` AUTO-GENERATED marker block differs from
//     generator output.
// Localized READMEs (`README.es.md`, `README.zh.md`, etc.) carry
// hand-translated static content and are NOT verified by this gate — see
// `generate_conformance_doc.mjs` for the rationale.
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
  // canonical English README receives the auto-generated marker block;
  // localized READMEs carry a static hand-translated link that points at
  // the canonical surface and is not part of the drift contract.
  const paths = [
    'spec-compliance/CONFORMANCE.md',
    'README.md',
  ];
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
