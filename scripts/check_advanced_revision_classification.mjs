import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'spec-compliance/manifests/ecma-376-advanced-revisions.json');
const vocabularyPath = path.join(root, 'packages/docx-core/src/primitives/revision-vocabulary.ts');
const registryPath = path.join(root, 'spec-compliance/registry/ecma-376.md');

const ALLOWED_STATUSES = new Set(['implemented', 'preservation-only', 'conformance-gap', 'non-goal']);
const REQUIRED_ISSUE_ANCHORS = new Set([
  'ECMA-PART1-17-13-5-21',
  'ECMA-PART1-17-13-5-30',
  'ECMA-PART1-17-13-5-34',
  'ECMA-PART1-17-13-5-36',
]);

export function parseRevisionVocabulary(source) {
  const sourceFile = ts.createSourceFile(
    'revision-vocabulary.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const wanted = new Set(['TRACKED_CHANGE_ELEMENT_NAMES', 'REVISION_RANGE_ELEMENT_NAMES']);
  const found = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !wanted.has(declaration.name.text)) continue;
      let initializer = declaration.initializer;
      while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))) {
        initializer = initializer.expression;
      }
      if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
        throw new Error(`${declaration.name.text} must remain a literal array`);
      }
      found.set(declaration.name.text, initializer.elements.map((element) => {
        if (!ts.isStringLiteral(element)) throw new Error(`${declaration.name.text} contains a non-string element`);
        return element.text;
      }));
    }
  }
  if (found.size !== wanted.size) throw new Error('Unable to parse both revision vocabulary arrays');
  return [...found.get('TRACKED_CHANGE_ELEMENT_NAMES'), ...found.get('REVISION_RANGE_ELEMENT_NAMES')];
}

export async function validateAdvancedRevisionClassification(manifest, vocabulary, registryText) {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported advanced-revision manifest schemaVersion');
  if (!Array.isArray(manifest.records) || manifest.records.length === 0) throw new Error('Advanced-revision manifest has no records');

  const ids = new Set();
  const classifiedElements = new Set();
  const referencedAnchors = new Set();
  for (const record of manifest.records) {
    if (ids.has(record.id)) throw new Error(`Duplicate advanced-revision record id: ${record.id}`);
    ids.add(record.id);
    if (!ALLOWED_STATUSES.has(record.classification)) throw new Error(`${record.id}: invalid classification ${record.classification}`);
    for (const [operation, status] of Object.entries(record.operations ?? {})) {
      if (!ALLOWED_STATUSES.has(status)) throw new Error(`${record.id}: invalid ${operation} status ${status}`);
    }
    for (const element of record.elements ?? []) {
      if (!element.includes(' ') && !element.includes(':')) classifiedElements.add(element);
    }
    for (const registryId of record.registryIds ?? []) {
      if (!registryText.includes(`## [${registryId}]`)) throw new Error(`${record.id}: unknown registry id ${registryId}`);
      referencedAnchors.add(registryId);
    }
    if (Object.values(record.operations ?? {}).includes('implemented')) {
      const evidence = record.evidence ?? [];
      if (!evidence.some((entry) => entry.endsWith('.test.ts') || entry.endsWith('.test.mjs'))) {
        throw new Error(`${record.id}: implemented operations require executable test evidence`);
      }
      if (!evidence.some((entry) => !entry.includes('.test.'))) {
        throw new Error(`${record.id}: implemented operations require production source evidence`);
      }
    }
    for (const evidence of record.evidence ?? []) await access(path.join(root, evidence));
  }

  const unclassified = vocabulary.filter((element) => !classifiedElements.has(element));
  if (unclassified.length > 0) throw new Error(`Unclassified revision vocabulary: ${unclassified.join(', ')}`);
  const missingAnchors = [...REQUIRED_ISSUE_ANCHORS].filter((id) => !referencedAnchors.has(id));
  if (missingAnchors.length > 0) throw new Error(`Missing issue #565 registry anchors: ${missingAnchors.join(', ')}`);

  const leanScope = manifest.storyScope?.leanReads ?? [];
  if (leanScope.join('|') !== 'word/document.xml|word/footnotes.xml|word/endnotes.xml') {
    throw new Error('Lean advanced-revision scope must remain the exact fixed-story input set');
  }
  for (const record of manifest.records) {
    if (record.operations?.lean !== 'non-goal') throw new Error(`${record.id}: advanced revision semantics are not Lean-verified`);
  }
}

export async function main() {
  const [manifest, vocabularySource, registryText] = await Promise.all([
    readFile(manifestPath, 'utf8').then(JSON.parse),
    readFile(vocabularyPath, 'utf8'),
    readFile(registryPath, 'utf8'),
  ]);
  await validateAdvancedRevisionClassification(manifest, parseRevisionVocabulary(vocabularySource), registryText);
  console.log(`check_advanced_revision_classification: OK (${manifest.records.length} records)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
