/**
 * A fuzzy changed run inside an aligned paragraph must be refined locally so
 * unchanged inline tokens are not represented as delete+insert or false moves.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/717
 * @see https://github.com/UseJunior/safe-docx/issues/734
 */

import {
  DEFAULT_MOVE_DETECTION_SETTINGS,
  DocxArchive,
  parseXml,
  type ComparisonUnitAtom,
  type OpcPart,
  type WmlElement,
} from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import {
  assignIdentityIds,
  createComparisonUnitAtom,
  IdentityInterner,
} from '../../atomizer.js';
import {
  getAtomText,
  jaccardWordSimilarity,
  wordContainmentSimilarity,
} from '../../move-detection.js';
import { el } from '../../testing/dom-test-helpers.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { hierarchicalCompare } from './hierarchicalLcs.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  ALIGNED_RUN_REFINEMENT_CONTAINMENT_THRESHOLD,
  ALIGNED_RUN_REFINEMENT_SIMILARITY_THRESHOLD,
  refineFuzzyRunsWithinAlignedParagraphs,
} from './selectiveWordRefinement.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Adaptive Atomization',
    story: 'Selective Word Refinement',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
  );

function paragraph(changedRun: string): string {
  return (
    '<w:p>' +
    '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Aligned prefix. </w:t></w:r>' +
    `<w:r><w:t xml:space="preserve">${changedRun}</w:t></w:r>` +
    '<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> Aligned suffix.</w:t></w:r>' +
    '</w:p>'
  );
}

const documentPart: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

function comparisonAtom(text: string, paragraphIndex = 0): ComparisonUnitAtom {
  const result = createComparisonUnitAtom({
    contentElement: el('w:t', {}, undefined, text) as WmlElement,
    ancestors: [],
    part: documentPart,
  });
  result.paragraphIndex = paragraphIndex;
  return result;
}

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

function projectedText(xml: string, projection: 'accept' | 'reject'): string {
  const projected = projection === 'accept' ? acceptAllChanges(xml) : rejectAllChanges(xml);
  return parseXml(projected).documentElement.textContent ?? '';
}

function revisionAncestor(node: Element): Element | null {
  let current = node.parentNode as Element | null;
  while (current) {
    if (
      current.tagName === 'w:ins' ||
      current.tagName === 'w:del' ||
      current.tagName === 'w:moveFrom' ||
      current.tagName === 'w:moveTo'
    ) {
      return current;
    }
    current = current.parentNode as Element | null;
  }
  return null;
}

describe('selective word refinement for aligned paragraphs (#717)', () => {
  test('directly refines only the fuzzy run pair selected by the run-level LCS', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const originalAtoms = await given('three run-level atoms with one long fuzzy changed run', () => [
      comparisonAtom('Aligned prefix. '),
      comparisonAtom('The annual allocation shall remain 10,000 units for each reporting period; review, review, under this agreement.'),
      comparisonAtom(' Aligned suffix.'),
    ]);
    const revisedAtoms = await given('the aligned revised atoms preserving an interior numeric token', () => [
      comparisonAtom('Aligned prefix. '),
      comparisonAtom('The annual allocation will remain 10,000 units for each reporting period; review, review, under this agreement.'),
      comparisonAtom(' Aligned suffix.'),
    ]);
    const interner = new IdentityInterner();
    assignIdentityIds(originalAtoms, interner);
    assignIdentityIds(revisedAtoms, interner);
    const initialLcs = hierarchicalCompare(originalAtoms, revisedAtoms);

    const refined = await when('the run-level result receives selective word refinement', () =>
      refineFuzzyRunsWithinAlignedParagraphs(
        originalAtoms,
        revisedAtoms,
        initialLcs,
        DEFAULT_MOVE_DETECTION_SETTINGS,
        interner,
      ),
    );

    await then('exactly one original/revised run pair is refined', () => {
      expect(refined.refinedPairCount).toBe(1);
    });

    await and('the unchanged numeric token is an exact LCS match', () => {
      const matchingTexts = refined.lcsResult.matches.map((match) => [
        getAtomText(refined.originalAtoms[match.originalIndex]!),
        getAtomText(refined.revisedAtoms[match.revisedIndex]!),
      ]);
      expect(matchingTexts).toContainEqual(['10,000', '10,000']);
    });

    await and('neither changed side classifies the numeric token as deleted or inserted', () => {
      expect(
        refined.lcsResult.deletedIndices
          .map((index) => getAtomText(refined.originalAtoms[index]!))
          .some((text) => text.includes('10,000')),
      ).toBe(false);
      expect(
        refined.lcsResult.insertedIndices
          .map((index) => getAtomText(refined.revisedAtoms[index]!))
          .some((text) => text.includes('10,000')),
      ).toBe(false);
    });
  });

  test('keeps a dense rewrite coarse when word refinement exceeds the review budget', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const originalAtoms = await given('an aligned paragraph with four scattered substitutions', () => [
      comparisonAtom('Exact prefix. '),
      comparisonAtom('a one b two c three d four e f g h'),
      comparisonAtom(' Exact suffix.'),
    ]);
    const revisedAtoms = await given('the corresponding dense revised run', () => [
      comparisonAtom('Exact prefix. '),
      comparisonAtom('a uno b dos c tres d cuatro e f g h'),
      comparisonAtom(' Exact suffix.'),
    ]);
    const interner = new IdentityInterner();
    assignIdentityIds(originalAtoms, interner);
    assignIdentityIds(revisedAtoms, interner);
    const initialLcs = hierarchicalCompare(originalAtoms, revisedAtoms);

    const refined = await when('word refinement is limited to six change ranges', () =>
      refineFuzzyRunsWithinAlignedParagraphs(
        originalAtoms,
        revisedAtoms,
        initialLcs,
        DEFAULT_MOVE_DETECTION_SETTINGS,
        interner,
        6,
      ),
    );

    await then('the changed run remains a single coarse replacement', () => {
      expect(refined.refinedPairCount).toBe(0);
      expect(refined.originalAtoms).toBe(originalAtoms);
      expect(refined.revisedAtoms).toBe(revisedAtoms);
      expect(refined.lcsResult).toBe(initialLcs);
    });
  });

  test('budgets each aligned run independently so one dense rewrite does not coarsen sparse edits', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const changedRuns = [
      ['alpha agreement shall remain effective throughout each annual reporting period', 'alpha agreement will remain effective throughout each annual reporting period'],
      ['beta committee shall review records during each quarterly reporting period', 'beta committee will review records during each quarterly reporting period'],
      ['gamma adviser shall deliver notices during each monthly reporting period', 'gamma adviser will deliver notices during each monthly reporting period'],
      ['dense a one b two c three d four e stable tail', 'dense a uno b dos c tres d cuatro e stable tail'],
    ] as const;
    const originalAtoms = await given('three sparse paragraph edits and one dense paragraph rewrite', () =>
      changedRuns.flatMap(([original], paragraphIndex) => [
        comparisonAtom(`Unique aligned prefix ${paragraphIndex}. `, paragraphIndex),
        comparisonAtom(original, paragraphIndex),
        comparisonAtom(` Unique aligned suffix ${paragraphIndex}.`, paragraphIndex),
      ]),
    );
    const revisedAtoms = changedRuns.flatMap(([, revised], paragraphIndex) => [
      comparisonAtom(`Unique aligned prefix ${paragraphIndex}. `, paragraphIndex),
      comparisonAtom(revised, paragraphIndex),
      comparisonAtom(` Unique aligned suffix ${paragraphIndex}.`, paragraphIndex),
    ]);
    const denseOriginal = originalAtoms[10]!;
    const denseRevised = revisedAtoms[10]!;
    const interner = new IdentityInterner();
    assignIdentityIds(originalAtoms, interner);
    assignIdentityIds(revisedAtoms, interner);

    const refined = await when('word refinement receives a six-range budget per candidate pair', () =>
      refineFuzzyRunsWithinAlignedParagraphs(
        originalAtoms,
        revisedAtoms,
        hierarchicalCompare(originalAtoms, revisedAtoms),
        DEFAULT_MOVE_DETECTION_SETTINGS,
        interner,
        6,
      ),
    );

    await then('all three sparse changed runs remain word-refined', () => {
      expect(refined.refinedPairCount).toBe(3);
      const matched = refined.lcsResult.matches.map((match) =>
        getAtomText(refined.originalAtoms[match.originalIndex]!),
      );
      expect(matched).toEqual(expect.arrayContaining(['agreement', 'committee', 'adviser']));
    });

    await and('only the dense changed pair remains as its original coarse atoms', () => {
      expect(refined.originalAtoms).toContain(denseOriginal);
      expect(refined.revisedAtoms).toContain(denseRevised);
      expect(refined.originalAtoms).not.toContain(originalAtoms[1]);
      expect(refined.originalAtoms).not.toContain(originalAtoms[4]);
      expect(refined.originalAtoms).not.toContain(originalAtoms[7]);
    });
  });

  test('refines a containment-heavy aligned run below the move threshold', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const originalChanged =
      'stable anchor one two three four five';
    const revisedChanged =
      'stable anchor one two three four five new gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron';
    const similarity = jaccardWordSimilarity(originalChanged, revisedChanged);
    const containment = wordContainmentSimilarity(originalChanged, revisedChanged);
    const originalAtoms = await given('an aligned paragraph with a moderately overlapping long run', () => [
      comparisonAtom('Exact prefix. '),
      comparisonAtom(originalChanged),
      comparisonAtom(' Exact suffix.'),
    ]);
    const revisedAtoms = await given('a longer replacement that retains most of the source vocabulary', () => [
      comparisonAtom('Exact prefix. '),
      comparisonAtom(revisedChanged),
      comparisonAtom(' Exact suffix.'),
    ]);
    const interner = new IdentityInterner();
    assignIdentityIds(originalAtoms, interner);
    assignIdentityIds(revisedAtoms, interner);

    const refined = await when('selective refinement evaluates the aligned changed runs', () =>
      refineFuzzyRunsWithinAlignedParagraphs(
        originalAtoms,
        revisedAtoms,
        hierarchicalCompare(originalAtoms, revisedAtoms),
        DEFAULT_MOVE_DETECTION_SETTINGS,
        interner,
      ),
    );

    await then('containment is sufficient even though Jaccard overlap is below both thresholds', () => {
      expect(similarity).toBeLessThan(ALIGNED_RUN_REFINEMENT_SIMILARITY_THRESHOLD);
      expect(similarity).toBeLessThan(DEFAULT_MOVE_DETECTION_SETTINGS.moveSimilarityThreshold);
      expect(containment).toBeGreaterThanOrEqual(ALIGNED_RUN_REFINEMENT_CONTAINMENT_THRESHOLD);
      expect(refined.refinedPairCount).toBe(1);
    });

    await and('shared interior words become exact atom matches', () => {
      const matched = refined.lcsResult.matches.map((match) =>
        getAtomText(refined.revisedAtoms[match.revisedIndex]!),
      );
      expect(matched).toContain('stable');
      expect(matched).toContain('five');
    });
  });

  test('keeps the unchanged numeric token outside revisions when one long run changes', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const originalRun =
      'The annual allocation shall remain 10,000 units for each reporting period; review, review, under this agreement.';
    const revisedRun =
      'The annual allocation will remain 10,000 units for each reporting period; review, review, under this agreement.';
    const originalBody = paragraph(originalRun);
    const revisedBody = paragraph(revisedRun);
    const originalText = parseXml(
      `<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${originalBody}</w:root>`,
    ).documentElement.textContent ?? '';
    const revisedText = parseXml(
      `<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${revisedBody}</w:root>`,
    ).documentElement.textContent ?? '';

    const original = await given('an aligned paragraph containing a long original run', () =>
      buildDocxFromBodyXml(originalBody),
    );
    const revised = await given('a fuzzy revision that preserves an interior numeric token', () =>
      buildDocxFromBodyXml(revisedBody),
    );

    const comparison = await when('the in-place atomizer compares the documents', () =>
      compareDocumentsAtomizer(original, revised, {
        comparisonStrategy: 'legacy',
        reconstructionMode: 'inplace',
        date: new Date('2026-07-28T12:00:00Z'),
      }),
    );
    const xml = await documentXml(comparison.document);
    const document = parseXml(xml);

    await then('the unchanged numeric token is emitted once outside every revision wrapper', () => {
      const numericTokens = Array.from(document.getElementsByTagName('w:t'))
        .concat(Array.from(document.getElementsByTagName('w:delText')))
        .filter((node) => (node.textContent ?? '').includes('10,000'));
      expect(numericTokens).toHaveLength(1);
      expect(revisionAncestor(numericTokens[0]!)).toBeNull();
    });

    await and('the changed word is not misclassified as a move', () => {
      expect(document.getElementsByTagName('w:moveFrom')).toHaveLength(0);
      expect(document.getElementsByTagName('w:moveTo')).toHaveLength(0);
    });

    await and('accept and reject projections exactly recover their respective source text', () => {
      expect(projectedText(xml, 'accept')).toBe(revisedText);
      expect(projectedText(xml, 'reject')).toBe(originalText);
    });
  });

  test('keeps fully contained source vocabulary outside an expanded-run replacement', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const originalRun =
      'The committee may review the annual allocation under this agreement for each reporting period.';
    const revisedRun =
      'The committee may after consulting its advisers and examining the applicable records review the annual allocation under this agreement for each reporting period and document its conclusions in a written report delivered promptly to all interested parties.';
    const originalBody = paragraph(originalRun);
    const revisedBody = paragraph(revisedRun);
    const originalText = parseXml(
      `<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${originalBody}</w:root>`,
    ).documentElement.textContent ?? '';
    const revisedText = parseXml(
      `<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${revisedBody}</w:root>`,
    ).documentElement.textContent ?? '';

    const original = await given('a long run whose vocabulary is retained by an expanded revision', () =>
      buildDocxFromBodyXml(originalBody),
    );
    const revised = await given('the same run with substantial new language around it', () =>
      buildDocxFromBodyXml(revisedBody),
    );
    const comparison = await when('the documents are compared in place', () =>
      compareDocumentsAtomizer(original, revised, {
        comparisonStrategy: 'legacy',
        reconstructionMode: 'inplace',
        date: new Date('2026-07-29T12:00:00Z'),
      }),
    );
    const xml = await documentXml(comparison.document);
    const document = parseXml(xml);

    await then('a retained interior word is emitted once outside revision wrappers', () => {
      const retained = Array.from(document.getElementsByTagName('w:t'))
        .concat(Array.from(document.getElementsByTagName('w:delText')))
        .filter((node) => (node.textContent ?? '').includes('allocation'));
      expect(retained).toHaveLength(1);
      expect(revisionAncestor(retained[0]!)).toBeNull();
    });

    await and('no unchanged words overlap the deletion and insertion payloads', () => {
      const words = (value: string): Set<string> =>
        new Set(value.toLowerCase().match(/[a-z]+/g) ?? []);
      const deleted = words(
        Array.from(document.getElementsByTagName('w:del'))
          .map((node) => node.textContent ?? '')
          .join(' '),
      );
      const inserted = words(
        Array.from(document.getElementsByTagName('w:ins'))
          .map((node) => node.textContent ?? '')
          .join(' '),
      );
      expect([...deleted].filter((word) => inserted.has(word))).toHaveLength(0);
    });

    await and('accept and reject recover the expanded and source paragraphs exactly', () => {
      expect(projectedText(xml, 'accept')).toBe(revisedText);
      expect(projectedText(xml, 'reject')).toBe(originalText);
    });
  });
});
