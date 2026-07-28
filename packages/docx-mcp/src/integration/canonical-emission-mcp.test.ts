import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { parseXml, readZipText } from '@usejunior/docx-core';
import { SessionManager } from '../session/manager.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { openSession, assertSuccess, registerCleanup } from '../testing/session-test-utils.js';
import { replaceText } from '../tools/replace_text.js';
import { insertParagraph } from '../tools/insert_paragraph.js';
import { batchEdit } from '../tools/batch_edit.js';
import { clearFormatting } from '../tools/clear_formatting.js';
import { formatLayout } from '../tools/format_layout.js';
import { formatNumbering } from '../tools/format_numbering.js';
import { formatSection } from '../tools/format_section.js';
import { addComment } from '../tools/add_comment.js';
import { deleteComment } from '../tools/delete_comment.js';
import { addFootnote } from '../tools/add_footnote.js';
import { updateFootnote } from '../tools/update_footnote.js';
import { deleteFootnote } from '../tools/delete_footnote.js';
import { save } from '../tools/save.js';

const test = testAllure.epic('Document Editing').withLabels({
  feature: 'Canonical Emission MCP Regression',
});
const numberingTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.19' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.18' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.3' },
);
const sectionTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.12' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.13' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.11' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
);

const AI_AUTHOR = 'SafeDocX';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function createManager(aiAuthor: string = AI_AUTHOR): SessionManager {
  return new SessionManager({ ttlMs: 60_000, defaultAiAuthor: aiAuthor });
}

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">` +
    `<w:body>${bodyXml}<w:sectPr/></w:body>` +
    `</w:document>`
  );
}

async function saveAndReadParts(
  mgr: SessionManager,
  inputPath: string,
  outputPath: string,
  partPaths: string[],
): Promise<Record<string, string>> {
  // #126: write-time tracked markup lands in the tracked (redline) artifact; the
  // clean artifact now accepts the AI's edits. Verify the emitted wrappers via the
  // tracked output.
  const saved = await save(mgr, {
    file_path: inputPath,
    save_to_local_path: outputPath,
    save_format: 'tracked',
    clean_bookmarks: true,
  });
  assertSuccess(saved, 'save');

  const buffer = await fs.readFile(outputPath);
  const entries = await Promise.all(
    partPaths.map(async (partPath) => {
      const text = await readZipText(buffer, partPath);
      if (text === null) {
        throw new Error(`Missing expected DOCX part: ${partPath}`);
      }
      return [partPath, text] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function wordAttr(element: Element, localName: string): string | null {
  return (
    element.getAttributeNS(W_NS, localName) ??
    element.getAttribute(`w:${localName}`) ??
    element.getAttribute(localName)
  );
}

function expectTrackedElementsWithAuthor(xml: string, localNames: string[]): void {
  const doc = parseXml(xml);

  for (const localName of localNames) {
    const matches = Array.from(doc.getElementsByTagNameNS(W_NS, localName)) as Element[];
    expect(matches.length, `expected <w:${localName}> in saved XML`).toBeGreaterThan(0);

    for (const match of matches) {
      expect(wordAttr(match, 'author')).toBe(AI_AUTHOR);
      expect(wordAttr(match, 'id')).toMatch(/^\d+$/);
      expect(wordAttr(match, 'date')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  }
}

// These tests exercise tool functions directly through SessionManager + save
// + unzip. They are tool-integration tests, not full MCP-dispatch end-to-end
// tests (those would also exercise server.ts's CallToolRequestSchema handler
// and dispatchToolCall routing). Naming reflects that scope.
describe('Tool integration through SessionManager: canonical revision emission', () => {
  registerCleanup();

  test('replace_text saves SafeDocX-authored insertion and deletion wrappers', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a tracked session with one paragraph', async () => {
      opened = await openSession(['Alpha Beta'], { mgr: createManager() });
    });

    await when('replace_text edits the paragraph', async () => {
      const replaced = await replaceText(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        old_string: 'Alpha',
        new_string: 'Gamma',
        instruction: 'Replace Alpha with Gamma.',
      });
      assertSuccess(replaced, 'replace_text');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'replace-text-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains tracked SafeDocX insertion and deletion metadata', () => {
      expectTrackedElementsWithAuthor(documentXml, ['ins', 'del']);
    });
  });

  test('insert_paragraph saves SafeDocX-authored insertion wrappers', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a tracked session with an anchor paragraph', async () => {
      opened = await openSession(['Anchor paragraph.'], { mgr: createManager() });
    });

    await when('insert_paragraph adds a paragraph after the anchor', async () => {
      const inserted = await insertParagraph(opened.mgr, {
        file_path: opened.inputPath,
        positional_anchor_node_id: opened.firstParaId,
        new_string: 'Inserted paragraph.',
        instruction: 'Insert a paragraph after the anchor.',
      });
      assertSuccess(inserted, 'insert_paragraph');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'insert-paragraph-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains SafeDocX-authored insertion metadata', () => {
      expectTrackedElementsWithAuthor(documentXml, ['ins']);
      expect(documentXml).toContain('Inserted paragraph.');
    });
  });

  test('batch_edit saves SafeDocX-authored tracked output for delegated edits', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a tracked session with one paragraph', async () => {
      opened = await openSession(['Hello world'], { mgr: createManager() });
    });

    await when('batch_edit runs replace_text and insert_paragraph steps', async () => {
      const applied = await batchEdit(opened.mgr, {
        file_path: opened.inputPath,
        steps: [
          {
            step_id: 'replace-1',
            operation: 'replace_text',
            target_paragraph_id: opened.firstParaId,
            old_string: 'Hello',
            new_string: 'Goodbye',
            instruction: 'Replace Hello with Goodbye.',
          },
          {
            step_id: 'insert-1',
            operation: 'insert_paragraph',
            positional_anchor_node_id: opened.firstParaId,
            new_string: 'Plan inserted paragraph.',
            instruction: 'Insert a paragraph after the edited one.',
            position: 'AFTER',
          },
        ],
      });
      assertSuccess(applied, 'batch_edit');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'apply-plan-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains SafeDocX-authored tracked revisions from the plan', () => {
      expectTrackedElementsWithAuthor(documentXml, ['ins', 'del']);
      expect(documentXml).toContain('Plan inserted paragraph.');
    });
  });

  test('clear_formatting saves SafeDocX-authored w:rPrChange wrappers', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a run with bold formatting to clear', async () => {
      opened = await openSession([], {
        mgr: createManager(),
        xml: makeDocXml('<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Tracked</w:t></w:r></w:p>'),
      });
    });

    await when('clear_formatting clears bold in tracked mode', async () => {
      const cleared = await clearFormatting(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_ids: [opened.firstParaId],
        clear_bold: true,
      });
      assertSuccess(cleared, 'clear_formatting');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'clear-formatting-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains a SafeDocX-authored run property change', () => {
      expectTrackedElementsWithAuthor(documentXml, ['rPrChange']);
    });
  });

  test('format_layout saves SafeDocX-authored paragraph, row, and cell property changes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a document with both paragraph and table layout surfaces', async () => {
      opened = await openSession([], {
        mgr: createManager(),
        xml: makeDocXml(
          '<w:p><w:r><w:t>Spacing paragraph.</w:t></w:r></w:p>' +
            '<w:tbl>' +
            '<w:tblPr/>' +
            '<w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>' +
            '<w:tr>' +
            '<w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
            '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>' +
            '</w:tr>' +
            '</w:tbl>',
        ),
      });
    });

    await when('format_layout updates paragraph spacing, row height, and cell padding', async () => {
      const formatted = await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_spacing: {
          paragraph_ids: [opened.paraIds[0]!],
          before_twips: 240,
        },
        row_height: {
          table_indexes: [0],
          value_twips: 420,
          rule: 'exact',
        },
        cell_padding: {
          table_indexes: [0],
          left_dxa: 120,
        },
      });
      assertSuccess(formatted, 'format_layout');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'format-layout-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains SafeDocX-authored layout property changes', () => {
      expectTrackedElementsWithAuthor(documentXml, ['pPrChange', 'trPrChange', 'tcPrChange']);
    });
  });

  numberingTest('format_numbering saves a SafeDocX-authored paragraph property change', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a tracked session with a directly numbered paragraph', async () => {
      opened = await openSession([], {
        mgr: createManager(),
        xml: makeDocXml(
          '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr></w:pPr><w:r><w:t>Numbered</w:t></w:r></w:p>',
        ),
        extraFiles: {
          'word/numbering.xml':
            `<w:numbering xmlns:w="${W_NS}">`
            + '<w:abstractNum w:abstractNumId="1">'
            + '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>'
            + '<w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/></w:lvl>'
            + '</w:abstractNum>'
            + '<w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num>'
            + '</w:numbering>',
        },
      });
    });

    await when('format_numbering changes the direct list level and saves tracked output', async () => {
      const formatted = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        num_id: '10',
        ilvl: 1,
      });
      assertSuccess(formatted, 'format_numbering');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'format-numbering-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains a SafeDocX-authored paragraph property change', () => {
      expectTrackedElementsWithAuthor(documentXml, ['pPrChange']);
      const doc = parseXml(documentXml);
      const change = doc.getElementsByTagNameNS(W_NS, 'pPrChange')[0] as Element;
      const priorIlvl = change.getElementsByTagNameNS(W_NS, 'ilvl')[0] as Element;
      expect(wordAttr(priorIlvl, 'val')).toBe('0');
    });
  });

  sectionTest('format_section saves a SafeDocX-authored section property change', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a tracked session with a final section', async () => {
      opened = await openSession([], {
        mgr: createManager(),
        xml: makeDocXml('<w:p><w:r><w:t>Section body</w:t></w:r></w:p>'),
      });
    });

    await when('format_section restarts page numbering and saves tracked output', async () => {
      const formatted = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_number_start: 1,
      });
      assertSuccess(formatted, 'format_section');
      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'format-section-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains a SafeDocX-authored section property change', () => {
      expectTrackedElementsWithAuthor(documentXml, ['sectPrChange']);
      const doc = parseXml(documentXml);
      const current = doc.getElementsByTagNameNS(W_NS, 'pgNumType')[0] as Element;
      expect(wordAttr(current, 'start')).toBe('1');
    });
  });

  sectionTest('format_section saves atomic page size and margin changes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a tracked session whose final section has no explicit page setup', async () => {
      opened = await openSession([], {
        mgr: createManager(),
        xml: makeDocXml('<w:p><w:r><w:t>Page setup body</w:t></w:r></w:p>'),
      });
    });

    await when('format_section creates landscape geometry and complete margins', async () => {
      const formatted = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_size: {
          width_twips: 15840,
          height_twips: 12240,
          orientation: 'landscape',
        },
        margins: {
          top_twips: 720,
          right_twips: 720,
          bottom_twips: 720,
          left_twips: 720,
          header_twips: 360,
          footer_twips: 360,
          gutter_twips: 0,
        },
      });
      assertSuccess(formatted, 'format_section page setup');
      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'format-section-page-setup-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains current geometry and one SafeDocX section snapshot', () => {
      expectTrackedElementsWithAuthor(documentXml, ['sectPrChange']);
      const doc = parseXml(documentXml);
      const pgSz = doc.getElementsByTagNameNS(W_NS, 'pgSz')[0] as Element;
      const pgMar = doc.getElementsByTagNameNS(W_NS, 'pgMar')[0] as Element;
      expect(wordAttr(pgSz, 'w')).toBe('15840');
      expect(wordAttr(pgSz, 'h')).toBe('12240');
      expect(wordAttr(pgSz, 'orient')).toBe('landscape');
      expect(wordAttr(pgMar, 'top')).toBe('720');
      expect(wordAttr(pgMar, 'gutter')).toBe('0');
    });
  });

  test('add_comment saves a SafeDocX-authored insertion wrapper for the comment reference', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a tracked session with one paragraph', async () => {
      opened = await openSession(['Comment target paragraph.'], { mgr: createManager() });
    });

    await when('add_comment inserts a root comment', async () => {
      const added = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Reviewer',
        text: 'Tracked comment body.',
      });
      assertSuccess(added, 'add_comment');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'add-comment-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains a SafeDocX-authored insertion wrapper', () => {
      expectTrackedElementsWithAuthor(documentXml, ['ins']);
      expect(documentXml).toContain('w:commentReference');
    });
  });

  test('delete_comment saves a SafeDocX-authored deletion wrapper for the removed comment reference', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a tracked session with an existing comment', async () => {
      opened = await openSession(['Comment delete paragraph.'], { mgr: createManager() });
      const added = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Reviewer',
        text: 'Delete me.',
      });
      assertSuccess(added, 'add_comment');
    });

    await when('delete_comment removes that comment', async () => {
      const deleted = await deleteComment(opened.mgr, {
        file_path: opened.inputPath,
        comment_id: 0,
      });
      assertSuccess(deleted, 'delete_comment');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'delete-comment-regression.docx'),
        ['word/document.xml'],
      );
      documentXml = parts['word/document.xml'];
    });

    await then('document.xml contains a SafeDocX-authored deletion wrapper', () => {
      expectTrackedElementsWithAuthor(documentXml, ['del']);
    });
  });

  test('add_footnote saves SafeDocX-authored insertions in document.xml and footnotes.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;
    let footnotesXml: string;

    await given('a tracked session with one paragraph', async () => {
      opened = await openSession(['Footnote target paragraph.'], { mgr: createManager() });
    });

    await when('add_footnote inserts a tracked footnote', async () => {
      const added = await addFootnote(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        text: 'Tracked footnote body.',
      });
      assertSuccess(added, 'add_footnote');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'add-footnote-regression.docx'),
        ['word/document.xml', 'word/footnotes.xml'],
      );
      documentXml = parts['word/document.xml'];
      footnotesXml = parts['word/footnotes.xml'];
    });

    await then('both saved parts contain SafeDocX-authored insertion metadata', () => {
      expectTrackedElementsWithAuthor(documentXml, ['ins']);
      expectTrackedElementsWithAuthor(footnotesXml, ['ins']);
    });
  });

  test('update_footnote saves SafeDocX-authored insertions and deletions in footnotes.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let footnotesXml: string;

    await given('a tracked session with an existing footnote', async () => {
      opened = await openSession(['Update footnote paragraph.'], { mgr: createManager() });
      const added = await addFootnote(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        text: 'Old note body.',
      });
      assertSuccess(added, 'add_footnote');
    });

    await when('update_footnote replaces the note body', async () => {
      const updated = await updateFootnote(opened.mgr, {
        file_path: opened.inputPath,
        note_id: 1,
        new_text: 'Updated note body.',
      });
      assertSuccess(updated, 'update_footnote');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'update-footnote-regression.docx'),
        ['word/footnotes.xml'],
      );
      footnotesXml = parts['word/footnotes.xml'];
    });

    await then('footnotes.xml contains SafeDocX-authored insertion and deletion metadata', () => {
      expectTrackedElementsWithAuthor(footnotesXml, ['ins', 'del']);
    });
  });

  test('delete_footnote saves SafeDocX-authored deletions in document.xml and footnotes.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;
    let footnotesXml: string;

    await given('a tracked session with an existing footnote', async () => {
      opened = await openSession(['Delete footnote paragraph.'], { mgr: createManager() });
      const added = await addFootnote(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        text: 'Delete note body.',
      });
      assertSuccess(added, 'add_footnote');
    });

    await when('delete_footnote removes that footnote', async () => {
      const deleted = await deleteFootnote(opened.mgr, {
        file_path: opened.inputPath,
        note_id: 1,
      });
      assertSuccess(deleted, 'delete_footnote');

      const parts = await saveAndReadParts(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'delete-footnote-regression.docx'),
        ['word/document.xml', 'word/footnotes.xml'],
      );
      documentXml = parts['word/document.xml'];
      footnotesXml = parts['word/footnotes.xml'];
    });

    await then('both saved parts contain SafeDocX-authored deletion metadata', () => {
      expectTrackedElementsWithAuthor(documentXml, ['del']);
      expectTrackedElementsWithAuthor(footnotesXml, ['del']);
    });
  });
});
