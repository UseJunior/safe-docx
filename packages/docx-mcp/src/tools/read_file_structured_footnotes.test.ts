import { describe, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  createTestSessionManager,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { addFootnote } from './add_footnote.js';
import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';

// One TEST_FEATURE per file; this file covers the #207 single-call body +
// footnotes retrieval (top-level JSON `footnotes` + toon `#FOOTNOTES`).
const TEST_FEATURE = 'add-read-file-structured-footnotes';
const test = testAllure.epic('Document Reading').withLabels({ feature: TEST_FEATURE });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NVCA_SOURCE = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/source.docx');

type TopLevelFootnote = {
  id: string;
  display_number: number;
  ref_paragraph_ids: string[];
  paragraphs: { text: string; tagged_text: string; style: string | null }[];
};

function topLevelFootnotes(read: Record<string, unknown>): TopLevelFootnote[] | undefined {
  return read.footnotes as TopLevelFootnote[] | undefined;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** A document.xml whose single paragraph references footnote `noteId`. */
function documentReferencing(noteId: number, leadText = 'Body text'): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>` +
    `<w:p>` +
    `<w:r><w:t>${leadText}</w:t></w:r>` +
    `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${noteId}"/></w:r>` +
    `</w:p>` +
    `</w:body></w:document>`
  );
}

function footnotesPart(footnoteEntries: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:footnotes xmlns:w="${W_NS}" xmlns:w14="${W14_NS}">` +
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    footnoteEntries +
    `</w:footnotes>`
  );
}

describe('OpenSpec traceability: add-read-file-structured-footnotes (read_file tool)', () => {
  registerCleanup();

  test('zero-footnote document yields no top-level footnotes field',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a document with no footnotes', async () =>
        openSession(['A plain paragraph.', 'Another one.']));

      const read = await when('read_file runs as json with include_footnotes', async () => {
        const result = await readFile(opened.mgr, {
          file_path: opened.inputPath,
          format: 'json',
          include_footnotes: true,
        });
        assertSuccess(result, 'read_file');
        return result;
      });

      await then('no top-level footnotes field is present', async () => {
        expect('footnotes' in read).toBe(false);
      });
    },
  );

  test.openspec('JSON top-level footnotes array')(
    'JSON top-level footnotes array',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a document with one anchored footnote', async () => {
        const session = await openSession(['Anchor paragraph.', 'Trailing paragraph.']);
        const added = await addFootnote(session.mgr, {
          file_path: session.inputPath,
          target_paragraph_id: session.paraIds[0],
          text: 'See generally the treatise.',
        });
        assertSuccess(added, 'add_footnote');
        return session;
      });

      const footnotes = await when('read_file runs as json with include_footnotes', async () => {
        const result = await readFile(opened.mgr, {
          file_path: opened.inputPath,
          format: 'json',
          include_footnotes: true,
        });
        assertSuccess(result, 'read_file');
        return topLevelFootnotes(result);
      });

      await then('the top-level footnotes entry has the #207 shape', async () => {
        expect(footnotes).toHaveLength(1);
        const fn = footnotes![0]!;
        expect(fn.display_number).toBe(1);
        expect(Array.isArray(fn.ref_paragraph_ids)).toBe(true);
        expect(fn.ref_paragraph_ids).toEqual([opened.paraIds[0]]);
        expect(fn.paragraphs.length).toBeGreaterThanOrEqual(1);
        expect(fn.paragraphs.map((p) => p.text).join('')).toContain('See generally the treatise.');
      });
    },
  );

  test.openspec('multi-paragraph footnote body reported with node-level fidelity')(
    'multi-paragraph footnote body reported with node-level fidelity',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a crafted footnote with two paragraphs and a bold run', async () => {
        const fnPart = footnotesPart(
          `<w:footnote w:id="1">` +
            `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>` +
            `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>` +
            `<w:r><w:t xml:space="preserve">See </w:t></w:r>` +
            `<w:r><w:rPr><w:b/></w:rPr><w:t>Smith v. Jones</w:t></w:r>` +
            `<w:r><w:t>, 1 U.S. 1.</w:t></w:r>` +
            `</w:p>` +
            `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>` +
            `<w:r><w:t>Continuation paragraph.</w:t></w:r>` +
            `</w:p>` +
            `</w:footnote>`,
        );
        return openSession([], {
          xml: documentReferencing(1, 'Clause one'),
          extraFiles: { 'word/footnotes.xml': fnPart },
        });
      });

      const footnotes = await when('read_file runs as json with include_footnotes', async () => {
        const result = await readFile(opened.mgr, {
          file_path: opened.inputPath,
          format: 'json',
          include_footnotes: true,
        });
        assertSuccess(result, 'read_file');
        return topLevelFootnotes(result);
      });

      await then('paragraphs[] has the right count and preserves the bold citation run', async () => {
        expect(footnotes).toHaveLength(1);
        const fn = footnotes![0]!;
        expect(fn.paragraphs).toHaveLength(2);
        expect(fn.paragraphs[0]!.text).toBe('See Smith v. Jones, 1 U.S. 1.');
        expect(fn.paragraphs[0]!.tagged_text).toContain('<b>Smith v. Jones</b>');
        expect(fn.paragraphs[0]!.style).toBe('FootnoteText');
        expect(fn.paragraphs[1]!.text).toBe('Continuation paragraph.');
      });
    },
  );

  test('a footnote that itself contains a footnote reference is enumerated',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('footnote 1 whose body references footnote 2', async () => {
        const fnPart = footnotesPart(
          `<w:footnote w:id="1">` +
            `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>` +
            `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>` +
            `<w:r><w:t xml:space="preserve">Outer note</w:t></w:r>` +
            `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r>` +
            `</w:p></w:footnote>` +
            `<w:footnote w:id="2">` +
            `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>` +
            `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>` +
            `<w:r><w:t xml:space="preserve">Nested inner note</w:t></w:r>` +
            `</w:p></w:footnote>`,
        );
        return openSession([], {
          xml: documentReferencing(1, 'Clause'),
          extraFiles: { 'word/footnotes.xml': fnPart },
        });
      });

      const footnotes = await when('read_file runs as json with include_footnotes', async () => {
        const result = await readFile(opened.mgr, {
          file_path: opened.inputPath,
          format: 'json',
          include_footnotes: true,
        });
        assertSuccess(result, 'read_file');
        return topLevelFootnotes(result);
      });

      await then('the outer footnote reads cleanly with its nested reference retained', async () => {
        const byId = new Map((footnotes ?? []).map((f) => [f.id, f]));
        // Footnote 1 is referenced from the body, so it carries display 1 and
        // is rendered. Its body includes the outer text; the nested
        // footnoteReference glyph run contributes no visible text.
        expect(byId.has('1')).toBe(true);
        expect(byId.get('1')!.paragraphs[0]!.text).toContain('Outer note');
        // Footnote 2 is referenced ONLY from inside footnote 1 (never from the
        // body), so OOXML body display-numbering assigns it none; it is
        // correctly omitted from the renderable top-level array. The read does
        // not crash on the nested reference.
        expect(byId.has('2')).toBe(false);
      });
    },
  );

  test.openspec('toon FOOTNOTES sidecar')(
    'toon FOOTNOTES sidecar',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a document with two anchored footnotes', async () => {
        const session = await openSession(['First anchor.', 'Second anchor.']);
        for (const [idx, text] of [
          [0, 'First note.'],
          [1, 'Second note.'],
        ] as const) {
          const added = await addFootnote(session.mgr, {
            file_path: session.inputPath,
            target_paragraph_id: session.paraIds[idx],
            text,
          });
          assertSuccess(added, 'add_footnote');
        }
        return session;
      });

      const content = await when('read_file runs as toon with include_footnotes', async () => {
        const result = await readFile(opened.mgr, {
          file_path: opened.inputPath,
          format: 'toon',
          include_footnotes: true,
        });
        assertSuccess(result, 'read_file');
        return String(result.content);
      });

      await then('a trailing #FOOTNOTES block lists both footnotes', async () => {
        expect(content).toContain('#FOOTNOTES');
        expect(content.indexOf('#FOOTNOTES')).toBeGreaterThan(content.indexOf('#SCHEMA'));
        expect(content).toContain('[^1]');
        expect(content).toContain('First note.');
        expect(content).toContain('[^2]');
        expect(content).toContain('Second note.');
      });
    },
  );

  test.openspec('default output is byte-identical')(
    'default output is byte-identical',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a document with a footnote', async () => {
        const session = await openSession(['Anchor.', 'Tail.']);
        const added = await addFootnote(session.mgr, {
          file_path: session.inputPath,
          target_paragraph_id: session.paraIds[0],
          text: 'A note.',
        });
        assertSuccess(added, 'add_footnote');
        return session;
      });

      const reads = await when('read_file runs json with the flag absent and with false', async () => {
        const absent = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'json' });
        const explicitFalse = await readFile(opened.mgr, {
          file_path: opened.inputPath,
          format: 'json',
          include_footnotes: false,
        });
        assertSuccess(absent, 'read_file');
        assertSuccess(explicitFalse, 'read_file');
        return { absent, explicitFalse };
      });

      await then('content is byte-identical and no top-level footnotes field appears', async () => {
        expect(String(reads.explicitFalse.content)).toBe(String(reads.absent.content));
        expect('footnotes' in reads.absent).toBe(false);
        expect('footnotes' in reads.explicitFalse).toBe(false);
      });
    },
  );

  test.openspec('scale document enumerates every footnote')(
    'scale document enumerates every footnote',
    async ({ given, when, then }: AllureBddContext) => {
      const nvca = await given('the NVCA SPA source (109 footnotes)', async () => {
        const mgr = createTestSessionManager();
        const open = await openDocument(mgr, { file_path: NVCA_SOURCE });
        assertSuccess(open, 'open');
        return { mgr, filePath: String(open.file_path ?? NVCA_SOURCE) };
      });

      const footnotes = await when('the whole document is read as json with include_footnotes', async () => {
        const result = await readFile(nvca.mgr, {
          file_path: nvca.filePath,
          format: 'json',
          include_footnotes: true,
          limit: 100_000,
        });
        assertSuccess(result, 'read_file');
        return topLevelFootnotes(result);
      });

      await then('every renderable footnote is represented with an array of refs', async () => {
        expect(footnotes).toBeDefined();
        // The fixture ships 109 footnotes; 108 are renderable (one is empty
        // scaffolding, matching the existing NVCA regression baseline). The
        // read exits cleanly with all of them in the top-level array and each
        // one covered by display numbers 1..108.
        expect(footnotes!.length).toBe(108);
        for (const fn of footnotes!) {
          expect(Array.isArray(fn.ref_paragraph_ids)).toBe(true);
          expect(fn.paragraphs.length).toBeGreaterThanOrEqual(1);
        }
        const displayNumbers = footnotes!.map((f) => f.display_number).sort((a, b) => a - b);
        expect(displayNumbers[0]).toBe(1);
        expect(displayNumbers[displayNumbers.length - 1]).toBe(108);
      });
    },
  );
});
