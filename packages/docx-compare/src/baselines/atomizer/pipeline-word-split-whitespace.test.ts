/**
 * Word-split in-place reconstruction must retain source whitespace when an LCS
 * could otherwise align identical standalone space atoms across reordered text.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/720
 */

import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'Word-Split Whitespace Projection',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.31' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
  );

const ORIGINAL_CHANGED_RUN =
  'vgjwsxyt zjq kotvr uajifak eofxjlas kkqje rb vue Uajifak';
const REVISED_CHANGED_RUN =
  'uajifak eofxjlas kkqje (kotvr cugl xbhov mzqfyfkvf sh qxrpcm (dzb) gcqmm) og vgjwsxyt rb vue Uajifak';
const PREFIX =
  'Stable alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron. ';
const SUFFIX =
  ' Stable suffix pi rho sigma tau upsilon phi chi psi omega remains exactly the same.';

function body(changedRun: string): string {
  return (
    '<w:p>' +
    `<w:r><w:t xml:space="preserve">${PREFIX}</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">${changedRun}</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">${SUFFIX}</w:t></w:r>` +
    '</w:p>'
  );
}

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

function bodyText(bodyXml: string): string {
  return parseXml(
    `<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${bodyXml}</w:root>`,
  ).documentElement.textContent ?? '';
}

describe('adaptive word-split whitespace parity (#720)', () => {
  test('keeps isolated spaces on both projections when words are reordered inside one run', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const originalBody = body(ORIGINAL_CHANGED_RUN);
    const revisedBody = body(REVISED_CHANGED_RUN);
    const original = await given('a paragraph with a multi-word source run', () =>
      buildDocxFromBodyXml(originalBody),
    );
    const revised = await given('the paragraph with reordered and inserted words in that run', () =>
      buildDocxFromBodyXml(revisedBody),
    );

    const result = await when('the adaptive in-place comparison runs', () =>
      compareDocumentsAtomizer(original, revised, {
        comparisonStrategy: 'legacy',
        reconstructionMode: 'inplace',
        date: new Date('2026-07-28T12:00:00Z'),
      }),
    );
    const xml = await documentXml(result.document);

    await then('the highest-fidelity word-split pass satisfies the safety gate', () => {
      expect(result.reconstructionModeUsed).toBe('inplace');
      expect(result.inplaceSuccessDiagnostics?.passUsed).toBe('inplace_word_split');
      expect(result.inplaceSuccessDiagnostics?.precedingFailedAttempts).toEqual([]);
    });

    await and('accept and reject preserve every character, including spaces', () => {
      expect(extractTextWithParagraphs(acceptAllChanges(xml))).toBe(bodyText(revisedBody));
      expect(extractTextWithParagraphs(rejectAllChanges(xml))).toBe(bodyText(originalBody));
    });
  });
});
