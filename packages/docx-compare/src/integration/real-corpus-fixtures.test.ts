/**
 * The real-corpus re-segmentation fixture must change only run boundaries and
 * the targeted word, so the corpus gate measures the comparison and not the
 * fixture. Exercised here on a synthetic package so it runs without the corpus.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1142
 */

import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocuments } from '../index.js';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { resegmentAndReplaceRealRunText } from './real-corpus-fixtures.js';

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
