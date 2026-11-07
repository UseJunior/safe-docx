/**
 * Regression test for issue #1222: deleting a numbered heading that holds a
 * bookmark (such as a `_Ref*` cross-reference target) must delete the
 * paragraph mark in tracked mode and remove the paragraph in clean mode so
 * following sections renumber in both clean output and accept-all of tracked
 * output, while reject-all restores the original paragraph and bookmark, and
 * the tool response reports any REF fields that targeted the removed
 * paragraph's bookmarks.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect } from 'vitest';
import { DocxArchive, acceptChanges, parseXml, rejectChanges } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { replaceText, type AffectedRefField } from './replace_text.js';
import { readFile } from './read_file.js';
import { getDocumentOutline } from './get_document_outline.js';
import { save } from './save.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Paragraph Deletion' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const EXTRA_PARTS: Record<string, string> = {
  '[Content_Types].xml':
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="${CT}.numbering+xml"/>` +
    '</Types>',
  'word/_rels/document.xml.rels':
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${R_NS}">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    '</Relationships>',
  'word/styles.xml':
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W_NS}">` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>' +
    '</w:styles>',
  'word/numbering.xml':
    `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="${W_NS}">` +
    '<w:abstractNum w:abstractNumId="0">' +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="Article %1"/></w:lvl>' +
    '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimalZero"/><w:pStyle w:val="Heading2"/><w:lvlText w:val="Section 1.%2"/></w:lvl>' +
    '</w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '</w:numbering>',
};

function headingXml(text: string, bookmark?: string): string {
  return (
    '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>' +
    (bookmark ? `<w:bookmarkStart w:id="1" w:name="${bookmark}"/>` : '') +
    `<w:r><w:t>${text}</w:t></w:r>` +
    (bookmark ? '<w:bookmarkEnd w:id="1"/>' : '') +
    '</w:p>'
  );
}

function refFieldXml(name: string, cached: string): string {
  return (
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> REF ${name} \\n \\t \\h </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    `<w:r><w:t>${cached}</w:t></w:r>` +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  );
}

function makeDocumentXml(withBookmark: boolean): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>` +
    headingXml('Alpha. The first thing.') +
    headingXml('Bravo. The second thing.', withBookmark ? '_Ref100000001' : undefined) +
    headingXml('Charlie. The third thing.') +
    '<w:p><w:r><w:t xml:space="preserve">As provided in Section </w:t></w:r>' +
    (withBookmark ? refFieldXml('_Ref100000001', '1.02') : '<w:r><w:t>1.02</w:t></w:r>') +
    '<w:r><w:t>.</w:t></w:r></w:p>' +
    '<w:sectPr/></w:body></w:document>'
  );
}

async function loadDocumentXml(outPath: string): Promise<Document> {
  const archive = await DocxArchive.load(await fs.readFile(outPath));
  const xml = await archive.getFile('word/document.xml');
  expect(xml).toBeTruthy();
  return parseXml(xml!);
}

function headingTexts(doc: Document): string[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))
    .filter((p) => {
      const pStyle = p.getElementsByTagNameNS(W_NS, 'pStyle').item(0);
      return pStyle?.getAttribute('w:val') === 'Heading2';
    })
    .map((p) =>
      Array.from(p.getElementsByTagNameNS(W_NS, 't'))
        .map((t) => t.textContent ?? '')
        .join(''),
    );
}

function hasDeletedParagraphMark(p: Element): boolean {
  const pPr = Array.from(p.childNodes).find((c): c is Element => c.nodeType === 1 && (c as Element).localName === 'pPr');
  const rPr = pPr
    ? Array.from(pPr.childNodes).find((c): c is Element => c.nodeType === 1 && (c as Element).localName === 'rPr')
    : undefined;
  return !!rPr && Array.from(rPr.childNodes).some((c) => c.nodeType === 1 && (c as Element).localName === 'del');
}

describe('replace_text — blanking a numbered heading that holds a bookmark (#1222)', () => {
  registerCleanup();

  test('tracked mode: Section 1.02 is removed in clean and accept-all, Section 1.03 becomes 1.02, reject-all restores original, and response reports targeting REF fields', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
    const session = await given('three style-numbered Heading2 paragraphs where Section 1.02 holds _Ref100000001 and a body paragraph references it', () =>
      openSession([], { mgr, xml: makeDocumentXml(true), extraFiles: EXTRA_PARTS }),
    );

    const cleanPath = path.join(session.tmpDir, 'clean.docx');
    const trackedPath = path.join(session.tmpDir, 'tracked.docx');
    let warnings: string[] = [];
    let affectedRefFields: AffectedRefField[] = [];

    await when('replace_text deletes the text of Section 1.02 and saves both clean and tracked outputs', async () => {
      const res = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: session.paraIds[1]!,
        old_string: 'Bravo. The second thing.',
        new_string: '',
        instruction: 'Delete Section 1.02',
      });
      assertSuccess(res, 'replace_text');
      warnings = (res as { warnings?: string[] }).warnings ?? [];
      affectedRefFields = (res as { affected_ref_fields?: AffectedRefField[] }).affected_ref_fields ?? [];

      assertSuccess(
        await save(mgr, {
          file_path: session.inputPath,
          save_to_local_path: cleanPath,
          tracked_save_to_local_path: trackedPath,
          save_format: 'both',
        }),
        'save both',
      );
    });

    await then('the response reports the REF field targeting _Ref100000001', () => {
      expect(affectedRefFields).toEqual([
        {
          bookmark: '_Ref100000001',
          instruction: 'REF _Ref100000001 \\n \\t \\h',
          paragraph_id: session.paraIds[3]!,
        },
      ]);
      expect(warnings.some((w) => w.includes('_Ref100000001') && w.includes('REF _Ref100000001 \\n \\t \\h'))).toBe(true);
    });

    await then('in the live session and in the clean output, Section 1.02 is gone and Section 1.03 becomes Section 1.02', async () => {
      const outlineRes = await getDocumentOutline(mgr, { file_path: session.inputPath });
      assertSuccess(outlineRes, 'get_document_outline');
      const outline = (outlineRes as { outline?: Array<{ list_label?: string; text: string }> }).outline ?? [];
      expect(outline.map((e) => [e.list_label, e.text])).toEqual([
        ['Section 1.01', 'Alpha. The first thing.'],
        ['Section 1.02', 'Charlie. The third thing.'],
      ]);

      const cleanDoc = await loadDocumentXml(cleanPath);
      expect(headingTexts(cleanDoc)).toEqual([
        'Alpha. The first thing.',
        'Charlie. The third thing.',
      ]);

      const cleanOutlineRes = await getDocumentOutline(createTestSessionManager(), { file_path: cleanPath });
      assertSuccess(cleanOutlineRes, 'get_document_outline on clean output');
      const cleanOutline = (cleanOutlineRes as { outline?: Array<{ list_label?: string; text: string }> }).outline ?? [];
      expect(cleanOutline.map((e) => [e.list_label, e.text])).toEqual([
        ['Section 1.01', 'Alpha. The first thing.'],
        ['Section 1.02', 'Charlie. The third thing.'],
      ]);
    });

    await then('in the tracked output, the paragraph mark is deleted, accept-all matches the clean output, and reject-all restores the original', async () => {
      const trackedDoc = await loadDocumentXml(trackedPath);
      const trackedParagraphs = Array.from(trackedDoc.getElementsByTagNameNS(W_NS, 'p'));
      expect(hasDeletedParagraphMark(trackedParagraphs[1]!)).toBe(true);

      const acceptedDoc = await loadDocumentXml(trackedPath);
      acceptChanges(acceptedDoc);
      expect(headingTexts(acceptedDoc)).toEqual([
        'Alpha. The first thing.',
        'Charlie. The third thing.',
      ]);
      expect(acceptedDoc.getElementsByTagNameNS(W_NS, 'bookmarkStart')).toHaveLength(0);

      const rejectedDoc = await loadDocumentXml(trackedPath);
      rejectChanges(rejectedDoc);
      expect(headingTexts(rejectedDoc)).toEqual([
        'Alpha. The first thing.',
        'Bravo. The second thing.',
        'Charlie. The third thing.',
      ]);
      const starts = Array.from(rejectedDoc.getElementsByTagNameNS(W_NS, 'bookmarkStart'));
      expect(starts.map((s) => s.getAttribute('w:name'))).toEqual(['_Ref100000001']);
    });
  });

  test('untracked mode: Section 1.02 is removed on clean save, Section 1.03 becomes 1.02, and response reports targeting REF fields', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: null });
    const session = await given('the same style-numbered document opened with tracked emission disabled', () =>
      openSession([], { mgr, xml: makeDocumentXml(true), extraFiles: EXTRA_PARTS }),
    );

    const cleanPath = path.join(session.tmpDir, 'untracked-clean.docx');
    let affectedRefFields: AffectedRefField[] = [];

    await when('replace_text deletes Section 1.02 and saves clean', async () => {
      const res = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: session.paraIds[1]!,
        old_string: 'Bravo. The second thing.',
        new_string: '',
        instruction: 'Delete Section 1.02',
      });
      assertSuccess(res, 'replace_text');
      affectedRefFields = (res as { affected_ref_fields?: AffectedRefField[] }).affected_ref_fields ?? [];
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: cleanPath, save_format: 'clean' }), 'save clean');
    });

    await then('Section 1.02 is gone, Charlie renumbers to Section 1.02, and the REF field is reported', async () => {
      expect(affectedRefFields).toHaveLength(1);
      expect(affectedRefFields[0]?.bookmark).toBe('_Ref100000001');

      const cleanDoc = await loadDocumentXml(cleanPath);
      expect(headingTexts(cleanDoc)).toEqual([
        'Alpha. The first thing.',
        'Charlie. The third thing.',
      ]);

      const readRes = await readFile(mgr, { file_path: session.inputPath, format: 'json' });
      assertSuccess(readRes, 'read_file');
      const nodes = JSON.parse(readRes.content as string) as Array<{ list_label: string; clean_text: string }>;
      expect(nodes.filter((n) => n.list_label).map((n) => [n.list_label, n.clean_text])).toEqual([
        ['Section 1.01', 'Alpha. The first thing.'],
        ['Section 1.02', 'Charlie. The third thing.'],
      ]);
    });
  });
});
