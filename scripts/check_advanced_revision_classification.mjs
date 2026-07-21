import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'spec-compliance/manifests/ecma-376-advanced-revisions.json');
const vocabularyPath = path.join(root, 'packages/docx-core/src/primitives/revision-vocabulary.ts');
const registryPath = path.join(root, 'spec-compliance/registry/ecma-376.md');
const leanLedgerPath = path.join(root, 'verification/registry/lean-xml-checker-coverage.json');

const ALLOWED_STATUSES = new Set(['implemented', 'preservation-only', 'conformance-gap', 'non-goal']);
const REQUIRED_MODE_PATHS = ['comparison.inplace', 'comparison.rebuild', 'reconstruction.inplace', 'reconstruction.rebuild'];
const REQUIRED_NORMATIVE_ANCHORS = new Set([
  ...Array.from({ length: 3 }, (_, index) => `ECMA-PART1-17-13-5-${index + 1}`),
  ...Array.from({ length: 8 }, (_, index) => `ECMA-PART1-17-13-5-${index + 4}`),
  ...Array.from({ length: 8 }, (_, index) => `ECMA-PART1-17-13-5-${index + 21}`),
  'ECMA-PART1-17-13-5-30',
  'ECMA-PART1-17-13-5-34',
  'ECMA-PART1-17-13-5-36',
]);
const LEAN_PROJECTED_ELEMENTS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

export function parseRevisionVocabulary(source) {
  const sourceFile = ts.createSourceFile('revision-vocabulary.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const wanted = new Set(['TRACKED_CHANGE_ELEMENT_NAMES', 'REVISION_RANGE_ELEMENT_NAMES']);
  const found = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !wanted.has(declaration.name.text)) continue;
      let initializer = declaration.initializer;
      while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))) initializer = initializer.expression;
      if (!initializer || !ts.isArrayLiteralExpression(initializer)) throw new Error(`${declaration.name.text} must remain a literal array`);
      found.set(declaration.name.text, initializer.elements.map((element) => {
        if (!ts.isStringLiteral(element)) throw new Error(`${declaration.name.text} contains a non-string element`);
        return element.text;
      }));
    }
  }
  if (found.size !== wanted.size) throw new Error('Unable to parse both revision vocabulary arrays');
  return [...found.get('TRACKED_CHANGE_ELEMENT_NAMES'), ...found.get('REVISION_RANGE_ELEMENT_NAMES')];
}

function flattenStatuses(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value ?? {})) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') out.set(childPath, child);
    else if (child && typeof child === 'object' && !Array.isArray(child)) flattenStatuses(child, childPath, out);
    else throw new Error(`Invalid operation value at ${childPath}`);
  }
  return out;
}

function findEvidenceTest(source, filename, evidenceId) {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let callback = null;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      const [title, body] = node.arguments;
      if ((ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) &&
          title.text.includes(`[${evidenceId}]`) &&
          (ts.isArrowFunction(body) || ts.isFunctionExpression(body))) {
        if (callback) throw new Error(`${evidenceId}: duplicate executable test identifiers`);
        callback = body;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!callback) return null;
  const literals = [];
  const collectLiterals = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      literals.push(node.text);
    }
    ts.forEachChild(node, collectLiterals);
  };
  collectLiterals(callback);
  return { body: callback.getText(sourceFile), literals };
}

async function validateEvidence(record, operationStatuses) {
  const evidenceIds = new Set();
  const evidenceByOperation = new Map();
  for (const evidence of record.evidence ?? []) {
    if (!evidence.id || evidenceIds.has(evidence.id)) throw new Error(`${record.id}: duplicate or missing evidence id`);
    evidenceIds.add(evidence.id);
    if (!Array.isArray(evidence.operations) || evidence.operations.length === 0) throw new Error(`${evidence.id}: operations are required`);
    if (!Array.isArray(evidence.elements) || evidence.elements.length === 0) throw new Error(`${evidence.id}: element assertions are required`);
    for (const element of evidence.elements) {
      if (!record.elements.includes(element)) throw new Error(`${evidence.id}: ${element} is not classified by ${record.id}`);
    }
    for (const sourcePath of evidence.sources ?? []) await access(path.join(root, sourcePath));
    await access(path.join(root, evidence.test.path));
    const testSource = await readFile(path.join(root, evidence.test.path), 'utf8');
    const executableTest = findEvidenceTest(testSource, evidence.test.path, evidence.id);
    if (!executableTest) throw new Error(`${evidence.id}: identifier is not attached to an executable test callback`);
    const { body, literals } = executableTest;
    if (!/\bexpect\s*\(/.test(body)) throw new Error(`${evidence.id}: test callback has no assertion`);
    for (const token of evidence.assertedTokens ?? evidence.elements) {
      if (!literals.some((literal) => literal.includes(token))) {
        throw new Error(`${evidence.id}: test callback does not name asserted token ${token}`);
      }
    }
    for (const operation of evidence.operations) {
      if (!operationStatuses.has(operation)) throw new Error(`${evidence.id}: unknown operation ${operation}`);
      const covered = evidenceByOperation.get(operation) ?? new Set();
      for (const element of evidence.elements) covered.add(element);
      evidenceByOperation.set(operation, covered);
    }
  }

  for (const [operation, status] of operationStatuses) {
    if (!ALLOWED_STATUSES.has(status)) throw new Error(`${record.id}: invalid ${operation} status ${status}`);
    if (status === 'non-goal' || operation.startsWith('lean.')) continue;
    const covered = evidenceByOperation.get(operation) ?? new Set();
    const missing = record.elements.filter((element) => !covered.has(element));
    if (missing.length > 0) throw new Error(`${record.id}: ${operation} lacks element-specific evidence for ${missing.join(', ')}`);
  }
}

export async function validateAdvancedRevisionClassification(manifest, vocabulary, registryText, leanLedger) {
  if (manifest.schemaVersion !== 2) throw new Error('Unsupported advanced-revision manifest schemaVersion');
  if (!Array.isArray(manifest.records) || manifest.records.length === 0) throw new Error('Advanced-revision manifest has no records');

  const ids = new Set();
  const classifiedElements = new Set();
  const referencedAnchors = new Set();
  for (const record of manifest.records) {
    if (ids.has(record.id)) throw new Error(`Duplicate advanced-revision record id: ${record.id}`);
    ids.add(record.id);
    if (!ALLOWED_STATUSES.has(record.classification)) throw new Error(`${record.id}: invalid classification ${record.classification}`);
    const operationStatuses = flattenStatuses(record.operations);
    for (const requiredPath of REQUIRED_MODE_PATHS) {
      if (!operationStatuses.has(requiredPath)) throw new Error(`${record.id}: missing explicit ${requiredPath} classification`);
    }
    if (operationStatuses.get('lean.advancedRecordSemantics') !== 'non-goal') {
      throw new Error(`${record.id}: Lean does not verify advanced-record semantics`);
    }
    const leanProjection = operationStatuses.get('lean.textFieldProjection');
    if (!ALLOWED_STATUSES.has(leanProjection)) throw new Error(`${record.id}: missing Lean text/field projection status`);
    if (leanProjection === 'implemented' && record.elements.some((element) => !LEAN_PROJECTED_ELEMENTS.has(element))) {
      throw new Error(`${record.id}: Lean projection is limited to ins/del/moveFrom/moveTo`);
    }

    for (const element of record.elements ?? []) {
      if (!element.includes(' ') && !element.includes(':')) classifiedElements.add(element);
      const elementAnchors = record.normativeSections?.[element] ?? [];
      for (const registryId of elementAnchors) {
        if (!registryText.includes(`## [${registryId}]`)) throw new Error(`${record.id}: unknown registry id ${registryId}`);
        referencedAnchors.add(registryId);
      }
    }
    await validateEvidence(record, operationStatuses);
  }

  const unclassified = vocabulary.filter((element) => !classifiedElements.has(element));
  if (unclassified.length > 0) throw new Error(`Unclassified revision vocabulary: ${unclassified.join(', ')}`);
  const missingAnchors = [...REQUIRED_NORMATIVE_ANCHORS].filter((id) => !referencedAnchors.has(id));
  if (missingAnchors.length > 0) throw new Error(`Missing normative advanced-revision anchors: ${missingAnchors.join(', ')}`);

  if ((manifest.storyScope?.leanReads ?? []).join('|') !== 'word/document.xml|word/footnotes.xml|word/endnotes.xml') {
    throw new Error('Lean advanced-revision scope must remain the exact fixed-story input set');
  }
  for (const element of LEAN_PROJECTED_ELEMENTS) {
    if (!leanLedger.parsedWordprocessingML?.elements?.includes(`w:${element}`)) {
      throw new Error(`Lean ledger no longer lists projected element w:${element}`);
    }
  }
}

export async function main() {
  const [manifest, vocabularySource, registryText, leanLedger] = await Promise.all([
    readFile(manifestPath, 'utf8').then(JSON.parse),
    readFile(vocabularyPath, 'utf8'),
    readFile(registryPath, 'utf8'),
    readFile(leanLedgerPath, 'utf8').then(JSON.parse),
  ]);
  await validateAdvancedRevisionClassification(manifest, parseRevisionVocabulary(vocabularySource), registryText, leanLedger);
  console.log(`check_advanced_revision_classification: OK (${manifest.records.length} records)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
