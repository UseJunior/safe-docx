import { DOMParser } from '@xmldom/xmldom';
import { compareDocuments } from '@usejunior/docx-compare';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect } from 'vitest';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Revision Boundary Readability',
    story: 'Issue #851 — keep parenthetical enumerators intact',
    severity: 'normal',
  });

const projectRoot = join(dirname(import.meta.url.replace('file://', '')), '../../../..');

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function directRevisionText(xml: string, tagName: 'w:del' | 'w:ins'): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.getElementsByTagName(tagName)).map((wrapper) => wrapper.textContent ?? '');
}

describe('parenthetical enumerator revision boundaries', () => {
  test('deletes the complete old (i) enumerator and inserts the complete new one', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('the reduced ILPA §14.7.1 enumerator rewrite', async () => {
      const original = await buildDocxFromBodyXml(
        paragraph('If, upon any of (i) the first anniversary following the end of the Commitment Period, (ii) a Removal Date, (iii) the liquidation of the Fund and final distribution to the Partners pursuant to Section 18.3.2.2; or (iv) any re-advance of any amounts pursuant to Section 16.3 (Limited Partner Giveback), with respect to any Limited Partner, either:'),
      );
      const revised = await buildDocxFromBodyXml(paragraph('If, upon (i) the liquidation of the Fund and final distribution to the Partners pursuant to Section 18.3.2.2 or (ii) any re-advance of any amounts pursuant to Section 16.3 (Limited Partner Giveback) after the liquidation of the Fund and final distribution to the Partners pursuant to Section 18.3.2.2, with respect to any Limited Partner, either:'));
      const compared = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      const archive = await DocxArchive.load(compared.document);
      xml = await archive.getDocumentXml();
    });

    await when('the inplace redline is emitted', async () => {});

    await then('the changed first enumerator is never split before its closing parenthesis', () => {
      const deletions = directRevisionText(xml, 'w:del');
      const insertions = directRevisionText(xml, 'w:ins');
      expect(
        deletions.some((text) => text.includes('(i) the first anniversary')),
        `deletions: ${JSON.stringify(deletions)} insertions: ${JSON.stringify(insertions)}`,
      ).toBe(true);
      expect(
        insertions.some((text) => text.includes('(i)')),
        `deletions: ${JSON.stringify(deletions)} insertions: ${JSON.stringify(insertions)}`,
      ).toBe(true);
    });
  });

  test('keeps the complete enumerator boundary on the committed ILPA §14.7.1 pair', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('the committed ILPA original and revised agreements', async () => {
      const [original, revised] = await Promise.all([
        readFile(join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx')),
        readFile(join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx')),
      ]);
      const compared = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      const archive = await DocxArchive.load(compared.document);
      xml = await archive.getDocumentXml();
    });

    await when('the real-document redline is emitted', async () => {});

    await then('the old (i) is deleted whole and the new (i) is inserted whole', () => {
      const deletions = directRevisionText(xml, 'w:del');
      const insertions = directRevisionText(xml, 'w:ins');
      expect(deletions.some((text) => text.includes('(i) the first anniversary'))).toBe(true);
      expect(insertions.some((text) => text === '(i)')).toBe(true);
    });
  }, 30_000);

  test('does not redline an unchanged enumerator when only nearby prose changes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('an unchanged (i) followed by a one-word edit in the same item', async () => {
      const original = await buildDocxFromBodyXml(paragraph('(i) below the threshold'));
      const revised = await buildDocxFromBodyXml(paragraph('(i) above the threshold'));
      const compared = await compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: 'inplace' });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
    });

    await when('the nearby prose edit is compared', async () => {});

    await then('only the changed word is revised', () => {
      expect(directRevisionText(xml, 'w:del')).toEqual(['below']);
      expect(directRevisionText(xml, 'w:ins')).toEqual(['above']);
    });
  });

  test('does not borrow enumerator identity from the following paragraph', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml = '';
    await given('an unchanged short enumerator paragraph before an edited paragraph', async () => {
      const original = await buildDocxFromBodyXml(paragraph('Clause (i)') + paragraph('Alpha beta gamma.'));
      const revised = await buildDocxFromBodyXml(paragraph('Clause (i)') + paragraph('Delta epsilon gamma.'));
      const compared = await compareDocuments(original, revised, { engine: 'atomizer', reconstructionMode: 'inplace' });
      expect(compared.reconstructionModeUsed).toBe('inplace');
      xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
    });

    await when('the following paragraph is compared', async () => {});

    await then('the unchanged enumerator is absent from all revisions', () => {
      const revisions = [...directRevisionText(xml, 'w:del'), ...directRevisionText(xml, 'w:ins')];
      expect(revisions.every((text) => !text.includes('(i)'))).toBe(true);
    });
  });
});
