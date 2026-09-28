/**
 * Regression test for issue #1098: blanking a whole paragraph with
 * replace_text(old_string: <all text>, new_string: "") gave different
 * documents by tracking mode when the paragraph carried a bookmark or a
 * comment range. The clean save kept an empty paragraph with the markers; the
 * tracked save deleted the paragraph mark, so accept-all merged the comment
 * markers into the next paragraph or dropped the bookmark entirely (a lost
 * cross-reference target).
 *
 * Exercises the full package path — open → replace_text → save — in both
 * modes and resolves the tracked package with accept-all and reject-all.
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
import { replaceText } from './replace_text.js';
import { save } from './save.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Tracked Change Emission' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const COMMENT_PARTS: Record<string, string> = {
  '[Content_Types].xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
    `<Override PartName="/word/comments.xml" ContentType="${CT}.comments+xml"/>` +
    '</Types>',
  'word/_rels/document.xml.rels':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId12" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' +
    '</Relationships>',
  'word/comments.xml':
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W_NS}">` +
    '<w:comment w:id="0" w:author="Reviewer" w:date="2026-01-01T00:00:00Z" w:initials="R"><w:p><w:r><w:t>Comment body.</w:t></w:r></w:p></w:comment>' +
    '</w:comments>',
};

const T = (s: string): string => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
const TARGET_TEXT = 'Alpha Bravo';

function wrapDoc(paragraph: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    '<w:body>' +
    '<w:p><w:r><w:t xml:space="preserve">Intro paragraph.</w:t></w:r></w:p>' +
    paragraph +
    '<w:p><w:r><w:t xml:space="preserve">Closing paragraph.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
}

const MARKERS = ['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference'];

function inside(el: Element, local: string): boolean {
  for (let node: Node | null = el.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === local) return true;
  }
  return false;
}

/** Body signature: one entry per paragraph, live w:t text and ⟨marker⟩ tokens in order; deleted text as [del:…]. */
function bodySignature(doc: Document): string[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'p')).map((p) => {
    let out = '';
    const walk = (node: Node): void => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== 1) continue;
        const el = child as Element;
        if (el.namespaceURI !== W_NS || el.localName === 'rPr' || el.localName === 'pPr') continue;
        if (el.localName === 't') out += el.textContent ?? '';
        else if (el.localName === 'delText') out += `[del:${el.textContent ?? ''}]`;
        else if (MARKERS.includes(el.localName ?? '')) out += `⟨${el.localName}${el.getAttribute('w:name') ? ':' + el.getAttribute('w:name') : ''}⟩`;
        else walk(el);
      }
    };
    walk(p);
    return out.replace(/\]\[del:/gu, '');
  });
}

async function loadBody(outPath: string): Promise<Document> {
  const archive = await DocxArchive.load(await fs.readFile(outPath));
  const xml = await archive.getFile('word/document.xml');
  expect(xml).toBeTruthy();
  return parseXml(xml!);
}

function paragraphMarkDeleted(p: Element): boolean {
  return Array.from(p.getElementsByTagNameNS(W_NS, 'del')).some((del) => inside(del, 'rPr') && inside(del, 'pPr'));
}

const CASES: Array<{ name: string; paragraph: string; original: string; blanked: string }> = [
  {
    name: 'bookmark spanning the whole paragraph',
    paragraph: `<w:p><w:bookmarkStart w:id="5" w:name="Sec1"/>${T(TARGET_TEXT)}<w:bookmarkEnd w:id="5"/></w:p>`,
    original: '⟨bookmarkStart:Sec1⟩Alpha Bravo⟨bookmarkEnd⟩',
    blanked: '⟨bookmarkStart:Sec1⟩⟨bookmarkEnd⟩',
  },
  {
    name: 'comment range spanning the whole paragraph',
    paragraph: `<w:p><w:commentRangeStart w:id="0"/>${T(TARGET_TEXT)}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`,
    original: '⟨commentRangeStart⟩Alpha Bravo⟨commentRangeEnd⟩⟨commentReference⟩',
    blanked: '⟨commentRangeStart⟩⟨commentRangeEnd⟩⟨commentReference⟩',
  },
];

async function blankAndSave(paragraph: string, tracked: boolean): Promise<string> {
  const mgr = createTestSessionManager({ defaultAiAuthor: tracked ? 'SafeDocX' : null });
  const session = await openSession([], { mgr, xml: wrapDoc(paragraph), extraFiles: COMMENT_PARTS });
  const outPath = path.join(session.tmpDir, tracked ? 'out-tracked.docx' : 'out-clean.docx');
  const replaced = await replaceText(mgr, {
    file_path: session.inputPath,
    target_paragraph_id: session.paraIds[1]!,
    old_string: TARGET_TEXT,
    new_string: '',
    instruction: 'blank the paragraph',
  });
  assertSuccess(replaced, 'replace_text');
  expect(replaced.after_text).toBe('');
  assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: outPath, save_format: tracked ? 'tracked' : 'clean' }), 'save');
  return outPath;
}

describe('replace_text — blanking a paragraph that carries a bookmark or comment range (#1098)', () => {
  registerCleanup();

  for (const c of CASES) {
    test(`${c.name}: tracked and clean agree the paragraph survives, and accept-all equals the clean save`, async ({ given, when, then }: AllureBddContext) => {
      let trackedPath: string;
      let cleanPath: string;

      await given('the paragraph blanked with replace_text and saved clean', async () => {
        cleanPath = await blankAndSave(c.paragraph, false);
      });

      await when('the same edit is saved tracked', async () => {
        trackedPath = await blankAndSave(c.paragraph, true);
      });

      await then('the clean save keeps three paragraphs, the middle one empty with its markers', async () => {
        expect(bodySignature(await loadBody(cleanPath))).toEqual(['Intro paragraph.', c.blanked, 'Closing paragraph.']);
      });

      await then('the tracked save deletes the text but keeps the paragraph mark, markers live', async () => {
        const doc = await loadBody(trackedPath);
        const middle = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))[1]!;
        expect(paragraphMarkDeleted(middle)).toBe(false);
        expect(bodySignature(doc)[1]).toBe(c.blanked.replace('⟩⟨', `⟩[del:${TARGET_TEXT}]⟨`));
        for (const m of Array.from(middle.getElementsByTagNameNS(W_NS, '*')).filter((el) => MARKERS.includes(el.localName ?? ''))) {
          expect(inside(m, 'del')).toBe(false);
          expect(inside(m, 'ins')).toBe(false);
        }
      });

      await then('accept-all of the tracked save equals the clean save: no marker dropped or moved', async () => {
        const doc = await loadBody(trackedPath);
        acceptChanges(doc);
        expect(bodySignature(doc)).toEqual(['Intro paragraph.', c.blanked, 'Closing paragraph.']);
      });

      await then('reject-all of the tracked save equals the original', async () => {
        const doc = await loadBody(trackedPath);
        rejectChanges(doc);
        expect(bodySignature(doc)).toEqual(['Intro paragraph.', c.original, 'Closing paragraph.']);
      });
    });
  }
});
