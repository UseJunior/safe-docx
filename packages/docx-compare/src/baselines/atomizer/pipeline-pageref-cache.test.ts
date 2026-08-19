/**
 * Cached PAGEREF results are layout artifacts, not authored TOC edits.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @see https://github.com/UseJunior/safe-docx/issues/716
 */

import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import {
  buildDocxFromBodyXml,
  completeField,
  fldChar,
  instrText,
  resultText,
} from '../../testing/ooxml-fixtures.js';
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
    story: 'TOC PAGEREF Cached Results',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.45' },
  );

interface TocEntry {
  title: string;
  target: string;
  page: string;
}

function tocEntry(entry: TocEntry): string {
  return (
    '<w:p>' +
    '<w:pPr><w:pStyle w:val="TOC1"/></w:pPr>' +
    `<w:hyperlink w:anchor="${entry.target}">` +
    resultText(entry.title) +
    '<w:r><w:tab/></w:r>' +
    completeField(` PAGEREF ${entry.target} \\h `, entry.page) +
    '</w:hyperlink>' +
    '</w:p>'
  );
}

function tocBody(entries: TocEntry[]): string {
  const [first, ...rest] = entries;
  if (!first) throw new Error('TOC fixture requires at least one entry');
  return (
    '<w:p>' +
    fldChar('begin') +
    instrText(' TOC \\o "1-3" \\h \\z \\u ', { preserve: true }) +
    fldChar('separate') +
    '</w:p>' +
    tocEntry(first) +
    rest.map(tocEntry).join('') +
    `<w:p>${fldChar('end')}</w:p>`
  );
}

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

function revisionTexts(xml: string): string[] {
  const document = parseXml(xml);
  return ['ins', 'del'].flatMap((localName) =>
    Array.from(
      document.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        localName,
      ),
    ).map((element) => element.textContent ?? ''),
  );
}

function cacheInsensitiveText(xml: string): string {
  return extractTextWithParagraphs(xml).replace(/\d+/gu, '{PAGE}');
}

const ORIGINAL: TocEntry[] = [
  { title: 'Alpha Topic', target: '_Toc100', page: '3' },
  { title: 'Beta Topic', target: '_Toc200', page: '5' },
  { title: 'Gamma Topic', target: '_Toc300', page: '8' },
];

describe('cached PAGEREF comparison (#716)', () => {
  test('does not mark repaginated cached results as authored changes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const original = await given('a multi-paragraph TOC with three PAGEREF fields', () =>
      buildDocxFromBodyXml(tocBody(ORIGINAL)),
    );
    const revised = await given('the same TOC after pagination changes every cached result', () =>
      buildDocxFromBodyXml(
        tocBody(ORIGINAL.map((entry, index) => ({ ...entry, page: String(10 + index) }))),
      ),
    );

    const result = await when('the adaptive in-place comparison runs', () =>
      compareDocumentsAtomizer(original, revised, {
        date: new Date('2026-07-28T12:00:00Z'),
      }),
    );
    const outputXml = await documentXml(result.document);

    await then('the cached page numbers produce no insertion or deletion', async () => {
      expect(revisionTexts(outputXml)).toEqual([]);
    });
    await then('the sole tagged path succeeds', () => {
      expect(result.comparisonStrategyUsed).toBe('tagged-tree');
    });
    await then('both cache-insensitive projections preserve their source TOC', async () => {
      expect(cacheInsensitiveText(acceptAllChanges(outputXml))).toBe(
        cacheInsensitiveText(await documentXml(revised)),
      );
      expect(cacheInsensitiveText(rejectAllChanges(outputXml))).toBe(
        cacheInsensitiveText(await documentXml(original)),
      );
    });
  });

  test('still represents a renamed and newly added TOC entry without revising page caches', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const original = await given('the original three-entry TOC', () =>
      buildDocxFromBodyXml(tocBody(ORIGINAL)),
    );
    const revisedEntries: TocEntry[] = [
      ORIGINAL[0]!,
      { ...ORIGINAL[1]!, title: 'Beta Topic Revised' },
      { title: 'Delta Topic', target: '_Toc250', page: '12' },
      ORIGINAL[2]!,
    ];
    const revised = await given('a renamed entry and a new entry with stable existing caches', () =>
      buildDocxFromBodyXml(tocBody(revisedEntries)),
    );

    const result = await when('the adaptive in-place comparison runs', () =>
      compareDocumentsAtomizer(original, revised, {
        date: new Date('2026-07-28T12:00:00Z'),
      }),
    );
    const outputXml = await documentXml(result.document);
    const revisions = revisionTexts(outputXml);

    await then('the substantive entry edits remain visible', () => {
      expect(revisions.join(' ')).toContain('Revised');
      expect(revisions.join(' ')).toContain('Delta Topic');
    });
    await and('no cached page number is marked as inserted or deleted', () => {
      expect(revisions).not.toContainEqual(expect.stringMatching(/^\d+$/u));
    });
    await and('accept and reject recover the intended TOC apart from volatile caches', async () => {
      expect(cacheInsensitiveText(acceptAllChanges(outputXml))).toBe(
        cacheInsensitiveText(await documentXml(revised)),
      );
      expect(cacheInsensitiveText(rejectAllChanges(outputXml))).toBe(
        cacheInsensitiveText(await documentXml(original)),
      );
    });
  });
});
