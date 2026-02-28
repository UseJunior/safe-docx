import { beforeAll, describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { compareDocuments } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import {
  acceptAllChanges,
  compareTexts,
  extractTextWithParagraphs,
  rejectAllChanges,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';
import { parseDocumentXml } from '../baselines/atomizer/xmlToWmlElement.js';
import { findAllByTagName } from '../primitives/index.js';

interface BookmarkSemanticDiagnostics {
  startIds: string[];
  endIds: string[];
  unmatchedStartIds: string[];
  unmatchedEndIds: string[];
  duplicateStartIds: string[];
  duplicateEndIds: string[];
  startNames: string[];
  duplicateStartNames: string[];
  referencedBookmarkNames: string[];
  unresolvedReferenceNames: string[];
}

interface InplaceRun {
  originalXml: string;
  revisedXml: string;
  resultXml: string;
  acceptedXml: string;
  rejectedXml: string;
  reconstructionModeUsed: 'rebuild' | 'inplace' | undefined;
  fallbackReason: string | undefined;
  fallbackDiagnostics: unknown;
}

const integrationDir = dirname(import.meta.url.replace('file://', ''));
const projectRoot = join(integrationDir, '../../../..');

const SYNTHETIC_INPLACE_ORIGINAL_DOC = join(
  integrationDir,
  '../testing/fixtures/split-run-boundary-change/original.docx'
);
const SYNTHETIC_INPLACE_REVISED_DOC = join(
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

function collectAttrValues(
  root: Element,
  tagName: string,
  attributeName: string
): { values: string[]; duplicates: string[] } {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const node of findAllByTagName(root, tagName)) {
    const value = node.getAttribute(attributeName);
    if (!value) {
      continue;
    }
    if (seen.has(value)) {
      dupes.add(value);
      continue;
    }
    seen.add(value);
  }
  return {
    values: Array.from(seen).sort(),
    duplicates: Array.from(dupes).sort(),
  };
}

function collectReferencedBookmarkNames(root: Element): string[] {
  const names = new Set<string>();
  const fieldCodePattern = /\b(?:REF|PAGEREF)\s+([^\s\\]+)/gi;
  for (const instrNode of findAllByTagName(root, 'w:instrText')) {
    const text = instrNode.textContent ?? '';
    let match = fieldCodePattern.exec(text);
    while (match) {
      const name = match[1]?.trim();
      if (name) {
        names.add(name);
      }
      match = fieldCodePattern.exec(text);
    }
    fieldCodePattern.lastIndex = 0;
  }
  return Array.from(names).sort();
}

function bookmarkDiagnostics(documentXml: string): BookmarkSemanticDiagnostics {
  const root = parseDocumentXml(documentXml);
  const startsById = collectAttrValues(root, 'w:bookmarkStart', 'w:id');
  const endsById = collectAttrValues(root, 'w:bookmarkEnd', 'w:id');
  const startsByName = collectAttrValues(root, 'w:bookmarkStart', 'w:name');
  const referencedBookmarkNames = collectReferencedBookmarkNames(root);
  const startNameSet = new Set(startsByName.values);
  const unresolvedReferenceNames = referencedBookmarkNames
    .filter((name) => !startNameSet.has(name))
    .sort();

  const startIdSet = new Set(startsById.values);
  const endIdSet = new Set(endsById.values);
  const unmatchedStartIds = startsById.values.filter((id) => !endIdSet.has(id)).sort();
  const unmatchedEndIds = endsById.values.filter((id) => !startIdSet.has(id)).sort();

  return {
    startIds: startsById.values,
    endIds: endsById.values,
    unmatchedStartIds,
    unmatchedEndIds,
    duplicateStartIds: startsById.duplicates,
    duplicateEndIds: endsById.duplicates,
    startNames: startsByName.values,
    duplicateStartNames: startsByName.duplicates,
    referencedBookmarkNames,
    unresolvedReferenceNames,
  };
}

function assertReadTextParity(expectedXml: string, actualXml: string, context: string): void {
  const expectedReadText = extractTextWithParagraphs(expectedXml);
  const actualReadText = extractTextWithParagraphs(actualXml);
  const comparison = compareTexts(expectedReadText, actualReadText);
  const hint = comparison.differences.slice(0, 3).join('\n');
  expect(
    comparison.normalizedIdentical,
    `${context}: read_text mismatch\nexpectedLength=${comparison.expectedLength} actualLength=${comparison.actualLength}\n${hint}`
  ).toBe(true);
}

function assertSemanticBookmarkParity(
  expected: BookmarkSemanticDiagnostics,
  actual: BookmarkSemanticDiagnostics,
  context: string
): void {
  expect(actual.startNames, `${context}: startNames mismatch`).toEqual(expected.startNames);
  expect(actual.duplicateStartNames, `${context}: duplicateStartNames mismatch`).toEqual(
    expected.duplicateStartNames
  );
  expect(actual.referencedBookmarkNames, `${context}: referencedBookmarkNames mismatch`).toEqual(
    expected.referencedBookmarkNames
  );
  expect(actual.unresolvedReferenceNames, `${context}: unresolvedReferenceNames mismatch`).toEqual(
    expected.unresolvedReferenceNames
  );
  expect(actual.unmatchedStartIds, `${context}: unmatchedStartIds mismatch`).toEqual(
    expected.unmatchedStartIds
  );
  expect(actual.unmatchedEndIds, `${context}: unmatchedEndIds mismatch`).toEqual(expected.unmatchedEndIds);
  expect(actual.duplicateStartIds, `${context}: duplicateStartIds mismatch`).toEqual(expected.duplicateStartIds);
  expect(actual.duplicateEndIds, `${context}: duplicateEndIds mismatch`).toEqual(expected.duplicateEndIds);
}

async function runInplaceComparison(originalPath: string, revisedPath: string): Promise<InplaceRun> {
  const [original, revised] = await Promise.all([readFile(originalPath), readFile(revisedPath)]);
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
  });

  const [originalArchive, revisedArchive, resultArchive] = await Promise.all([
    DocxArchive.load(original),
    DocxArchive.load(revised),
    DocxArchive.load(result.document),
  ]);

  const [originalXml, revisedXml, resultXml] = await Promise.all([
    originalArchive.getDocumentXml(),
    revisedArchive.getDocumentXml(),
    resultArchive.getDocumentXml(),
  ]);

  return {
    originalXml,
    revisedXml,
    resultXml,
    acceptedXml: acceptAllChanges(resultXml),
    rejectedXml: rejectAllChanges(resultXml),
    reconstructionModeUsed: result.reconstructionModeUsed,
    fallbackReason: result.fallbackReason,
    fallbackDiagnostics: result.fallbackDiagnostics,
  };
}

describe('Inplace bookmark semantic regression coverage (Allure)', () => {
  let synthetic: InplaceRun;
  let ilpa: InplaceRun;

  beforeAll(async () => {
    [synthetic, ilpa] = await Promise.all([
      runInplaceComparison(SYNTHETIC_INPLACE_ORIGINAL_DOC, SYNTHETIC_INPLACE_REVISED_DOC),
      runInplaceComparison(ILPA_ORIGINAL_DOC, ILPA_REVISED_DOC),
    ]);
  }, 300000);

  it(
    'Synthetic/inplace keeps read_text parity without fallback',
    async () => {
      await allure.epic('Document Comparison');
      await allure.feature('Inplace Reconstruction');
      await allure.story('Read-text round-trip invariants');
      await allure.severity('critical');

      await allure.step('Given synthetic output from inplace reconstruction', async () => {
        await allure.attachment(
          'synthetic-reconstruction-metadata.json',
          JSON.stringify(
            {
              reconstructionModeUsed: synthetic.reconstructionModeUsed,
              fallbackReason: synthetic.fallbackReason,
            },
            null,
            2
          ),
          'application/json'
        );
      });

      await allure.step('When the output is projected through Accept All and Reject All', async () => {
        assertReadTextParity(synthetic.revisedXml, synthetic.acceptedXml, 'Synthetic/inplace/accept-all');
        assertReadTextParity(synthetic.originalXml, synthetic.rejectedXml, 'Synthetic/inplace/reject-all');
      });

      await allure.step('Then inplace is retained and no fallback reason is emitted', async () => {
        expect(synthetic.reconstructionModeUsed).toBe('inplace');
        expect(synthetic.fallbackReason).toBeUndefined();
        expect(synthetic.fallbackDiagnostics).toBeUndefined();
      });
    },
    180000
  );

  it(
    'Synthetic/inplace preserves semantic bookmark parity',
    async () => {
      await allure.epic('Document Comparison');
      await allure.feature('Inplace Reconstruction');
      await allure.story('Semantic bookmark parity');
      await allure.severity('critical');

      let acceptedExpected: BookmarkSemanticDiagnostics;
      let acceptedActual: BookmarkSemanticDiagnostics;
      let rejectedExpected: BookmarkSemanticDiagnostics;
      let rejectedActual: BookmarkSemanticDiagnostics;

      await allure.step('Given semantic bookmark diagnostics for synthetic baselines and projections', async () => {
        acceptedExpected = bookmarkDiagnostics(synthetic.revisedXml);
        acceptedActual = bookmarkDiagnostics(synthetic.acceptedXml);
        rejectedExpected = bookmarkDiagnostics(synthetic.originalXml);
        rejectedActual = bookmarkDiagnostics(synthetic.rejectedXml);

        await allure.attachment(
          'synthetic-bookmark-diagnostics.json',
          JSON.stringify(
            {
              acceptExpected: acceptedExpected,
              acceptActual: acceptedActual,
              rejectExpected: rejectedExpected,
              rejectActual: rejectedActual,
            },
            null,
            2
          ),
          'application/json'
        );
      });

      await allure.step('When parity checks ignore strict bookmark ID identity', async () => {
        assertSemanticBookmarkParity(
          acceptedExpected!,
          acceptedActual!,
          'Synthetic/inplace/accept-all/semantic-bookmarks'
        );
        assertSemanticBookmarkParity(
          rejectedExpected!,
          rejectedActual!,
          'Synthetic/inplace/reject-all/semantic-bookmarks'
        );
      });

      await allure.step('Then semantic bookmark parity holds for both projections', async () => {
        expect(acceptedActual!.unresolvedReferenceNames).toEqual(acceptedExpected!.unresolvedReferenceNames);
        expect(rejectedActual!.unresolvedReferenceNames).toEqual(rejectedExpected!.unresolvedReferenceNames);
      });
    },
    180000
  );

  it(
    'ILPA/inplace keeps read_text parity (v0.3: improved matching allows inplace)',
    async () => {
      await allure.epic('Document Comparison');
      await allure.feature('Inplace Reconstruction');
      await allure.story('Large document round-trip');
      await allure.severity('normal');

      await allure.step('Given ILPA output from requested inplace reconstruction', async () => {
        await allure.attachment(
          'ilpa-reconstruction-metadata.json',
          JSON.stringify(
            {
              reconstructionModeUsed: ilpa.reconstructionModeUsed,
              fallbackReason: ilpa.fallbackReason,
            },
            null,
            2
          ),
          'application/json'
        );
      });

      await allure.step('Then reconstruction retains inplace mode', async () => {
        expect(ilpa.reconstructionModeUsed).toBe('inplace');
        expect(ilpa.fallbackReason).toBeUndefined();
      });

      await allure.step('And read_text parity holds after accept all', async () => {
        assertReadTextParity(ilpa.revisedXml, ilpa.acceptedXml, 'ILPA/inplace/accept-all');
      });
    },
    180000
  );
});
