#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TEST_PATH_RE = /^packages\/[^/]+\/(src|test)\/.+\.test\.ts$/;

const helperImportRe = /from\s+['"][^'"]*allure-test\.(?:js|ts)['"]/;
const wrapperReferenceRe = /\b(itAllure|testAllure)\b/;
const epicWrapperAssignmentRe =
  /(?:const|let|var)\s+\w+\s*=\s*(?:itAllure|testAllure)\.(?:epic\(\s*['"`][^'"`]+['"`]\s*\)|withLabels\(\s*\{[\s\S]*?\bepic\s*:)/m;
const inlineEpicUsageRe =
  /\b(?:itAllure|testAllure)\.epic\(\s*['"`][^'"`]+['"`]\s*\)\s*\(/;
const inlineWithLabelsEpicUsageRe =
  /\b(?:itAllure|testAllure)\.withLabels\(\s*\{[\s\S]*?\bepic\s*:/m;
const directEpicUsageRe = /\ballure\.epic\(/;
const featureAssignmentRe =
  /\.withLabels\(\s*\{[\s\S]*?\bfeature\s*:/m;
const directFeatureUsageRe = /\ballure\.feature\(/;
const openSpecFeatureConstRe = /const\s+TEST_FEATURE\s*=\s*['"`][^'"`]+['"`]/;

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      walk(absolute, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.test.ts')) continue;
    const relative = absolute.slice(`${ROOT}/`.length);
    if (TEST_PATH_RE.test(relative)) out.push(relative);
  }
}

function discoverTestFiles() {
  const files = [];
  walk(join(ROOT, 'packages'), files);
  return [...new Set(files)].sort();
}

function normalizeInputFiles(rawFiles) {
  const normalized = rawFiles
    .map((file) => file.trim())
    .filter((file) => file.length > 0)
    .map((file) => file.replace(/^\.\//, ''))
    .filter((file) => TEST_PATH_RE.test(file));
  return [...new Set(normalized)].sort();
}

function parseVitestImports(body) {
  const imports = [];
  const vitestImportRe = /import\s*\{([^}]*)\}\s*from\s*['"]vitest['"]/g;
  let match = vitestImportRe.exec(body);
  while (match) {
    imports.push(
      ...match[1]
        .split(',')
        .map((specifier) => specifier.trim())
        .filter(Boolean)
        .map((specifier) => specifier.split(/\s+as\s+/)[0]?.trim())
        .filter(Boolean),
    );
    match = vitestImportRe.exec(body);
  }
  return imports;
}

function validateFile(relativePath) {
  const absolutePath = join(ROOT, relativePath);
  const body = readFileSync(absolutePath, 'utf-8');
  const errors = [];
  const isAllureFile = relativePath.endsWith('.allure.test.ts');
  const isOpenSpecTraceabilityFile = /OpenSpec Traceability/.test(body);

  if (!helperImportRe.test(body)) {
    errors.push('must import the shared Allure helper (`allure-test`).');
  }

  if (!wrapperReferenceRe.test(body)) {
    errors.push('must reference `itAllure` or `testAllure`.');
  }

  if (isAllureFile) {
    const hasEpicAssignment =
      epicWrapperAssignmentRe.test(body)
      || inlineEpicUsageRe.test(body)
      || inlineWithLabelsEpicUsageRe.test(body)
      || directEpicUsageRe.test(body);
    if (!hasEpicAssignment) {
      errors.push('`*.allure.test.ts` must assign an explicit epic using `.epic(...)` or `.withLabels({ epic: ... })`.');
    }

    if (!(featureAssignmentRe.test(body) || directFeatureUsageRe.test(body))) {
      errors.push('`*.allure.test.ts` must assign a feature label using `.withLabels({ feature: ... })`.');
    }
  }

  const vitestImports = parseVitestImports(body);
  if (vitestImports.includes('it') || vitestImports.includes('test')) {
    errors.push('must not import plain `it`/`test` from `vitest`; use Allure wrappers.');
  }

  if (isOpenSpecTraceabilityFile && !openSpecFeatureConstRe.test(body)) {
    errors.push('OpenSpec traceability tests must declare `const TEST_FEATURE = ...` for deterministic mapping.');
  }

  return errors;
}

const cliFiles = normalizeInputFiles(process.argv.slice(2));
const filesToCheck = cliFiles.length > 0 ? cliFiles : discoverTestFiles();

if (filesToCheck.length === 0) {
  process.exit(0);
}

const failures = [];
for (const file of filesToCheck) {
  const errors = validateFile(file);
  if (errors.length > 0) {
    failures.push({ file, errors });
  }
}

if (failures.length > 0) {
  console.error('Allure label coverage check failed.\n');
  for (const failure of failures) {
    console.error(`- ${failure.file}`);
    for (const error of failure.errors) {
      console.error(`  - ${error}`);
    }
  }
  console.error('\nExpected outcome: tests emit Epic/Feature/Story via shared wrappers for Allure v3.');
  process.exit(1);
}
