import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { OOXML } from '../src/primitives/namespaces.js';
import { parseXml } from '../src/primitives/xml.js';
import { getFootnote, getFootnotes } from '../src/primitives/footnotes.js';
import { DocxZip } from '../src/primitives/zip.js';
import { parseStylesXml } from '../src/primitives/styles.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

// One TEST_FEATURE per file; this file covers the structured-footnote model
// upgrade (multi-paragraph bodies + run-level formatting + plural refs).
const TEST_FEATURE = 'add-read-file-structured-footnotes';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

function makeDocumentXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

function bookmarkedParagraph(id: string, innerXml: string): string {
  return (
    `<w:p>` +
    `<w:bookmarkStart w:id="0" w:name="${id}"/>` +
    innerXml +
    `<w:bookmarkEnd w:id="0"/>` +
    `</w:p>`
  );
}

/** A paragraph carrying a footnote reference to `noteId`. */
function refParagraph(bookmarkId: string, text: string, noteId: number): string {
  return bookmarkedParagraph(
    bookmarkId,
    `<w:r><w:t>${text}</w:t></w:r>` +
      `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${noteId}"/></w:r>`,
  );
}

function footnotesXml(footnoteEntries: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:footnotes xmlns:w="${OOXML.W_NS}" xmlns:w14="${OOXML.W14_NS}">` +
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    footnoteEntries +
    `</w:footnotes>`
  );
}

/** A footnote body paragraph with the auto-number glyph run + a body text run. */
function footnoteBodyParagraph(bodyRunsXml: string): string {
  return (
    `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>` +
    `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>` +
    `<w:r><w:t xml:space="preserve"> </w:t></w:r>` +
    bodyRunsXml +
    `</w:p>`
  );
}

async function loadZip(files: Record<string, string>): Promise<DocxZip> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
  return DocxZip.load(buffer);
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${OOXML.W_NS}"></w:styles>`;

describe('structured footnote model', () => {
  test.openspec('Zero user footnotes yields empty result')(
    'Zero user footnotes yields empty result',
    async ({ given, when, then }: AllureBddContext) => {
      const documentXml = await given('a document with no footnotes part', async () =>
        makeDocumentXml(bookmarkedParagraph('_bk_a', '<w:r><w:t>Body.</w:t></w:r>')),
      );
      const notes = await when('footnotes are read', async () => {
        const zip = await loadZip({ 'word/document.xml': documentXml });
        return getFootnotes(zip, parseXml(documentXml));
      });
      await then('the result is an empty array', async () => {
        expect(notes).toEqual([]);
      });
    },
  );

  test('single footnote exposes paragraphs and plural refs',
    async ({ given, when, then }: AllureBddContext) => {
      const files = await given('one anchored single-paragraph footnote', async () => {
        const documentXml = makeDocumentXml(refParagraph('_bk_anchor', 'See note', 1));
        const fnXml = footnotesXml(
          `<w:footnote w:id="1">${footnoteBodyParagraph('<w:r><w:t>Alpha body.</w:t></w:r>')}</w:footnote>`,
        );
        return { documentXml, fnXml };
      });
      const note = await when('the footnote is read', async () => {
        const zip = await loadZip({
          'word/document.xml': files.documentXml,
          'word/footnotes.xml': files.fnXml,
          'word/styles.xml': STYLES_XML,
        });
        return getFootnote(zip, parseXml(files.documentXml), 1, parseStylesXml(parseXml(STYLES_XML)));
      });
      await then('id, display, text, paragraphs and refs are populated', async () => {
        expect(note).not.toBeNull();
        expect(note!.id).toBe(1);
        expect(note!.displayNumber).toBe(1);
        // The leading separator space run (Word's number+space+text shape) is
        // faithfully retained, exactly as extractFootnoteText has always done.
        expect(note!.text).toBe(' Alpha body.');
        expect(note!.anchoredParagraphId).toBe('_bk_anchor');
        expect(note!.refParagraphIds).toEqual(['_bk_anchor']);
        expect(note!.paragraphs).toHaveLength(1);
        expect(note!.paragraphs[0]).toMatchObject({ text: ' Alpha body.', style: 'FootnoteText' });
      });
    },
  );

  test.openspec('Multi-paragraph footnote body preserved')(
    'Multi-paragraph footnote body preserved',
    async ({ given, when, then }: AllureBddContext) => {
      const files = await given('a two-paragraph footnote body', async () => {
        const documentXml = makeDocumentXml(refParagraph('_bk_anchor', 'See', 1));
        const fnXml = footnotesXml(
          `<w:footnote w:id="1">` +
            footnoteBodyParagraph('<w:r><w:t>First para.</w:t></w:r>') +
            `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:t>Second para.</w:t></w:r></w:p>` +
            `</w:footnote>`,
        );
        return { documentXml, fnXml };
      });
      const note = await when('the footnote is read', async () => {
        const zip = await loadZip({
          'word/document.xml': files.documentXml,
          'word/footnotes.xml': files.fnXml,
        });
        return getFootnote(zip, parseXml(files.documentXml), 1);
      });
      await then('paragraphs has one entry per body paragraph and text is \\n-joined', async () => {
        expect(note!.paragraphs).toHaveLength(2);
        // First paragraph carries the separator space run; the second is a bare
        // continuation paragraph with no glyph/space.
        expect(note!.paragraphs.map((p) => p.text)).toEqual([' First para.', 'Second para.']);
        expect(note!.text).toBe(' First para.\nSecond para.');
      });
    },
  );

  test.openspec('Footnote-internal run formatting preserved')(
    'Footnote-internal run formatting preserved',
    async ({ given, when, then }: AllureBddContext) => {
      const files = await given('a footnote paragraph mixing plain, bold, italic runs', async () => {
        const documentXml = makeDocumentXml(refParagraph('_bk_anchor', 'See', 1));
        const body =
          `<w:r><w:t xml:space="preserve">plain </w:t></w:r>` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>` +
          `<w:r><w:t xml:space="preserve"> </w:t></w:r>` +
          `<w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>`;
        const fnXml = footnotesXml(
          `<w:footnote w:id="1">${footnoteBodyParagraph(body)}</w:footnote>`,
        );
        return { documentXml, fnXml };
      });
      const note = await when('the footnote is read', async () => {
        const zip = await loadZip({
          'word/document.xml': files.documentXml,
          'word/footnotes.xml': files.fnXml,
        });
        return getFootnote(zip, parseXml(files.documentXml), 1);
      });
      await then('tagged_text wraps the bold and italic runs', async () => {
        const tagged = note!.paragraphs[0]!.tagged_text;
        expect(tagged).toContain('<b>bold</b>');
        expect(tagged).toContain('<i>italic</i>');
        expect(note!.paragraphs[0]!.text).toBe(' plain bold italic');
      });
    },
  );

  test.openspec('Reference paragraph ids are an array')(
    'Reference paragraph ids are an array',
    async ({ given, when, then }: AllureBddContext) => {
      const files = await given('a malformed doc reusing one footnote id from two paragraphs', async () => {
        const documentXml = makeDocumentXml(
          refParagraph('_bk_first', 'First anchor', 1) + refParagraph('_bk_second', 'Second anchor', 1),
        );
        const fnXml = footnotesXml(
          `<w:footnote w:id="1">${footnoteBodyParagraph('<w:r><w:t>Shared note.</w:t></w:r>')}</w:footnote>`,
        );
        return { documentXml, fnXml };
      });
      const note = await when('the footnote is read', async () => {
        const zip = await loadZip({
          'word/document.xml': files.documentXml,
          'word/footnotes.xml': files.fnXml,
        });
        return getFootnote(zip, parseXml(files.documentXml), 1);
      });
      await then('refParagraphIds contains both, anchoredParagraphId is the first', async () => {
        expect(note!.refParagraphIds).toEqual(['_bk_first', '_bk_second']);
        expect(note!.anchoredParagraphId).toBe('_bk_first');
      });
    },
  );

  test('footnote containing a nested footnote reference reads cleanly',
    async ({ given, when, then }: AllureBddContext) => {
      const files = await given('footnote 1 whose body references footnote 2', async () => {
        const documentXml = makeDocumentXml(refParagraph('_bk_anchor', 'See', 1));
        const nestedBody =
          `<w:r><w:t xml:space="preserve">outer </w:t></w:r>` +
          `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r>`;
        const fnXml = footnotesXml(
          `<w:footnote w:id="1">${footnoteBodyParagraph(nestedBody)}</w:footnote>` +
            `<w:footnote w:id="2">${footnoteBodyParagraph('<w:r><w:t>inner note.</w:t></w:r>')}</w:footnote>`,
        );
        return { documentXml, fnXml };
      });
      const notes = await when('all footnotes are read', async () => {
        const zip = await loadZip({
          'word/document.xml': files.documentXml,
          'word/footnotes.xml': files.fnXml,
        });
        return getFootnotes(zip, parseXml(files.documentXml));
      });
      await then('both footnotes are present and outer body text excludes the nested glyph', async () => {
        const byId = new Map(notes.map((n) => [n.id, n]));
        // Outer body text is the separator space + "outer "; the nested
        // footnoteReference glyph run contributes no text.
        expect(byId.get(1)!.text).toBe(' outer ');
        expect(byId.get(2)!.text).toBe(' inner note.');
      });
    },
  );
});
