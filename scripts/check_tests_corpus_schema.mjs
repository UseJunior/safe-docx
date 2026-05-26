#!/usr/bin/env node
// check_tests_corpus_schema.mjs
//
// Drift gate for `tests-corpus.schema.json`. Regenerates the schema, then
// relies on `git diff --exit-code` to print a unified diff when the checked-in
// artifact is stale.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  const gen = spawnSync(process.execPath, ['scripts/generate_tests_corpus_schema.mjs'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (gen.status !== 0) {
    console.error('check_tests_corpus_schema: generator failed');
    process.exit(gen.status ?? 1);
  }

  const diff = spawnSync('git', ['diff', '--exit-code', '--', 'tests-corpus.schema.json'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (diff.status !== 0) {
    console.error('\ncheck_tests_corpus_schema: FAIL - generated schema disagrees with the working tree.');
    console.error('Run `node scripts/generate_tests_corpus_schema.mjs` and commit the result.');
    process.exit(diff.status ?? 1);
  }

  console.log('check_tests_corpus_schema: OK');
}

main();
