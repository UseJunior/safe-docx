#!/usr/bin/env node
// check_tests_corpus_schema.mjs
//
// Drift gate for `tests-corpus.schema.json`. Renders the schema from the
// in-repo Zod source IN MEMORY and compares against the checked-in file
// contents. Must NOT write the schema to disk — the previous version did,
// which made the gate a no-op: it overwrote any stray edit before diffing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderTestsCorpusSchema } from './generate_tests_corpus_schema.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'tests-corpus.schema.json');

function main() {
  const expected = renderTestsCorpusSchema();
  let actual;
  try {
    actual = fs.readFileSync(SCHEMA_PATH, 'utf8');
  } catch (e) {
    console.error(`check_tests_corpus_schema: FAIL — ${path.relative(REPO_ROOT, SCHEMA_PATH)} is missing.`);
    console.error('Run `npm run generate:tests-corpus-schema` and commit the result.');
    process.exit(1);
  }
  if (actual === expected) {
    console.log('check_tests_corpus_schema: OK');
    return;
  }
  console.error(`check_tests_corpus_schema: FAIL — ${path.relative(REPO_ROOT, SCHEMA_PATH)} is stale.`);
  console.error('Run `npm run generate:tests-corpus-schema` and commit the result.');
  console.error('');
  console.error('First mismatch:');
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  for (let i = 0; i < Math.max(expectedLines.length, actualLines.length); i += 1) {
    if (expectedLines[i] !== actualLines[i]) {
      console.error(`  line ${i + 1}:`);
      console.error(`    - actual:   ${JSON.stringify(actualLines[i] ?? '<eof>')}`);
      console.error(`    + expected: ${JSON.stringify(expectedLines[i] ?? '<eof>')}`);
      break;
    }
  }
  process.exit(1);
}

main();
