/**
 * Regression test for issue #1044: a tracked replace_text whose range spans a
 * run holding only a `w:sym` (a Wingdings checkbox, as in legal forms) used to
 * detach that run without a `w:del`, so the tracked save silently lost the
 * symbol and reject-all could not bring it back. The symbol contributes
 * nothing to the paragraph text the caller matched, so the caller never saw
 * it either.
 *
 * Exercises the full package path — open → replace_text → save — in the
 * default tracked mode and with tracked emission disabled, and asserts the
 * issue's acceptance criteria: the tracked save carries the symbol inside
 * `w:del` (a package-level reject-all restores it), the clean save yields the
 * intended text, and in both modes the tool response says the range removed a
 * symbol the caller could not see.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect } from 'vitest';
import { DocxArchive, parseXml, rejectChanges } from '@usejunior/docx-core';
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

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Tracked Change Emission' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const CHECKBOX = '<w:sym w:font="Wingdings" w:char="F0A8"/>';

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<w:body>' +
  '<w:p><w:r><w:t xml:space="preserve">Please indicate your election:</w:t></w:r></w:p>' +
  '<w:p>' +
    '<w:r><w:t xml:space="preserve">Alpha </w:t></w:r>' +
    `<w:r><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr>${CHECKBOX}</w:r>` +
    '<w:r><w:t xml:space="preserve"> Bravo</w:t></w:r>' +
  '</w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Closing paragraph.</w:t></w:r></w:p>' +
  '</w:body></w:document>';

async function loadDocumentXml(outPath: string): Promise<Document> {
  const archive = await DocxArchive.load(await fs.readFile(outPath));
  const documentXml = await archive.getFile('word/document.xml');
  expect(documentXml).toBeTruthy();
  return parseXml(documentXml!);
}

function symbols(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'sym'));
}

function insideDeletion(el: Element): boolean {
  for (let node: Node | null = el.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).localName === 'del') return true;
  }
  return false;
}

function textOf(p: Element, local: 't' | 'delText'): string {
  return Array.from(p.getElementsByTagNameNS(W_NS, local)).map((t) => t.textContent ?? '').join('');
}

describe('replace_text — a range spanning a w:sym-only run (#1044)', () => {
  registerCleanup();

  test('tracked mode: the symbol is deleted inside w:del, reject-all restores it, and the response reports it', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });

    const session = await given('a form paragraph whose checkbox sits in a sym-only run between two text runs', () =>
      openSession([], { mgr, xml: DOCUMENT_XML }),
    );
    const paraId = session.paraIds[1]!;
    // The symbol is invisible to the paragraph text the caller matches against.
    expect(session.content).toContain('Alpha  Bravo');

    const trackedPath = path.join(session.tmpDir, 'out-tracked.docx');
    const cleanPath = path.join(session.tmpDir, 'out-clean.docx');
    await when('replace_text replaces "a  B" (which spans the checkbox) with "X" and the session is saved tracked and clean', async () => {
      const replaced = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: paraId,
        old_string: 'a  B',
        new_string: 'X',
        instruction: 'collapse the election',
      });
      assertSuccess(replaced, 'replace_text');
      expect(replaced.after_text).toBe('AlphXravo');
      const warnings = (replaced as { warnings?: string[] }).warnings ?? [];
      expect(warnings.some((w) => /1 symbol character \(w:sym/u.test(w) && /tracked change/u.test(w))).toBe(true);
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: cleanPath, save_format: 'clean' }), 'save clean');
    });

    await then('the tracked save carries the original w:sym inside the deletion, next to the deleted text', async () => {
      const doc = await loadDocumentXml(trackedPath);
      expect(symbols(doc)).toHaveLength(1);
      expect(insideDeletion(symbols(doc)[0]!)).toBe(true);
      const p = symbols(doc)[0]!.parentNode!.parentNode!.parentNode as Element;
      expect(p.localName).toBe('p');
      expect(textOf(p, 'delText')).toBe('a  B');
      expect(textOf(p, 't')).toBe('AlphXravo');
      expect(symbols(doc)[0]!.getAttribute('w:char')).toBe('F0A8');
      expect(symbols(doc)[0]!.getAttribute('w:font')).toBe('Wingdings');

      const reopened = await openDocument(createTestSessionManager(), { file_path: trackedPath });
      assertSuccess(reopened, 'reopen tracked');
    });

    await then('rejecting every change in the tracked save restores the paragraph with its checkbox in place', async () => {
      const doc = await loadDocumentXml(trackedPath);
      rejectChanges(doc);
      const p = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))[1]!;
      expect(symbols(doc)).toHaveLength(1);
      expect(insideDeletion(symbols(doc)[0]!)).toBe(false);
      expect(textOf(p, 't')).toBe('Alpha  Bravo');
      // Order: "Alpha " run(s), checkbox run, " Bravo" run(s).
      const runs = Array.from(p.childNodes).filter((c): c is Element => c.nodeType === 1 && (c as Element).localName === 'r');
      const symbolRunIndex = runs.findIndex((r) => r.getElementsByTagNameNS(W_NS, 'sym').length > 0);
      expect(symbolRunIndex).toBeGreaterThan(0);
      const joined = (list: Element[]): string => list.map((r) => textOf(r, 't')).join('');
      expect(joined(runs.slice(0, symbolRunIndex))).toBe('Alpha ');
      expect(joined(runs.slice(symbolRunIndex + 1))).toBe(' Bravo');
    });

    await then('the clean save yields the intended text with no symbol', async () => {
      const doc = await loadDocumentXml(cleanPath);
      expect(symbols(doc)).toHaveLength(0);
      const p = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))[1]!;
      expect(textOf(p, 't')).toBe('AlphXravo');
    });
  });

  test('untracked mode: the clean replace removes the symbol with the range and the response says so', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: null });

    const session = await given('the same form paragraph, opened with tracked emission disabled', () =>
      openSession([], { mgr, xml: DOCUMENT_XML }),
    );
    const paraId = session.paraIds[1]!;

    const outPath = path.join(session.tmpDir, 'out-untracked.docx');
    await when('replace_text replaces the range spanning the checkbox and the session is saved clean', async () => {
      const replaced = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: paraId,
        old_string: 'a  B',
        new_string: 'X',
        instruction: 'collapse the election',
      });
      assertSuccess(replaced, 'replace_text');
      expect(replaced.after_text).toBe('AlphXravo');
      const warnings = (replaced as { warnings?: string[] }).warnings ?? [];
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/1 symbol character \(w:sym, such as a checkbox or bullet\) not shown in the paragraph text; it was removed with the replaced text\./u);
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: outPath, save_format: 'clean' }), 'save clean');
    });

    await then('the saved document has the intended text and no symbol, and reopens', async () => {
      const doc = await loadDocumentXml(outPath);
      expect(symbols(doc)).toHaveLength(0);
      expect(textOf(Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))[1]!, 't')).toBe('AlphXravo');
      const reopened = await openDocument(createTestSessionManager(), { file_path: outPath });
      assertSuccess(reopened, 'reopen');
    });
  });

  test('a range that ends before the symbol run leaves it live and raises no warning', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });

    const session = await given('the same form paragraph', () => openSession([], { mgr, xml: DOCUMENT_XML }));
    const paraId = session.paraIds[1]!;

    let warnings: string[] = [];
    await when('replace_text edits only the text before the checkbox', async () => {
      const replaced = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: paraId,
        old_string: 'Alpha',
        new_string: 'Alfa',
        instruction: 'respell',
      });
      assertSuccess(replaced, 'replace_text');
      warnings = (replaced as { warnings?: string[] }).warnings ?? [];
    });

    await then('no symbol warning is raised and the tracked save keeps the checkbox outside w:del', async () => {
      expect(warnings.filter((w) => w.includes('w:sym'))).toHaveLength(0);
      const trackedPath = path.join(session.tmpDir, 'out-boundary.docx');
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
      const doc = await loadDocumentXml(trackedPath);
      expect(symbols(doc)).toHaveLength(1);
      expect(insideDeletion(symbols(doc)[0]!)).toBe(false);
    });
  });
});
