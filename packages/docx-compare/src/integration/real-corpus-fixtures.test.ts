/**
 * The real-corpus fixtures must change only what each scenario names, so the
 * corpus gate measures the comparison and not the fixture. Exercised here on
 * synthetic packages so they run without the corpus:
 *
 * - re-segmentation changes only run boundaries and the targeted word;
 * - paragraph deletion leaves every bookmark paired, so the gate never has to
 *   accept a fixture-made orphan as inherited source damage.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/1142
 * @see https://github.com/UseJunior/safe-docx/issues/1255
 */

import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocuments } from '../index.js';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { checkGeneratedPackage } from '@usejunior/docx-core';
import {
  deleteOneRealParagraph,
  resegmentAndReplaceRealRunText,
  spanningBookmarkBoundaries,
} from './real-corpus-fixtures.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'DOCX Comparison',
  story: 'Word-Authored Agreement Run Re-segmentation',
});

const run = (text: string, bold = false): string =>
  `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

// Preamble-shaped paragraph: plain runs split around punctuation, a bold
// defined term, a bookmark, and a tab run that must not be merged.
const preamble = `<w:p>${[
  run('This agreement (this “'),
  run('Agreement', true),
  run('”'),
  run(')'),
  '<w:bookmarkStart w:id="7" w:name="Fixture"/>',
  run(' is made by the '),
  run('Company', true),
  run('”'),
  run(')'),
  run(','),
  '<w:r><w:tab/></w:r>',
  run('and others'),
  run('.'),
  '<w:bookmarkEnd w:id="7"/>',
].join('')}</w:p><w:p>${run('Company')}${run(' stays.')}</w:p>`;

async function paragraphRuns(document: Buffer): Promise<string[][]> {
  const xml = await (await JSZip.loadAsync(document)).file('word/document.xml')!.async('string');
  const parsed = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(parsed.getElementsByTagNameNS(W_NS, 'p')).map((paragraph) =>
    Array.from(paragraph.getElementsByTagNameNS(W_NS, 'r')).map((runElement) =>
      runElement.getElementsByTagNameNS(W_NS, 't')[0]?.textContent ?? '<tab>'));
}

describe('real-corpus re-segmentation fixture', () => {
  test('merges adjacent same-format plain runs and replaces only the target word', async () => {
    const source = await buildDocxFromBodyXml(preamble);
    const edited = await resegmentAndReplaceRealRunText(source, 'Company', 'SMOKEWORD');
    expect(await paragraphRuns(edited)).toEqual([
      ['This agreement (this “', 'Agreement', '”)', ' is made by the ', 'SMOKEWORD', '”),', '<tab>', 'and others.'],
      ['Company', ' stays.'],
    ]);

    const result = await compareDocuments(source, edited, {
      author: 'Fixture Gate',
      date: new Date('2026-10-03T00:00:00Z'),
    });
    expect(result.stats).toMatchObject({
      insertedRanges: 1, deletedRanges: 1, insertedAtoms: 1, deletedAtoms: 1,
    });

    const resegmented = await resegmentAndReplaceRealRunText(source, 'Company', 'Company');
    const unchanged = await compareDocuments(source, resegmented, {
      author: 'Fixture Gate',
      date: new Date('2026-10-03T00:00:00Z'),
    });
    expect(unchanged.stats).toMatchObject({
      insertedRanges: 0, deletedRanges: 0, insertedAtoms: 0, deletedAtoms: 0,
    });
  });

  test('names a missing target word', async () => {
    const source = await buildDocxFromBodyXml(preamble);
    await expect(resegmentAndReplaceRealRunText(source, 'Absent', 'SMOKEWORD'))
      .rejects.toThrow('no body paragraph has a run reading "Absent"');
  });
});

const deletionTest = testAllure.epic('Document Comparison').withLabels({
  feature: 'DOCX Comparison',
  story: 'Real-Corpus Paragraph Deletion Fixture Bookmark Pairing',
}).conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
);

// The middle paragraph is the one the fixture deletes: it holds a REF-targeted
// bookmark with text after it. It also closes _Before (opened in the first
// paragraph) and opens _Spanning (closed in the third), the NVCA SPA shape
// that left bookmarkEnd 27 orphaned (#1255).
const spanningBody = [
  `<w:p>${run('Opening paragraph that stays in place.')}<w:bookmarkStart w:id="5" w:name="_Before"/>${run(' Before range text.')}</w:p>`,
  `<w:p>${run('Deleted clause opens with ')}<w:bookmarkStart w:id="10" w:name="_RefTarget"/>${run('the targeted words')}<w:bookmarkEnd w:id="10"/>${run(' and continues')}<w:bookmarkEnd w:id="5"/>${run(' until ')}<w:bookmarkStart w:id="27" w:name="_Spanning"/>${run('the spanning range opens.')}</w:p>`,
  `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run('The following paragraph closes it')}<w:bookmarkEnd w:id="27"/>${run(' and keeps going.')}</w:p>`,
  `<w:p>${run('See ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF _RefTarget \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('the targeted words')}<w:r><w:fldChar w:fldCharType="end"/></w:r>${run(' for the closing reference.')}</w:p>`,
].join('');

async function bodyDocument(document: Buffer) {
  const xml = await (await JSZip.loadAsync(document)).file('word/document.xml')!.async('string');
  return new DOMParser().parseFromString(xml, 'text/xml');
}

function bookmarkPairingIssues(issues: Array<{ check: string; message: string }>): string[] {
  return issues.filter((issue) => issue.check === 'bookmark_pairing').map((issue) => issue.message);
}

describe('real-corpus paragraph-deletion fixture', () => {
  deletionTest('moves bookmark boundaries that span the deleted paragraph instead of orphaning them', async () => {
    const source = await buildDocxFromBodyXml(spanningBody);
    expect(bookmarkPairingIssues((await checkGeneratedPackage(source)).issues)).toEqual([]);

    const deleted = (await bodyDocument(source)).getElementsByTagNameNS(W_NS, 'p')[1]!;
    expect(spanningBookmarkBoundaries(deleted).map((node) => `${node.localName}:${node.getAttribute('w:id')}`))
      .toEqual(['bookmarkEnd:5', 'bookmarkStart:27']);

    const fixture = await deleteOneRealParagraph(source);
    expect(fixture.targetedBookmarkNames).toEqual(['_RefTarget']);
    expect(bookmarkPairingIssues((await checkGeneratedPackage(fixture.revised)).issues)).toEqual([]);

    const paragraphs = Array.from((await bodyDocument(fixture.revised)).getElementsByTagNameNS(W_NS, 'p'));
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.slice(0, 2).map((paragraph) => paragraph.textContent)).toEqual([
      'Opening paragraph that stays in place. Before range text.',
      'The following paragraph closes it and keeps going.',
    ]);
    // Both boundaries land at the deletion point, after the next paragraph's
    // properties: _Before now ends there, and _Spanning starts there.
    const following = Array.from(paragraphs[1]!.childNodes)
      .filter((node) => node.nodeType === 1)
      .map((node) => {
        const element = node as XmlElement;
        return element.localName === 'r' ? 'r' : `${element.localName}:${element.getAttribute('w:id') ?? ''}`;
      });
    expect(following).toEqual(['pPr:', 'bookmarkEnd:5', 'bookmarkStart:27', 'r', 'bookmarkEnd:27', 'r']);
    // The REF target was wholly inside the deleted paragraph, so it goes with it.
    expect((await bodyDocument(fixture.revised)).getElementsByTagNameNS(W_NS, 'bookmarkStart'))
      .toHaveLength(2);
  });

  deletionTest('keeps spanning boundaries at body level when a table follows the deletion', async () => {
    // Body-level bookmark boundaries are valid block-level content, so they stay
    // in w:body at the deletion point rather than moving into the table.
    const source = await buildDocxFromBodyXml(spanningBody.replace(/<w:p><w:pPr>.*?<\/w:p>/, '<w:tbl/>'));
    const deleted = (await bodyDocument(source)).getElementsByTagNameNS(W_NS, 'p')[1]!;
    expect(deleted.textContent).toContain('Deleted clause');
    const fixture = await deleteOneRealParagraph(source);
    const body = (await bodyDocument(fixture.revised)).getElementsByTagNameNS(W_NS, 'body')[0]!;
    const children = Array.from(body.childNodes)
      .filter((node) => node.nodeType === 1)
      .map((node) => (node as XmlElement).localName);
    expect(children.slice(0, 4)).toEqual(['p', 'bookmarkEnd', 'bookmarkStart', 'tbl']);
  });
});
