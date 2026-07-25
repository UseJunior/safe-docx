import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { compareDocumentsAtomizer } from './pipeline.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Pipeline Auxiliary Note Merge' });

async function resultParts(docx: Buffer) {
  const zip = await JSZip.loadAsync(docx);
  const read = async (path: string): Promise<string | null> =>
    (await zip.file(path)?.async('string')) ?? null;
  return {
    documentXml: await read('word/document.xml'),
    footnotesXml: await read('word/footnotes.xml'),
    endnotesXml: await read('word/endnotes.xml'),
    contentTypesXml: await read('[Content_Types].xml'),
    relsXml: await read('word/_rels/document.xml.rels'),
  };
}

describe('pipeline auxiliary note publication', () => {
  test('rebuild creates referenced footnote and endnote parts with package metadata', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('a plain original and a revised document with new footnote and endnote stories', async () => {
      original = await buildSyntheticDocx({ paragraphs: ['Stable body text'] });
      revised = await buildSyntheticDocx({
        paragraphs: ['Stable body text'],
        footnoteOnParagraph: 0,
        footnoteText: 'Inserted footnote definition',
        endnoteOnParagraph: 0,
        endnoteText: 'Inserted endnote definition',
      });
    });

    await when('the pair is compared using rebuild reconstruction', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        author: 'Pipeline test',
        date: new Date('2025-01-01T00:00:00Z'),
        reconstructionMode: 'rebuild',
      });
    });

    await then('the emitted main story tracks both inserted note references', async () => {
      const parts = await resultParts(result.document);
      expect(parts.documentXml).toContain('<w:ins');
      expect(parts.documentXml).toContain('<w:footnoteReference w:id="1"');
      expect(parts.documentXml).toContain('<w:endnoteReference w:id="1"');
    });

    await and('the referenced definitions and reserved separator entries are published', async () => {
      const parts = await resultParts(result.document);
      expect(parts.footnotesXml).toContain('Inserted footnote definition');
      expect(parts.footnotesXml).toContain('w:type="separator"');
      expect(parts.footnotesXml).toContain('w:type="continuationSeparator"');
      expect(parts.endnotesXml).toContain('Inserted endnote definition');
      expect(parts.endnotesXml).toContain('w:type="separator"');
      expect(parts.endnotesXml).toContain('w:type="continuationSeparator"');
    });

    await and('content types and document relationships advertise both created parts', async () => {
      const parts = await resultParts(result.document);
      expect(parts.contentTypesXml).toContain('PartName="/word/footnotes.xml"');
      expect(parts.contentTypesXml).toContain('PartName="/word/endnotes.xml"');
      expect(parts.relsXml).toContain('Target="footnotes.xml"');
      expect(parts.relsXml).toContain('Target="endnotes.xml"');
      expect(result.reconstructionModeUsed).toBe('rebuild');
      expect(result.ancillaryFieldEvidence).toMatchObject({
        status: 'passed',
        reconstructionMode: 'rebuild',
      });
    });
  });

  test('rebuild appends a renumbered revised footnote to an existing original part', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('both documents use footnote id 1 for different definitions', async () => {
      original = await buildSyntheticDocx({
        paragraphs: ['Original body'],
        footnoteOnParagraph: 0,
        footnoteText: 'Original footnote definition',
      });
      revised = await buildSyntheticDocx({
        paragraphs: ['Revised body'],
        footnoteOnParagraph: 0,
        footnoteText: 'Revised footnote definition',
      });
    });

    await when('the collision-aware pipeline compares the documents', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        reconstructionMode: 'rebuild',
        moveDetection: { detectMoves: false },
      });
    });

    await then('the output preserves both independently authored definitions', async () => {
      const parts = await resultParts(result.document);
      expect(parts.footnotesXml).toContain('Original footnote definition');
      expect(parts.footnotesXml).toContain('Revised footnote definition');
    });

    await and('the revised anchor points at a distinct non-reserved id', async () => {
      const parts = await resultParts(result.document);
      expect(parts.documentXml).toMatch(/<w:footnoteReference w:id="2"/);
      expect(parts.footnotesXml).toMatch(/<w:footnote w:id="2"/);
      expect(result.stats.insertions).toBeGreaterThan(0);
      expect(result.stats.deletions).toBeGreaterThan(0);
    });
  });
});
