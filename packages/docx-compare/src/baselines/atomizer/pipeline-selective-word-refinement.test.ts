/**
 * A fuzzy changed run inside an aligned paragraph must be refined locally so
 * unchanged inline tokens are not represented as delete+insert or false moves.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/717
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
import { getAtomText } from '../../move-detection.js';
import { el } from '../../testing/dom-test-helpers.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { hierarchicalCompare } from './hierarchicalLcs.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { refineFuzzyRunsWithinAlignedParagraphs } from './selectiveWordRefinement.js';
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
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
    const atom = (text: string): ComparisonUnitAtom => {
      const result = createComparisonUnitAtom({
        contentElement: el('w:t', {}, undefined, text) as WmlElement,
        ancestors: [],
        part,
      });
      result.paragraphIndex = 0;
      return result;
    };
    const originalAtoms = await given('three run-level atoms with one long fuzzy changed run', () => [
      atom('Aligned prefix. '),
      atom('The annual allocation shall remain 10,000 units for each reporting period; review, review, under this agreement.'),
      atom(' Aligned suffix.'),
    ]);
    const revisedAtoms = await given('the aligned revised atoms preserving an interior numeric token', () => [
      atom('Aligned prefix. '),
      atom('The annual allocation will remain 10,000 units for each reporting period; review, review, under this agreement.'),
      atom(' Aligned suffix.'),
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
});
