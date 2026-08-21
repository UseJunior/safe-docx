import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { compareDocumentsAtomizer, footnoteDefinitionRequiresCollisionSafeFallback } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

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

async function replaceUserFootnoteContent(docx: Buffer, content: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  const path = 'word/footnotes.xml';
  const xml = await zip.file(path)!.async('string');
  zip.file(
    path,
    xml.replace(
      /(<w:footnote w:id="1">)[\s\S]*?(<\/w:footnote>)/,
      `$1${content}$2`,
    ),
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function addSecondFootnote(docx: Buffer, text: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  const documentPath = 'word/document.xml';
  const documentXml = await zip.file(documentPath)!.async('string');
  zip.file(
    documentPath,
    documentXml.replace(
      '</w:p>',
      '<w:r><w:footnoteReference w:id="2"/></w:r></w:p>',
    ),
  );
  const footnotePath = 'word/footnotes.xml';
  const footnotesXml = await zip.file(footnotePath)!.async('string');
  zip.file(
    footnotePath,
    footnotesXml.replace(
      '</w:footnotes>',
      `<w:footnote w:id="2"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:footnote>` +
        '</w:footnotes>',
    ),
  );
  return zip.generateAsync({ type: 'nodebuffer' });
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
      expect(result.ancillaryFieldEvidence).toMatchObject({
        status: 'passed',
      });
    });
  });

  test('rebuild compares corresponding collision-renumbered footnote definitions in place', async ({
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
        moveDetection: { detectMoves: false },
      });
    });

    await then('one definition carries the old and new text as tracked content', async () => {
      const parts = await resultParts(result.document);
      expect(parts.footnotesXml?.match(/<w:footnote\b/g)).toHaveLength(3);
      expect(parts.footnotesXml).toContain('<w:del');
      expect(parts.footnotesXml).toContain('<w:delText>Original</w:delText>');
      expect(parts.footnotesXml).toContain('<w:ins');
      expect(parts.footnotesXml).toContain('<w:t>Revised</w:t>');
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' });
    });

    await and('both tracked reference sides resolve to that one definition', async () => {
      const parts = await resultParts(result.document);
      expect(acceptAllChanges(parts.documentXml!).match(/<w:footnoteReference w:id="2"/g))
        .toHaveLength(1);
      expect(rejectAllChanges(parts.documentXml!).match(/<w:footnoteReference w:id="2"/g))
        .toHaveLength(1);
      expect(parts.footnotesXml).toMatch(/<w:footnote w:id="2"/);
      expect(result.stats.insertions).toBeGreaterThan(0);
      expect(result.stats.deletions).toBeGreaterThan(0);
    });
  });

  test('rebuild keeps structurally unrelated colliding footnotes distinct', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('same-ID footnotes are anchored in unrelated deleted and inserted paragraphs', async () => {
      original = await buildSyntheticDocx({
        paragraphs: ['Original note anchor', 'Stable paragraph'],
        footnoteOnParagraph: 0,
        footnoteText: 'Original independent definition',
      });
      revised = await buildSyntheticDocx({
        paragraphs: ['Stable paragraph', 'Revised note anchor'],
        footnoteOnParagraph: 1,
        footnoteText: 'Revised independent definition',
      });
    });

    await when('the collision-aware pipeline compares the documents', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        moveDetection: { detectMoves: false },
      });
    });

    await then('renumbering preserves two definitions and two reference identities', async () => {
      const parts = await resultParts(result.document);
      expect(parts.footnotesXml).toContain('Original independent definition');
      expect(parts.footnotesXml).toContain('Revised independent definition');
      expect(parts.footnotesXml).toMatch(/<w:footnote w:id="1"/);
      expect(parts.footnotesXml).toMatch(/<w:footnote w:id="2"/);
      expect(parts.documentXml).toMatch(/<w:footnoteReference w:id="1"/);
      expect(parts.documentXml).toMatch(/<w:footnoteReference w:id="2"/);
    });
  });

  test('inplace compares a corresponding definition under the revised collision-safe id', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('one aligned footnote changes text while retaining its source-local id', async () => {
      original = await buildSyntheticDocx({
        paragraphs: ['Aligned body'],
        footnoteOnParagraph: 0,
        footnoteText: 'Before note text',
      });
      revised = await buildSyntheticDocx({
        paragraphs: ['Aligned body'],
        footnoteOnParagraph: 0,
        footnoteText: 'After note text',
      });
    });

    await when('the pair is compared in place', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        moveDetection: { detectMoves: false },
      });
    });

    await then('one revised-ID definition contains both tracked text sides', async () => {
      const parts = await resultParts(result.document);
      expect(parts.footnotesXml?.match(/<w:footnote\b/g)).toHaveLength(3);
      expect(parts.footnotesXml).toMatch(/<w:footnote w:id="2"/);
      expect(parts.footnotesXml).not.toMatch(/<w:footnote w:id="1"/);
      expect(parts.footnotesXml).toContain('<w:delText>Before</w:delText>');
      expect(parts.footnotesXml).toContain('<w:t>After</w:t>');
      expect(parts.documentXml?.match(/<w:footnoteReference w:id="2"/g)).toHaveLength(2);
      const acceptedDocument = acceptAllChanges(parts.documentXml!);
      const rejectedDocument = rejectAllChanges(parts.documentXml!);
      expect(acceptedDocument.match(/<w:footnoteReference w:id="2"/g)).toHaveLength(1);
      expect(rejectedDocument.match(/<w:footnoteReference w:id="2"/g)).toHaveLength(1);
      const projectedText = (xml: string): string => Array.from(
        new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('w:t'),
        (text) => text.textContent ?? '',
      ).join('');
      expect(projectedText(acceptAllChanges(parts.footnotesXml!))).toBe('After note text');
      expect(projectedText(rejectAllChanges(parts.footnotesXml!))).toBe('Before note text');
    });
  });

  test('field and relationship-bearing definitions retain the collision-safe fallback', () => {
    const parseEntry = (content: string) => new DOMParser().parseFromString(
      `<w:footnote xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${content}</w:footnote>`,
      'application/xml',
    ).documentElement as unknown as Element;
    expect(footnoteDefinitionRequiresCollisionSafeFallback(parseEntry('<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple></w:p>'))).toBe(true);
    expect(footnoteDefinitionRequiresCollisionSafeFallback(parseEntry('<w:p><w:hyperlink r:id="rId7"><w:r><w:t>source</w:t></w:r></w:hyperlink></w:p>'))).toBe(true);
    expect(footnoteDefinitionRequiresCollisionSafeFallback(parseEntry('<w:p><w:drawing r:embed="rId8"/></w:p>'))).toBe(true);
    expect(footnoteDefinitionRequiresCollisionSafeFallback(parseEntry('<w:p><w:r><w:t>plain</w:t></w:r></w:p>'))).toBe(false);
  });

  test('rsid-split two-run definitions do not duplicate retained text', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('aligned footnotes split unchanged and changed text across separate rsid runs', async () => {
      original = await buildSyntheticDocx({
        paragraphs: ['Aligned body'],
        footnoteOnParagraph: 0,
        footnoteText: 'placeholder',
      });
      revised = await buildSyntheticDocx({
        paragraphs: ['Aligned body'],
        footnoteOnParagraph: 0,
        footnoteText: 'placeholder',
      });
      original = await replaceUserFootnoteContent(
        original,
        '<w:p><w:r w:rsidR="00000001"><w:t>Shared </w:t></w:r>' +
          '<w:r w:rsidR="00000002"><w:t>before</w:t></w:r></w:p>',
      );
      revised = await replaceUserFootnoteContent(
        revised,
        '<w:p><w:r w:rsidR="00000003"><w:t>Shared </w:t></w:r>' +
          '<w:r w:rsidR="00000004"><w:t>after</w:t></w:r></w:p>',
      );
    });

    await when('the pair is compared in place', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        moveDetection: { detectMoves: false },
      });
    });

    await then('one definition retains one shared prefix and tracks only the changed suffix', async () => {
      const parts = await resultParts(result.document);
      expect(parts.footnotesXml?.match(/Shared /g)).toHaveLength(1);
      expect(parts.footnotesXml).toContain('<w:delText>before</w:delText>');
      expect(parts.footnotesXml).toContain('<w:t>after</w:t>');
      expect(parts.footnotesXml?.match(/<w:footnote\b/g)).toHaveLength(3);
    });
  });

  test('unrepresentable table-to-paragraph definitions retain collision-safe definitions', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('an aligned footnote changes from table content to a paragraph', async () => {
      original = await buildSyntheticDocx({
        paragraphs: ['Aligned body'],
        footnoteOnParagraph: 0,
        footnoteText: 'placeholder',
      });
      revised = await buildSyntheticDocx({
        paragraphs: ['Aligned body'],
        footnoteOnParagraph: 0,
        footnoteText: 'placeholder',
      });
      original = await replaceUserFootnoteContent(
        original,
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Original table note</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      );
      revised = await replaceUserFootnoteContent(
        revised,
        '<w:p><w:r><w:t>Revised paragraph note</w:t></w:r></w:p>',
      );
    });

    await when('the document is compared', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        moveDetection: { detectMoves: false },
      });
    });

    await then('comparison succeeds with both definitions and resolvable distinct references', async () => {
      const parts = await resultParts(result.document);
      expect(parts.footnotesXml).toContain('Original table note');
      expect(parts.footnotesXml).toContain('Revised paragraph note');
      expect(parts.footnotesXml).toMatch(/<w:footnote w:id="1"/);
      expect(parts.footnotesXml).toMatch(/<w:footnote w:id="2"/);
      expect(parts.documentXml).toMatch(/<w:footnoteReference w:id="1"/);
      expect(parts.documentXml).toMatch(/<w:footnoteReference w:id="2"/);
    });
  });

  test('two edited footnotes in one aligned paragraph skip ambiguous ID reconciliation', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('one aligned paragraph contains two independently edited footnote anchors', async () => {
      original = await buildSyntheticDocx({
        paragraphs: ['Stable body'],
        footnoteOnParagraph: 0,
        footnoteText: 'Original first note',
      });
      revised = await buildSyntheticDocx({
        paragraphs: ['Stable body'],
        footnoteOnParagraph: 0,
        footnoteText: 'Revised first note',
      });
      original = await addSecondFootnote(original, 'Original second note');
      revised = await addSecondFootnote(revised, 'Revised second note');
    });

    await when('the pair is compared in rebuild mode', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        moveDetection: { detectMoves: false },
      });
    });

    await then('the ambiguous pairs are not rewritten and projections retain both anchors', async () => {
      const parts = await resultParts(result.document);
      expect(parts.footnotesXml).toContain('Original first note');
      expect(parts.footnotesXml).toContain('Original second note');
      expect(parts.footnotesXml).toContain('Revised first note');
      expect(parts.footnotesXml).not.toContain('<w:ins');
      expect(parts.footnotesXml).not.toContain('<w:del');

      const accepted = acceptAllChanges(parts.documentXml!);
      const rejected = rejectAllChanges(parts.documentXml!);
      expect(accepted.match(/<w:footnoteReference\b/g)?.length ?? 0).toBeGreaterThan(0);
      expect(rejected.match(/<w:footnoteReference\b/g)?.length ?? 0).toBeGreaterThan(0);
      expect(accepted).not.toContain('<w:del');
      expect(rejected).not.toContain('<w:ins');

      const definitionIds = new Set(
        [...parts.footnotesXml!.matchAll(/<w:footnote\b[^>]*w:id="([^\"]+)"/g)]
          .map((match) => match[1]),
      );
      for (const projection of [accepted, rejected]) {
        for (const match of projection.matchAll(/<w:footnoteReference\b[^>]*w:id="([^\"]+)"/g)) {
          expect(definitionIds.has(match[1]!)).toBe(true);
        }
      }
    });
  });
});
