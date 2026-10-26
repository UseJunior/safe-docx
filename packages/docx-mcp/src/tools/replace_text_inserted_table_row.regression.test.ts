/**
 * Regression test for issue #1225: bolding text in a table row that is a
 * tracked insertion used to delete and re-insert the text INSIDE the row's
 * existing `w:ins`. The edit reported success, but the redline then held one
 * actor's `w:del`/`w:ins` nested in another actor's `w:ins`, so
 * `accept_ai_edits` and `reject_ai_edits` refused it as an ambiguous overlap.
 *
 * Exercises the MCP path — open → replace_text / batch_edit → accept_ai_edits
 * or reject_ai_edits — on a row inserted by a reviewer and on a row inserted
 * in the same session, and asserts the formatting lands as a `w:rPrChange`
 * on the inserted runs (Word's shape for formatting inserted text) with the
 * text left inside the original insertion.
 */
import { describe, expect } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { DocxZip, parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { SessionManager, getRevisionContextForSession, type DocxSession } from '../session/manager.js';
import { replaceText } from './replace_text.js';
import { batchEdit } from './batch_edit.js';
import { acceptAiEdits } from './accept_ai_edits.js';
import { rejectAiEdits } from './reject_ai_edits.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Tracked Change Emission' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX';
const REVIEWER = 'Reviewer';
const MARK = `w:author="${REVIEWER}" w:date="2026-01-01T00:00:00Z"`;

function documentXml(rows: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>` +
    '<w:p><w:r><w:t>Schedule</w:t></w:r></w:p>' +
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr>' +
    rows +
    '</w:tbl><w:p><w:r><w:t>Closing</w:t></w:r></w:p></w:body></w:document>'
  );
}

// Revision ids start at 101 so they never collide with the bookmark ids that
// normalization backfills on open.
function insertedCell(text: string, markId: number, runId: number): string {
  return (
    `<w:tc><w:p><w:pPr><w:rPr><w:ins w:id="${markId}" ${MARK}/></w:rPr></w:pPr>` +
    `<w:ins w:id="${runId}" ${MARK}><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins></w:p></w:tc>`
  );
}

const REVIEWER_INSERTED_ROW =
  `<w:tr><w:trPr><w:ins w:id="101" ${MARK}/></w:trPr>` +
  insertedCell('Alpha', 102, 103) +
  insertedCell('Beta Gamma', 104, 105) +
  '</w:tr>';

async function docxSession(mgr: SessionManager, filePath: string): Promise<DocxSession> {
  const session = await mgr.getSessionByFilePath(filePath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  return session;
}

async function readBody(mgr: SessionManager, filePath: string): Promise<Document> {
  const session = await docxSession(mgr, filePath);
  const { buffer } = await session.doc.toBuffer({ cleanBookmarks: false });
  const zip = await DocxZip.load(buffer);
  return parseXml(await zip.readText('word/document.xml'));
}

function byLocal(root: Document | Element, local: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(W_NS, local));
}

/** Serialize elements for assertions; a failing diff over live DOM nodes is unreadable and slow. */
function xmlOf(elements: Element[]): string[] {
  const serializer = new XMLSerializer();
  return elements.map((el) => serializer.serializeToString(el as unknown as Parameters<XMLSerializer["serializeToString"]>[0]));
}

function author(el: Element): string | null {
  return el.getAttributeNS(W_NS, 'author') || el.getAttribute('w:author');
}

/** Content revisions (`w:ins`/`w:del` wrapping runs, not paragraph or row marks) by `who`. */
function contentRevisionsBy(doc: Document, who: string): Element[] {
  return [...byLocal(doc, 'ins'), ...byLocal(doc, 'del')].filter((el) => {
    const parent = el.parentNode as Element | null;
    return author(el) === who && parent?.localName !== 'rPr' && parent?.localName !== 'trPr';
  });
}

/** Visible run text in the n-th table row (0-based), grouped by bold-ness. */
function rowRuns(doc: Document, rowIndex: number): Array<{ text: string; bold: boolean; inIns: string | null }> {
  const row = byLocal(doc, 'tr')[rowIndex]!;
  return byLocal(row, 'r')
    .map((r) => {
      const text = byLocal(r, 't').map((t) => t.textContent ?? '').join('');
      const rPr = Array.from(r.childNodes).find((n) => (n as Element).localName === 'rPr') as Element | undefined;
      const b = rPr ? Array.from(rPr.childNodes).find((n) => (n as Element).localName === 'b') as Element | undefined : undefined;
      const parent = r.parentNode as Element;
      return { text, bold: !!b && b.getAttributeNS(W_NS, 'val') !== '0', inIns: parent.localName === 'ins' ? author(parent) : null };
    })
    .filter((run) => run.text.length > 0);
}

async function boldReviewerRow(mgr: SessionManager) {
  const opened = await openSession([], { mgr, xml: documentXml(REVIEWER_INSERTED_ROW) });
  // paraIds: Schedule, Name, Value, Alpha, Beta Gamma, Closing
  const [, , , alphaId, betaId] = opened.paraIds;
  const replaced = await replaceText(mgr, {
    file_path: opened.filePath,
    target_paragraph_id: alphaId!,
    old_string: 'Alpha',
    new_string: '<b>Alpha</b>',
    instruction: 'Bold the inserted row',
  });
  assertSuccess(replaced, 'replace_text');
  const batched = await batchEdit(mgr, {
    file_path: opened.filePath,
    steps: [{
      step_id: 'bold-beta',
      operation: 'replace_text',
      target_paragraph_id: betaId!,
      old_string: 'Beta Gamma',
      new_string: '<b>Beta</b> Gamma',
      instruction: 'Bold the first word of the second cell',
    }],
  });
  assertSuccess(batched, 'batch_edit');
  return opened;
}

describe('replace_text — formatting text in a tracked-inserted table row (#1225)', () => {
  registerCleanup();

  test('bold on a reviewer-inserted row is a run property change inside the reviewer insertion', async ({ given, when, then }: AllureBddContext) => {
    const mgr = new SessionManager({ defaultAiAuthor: AI });
    const opened = await given('a table row inserted by a reviewer, bolded through replace_text and batch_edit', () =>
      boldReviewerRow(mgr));

    const doc = await when('the session document is serialized', () => readBody(mgr, opened.filePath));

    await then('the AI adds no content revision and the bold carries an AI w:rPrChange', () => {
      expect(xmlOf(contentRevisionsBy(doc, AI))).toEqual([]);
      expect(rowRuns(doc, 1)).toEqual([
        { text: 'Alpha', bold: true, inIns: REVIEWER },
        { text: 'Beta', bold: true, inIns: REVIEWER },
        { text: ' Gamma', bold: false, inIns: REVIEWER },
      ]);
      const changes = byLocal(doc, 'rPrChange');
      expect(changes).toHaveLength(2);
      expect(changes.every((c) => author(c) === AI)).toBe(true);
      // The reviewer's row and paragraph-mark insertions are untouched.
      expect(byLocal(byLocal(doc, 'trPr')[0]!, 'ins').map((m) => author(m))).toEqual([REVIEWER]);
    });
  });

  test('reject_ai_edits removes only the bold and keeps the reviewer insertion', async ({ given, when, then }: AllureBddContext) => {
    const mgr = new SessionManager({ defaultAiAuthor: AI });
    const opened = await given('a reviewer-inserted row bolded by the AI', () => boldReviewerRow(mgr));

    const rejected = await when('reject_ai_edits targets the AI author', () =>
      rejectAiEdits(mgr, { file_path: opened.filePath, author: AI }));

    await then('it succeeds and the row is the reviewer insertion again, unbolded', async () => {
      assertSuccess(rejected, 'reject_ai_edits');
      const doc = await readBody(mgr, opened.filePath);
      expect(xmlOf(byLocal(doc, 'rPrChange'))).toEqual([]);
      expect(rowRuns(doc, 1).map((r) => r.bold)).toEqual(rowRuns(doc, 1).map(() => false));
      expect(rowRuns(doc, 1).map((r) => r.text).join('|')).toBe('Alpha|Beta| Gamma');
      expect(rowRuns(doc, 1).every((r) => r.inIns === REVIEWER)).toBe(true);
      expect(byLocal(byLocal(doc, 'trPr')[0]!, 'ins').map((m) => author(m))).toEqual([REVIEWER]);
    });
  });

  test('accept_ai_edits keeps the bold and keeps the reviewer insertion', async ({ given, when, then }: AllureBddContext) => {
    const mgr = new SessionManager({ defaultAiAuthor: AI });
    const opened = await given('a reviewer-inserted row bolded by the AI', () => boldReviewerRow(mgr));

    const accepted = await when('accept_ai_edits targets the AI author', () =>
      acceptAiEdits(mgr, { file_path: opened.filePath, author: AI }));

    await then('it succeeds, the bold stays, and the row is still a reviewer insertion', async () => {
      assertSuccess(accepted, 'accept_ai_edits');
      const doc = await readBody(mgr, opened.filePath);
      expect(xmlOf(byLocal(doc, 'rPrChange'))).toEqual([]);
      expect(rowRuns(doc, 1)).toEqual([
        { text: 'Alpha', bold: true, inIns: REVIEWER },
        { text: 'Beta', bold: true, inIns: REVIEWER },
        { text: ' Gamma', bold: false, inIns: REVIEWER },
      ]);
      expect(byLocal(byLocal(doc, 'trPr')[0]!, 'ins').map((m) => author(m))).toEqual([REVIEWER]);
    });
  });

  test('a second formatting edit on the same inserted cell stays one property change that reject_ai_edits undoes', async ({ given, when, then }: AllureBddContext) => {
    const mgr = new SessionManager({ defaultAiAuthor: AI });
    const opened = await given('a reviewer-inserted row', () =>
      openSession([], { mgr, xml: documentXml(REVIEWER_INSERTED_ROW) }));
    const alphaId = opened.paraIds[3]!;

    await when('batch_edit bolds the cell and then italicizes it in a second step', async () => {
      assertSuccess(await batchEdit(mgr, {
        file_path: opened.filePath,
        steps: [{
          step_id: 'bold', operation: 'replace_text', target_paragraph_id: alphaId,
          old_string: 'Alpha', new_string: '<b>Alpha</b>', instruction: 'Bold',
        }],
      }), 'batch_edit bold');
      assertSuccess(await batchEdit(mgr, {
        file_path: opened.filePath,
        steps: [{
          step_id: 'italic', operation: 'replace_text', target_paragraph_id: alphaId,
          old_string: 'Alpha', new_string: '<b><i>Alpha</i></b>', instruction: 'Italicize',
        }],
      }), 'batch_edit italic');
    });

    await then('no AI content revision exists, and rejecting the AI edits restores the plain reviewer text', async () => {
      const doc = await readBody(mgr, opened.filePath);
      expect(xmlOf(contentRevisionsBy(doc, AI))).toEqual([]);
      expect(byLocal(doc, 'rPrChange')).toHaveLength(1);
      assertSuccess(await rejectAiEdits(mgr, { file_path: opened.filePath, author: AI }), 'reject_ai_edits');
      const after = await readBody(mgr, opened.filePath);
      expect(xmlOf(byLocal(after, 'rPrChange'))).toEqual([]);
      expect(xmlOf([...byLocal(after, 'b'), ...byLocal(after, 'i')])).toEqual([]);
      expect(rowRuns(after, 1)[0]).toEqual({ text: 'Alpha', bold: false, inIns: REVIEWER });
    });
  });

  test('a row inserted in the same session can be bolded and the AI edits accepted', async ({ given, when, then }: AllureBddContext) => {
    const mgr = new SessionManager({ defaultAiAuthor: AI });
    const inserted = await given('a session that inserts a tracked table row', async () => {
      const opened = await openSession([], { mgr, xml: documentXml('') });
      const session = await docxSession(mgr, opened.filePath);
      const ctx = await getRevisionContextForSession(session);
      const row = session.doc.insertTableRow(
        { positionalAnchorNodeId: opened.paraIds[1]!, relativePosition: 'AFTER', cellTexts: ['Alpha', 'Beta'] },
        ctx,
      );
      return { opened, cellIds: row.cellParagraphIds };
    });

    await when('both new cells are bolded through batch_edit', async () => {
      assertSuccess(await batchEdit(mgr, {
        file_path: inserted.opened.filePath,
        steps: inserted.cellIds.map((id, i) => ({
          step_id: `bold-${i}`,
          operation: 'replace_text',
          target_paragraph_id: id,
          old_string: i === 0 ? 'Alpha' : 'Beta',
          new_string: i === 0 ? '<b>Alpha</b>' : '<b>Beta</b>',
          instruction: 'Bold the new row',
        })),
      }), 'batch_edit');
    });

    await then('the text stays in the original insertion and accept_ai_edits resolves everything', async () => {
      const before = await readBody(mgr, inserted.opened.filePath);
      expect(xmlOf(byLocal(before, 'del'))).toEqual([]);
      expect(rowRuns(before, 1)).toEqual([
        { text: 'Alpha', bold: true, inIns: AI },
        { text: 'Beta', bold: true, inIns: AI },
      ]);
      const accepted = await acceptAiEdits(mgr, { file_path: inserted.opened.filePath, author: AI });
      assertSuccess(accepted, 'accept_ai_edits');
      const after = await readBody(mgr, inserted.opened.filePath);
      expect(xmlOf([...byLocal(after, 'ins'), ...byLocal(after, 'rPrChange')])).toEqual([]);
      expect(rowRuns(after, 1)).toEqual([
        { text: 'Alpha', bold: true, inIns: null },
        { text: 'Beta', bold: true, inIns: null },
      ]);
    });
  });
});
