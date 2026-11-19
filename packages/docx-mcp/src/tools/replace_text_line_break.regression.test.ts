/**
 * Regression test for issue #1198: replace_text corrupts a paragraph when
 * old_string spans <w:br/> line breaks under tracked changes.
 *
 * When a tracked replacement trims a common prefix/suffix and wraps the middle
 * span in <w:del>, any <w:br/> or <w:tab/> inside the deleted runs remains a
 * <w:br/> or <w:tab/> element in OOXML (unlike <w:t>, which becomes
 * <w:delText>). Previously, buildParagraphIndex counted <w:br/> and <w:tab/>
 * inside <w:del> as live visible characters, causing read-back and subsequent
 * edits to splice deleted line breaks into the middle of the paragraph text.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect } from 'vitest';
import {
  DocxArchive,
  parseXml,
  acceptChanges,
  rejectChanges,
  getParagraphText,
} from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { replaceText } from './replace_text.js';
import { readFile } from './read_file.js';
import { save } from './save.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Tracked Change Emission' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeDocXml(paragraphInnerXml: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}">` +
    '<w:body>' +
    `<w:p>${paragraphInnerXml}</w:p>` +
    '</w:body></w:document>'
  );
}

async function loadDocumentXml(outPath: string): Promise<Document> {
  const archive = await DocxArchive.load(await fs.readFile(outPath));
  const documentXml = await archive.getFile('word/document.xml');
  expect(documentXml).toBeTruthy();
  return parseXml(documentXml!);
}

describe('replace_text — multi-line paragraphs with <w:br/> line breaks (#1198)', () => {
  registerCleanup();

  test('synthetic repro: replacing "A: ___\\nB: ___\\nC: ___" with wider underscores does not split the first line across deleted breaks', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
    const xml = makeDocXml(
      '<w:r><w:t>A: ___</w:t><w:br/><w:t>B: ___</w:t><w:br/><w:t>C: ___</w:t></w:r>',
    );

    const session = await given('a paragraph with three lines separated by <w:br/> in a single run', () =>
      openSession([], { mgr, xml }),
    );
    const paraId = session.paraIds[0]!;
    const oldStr = 'A: ___\nB: ___\nC: ___';
    const newStr = 'A: ______\n\nB: ______\nC: ______';

    const trackedPath = path.join(session.tmpDir, 'out-tracked.docx');
    const cleanPath = path.join(session.tmpDir, 'out-clean.docx');

    await when('replace_text widens every blank and inserts a blank line after A', async () => {
      const res = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: paraId,
        old_string: oldStr,
        new_string: newStr,
        instruction: 'widen fill-in blanks and add spacing',
      });
      assertSuccess(res, 'replace_text');
      expect(res.after_text).toBe(newStr);

      const readRes = await readFile(mgr, { file_path: session.inputPath, format: 'json' });
      assertSuccess(readRes, 'read_file');
      const nodes = JSON.parse(readRes.content as string) as Array<{ raw_text: string; text: string }>;
      expect(nodes[0]?.raw_text).toBe(newStr);
      expect(nodes[0]?.text).toBe(newStr);

      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: cleanPath, save_format: 'clean' }), 'save clean');
    });

    await then('accepting tracked changes yields new_string, rejecting restores old_string, and clean save matches new_string', async () => {
      const trackedForAccept = await loadDocumentXml(trackedPath);
      acceptChanges(trackedForAccept);
      const acceptedP = trackedForAccept.getElementsByTagNameNS(W_NS, 'p').item(0)!;
      expect(getParagraphText(acceptedP)).toBe(newStr);

      const trackedForReject = await loadDocumentXml(trackedPath);
      rejectChanges(trackedForReject);
      const rejectedP = trackedForReject.getElementsByTagNameNS(W_NS, 'p').item(0)!;
      expect(getParagraphText(rejectedP)).toBe(oldStr);

      const cleanDoc = await loadDocumentXml(cleanPath);
      const cleanP = cleanDoc.getElementsByTagNameNS(W_NS, 'p').item(0)!;
      expect(getParagraphText(cleanP)).toBe(newStr);
    });
  });

  test('case 1: replacing all 5 lines of a <w:br/> signature block preserves line structure without orphaned underscores', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
    const xml = makeDocXml(
      '<w:r><w:t>By: ____</w:t></w:r>' +
      '<w:r><w:br/><w:t>Name: ____</w:t></w:r>' +
      '<w:r><w:br/><w:t>Title: ____</w:t></w:r>' +
      '<w:r><w:br/><w:t>Date: ____</w:t></w:r>' +
      '<w:r><w:br/><w:t>Email: ____</w:t></w:r>',
    );

    const session = await given('a 5-line signature block paragraph using <w:br/> line breaks', () =>
      openSession([], { mgr, xml }),
    );
    const paraId = session.paraIds[0]!;
    const oldStr = 'By: ____\nName: ____\nTitle: ____\nDate: ____\nEmail: ____';
    const newStr = 'By: ________\nName: ________\nTitle: ________\nDate: ________\nEmail: ________';

    let afterText = '';
    await when('replace_text widens all five underscore blanks', async () => {
      const res = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: paraId,
        old_string: oldStr,
        new_string: newStr,
        instruction: 'widen signature blanks',
      });
      assertSuccess(res, 'replace_text');
      afterText = res.after_text as string;
    });

    await then('after_text exactly matches new_string with no extra blank lines or split underscores', () => {
      expect(afterText).toBe(newStr);
    });
  });

  test('case 2: replacing the tail lines of a 7-line <w:br/> notice block does not leak deleted breaks as extra blank lines', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
    const xml = makeDocXml(
      '<w:r><w:t>If to Company:</w:t></w:r>' +
      '<w:r><w:br/><w:t>Acme Corp.</w:t></w:r>' +
      '<w:r><w:br/><w:t>100 Main Street</w:t></w:r>' +
      '<w:r><w:br/><w:t>Attn: ____</w:t></w:r>' +
      '<w:r><w:br/><w:t>Email: ____</w:t></w:r>' +
      '<w:r><w:br/><w:t>Phone: ____</w:t></w:r>' +
      '<w:r><w:br/><w:t>Fax: ____</w:t></w:r>',
    );

    const session = await given('a 7-line notice block paragraph where the last 4 lines have fill-in blanks', () =>
      openSession([], { mgr, xml }),
    );
    const paraId = session.paraIds[0]!;
    const oldStr = 'Attn: ____\nEmail: ____\nPhone: ____\nFax: ____';
    const newStr = '\nAttn: ________\nEmail: ________\nPhone: ________\nFax: ________';
    const expectedFull =
      'If to Company:\nAcme Corp.\n100 Main Street\n\n' +
      'Attn: ________\nEmail: ________\nPhone: ________\nFax: ________';

    let afterText = '';
    await when('replace_text replaces the last 4 lines and prefixes a blank line', async () => {
      const res = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: paraId,
        old_string: oldStr,
        new_string: newStr,
        instruction: 'separate contact fields with one blank line and widen blanks',
      });
      assertSuccess(res, 'replace_text');
      afterText = res.after_text as string;
    });

    await then('the resulting paragraph has exactly one blank line before the contact lines, not five', async () => {
      expect(afterText).toBe(expectedFull);
      const readRes = await readFile(mgr, { file_path: session.inputPath, format: 'json' });
      assertSuccess(readRes, 'read_file');
      const nodes = JSON.parse(readRes.content as string) as Array<{ raw_text: string; text: string }>;
      expect(nodes[0]?.raw_text).toBe(expectedFull);
      expect(nodes[0]?.text).toBe(expectedFull);
    });
  });
});
