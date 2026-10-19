import { describe, expect } from 'vitest';
import {
  acceptChanges,
  buildDocxFromParts,
  DocxArchive,
  parseXml,
  rejectChanges,
  serializeXml,
} from '@usejunior/docx-core';
import { compareDocuments } from '../index.js';
import { testAllure } from '../testing/allure-test.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph split and merge' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.16' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (text: string, jc?: string): string =>
  `<w:p>${jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : ''}${run(text)}</w:p>`;

interface Paragraph { text: string; jc: string | null }

function paragraphs(xml: string): Paragraph[] {
  const body = parseXml(xml).getElementsByTagNameNS(W, 'body')[0]!;
  return Array.from(body.getElementsByTagNameNS(W, 'p')).map((p) => ({
    text: Array.from(p.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join(''),
    jc: p.getElementsByTagNameNS(W, 'pPr')[0]
      ?.getElementsByTagNameNS(W, 'jc')[0]?.getAttributeNS(W, 'val') ?? null,
  }));
}

/** Live (not deleted or pPrChange-snapshot) paragraph properties in document order. */
function liveParagraphs(xml: string): Paragraph[] {
  const body = parseXml(xml).getElementsByTagNameNS(W, 'body')[0]!;
  return Array.from(body.getElementsByTagNameNS(W, 'p')).map((p) => {
    const pPr = Array.from(p.childNodes).find((node) => (node as Element).localName === 'pPr') as Element | undefined;
    const jc = pPr && Array.from(pPr.childNodes).find((node) => (node as Element).localName === 'jc') as Element | undefined;
    return {
      text: Array.from(p.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join(''),
      jc: jc?.getAttributeNS(W, 'val') ?? null,
    };
  });
}

async function compareBodies(original: string, revised: string) {
  const result = await compareDocuments(
    await buildDocxFromParts({ bodyXml: original }),
    await buildDocxFromParts({ bodyXml: revised }),
  );
  const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
  return { xml, stats: result.stats };
}

function expectRoundTrips(xml: string, original: string, revised: string): void {
  const wrap = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const expected = { accept: liveParagraphs(wrap(revised)), reject: liveParagraphs(wrap(original)) };
  expect(liveParagraphs(acceptAllChanges(xml))).toEqual(expected.accept);
  expect(liveParagraphs(rejectAllChanges(xml))).toEqual(expected.reject);
  for (const [operation, project] of [['accept', acceptChanges], ['reject', rejectChanges]] as const) {
    const document = parseXml(xml);
    project(document);
    expect(liveParagraphs(serializeXml(document))).toEqual(expected[operation]);
  }
}

function revisionTexts(xml: string, localName: 'ins' | 'del'): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, localName))
    .filter((element) => (element.parentNode as Element).localName !== 'rPr')
    .map((element) => element.textContent ?? '');
}

function markRevisions(xml: string, localName: 'ins' | 'del'): number {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, localName))
    .filter((element) => (element.parentNode as Element).localName === 'rPr' &&
      ((element.parentNode as Element).parentNode as Element).localName === 'pPr').length;
}

const JOINED = 'First clause stands alone. Second clause follows directly.';
const FIRST = 'First clause stands alone.';
const SECOND = 'Second clause follows directly.';

describe('paragraph split and merge record only the paragraph mark (#873)', () => {
  test('a split inserts the first paragraph mark and deletes only the joining space', async () => {
    const original = para(JOINED);
    const revised = para(FIRST) + para(SECOND);
    const { xml, stats } = await compareBodies(original, revised);
    expect(markRevisions(xml, 'ins')).toBe(1);
    expect(markRevisions(xml, 'del')).toBe(0);
    expect(revisionTexts(xml, 'ins')).toEqual([]);
    expect(revisionTexts(xml, 'del')).toEqual([' ']);
    expect(paragraphs(xml).map((p) => p.text)).toEqual([FIRST, SECOND]);
    expect(stats).toMatchObject({
      insertedRanges: 1, deletedRanges: 1, insertedAtoms: 1, deletedAtoms: 1, modifiedParagraphs: 0,
    });
    expectRoundTrips(xml, original, revised);
  });

  test('a merge deletes the first paragraph mark and inserts only the joining space', async () => {
    const original = para(FIRST) + para(SECOND);
    const revised = para(JOINED);
    const { xml, stats } = await compareBodies(original, revised);
    expect(markRevisions(xml, 'del')).toBe(1);
    expect(markRevisions(xml, 'ins')).toBe(0);
    expect(revisionTexts(xml, 'del')).toEqual([]);
    expect(revisionTexts(xml, 'ins')).toEqual([' ']);
    expect(stats).toMatchObject({
      insertedRanges: 1, deletedRanges: 1, insertedAtoms: 1, deletedAtoms: 1, modifiedParagraphs: 0,
    });
    expectRoundTrips(xml, original, revised);
  });

  test('an edit at the seam stays a local word revision', async () => {
    const original = para(JOINED);
    const revised = para('First clause stands alone!') + para(SECOND);
    const { xml } = await compareBodies(original, revised);
    expect(markRevisions(xml, 'ins')).toBe(1);
    expect(revisionTexts(xml, 'del').join('')).toBe('. ');
    expect(revisionTexts(xml, 'ins').join('')).toBe('!');
    expectRoundTrips(xml, original, revised);
  });

  test('a three-way split and merge mark every interior paragraph mark', async () => {
    const parts = ['Alpha clause one.', 'Beta clause two.', 'Gamma clause three.'];
    const joined = para(parts.join(' '));
    const split = parts.map((text) => para(text)).join('');
    const forward = await compareBodies(joined, split);
    expect(markRevisions(forward.xml, 'ins')).toBe(2);
    expect(revisionTexts(forward.xml, 'del')).toEqual([' ', ' ']);
    expect(forward.stats).toMatchObject({ insertedAtoms: 2, deletedAtoms: 2, modifiedParagraphs: 0 });
    expectRoundTrips(forward.xml, joined, split);
    const backward = await compareBodies(split, joined);
    expect(markRevisions(backward.xml, 'del')).toBe(2);
    expect(revisionTexts(backward.xml, 'ins')).toEqual([' ', ' ']);
    expectRoundTrips(backward.xml, split, joined);
  });

  test('changed paragraph properties are tracked on every part, so either surviving mark is correct', async () => {
    const original = para(JOINED, 'right');
    const revised = para(FIRST, 'center') + para(SECOND, 'both');
    const split = await compareBodies(original, revised);
    expect(revisionTexts(split.xml, 'ins')).toEqual([]);
    expect(parseXml(split.xml).getElementsByTagNameNS(W, 'pPrChange')).toHaveLength(2);
    expect(split.stats.formatChanges).toBe(2);
    expectRoundTrips(split.xml, original, revised);

    const merged = await compareBodies(para(FIRST, 'right') + para(SECOND, 'center'), para(JOINED, 'both'));
    expect(revisionTexts(merged.xml, 'del')).toEqual([]);
    expect(parseXml(merged.xml).getElementsByTagNameNS(W, 'pPrChange')).toHaveLength(2);
    expectRoundTrips(merged.xml, para(FIRST, 'right') + para(SECOND, 'center'), para(JOINED, 'both'));
  });

  test('a split inside a table cell and among unchanged paragraphs', async () => {
    const table = (content: string) => '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
      `<w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`;
    const original = para('Before stays.') + table(para(JOINED)) + para('After stays.');
    const revised = para('Before stays.') + table(para(FIRST) + para(SECOND)) + para('After stays.');
    const { xml } = await compareBodies(original, revised);
    expect(markRevisions(xml, 'ins')).toBe(1);
    expect(revisionTexts(xml, 'del')).toEqual([' ']);
    expect(revisionTexts(xml, 'ins')).toEqual([]);
    expectRoundTrips(xml, original, revised);
  });

  test('a run split across the seam keeps its run properties on both sides', async () => {
    const bold = `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${JOINED}</w:t></w:r></w:p>`;
    const boldPart = (text: string) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
    const { xml, stats } = await compareBodies(bold, boldPart(FIRST) + boldPart(SECOND));
    expect(revisionTexts(xml, 'del')).toEqual([' ']);
    expect(stats.formatChanges).toBe(0);
    expect(parseXml(xml).getElementsByTagNameNS(W, 'b')).toHaveLength(3);
  });

  test('a bookmark that opens and closes at the seam stays with the following paragraph', async () => {
    const bookmark = '<w:bookmarkStart w:id="5" w:name="_Toc1"/><w:bookmarkEnd w:id="5"/>';
    const original = `<w:p>${run('First clause stands alone. ')}${bookmark}${run(SECOND)}</w:p>`;
    const revised = para(FIRST) + `<w:p>${bookmark}${run(SECOND)}</w:p>`;
    const { xml, stats } = await compareBodies(original, revised);
    const document = parseXml(xml);
    expect(revisionTexts(xml, 'del')).toEqual([' ']);
    expect(stats).toMatchObject({ insertedRanges: 1, deletedRanges: 1 });
    for (const marker of ['bookmarkStart', 'bookmarkEnd']) {
      const markers = Array.from(document.getElementsByTagNameNS(W, marker));
      expect(markers).toHaveLength(1);
      expect((markers[0]!.parentNode as Element).localName).toBe('p');
    }
    expectRoundTrips(xml, original, revised);
  });

  test('an unrelated new paragraph is still a whole-paragraph insertion', async () => {
    const original = para('Alpha beta gamma delta epsilon.');
    const revised = para('Alpha beta gamma delta epsilon zeta.') + para('Completely different words appear here.');
    const { xml } = await compareBodies(original, revised);
    expect(markRevisions(xml, 'ins')).toBe(1);
    expect(revisionTexts(xml, 'ins')).toContain('Completely different words appear here.');
  });

  test('a short neighbour that only repeats a word does not turn an edit into a split', async () => {
    // Every word of the short paragraph is in the original, but the edited
    // paragraph already aligns all of it: the neighbour contributes nothing.
    const original = para('Alpha beta gamma delta epsilon.');
    const revised = para('Alpha beta gamma delta epsilon zeta.') + para('epsilon');
    const { xml } = await compareBodies(original, revised);
    expect(revisionTexts(xml, 'ins')).toContain('epsilon');
    expect(markRevisions(xml, 'ins')).toBe(1);
    expect(paragraphs(xml).at(-1)!.text).toBe('epsilon');
  });

  test('paragraphs outside the plain scope keep the delete-and-insert behavior', async () => {
    const original = `<w:p><w:r><w:t xml:space="preserve">${FIRST}</w:t><w:br/><w:t xml:space="preserve"> ${SECOND}</w:t></w:r></w:p>`;
    const revised = para(FIRST) + para(SECOND);
    const { xml } = await compareBodies(original, revised);
    expect(revisionTexts(xml, 'ins').join('')).toContain(SECOND);
    expectRoundTrips(xml, original, revised);
  });
});
