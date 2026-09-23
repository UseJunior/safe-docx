/**
 * Regression test for issue #740: with tracked emission disabled
 * (`SessionManager({ defaultAiAuthor: null })`, the legacy untracked mode),
 * blanking a numbered paragraph's complete visible text through replace_text
 * must remove the paragraph on clean save instead of leaving an empty `w:p`
 * that still carries `w:numPr` — Word renders that as a bare list label.
 *
 * Exercises the full package path the issue describes — read_file →
 * replace_text → save — in both the untracked and the default tracked mode,
 * and asserts the issue's detection predicate: no paragraph has `w:numPr`
 * with a non-zero numId and no text, counting `w:delText` as text and
 * `w:drawing`/`w:pict`/`w:object` as content.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect } from 'vitest';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';
import { openDocument } from './open_document.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Paragraph Deletion' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const numbered = (text: string): string =>
  '<w:p>' +
    '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
    `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` +
  '</w:p>';

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<w:body>' +
  '<w:p><w:r><w:t xml:space="preserve">The parties agree as follows:</w:t></w:r></w:p>' +
  numbered('first obligation') +
  numbered('second obligation') +
  numbered('third obligation') +
  '<w:p><w:r><w:t xml:space="preserve">Closing paragraph.</w:t></w:r></w:p>' +
  '</w:body></w:document>';

function textOf(p: Element): string {
  return ['t', 'delText']
    .flatMap((name) => Array.from(p.getElementsByTagNameNS(W_NS, name)))
    .map((el) => el.textContent ?? '')
    .join('');
}

function numberedParagraphs(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'p')).filter((p) => {
    const numId = p.getElementsByTagNameNS(W_NS, 'numId').item(0)?.getAttribute('w:val');
    return !!numId && numId !== '0';
  });
}

/** The issue's detection predicate. */
function orphanNumberedParagraphs(doc: Document): Element[] {
  return numberedParagraphs(doc).filter((p) => {
    if (textOf(p).trim().length > 0) return false;
    return !['drawing', 'pict', 'object'].some((name) => p.getElementsByTagNameNS(W_NS, name).length > 0);
  });
}

async function loadDocumentXml(outPath: string): Promise<Document> {
  const archive = await DocxArchive.load(await fs.readFile(outPath));
  const documentXml = await archive.getFile('word/document.xml');
  expect(documentXml).toBeTruthy();
  return parseXml(documentXml!);
}

describe('replace_text — blanking a numbered paragraph removes it on clean save (#740)', () => {
  registerCleanup();

  test('untracked mode: the three-item list ends with two numbered paragraphs after clean save', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: null });

    const session = await given('a document with a three-item numbered list, opened with tracked emission disabled', () =>
      openSession([], { mgr, xml: DOCUMENT_XML }),
    );
    const middleParaId = session.paraIds[2]!;
    expect(session.content).toContain('second obligation');

    const outPath = path.join(session.tmpDir, 'out-untracked-clean.docx');
    await when('replace_text blanks the middle item\'s complete visible text and the session is saved clean', async () => {
      const replaced = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: middleParaId,
        old_string: 'second obligation',
        new_string: '',
        instruction: 'delete the second obligation',
      });
      assertSuccess(replaced, 'replace_text');
      const saved = await save(mgr, {
        file_path: session.inputPath,
        save_to_local_path: outPath,
        save_format: 'clean',
      });
      assertSuccess(saved, 'save');
    });

    await then('two numbered paragraphs remain, none of them empty, and the package reopens', async () => {
      const doc = await loadDocumentXml(outPath);
      expect(numberedParagraphs(doc).map(textOf)).toEqual(['first obligation', 'third obligation']);
      expect(orphanNumberedParagraphs(doc)).toHaveLength(0);
      expect(doc.getElementsByTagNameNS(W_NS, 'p')).toHaveLength(4);

      const reopened = await openDocument(createTestSessionManager(), { file_path: outPath });
      assertSuccess(reopened, 'reopen');
    });
  });

  test('tracked mode: clean save yields two numbered paragraphs and tracked save keeps the deletion for review', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });

    const session = await given('a document with a three-item numbered list, opened with the default AI author', () =>
      openSession([], { mgr, xml: DOCUMENT_XML }),
    );
    const middleParaId = session.paraIds[2]!;

    const cleanPath = path.join(session.tmpDir, 'out-tracked-clean.docx');
    const trackedPath = path.join(session.tmpDir, 'out-tracked-tracked.docx');
    await when('replace_text blanks the middle item and the session is saved both clean and tracked', async () => {
      const replaced = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: middleParaId,
        old_string: 'second obligation',
        new_string: '',
        instruction: 'delete the second obligation',
      });
      assertSuccess(replaced, 'replace_text');
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: cleanPath, save_format: 'clean' }), 'save clean');
    });

    await then('the clean save has two numbered paragraphs and no orphan label', async () => {
      const doc = await loadDocumentXml(cleanPath);
      expect(numberedParagraphs(doc).map(textOf)).toEqual(['first obligation', 'third obligation']);
      expect(orphanNumberedParagraphs(doc)).toHaveLength(0);
    });

    await then('the tracked save keeps the middle paragraph with its text in w:delText and a deleted paragraph mark', async () => {
      const doc = await loadDocumentXml(trackedPath);
      const numberedTexts = numberedParagraphs(doc).map(textOf);
      expect(numberedTexts).toEqual(['first obligation', 'second obligation', 'third obligation']);
      const middle = numberedParagraphs(doc)[1]!;
      expect(Array.from(middle.getElementsByTagNameNS(W_NS, 'delText')).map((t) => t.textContent).join('')).toBe('second obligation');
      const pPr = Array.from(middle.childNodes).find((c) => c.nodeType === 1 && (c as Element).localName === 'pPr') as Element;
      const markRPr = Array.from(pPr.childNodes).find((c) => c.nodeType === 1 && (c as Element).localName === 'rPr') as Element;
      expect(Array.from(markRPr.childNodes).some((c) => c.nodeType === 1 && (c as Element).localName === 'del')).toBe(true);
      // A correctly tracked deletion is not an orphan: w:delText counts as text.
      expect(orphanNumberedParagraphs(doc)).toHaveLength(0);
    });
  });
});
