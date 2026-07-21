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
const REQUIRED_ELEMENT_ANCHORS = new Map(Object.entries({
  ins: ['ECMA-PART1-17-13-5'],
  del: ['ECMA-PART1-17-13-5'],
  rPrChange: ['ECMA-PART1-17-13-5-30', 'ECMA-PART1-17-13-5-31'],
  pPrChange: ['ECMA-PART1-17-13-5-29'],
  sectPrChange: ['ECMA-PART1-17-13-5-32'],
  tblGridChange: ['ECMA-PART1-17-13-5-33'],
  tblPrChange: ['ECMA-PART1-17-13-5-34'],
  tblPrExChange: ['ECMA-PART1-17-13-5-35'],
  tcPrChange: ['ECMA-PART1-17-13-5-36'],
  trPrChange: ['ECMA-PART1-17-13-5-37'],
  moveFrom: ['ECMA-PART1-17-13-5-21', 'ECMA-PART1-17-13-5-22'],
  moveFromRangeEnd: ['ECMA-PART1-17-13-5-23'],
  moveFromRangeStart: ['ECMA-PART1-17-13-5-24'],
  moveTo: ['ECMA-PART1-17-13-5-25', 'ECMA-PART1-17-13-5-26'],
  moveToRangeEnd: ['ECMA-PART1-17-13-5-27'],
  moveToRangeStart: ['ECMA-PART1-17-13-5-28'],
  numberingChange: ['ECMA-PART1-17-13-5'],
  cellDel: ['ECMA-PART1-17-13-5-1'],
  cellIns: ['ECMA-PART1-17-13-5-2'],
  cellMerge: ['ECMA-PART1-17-13-5-3'],
  customXmlDelRangeEnd: ['ECMA-PART1-17-13-5-4'],
  customXmlDelRangeStart: ['ECMA-PART1-17-13-5-5'],
  customXmlInsRangeEnd: ['ECMA-PART1-17-13-5-6'],
  customXmlInsRangeStart: ['ECMA-PART1-17-13-5-7'],
  customXmlMoveFromRangeEnd: ['ECMA-PART1-17-13-5-8'],
  customXmlMoveFromRangeStart: ['ECMA-PART1-17-13-5-9'],
  customXmlMoveToRangeEnd: ['ECMA-PART1-17-13-5-10'],
  customXmlMoveToRangeStart: ['ECMA-PART1-17-13-5-11'],
  bookmarkEnd: ['ECMA-PART1-17-13-6-1'],
  bookmarkStart: ['ECMA-PART1-17-13-6-2'],
  commentRangeEnd: ['ECMA-PART1-17-13-4-3'],
  commentRangeStart: ['ECMA-PART1-17-13-4-4'],
  commentReference: ['ECMA-PART1-17-13-4-5'],
  permEnd: ['ECMA-PART1-17-13-7-1'],
  permStart: ['ECMA-PART1-17-13-7-2'],
  proofErr: ['ECMA-PART1-17-13-8-1'],
}));
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

function literalProperty(object, name, sourceFile) {
  const property = object.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) &&
    ((ts.isIdentifier(candidate.name) && candidate.name.text === name) ||
      (ts.isStringLiteral(candidate.name) && candidate.name.text === name)),
  );
  if (!property || !ts.isPropertyAssignment(property)) return null;
  if (!ts.isStringLiteral(property.initializer) && !ts.isNoSubstitutionTemplateLiteral(property.initializer)) {
    throw new Error(`${sourceFile.fileName}: evidence ${name} must be a string literal`);
  }
  return property.initializer.text;
}

function literalArrayProperty(object, name, sourceFile) {
  const property = object.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === name,
  );
  if (!property || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) {
    throw new Error(`${sourceFile.fileName}: evidence ${name} must be a literal array`);
  }
  return property.initializer.elements.map((item) => {
    if (!ts.isStringLiteral(item) && !ts.isNoSubstitutionTemplateLiteral(item)) {
      throw new Error(`${sourceFile.fileName}: evidence ${name} entries must be string literals`);
    }
    return item.text;
  });
}

export function parseEvidenceTest(source, filename, evidenceId) {
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
  const claims = [];
  let declarationCount = 0;
  const collectClaims = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'revisionEvidence') {
      const [idArg, matrixArg] = node.arguments;
      if (!idArg || (!ts.isStringLiteral(idArg) && !ts.isNoSubstitutionTemplateLiteral(idArg))) {
        throw new Error(`${filename}: revisionEvidence id must be a string literal`);
      }
      if (idArg.text === evidenceId) {
        declarationCount += 1;
        if (!matrixArg || !ts.isObjectLiteralExpression(matrixArg)) {
          throw new Error(`${evidenceId}: revisionEvidence matrix must be an object literal`);
        }
        const elements = literalArrayProperty(matrixArg, 'elements', sourceFile);
        const operations = literalArrayProperty(matrixArg, 'operations', sourceFile);
        const defaultStory = literalProperty(matrixArg, 'story', sourceFile);
        const storiesProperty = matrixArg.properties.find((candidate) =>
          ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === 'stories',
        );
        const stories = new Map();
        if (storiesProperty && ts.isPropertyAssignment(storiesProperty)) {
          if (!ts.isObjectLiteralExpression(storiesProperty.initializer)) throw new Error(`${evidenceId}: stories must be an object literal`);
          for (const property of storiesProperty.initializer.properties) {
            if (!ts.isPropertyAssignment(property)) throw new Error(`${evidenceId}: invalid story mapping`);
            const element = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
            if (!element || (!ts.isStringLiteral(property.initializer) && !ts.isNoSubstitutionTemplateLiteral(property.initializer))) {
              throw new Error(`${evidenceId}: story mappings must use string literals`);
            }
            stories.set(element, property.initializer.text);
          }
        }
        const passed = matrixArg.properties.find((candidate) =>
            ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === 'passed',
        );
        if (!passed || !ts.isPropertyAssignment(passed) ||
            (!ts.isArrowFunction(passed.initializer) && !ts.isFunctionExpression(passed.initializer))) {
          throw new Error(`${evidenceId}: passed must be an executable callback`);
        }
        for (const element of elements) {
          const story = stories.get(element) ?? defaultStory;
          if (!story) throw new Error(`${evidenceId}: no story declared for ${element}`);
          for (const operation of operations) {
            claims.push({ element, operation, story });
          }
        }
      }
    }
    ts.forEachChild(node, collectClaims);
  };
  collectClaims(callback);
  if (declarationCount !== 1) throw new Error(`${evidenceId}: expected one structured revisionEvidence declaration`);
  return claims;
}

function claimKey({ element, operation, story }) {
  return `${element}\u0000${operation}\u0000${story}`;
}

async function validateEvidence(record, operationStatuses, declaredClaimsByEvidence) {
  const evidenceIds = new Set();
  const evidenceByOperation = new Map();
  for (const evidence of record.evidence ?? []) {
    if (!evidence.id || evidenceIds.has(evidence.id)) throw new Error(`${record.id}: duplicate or missing evidence id`);
    evidenceIds.add(evidence.id);
    for (const sourcePath of evidence.sources ?? []) await access(path.join(root, sourcePath));
    await access(path.join(root, evidence.test.path));
    const testSource = await readFile(path.join(root, evidence.test.path), 'utf8');
    const executableClaims = parseEvidenceTest(testSource, evidence.test.path, evidence.id);
    if (!executableClaims) throw new Error(`${evidence.id}: identifier is not attached to an executable test callback`);
    const expectedClaims = evidence.claims ?? [];
    const declaredClaims = declaredClaimsByEvidence.get(`${evidence.id}\u0000${evidence.test.path}`) ?? [];
    if (expectedClaims.length === 0) throw new Error(`${evidence.id}: structured claims are required`);
    const actualKeys = new Set(executableClaims.map(claimKey));
    const expectedKeys = new Set(expectedClaims.map(claimKey));
    const declaredKeys = new Set(declaredClaims.map(claimKey));
    if (actualKeys.size !== executableClaims.length) throw new Error(`${evidence.id}: duplicate executable evidence claim`);
    if (expectedKeys.size !== expectedClaims.length) throw new Error(`${evidence.id}: duplicate manifest evidence claim`);
    for (const claim of expectedClaims) {
      if (!record.elements.includes(claim.element)) throw new Error(`${evidence.id}: ${claim.element} is not classified by ${record.id}`);
      if (!operationStatuses.has(claim.operation)) throw new Error(`${evidence.id}: unknown operation ${claim.operation}`);
      if (!claim.story) throw new Error(`${evidence.id}: story is required`);
      if (!actualKeys.has(claimKey(claim))) {
        throw new Error(`${evidence.id}: missing executable claim for ${claim.element} ${claim.operation} ${claim.story}`);
      }
      const covered = evidenceByOperation.get(claim.operation) ?? new Set();
      covered.add(claim.element);
      evidenceByOperation.set(claim.operation, covered);
    }
    for (const claim of executableClaims) {
      if (!declaredKeys.has(claimKey(claim))) {
        throw new Error(`${evidence.id}: undeclared executable claim for ${claim.element} ${claim.operation} ${claim.story}`);
      }
    }
    for (const claim of declaredClaims) {
      if (!actualKeys.has(claimKey(claim))) {
        throw new Error(`${evidence.id}: missing executable claim for ${claim.element} ${claim.operation} ${claim.story}`);
      }
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
  if (manifest.schemaVersion !== 3) throw new Error('Unsupported advanced-revision manifest schemaVersion');
  if (!Array.isArray(manifest.records) || manifest.records.length === 0) throw new Error('Advanced-revision manifest has no records');

  const ids = new Set();
  const classifiedElements = new Set();
  const anchorsByElement = new Map();
  const declaredClaimsByEvidence = new Map();
  for (const record of manifest.records) {
    for (const evidence of record.evidence ?? []) {
      const key = `${evidence.id}\u0000${evidence.test?.path ?? ''}`;
      const claims = declaredClaimsByEvidence.get(key) ?? [];
      claims.push(...(evidence.claims ?? []));
      declaredClaimsByEvidence.set(key, claims);
    }
  }
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
      if (anchorsByElement.has(element)) {
        anchorsByElement.set(element, [...new Set([...anchorsByElement.get(element), ...elementAnchors])]);
      } else {
        anchorsByElement.set(element, [...elementAnchors]);
      }
      for (const registryId of elementAnchors) {
        if (!registryText.includes(`## [${registryId}]`)) throw new Error(`${record.id}: unknown registry id ${registryId}`);
      }
    }
    await validateEvidence(record, operationStatuses, declaredClaimsByEvidence);
  }

  const unclassified = vocabulary.filter((element) => !classifiedElements.has(element));
  if (unclassified.length > 0) throw new Error(`Unclassified revision vocabulary: ${unclassified.join(', ')}`);
  for (const [element, required] of REQUIRED_ELEMENT_ANCHORS) {
    const actual = [...new Set(anchorsByElement.get(element) ?? [])].sort();
    const expected = [...required].sort();
    if (actual.join('|') !== expected.join('|')) {
      throw new Error(`${element}: normative anchors must be ${expected.join(', ') || '(none)'}; found ${actual.join(', ') || '(none)'}`);
    }
  }

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
