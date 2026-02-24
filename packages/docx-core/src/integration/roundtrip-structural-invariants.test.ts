/**
 * Structural Round-Trip Invariants (first pass)
 *
 * Focus:
 * 1) Golden corpus parity for core OOXML parts.
 * 2) Numbering reference integrity.
 * 3) Footnote/endnote reference integrity.
 * 4) Bookmark start/end ID integrity.
 */

import { describe, expect, beforeAll } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { compareDocuments } from '../index.js';
import { DocxArchive, DOCX_PATHS } from '../shared/docx/DocxArchive.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  compareTexts,
  rejectAllChanges,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';
import { parseDocumentXml } from '../baselines/atomizer/xmlToWmlElement.js';
import { findAllByTagName, childElements } from '../primitives/index.js';

type ReconstructionMode = 'rebuild' | 'inplace';

interface RoundTripArtifacts {
  originalArchive: DocxArchive;
  revisedArchive: DocxArchive;
  resultArchive: DocxArchive;
  acceptedArchive: DocxArchive;
  rejectedArchive: DocxArchive;
}

interface NumberingDiagnostics {
  missingNumIds: string[];
  missingAbstractNumIds: string[];
  invalidLevels: string[];
}

interface NoteDiagnostics {
  missingFootnoteRefs: string[];
  missingEndnoteRefs: string[];
  duplicateFootnoteIds: string[];
  duplicateEndnoteIds: string[];
}

interface BookmarkDiagnostics {
  unmatchedStartIds: string[];
  unmatchedEndIds: string[];
  duplicateStartIds: string[];
  duplicateEndIds: string[];
}

const MODES: ReconstructionMode[] = ['rebuild', 'inplace'];
const CORE_PARTS = [
  DOCX_PATHS.DOCUMENT,
  DOCX_PATHS.NUMBERING,
  DOCX_PATHS.FOOTNOTES,
  DOCX_PATHS.ENDNOTES,
  DOCX_PATHS.RELS,
] as const;
const NON_DOCUMENT_CORE_PARTS = CORE_PARTS.filter((part) => part !== DOCX_PATHS.DOCUMENT);

const VOLATILE_ATTRS = new Set([
  'w:rsidR',
  'w:rsidRPr',
  'w:rsidRDefault',
  'w:rsidP',
  'w14:paraId',
  'w14:textId',
]);

const integrationDir = dirname(import.meta.url.replace('file://', ''));
const projectRoot = join(integrationDir, '../../../..');

const SYNTHETIC_CORE_ORIGINAL_DOC = join(
  integrationDir,
  '../testing/fixtures/split-run-boundary-change/original.docx'
);
const SYNTHETIC_CORE_REVISED_DOC = join(
  integrationDir,
  '../testing/fixtures/split-run-boundary-change/revised.docx'
);

const ILPA_ORIGINAL_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx'
);
const ILPA_REVISED_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx'
);

async function getArchivePart(archive: DocxArchive, path: string): Promise<string | null> {
  if (path === DOCX_PATHS.DOCUMENT) {
    return archive.getDocumentXml();
  }
  return archive.getFile(path);
}

async function buildRoundTripArtifacts(
  originalBuffer: Buffer,
  revisedBuffer: Buffer,
  mode: ReconstructionMode
): Promise<RoundTripArtifacts> {
  const result = await compareDocuments(originalBuffer, revisedBuffer, {
    engine: 'atomizer',
    reconstructionMode: mode,
  });

  const originalArchive = await DocxArchive.load(originalBuffer);
  const revisedArchive = await DocxArchive.load(revisedBuffer);
  const resultArchive = await DocxArchive.load(result.document);

  const resultDocumentXml = await resultArchive.getDocumentXml();
  const acceptedDocumentXml = acceptAllChanges(resultDocumentXml);
  const rejectedDocumentXml = rejectAllChanges(resultDocumentXml);

  const acceptedArchive = await resultArchive.clone();
  acceptedArchive.setDocumentXml(acceptedDocumentXml);

  const rejectedArchive = await resultArchive.clone();
  rejectedArchive.setDocumentXml(rejectedDocumentXml);

  return {
    originalArchive,
    revisedArchive,
    resultArchive,
    acceptedArchive,
    rejectedArchive,
  };
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function canonicalizeNode(node: Node): string {
  if (node.nodeType === 9) { // Document
    const parts: string[] = [];
    for (let i = 0; i < node.childNodes.length; i++) parts.push(canonicalizeNode(node.childNodes[i]!));
    return parts.join('');
  }
  if (node.nodeType === 7) { // Processing instruction
    const pi = node as ProcessingInstruction;
    return pi.data ? `<?${pi.target} ${pi.data}?>` : `<?${pi.target}?>`;
  }
  if (node.nodeType === 3) { // Text node
    return escapeXml(node.nodeValue ?? '');
  }
  if (node.nodeType !== 1) return ''; // Skip other node types

  const el = node as Element;
  const attrList: [string, string][] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!;
    if (!VOLATILE_ATTRS.has(attr.name)) attrList.push([attr.name, attr.value]);
  }
  attrList.sort(([a], [b]) => a.localeCompare(b));
  const attrs = attrList.map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ');

  const openTag = attrs ? `<${el.tagName} ${attrs}>` : `<${el.tagName}>`;
  const closeTag = `</${el.tagName}>`;

  const childParts: string[] = [];
  for (let i = 0; i < el.childNodes.length; i++) childParts.push(canonicalizeNode(el.childNodes[i]!));
  const childContent = childParts.join('');

  if (!childContent) return attrs ? `<${el.tagName} ${attrs}/>` : `<${el.tagName}/>`;
  return `${openTag}${childContent}${closeTag}`;
}

function canonicalizeXml(xml: string): string {
  const root = parseDocumentXml(xml);
  return canonicalizeNode(root).replace(/>\s+</g, '><').trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function expectPartParity(
  actualArchive: DocxArchive,
  expectedArchive: DocxArchive,
  partPath: string,
  context: string
): Promise<void> {
  const actual = await getArchivePart(actualArchive, partPath);
  const expected = await getArchivePart(expectedArchive, partPath);

  if (expected === null) {
    expect(actual, `${context}: expected missing part ${partPath}`).toBeNull();
    return;
  }

  expect(actual, `${context}: expected part ${partPath} to exist`).not.toBeNull();
  const actualCanonical = canonicalizeXml(actual!);
  const expectedCanonical = canonicalizeXml(expected);
  expect(sha256(actualCanonical), `${context}: canonical mismatch in ${partPath}`).toBe(
    sha256(expectedCanonical)
  );
}

async function expectReadTextParity(
  actualArchive: DocxArchive,
  expectedArchive: DocxArchive,
  context: string
): Promise<void> {
  // `extractTextWithParagraphs` is the docx-comparison package's semantic
  // read_text-equivalent surface used by round-trip validation.
  const actualDocumentXml = await actualArchive.getDocumentXml();
  const expectedDocumentXml = await expectedArchive.getDocumentXml();

  const actualReadText = extractTextWithParagraphs(actualDocumentXml);
  const expectedReadText = extractTextWithParagraphs(expectedDocumentXml);
  const comparison = compareTexts(expectedReadText, actualReadText);
  if (!comparison.normalizedIdentical) {
    const expectedParas = expectedReadText.split('\n');
    const actualParas = actualReadText.split('\n');
    const maxLen = Math.max(expectedParas.length, actualParas.length);
    let firstParaDiff = -1;
    for (let i = 0; i < maxLen; i++) {
      const e = expectedParas[i] ?? '';
      const a = actualParas[i] ?? '';
      if (e !== a) {
        firstParaDiff = i;
        break;
      }
    }
    const paraDebug =
      firstParaDiff >= 0
        ? `first differing paragraph index=${firstParaDiff}\nexpected=${JSON.stringify(
            expectedParas[firstParaDiff] ?? ''
          )}\nactual=${JSON.stringify(actualParas[firstParaDiff] ?? '')}`
        : 'no paragraph-level diff found';

    const diffDebug = comparison.differences.slice(0, 3).join('\n');
    const debugMessage =
      `${context}: read_text (normalized) mismatch\n` +
      `expectedLength=${comparison.expectedLength} actualLength=${comparison.actualLength}\n` +
      `${paraDebug}\n${diffDebug}`;
    expect(comparison.normalizedIdentical, debugMessage).toBe(true);
    return;
  }

  expect(comparison.normalizedIdentical, `${context}: read_text (normalized) mismatch`).toBe(true);
}

function collectIds(
  root: Element,
  tagName: string,
  attributeName: string
): { values: Set<string>; duplicates: string[] } {
  const values = new Set<string>();
  const duplicateValues = new Set<string>();

  for (const node of findAllByTagName(root, tagName)) {
    const value = node.getAttribute(attributeName);
    if (!value) {
      continue;
    }
    if (values.has(value)) {
      duplicateValues.add(value);
    } else {
      values.add(value);
    }
  }

  return { values, duplicates: Array.from(duplicateValues).sort() };
}

function validateNumberingIntegrity(documentXml: string, numberingXml: string | null): NumberingDiagnostics {
  const documentRoot = parseDocumentXml(documentXml);
  const numRefIds = collectIds(documentRoot, 'w:numId', 'w:val').values;
  const ilvlNodes = findAllByTagName(documentRoot, 'w:ilvl');

  const invalidLevels: string[] = [];
  for (const node of ilvlNodes) {
    const rawLevel = node.getAttribute('w:val');
    if (!rawLevel) {
      continue;
    }
    const parsed = Number.parseInt(rawLevel, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 8) {
      invalidLevels.push(rawLevel);
    }
  }

  if (!numberingXml) {
    return {
      missingNumIds: Array.from(numRefIds).sort(),
      missingAbstractNumIds: [],
      invalidLevels: invalidLevels.sort(),
    };
  }

  const numberingRoot = parseDocumentXml(numberingXml);
  const numDefinitions = collectIds(numberingRoot, 'w:num', 'w:numId').values;
  const abstractDefinitions = collectIds(numberingRoot, 'w:abstractNum', 'w:abstractNumId').values;

  const abstractRefs = new Set<string>();
  for (const numNode of findAllByTagName(numberingRoot, 'w:num')) {
    const abstractNode = childElements(numNode).find((child) => child.tagName === 'w:abstractNumId');
    const abstractId = abstractNode?.getAttribute('w:val');
    if (abstractId) {
      abstractRefs.add(abstractId);
    }
  }

  // In WordprocessingML, numId="0" is a sentinel that means "no numbering".
  const missingNumIds = Array.from(numRefIds)
    .filter((id) => id !== '0' && !numDefinitions.has(id))
    .sort();
  const missingAbstractNumIds = Array.from(abstractRefs)
    .filter((id) => !abstractDefinitions.has(id))
    .sort();

  return {
    missingNumIds,
    missingAbstractNumIds,
    invalidLevels: invalidLevels.sort(),
  };
}

function validateNoteIntegrity(
  documentXml: string,
  footnotesXml: string | null,
  endnotesXml: string | null
): NoteDiagnostics {
  const documentRoot = parseDocumentXml(documentXml);
  const footnoteRefs = collectIds(documentRoot, 'w:footnoteReference', 'w:id').values;
  const endnoteRefs = collectIds(documentRoot, 'w:endnoteReference', 'w:id').values;

  const footnoteIds = footnotesXml
    ? collectIds(parseDocumentXml(footnotesXml), 'w:footnote', 'w:id')
    : { values: new Set<string>(), duplicates: [] };
  const endnoteIds = endnotesXml
    ? collectIds(parseDocumentXml(endnotesXml), 'w:endnote', 'w:id')
    : { values: new Set<string>(), duplicates: [] };

  const missingFootnoteRefs = Array.from(footnoteRefs)
    .filter((id) => !footnoteIds.values.has(id))
    .sort();
  const missingEndnoteRefs = Array.from(endnoteRefs)
    .filter((id) => !endnoteIds.values.has(id))
    .sort();

  return {
    missingFootnoteRefs,
    missingEndnoteRefs,
    duplicateFootnoteIds: footnoteIds.duplicates,
    duplicateEndnoteIds: endnoteIds.duplicates,
  };
}

function validateBookmarkIntegrity(documentXml: string): BookmarkDiagnostics {
  const root = parseDocumentXml(documentXml);
  const starts = collectIds(root, 'w:bookmarkStart', 'w:id');
  const ends = collectIds(root, 'w:bookmarkEnd', 'w:id');

  const unmatchedStartIds = Array.from(starts.values).filter((id) => !ends.values.has(id)).sort();
  const unmatchedEndIds = Array.from(ends.values).filter((id) => !starts.values.has(id)).sort();

  return {
    unmatchedStartIds,
    unmatchedEndIds,
    duplicateStartIds: starts.duplicates,
    duplicateEndIds: ends.duplicates,
  };
}

describe('Structural Round-Trip Invariants - Synthetic Core Pair', () => {
  const artifactsByMode = new Map<ReconstructionMode, RoundTripArtifacts>();

  beforeAll(async () => {
    const original = await readFile(SYNTHETIC_CORE_ORIGINAL_DOC);
    const revised = await readFile(SYNTHETIC_CORE_REVISED_DOC);

    for (const mode of MODES) {
      artifactsByMode.set(mode, await buildRoundTripArtifacts(original, revised, mode));
    }
  }, 180000);

  for (const mode of MODES) {
    it(
      `enforces accept/reject parity for non-document core OOXML parts (${mode})`,
      async () => {
        const artifacts = artifactsByMode.get(mode);
        expect(artifacts, `missing artifacts for mode ${mode}`).toBeDefined();
        const typedArtifacts = artifacts!;

        for (const partPath of NON_DOCUMENT_CORE_PARTS) {
          await expectPartParity(
            typedArtifacts.acceptedArchive,
            typedArtifacts.revisedArchive,
            partPath,
            `SyntheticCore/${mode}/accept-all`
          );
          await expectPartParity(
            typedArtifacts.rejectedArchive,
            typedArtifacts.originalArchive,
            partPath,
            `SyntheticCore/${mode}/reject-all`
          );
        }
      },
      120000
    );

    it(
      `enforces read_text accept/reject parity (${mode})`,
      async () => {
        const artifacts = artifactsByMode.get(mode);
        expect(artifacts, `missing artifacts for mode ${mode}`).toBeDefined();
        const typedArtifacts = artifacts!;

        await expectReadTextParity(
          typedArtifacts.acceptedArchive,
          typedArtifacts.revisedArchive,
          `SyntheticCore/${mode}/accept-all`
        );
        await expectReadTextParity(
          typedArtifacts.rejectedArchive,
          typedArtifacts.originalArchive,
          `SyntheticCore/${mode}/reject-all`
        );
      },
      120000
    );
  }
});

describe('Structural Round-Trip Invariants - ILPA Pair (feature-rich)', () => {
  const artifactsByMode = new Map<ReconstructionMode, RoundTripArtifacts>();

  beforeAll(async () => {
    const original = await readFile(ILPA_ORIGINAL_DOC);
    const revised = await readFile(ILPA_REVISED_DOC);

    for (const mode of MODES) {
      artifactsByMode.set(mode, await buildRoundTripArtifacts(original, revised, mode));
    }
  }, 240000);

  for (const mode of MODES) {
    it(
      `enforces read_text accept/reject parity (${mode})`,
      async () => {
        const artifacts = artifactsByMode.get(mode);
        expect(artifacts, `missing artifacts for mode ${mode}`).toBeDefined();
        const typedArtifacts = artifacts!;

        await expectReadTextParity(
          typedArtifacts.acceptedArchive,
          typedArtifacts.revisedArchive,
          `ILPA/${mode}/accept-all`
        );
        await expectReadTextParity(
          typedArtifacts.rejectedArchive,
          typedArtifacts.originalArchive,
          `ILPA/${mode}/reject-all`
        );
      },
      120000
    );

    it(
      `keeps numbering references valid after accept/reject (${mode})`,
      async () => {
        const artifacts = artifactsByMode.get(mode);
        expect(artifacts, `missing artifacts for mode ${mode}`).toBeDefined();
        const typedArtifacts = artifacts!;

        const acceptedDocumentXml = await typedArtifacts.acceptedArchive.getDocumentXml();
        const rejectedDocumentXml = await typedArtifacts.rejectedArchive.getDocumentXml();
        const revisedDocumentXml = await typedArtifacts.revisedArchive.getDocumentXml();
        const originalDocumentXml = await typedArtifacts.originalArchive.getDocumentXml();
        const acceptedNumberingXml = await typedArtifacts.acceptedArchive.getFile(DOCX_PATHS.NUMBERING);
        const rejectedNumberingXml = await typedArtifacts.rejectedArchive.getFile(DOCX_PATHS.NUMBERING);
        const revisedNumberingXml = await typedArtifacts.revisedArchive.getFile(DOCX_PATHS.NUMBERING);
        const originalNumberingXml = await typedArtifacts.originalArchive.getFile(DOCX_PATHS.NUMBERING);

        const acceptedDiagnostics = validateNumberingIntegrity(acceptedDocumentXml, acceptedNumberingXml);
        const rejectedDiagnostics = validateNumberingIntegrity(rejectedDocumentXml, rejectedNumberingXml);
        const revisedDiagnostics = validateNumberingIntegrity(revisedDocumentXml, revisedNumberingXml);
        const originalDiagnostics = validateNumberingIntegrity(originalDocumentXml, originalNumberingXml);

        expect(acceptedDiagnostics, `ILPA/${mode}/accept numbering diagnostics mismatch vs revised`).toEqual(
          revisedDiagnostics
        );
        expect(rejectedDiagnostics, `ILPA/${mode}/reject numbering diagnostics mismatch vs original`).toEqual(
          originalDiagnostics
        );
      },
      120000
    );

    it(
      `keeps footnote/endnote references valid after accept/reject (${mode})`,
      async () => {
        const artifacts = artifactsByMode.get(mode);
        expect(artifacts, `missing artifacts for mode ${mode}`).toBeDefined();
        const typedArtifacts = artifacts!;

        const acceptedDocumentXml = await typedArtifacts.acceptedArchive.getDocumentXml();
        const rejectedDocumentXml = await typedArtifacts.rejectedArchive.getDocumentXml();
        const revisedDocumentXml = await typedArtifacts.revisedArchive.getDocumentXml();
        const originalDocumentXml = await typedArtifacts.originalArchive.getDocumentXml();

        const acceptedFootnotesXml = await typedArtifacts.acceptedArchive.getFile(DOCX_PATHS.FOOTNOTES);
        const acceptedEndnotesXml = await typedArtifacts.acceptedArchive.getFile(DOCX_PATHS.ENDNOTES);
        const rejectedFootnotesXml = await typedArtifacts.rejectedArchive.getFile(DOCX_PATHS.FOOTNOTES);
        const rejectedEndnotesXml = await typedArtifacts.rejectedArchive.getFile(DOCX_PATHS.ENDNOTES);
        const revisedFootnotesXml = await typedArtifacts.revisedArchive.getFile(DOCX_PATHS.FOOTNOTES);
        const revisedEndnotesXml = await typedArtifacts.revisedArchive.getFile(DOCX_PATHS.ENDNOTES);
        const originalFootnotesXml = await typedArtifacts.originalArchive.getFile(DOCX_PATHS.FOOTNOTES);
        const originalEndnotesXml = await typedArtifacts.originalArchive.getFile(DOCX_PATHS.ENDNOTES);

        const acceptedDiagnostics = validateNoteIntegrity(
          acceptedDocumentXml,
          acceptedFootnotesXml,
          acceptedEndnotesXml
        );
        const rejectedDiagnostics = validateNoteIntegrity(
          rejectedDocumentXml,
          rejectedFootnotesXml,
          rejectedEndnotesXml
        );
        const revisedDiagnostics = validateNoteIntegrity(
          revisedDocumentXml,
          revisedFootnotesXml,
          revisedEndnotesXml
        );
        const originalDiagnostics = validateNoteIntegrity(
          originalDocumentXml,
          originalFootnotesXml,
          originalEndnotesXml
        );

        expect(acceptedDiagnostics, `ILPA/${mode}/accept note diagnostics mismatch vs revised`).toEqual(
          revisedDiagnostics
        );
        expect(rejectedDiagnostics, `ILPA/${mode}/reject note diagnostics mismatch vs original`).toEqual(
          originalDiagnostics
        );
      },
      120000
    );

    it(
      `keeps bookmark structure valid after accept/reject (${mode})`,
      async () => {
        const artifacts = artifactsByMode.get(mode);
        expect(artifacts, `missing artifacts for mode ${mode}`).toBeDefined();
        const typedArtifacts = artifacts!;

        const acceptedDocumentXml = await typedArtifacts.acceptedArchive.getDocumentXml();
        const rejectedDocumentXml = await typedArtifacts.rejectedArchive.getDocumentXml();
        const revisedDocumentXml = await typedArtifacts.revisedArchive.getDocumentXml();
        const originalDocumentXml = await typedArtifacts.originalArchive.getDocumentXml();

        const acceptedDiagnostics = validateBookmarkIntegrity(acceptedDocumentXml);
        const rejectedDiagnostics = validateBookmarkIntegrity(rejectedDocumentXml);
        const revisedDiagnostics = validateBookmarkIntegrity(revisedDocumentXml);
        const originalDiagnostics = validateBookmarkIntegrity(originalDocumentXml);

        expect(acceptedDiagnostics, `ILPA/${mode}/accept bookmark diagnostics mismatch vs revised`).toEqual(
          revisedDiagnostics
        );
        expect(rejectedDiagnostics, `ILPA/${mode}/reject bookmark diagnostics mismatch vs original`).toEqual(
          originalDiagnostics
        );
      },
      120000
    );
  }
});
