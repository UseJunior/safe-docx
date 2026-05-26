#!/usr/bin/env node
// check_test_narratives.mjs
//
// Validates static test narrative JSDoc tags for OpenSpec-mapped tests.
// The AST extraction stays purely static: it reads test source, joins
// immediately-leading JSDoc blocks to `.openspec(...)(...)` calls, and never
// evaluates code or follows imports.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractScenarios, validateTags } from '../packages/test-narrative/dist/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_GLOBS = [/^packages\/[^/]+\/src\/.*\.test\.ts$/, /^packages\/[^/]+\/test-primitives\/.*\.test\.ts$/];

const ERRORS = [];
function err(file, line, message) {
  ERRORS.push({ file, line, message });
}

function* walkFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      yield* walkFiles(full, predicate);
    } else if (predicate(full)) {
      yield full;
    }
  }
}

function listTestFiles() {
  const all = [];
  for (const file of walkFiles(REPO_ROOT, (f) => f.endsWith('.ts'))) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    if (TEST_GLOBS.some((re) => re.test(rel))) {
      all.push({ abs: file, rel });
    }
  }
  return all;
}

function lintTestFile(file) {
  let scenarios;
  try {
    scenarios = extractScenarios(file.abs);
  } catch (e) {
    err(file.rel, 1, `Parse error: ${e.message}`);
    return;
  }

  for (const scenario of scenarios) {
    const visibility = scenario.visibility ?? 'internal';
    if (visibility === 'public' && !scenario.narrative.motivatingProblem) {
      err(file.rel, scenario.sourceRef.line, '@motivatingProblem is required when visibility is public');
    }

    const result = validateTags(scenario.narrative, { visibility });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const tagPath = issue.path.length > 0 ? ` ${issue.path.join('.')}:` : '';
        err(file.rel, scenario.sourceRef.line, `Invalid narrative tag${tagPath} ${issue.message}`);
      }
    }
  }
}

function main() {
  const files = listTestFiles();
  for (const file of files) {
    lintTestFile(file);
  }

  if (ERRORS.length === 0) {
    console.log(`check_test_narratives: OK (${files.length} test files)`);
    process.exit(0);
  }
  for (const e of ERRORS) {
    console.error(`${e.file}:${e.line}: ${e.message}`);
  }
  console.error(`\ncheck_test_narratives: FAIL (${ERRORS.length} issue${ERRORS.length === 1 ? '' : 's'})`);
  process.exit(1);
}

main();
