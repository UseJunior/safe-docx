import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { buildSyntheticDocx } from '../integration/synthetic-docx-fixture.js';
import { testAllure } from '../testing/allure-test.js';
import { DocxDocument } from './document.js';
import { convertCommentsToFootnotes } from './note_conversion.js';

const TEST_FEATURE = 'add-configurable-note-presentation';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Note conversion' });

describe(`OpenSpec traceability: ${TEST_FEATURE}`, () => {
  test.openspec('[SDX-PRIM-210] Selected comments become footnotes')('Selected comments become footnotes', async () => {
    const source = await buildSyntheticDocx({
      paragraphs: ['The Guard shall remain properly licensed throughout the Term.'],
      commentOnParagraph: 0,
      commentText: 'Confirm the licensing standard with the counterparty.',
      commentAuthor: 'Drafting Counsel',
      commentAncillaryParts: true,
    });
    const before = await DocxDocument.load(source);
    const beforeText = before.buildDocumentView().nodes.map((node) => node.text).join('\n');

    const result = await convertCommentsToFootnotes(source, {
      presentation: {
        prefix: 'Note to Draft',
        prefixSeparator: ': ',
        prefixStyle: { bold: true, underline: true, highlight: 'yellow' },
      },
    });

    expect(result.report).toMatchObject({
      selected: 1,
      before: { comments: 1, footnotes: 0 },
      after: { comments: 0, footnotes: 1 },
      lossy: false,
    });
    const converted = await DocxDocument.load(result.buffer);
    expect(await converted.getComments()).toEqual([]);
    expect((await converted.getFootnotes())[0]?.text).toBe(
      ' Note to Draft: Confirm the licensing standard with the counterparty.',
    );
    expect(converted.buildDocumentView().nodes.map((node) => node.text).join('\n')).toBe(beforeText);

    const zip = await JSZip.loadAsync(result.buffer);
    const footnotesXml = await zip.file('word/footnotes.xml')!.async('string');
    expect(footnotesXml).toContain('<w:b/>');
    expect(footnotesXml).toContain('<w:u w:val="single"/>');
    expect(footnotesXml).toContain('<w:highlight w:val="yellow"/>');
    expect(footnotesXml).toContain('<w:t>Note to Draft</w:t>');
    expect(footnotesXml).toContain('<w:t xml:space="preserve">: </w:t>');

    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('<w:vertAlign w:val="superscript"/>');
  });

  test.openspec('[SDX-PRIM-212] Footnote markers render as superscript')('Footnote markers render as superscript', async () => {
    const source = await buildSyntheticDocx({
      paragraphs: ['Guard staffing requirement.'],
      commentOnParagraph: 0,
      commentText: 'Drafting note.',
    });
    const { buffer } = await convertCommentsToFootnotes(source);
    const zip = await JSZip.loadAsync(buffer);
    expect(await zip.file('word/footnotes.xml')!.async('string')).toContain('<w:vertAlign w:val="superscript"/>');
    expect(await zip.file('word/document.xml')!.async('string')).toContain('<w:vertAlign w:val="superscript"/>');
  });

  test('preserves a pre-existing substantive footnote', async () => {
    const source = await buildSyntheticDocx({
      paragraphs: ['Existing disclosure.', 'Guard staffing requirement.'],
      footnoteOnParagraph: 0,
      footnoteText: 'This substantive footnote must survive.',
      commentOnParagraph: 1,
      commentText: 'Drafting note.',
    });
    const { buffer, report } = await convertCommentsToFootnotes(source);
    const converted = await DocxDocument.load(buffer);

    expect(report.before.footnotes).toBe(1);
    expect(report.after.footnotes).toBe(2);
    expect((await converted.getFootnotes()).map((note) => note.text)).toEqual([
      'This substantive footnote must survive.',
      ' Drafting note.',
    ]);
  });

  test.openspec('[SDX-PRIM-213] Thread is rejected by default')('Thread is rejected by default', async () => {
    const source = await buildSyntheticDocx({
      paragraphs: ['Guard staffing requirement.'],
      commentOnParagraph: 0,
      commentText: 'Root note.',
      commentAncillaryParts: true,
      replyText: 'Reply note.',
      replyAuthor: 'Reviewer',
    });

    await expect(convertCommentsToFootnotes(source)).rejects.toThrow(/has replies/);
  });

  test.openspec('[SDX-PRIM-214] Explicit flattening is auditable')('Explicit flattening is auditable', async () => {
    const source = await buildSyntheticDocx({
      paragraphs: ['Guard staffing requirement.'],
      commentOnParagraph: 0,
      commentText: 'Root note.',
      commentAncillaryParts: true,
      replyText: 'Reply note.',
      replyAuthor: 'Reviewer',
    });
    const flattened = await convertCommentsToFootnotes(source, { flattenThreads: true });
    expect(flattened.report.lossy).toBe(true);
    expect((await (await DocxDocument.load(flattened.buffer)).getFootnotes())[0]?.text)
      .toContain('Reviewer: Reply note.');
  });

  test.openspec('[SDX-PRIM-211] Unsupported selection is atomic')('Unsupported selection is atomic', async () => {
    const source = await buildSyntheticDocx({
      paragraphs: ['Guard staffing requirement.'],
      commentOnParagraph: 0,
      commentText: 'Drafting note.',
    });
    await expect(convertCommentsToFootnotes(source, {
      presentation: { bodyStyle: { color: 'red' } },
    })).rejects.toThrow(/six hexadecimal digits/);
    await expect(convertCommentsToFootnotes(source, {
      presentation: { prefixStyle: { highlight: 'fuchsia' as 'yellow' } },
    })).rejects.toThrow(/Invalid Word highlight/);
  });
});
