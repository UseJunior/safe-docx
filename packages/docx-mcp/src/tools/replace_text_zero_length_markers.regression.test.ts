/**
 * Regression test for issue #1083: a tracked replace_text whose range crossed
 * a comment's range markers, or a w:fldSimple with no result, left those
 * markers live but emitted the whole deletion after them, so reject-all put
 * the removed text on the wrong side of each marker (a comment anchored on
 * "Alpha" came back anchored on "Alph"). Accept-all also deleted the comment
 * reference while its range markers stayed live.
 *
 * Exercises the full package path — open → replace_text → save tracked — and
 * resolves the saved package with accept-all and reject-all.
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

function wrapDoc(paragraph: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    '<w:body>' +
    '<w:p><w:r><w:t xml:space="preserve">Intro paragraph.</w:t></w:r></w:p>' +
    paragraph +
    '<w:p><w:r><w:t xml:space="preserve">Closing paragraph.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
}

const MARKERS = ['commentRangeStart', 'commentRangeEnd', 'commentReference', 'fldSimple'];

function inside(el: Element, local: string): boolean {
  for (let node: Node | null = el.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === local) return true;
  }
  return false;
}

/** Live paragraph content in document order: w:t text and ⟨marker⟩ tokens. Deleted content is shown as [del:…]. */
function signature(p: Element): string {
  let out = '';
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== W_NS || el.localName === 'rPr' || el.localName === 'pPr') continue;
      if (el.localName === 't') out += el.textContent ?? '';
      else if (el.localName === 'delText') out += `[del:${el.textContent ?? ''}]`;
      else if (MARKERS.includes(el.localName ?? '')) out += `⟨${el.localName}⟩`;
      else walk(el);
    }
  };
  walk(p);
  return out.replace(/\]\[del:/gu, '');
}

async function loadBodyParagraph(outPath: string): Promise<{ doc: Document; paragraph: () => Element }> {
  const archive = await DocxArchive.load(await fs.readFile(outPath));
  const xml = await archive.getFile('word/document.xml');
  expect(xml).toBeTruthy();
  const doc = parseXml(xml!);
  return { doc, paragraph: () => Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))[1]! };
}

function liveIds(p: Element, local: string): string[] {
  return Array.from(p.getElementsByTagNameNS(W_NS, local))
    .filter((el) => !inside(el, 'del') && !inside(el, 'ins'))
    .map((el) => el.getAttribute('w:id') ?? '');
}

const CASES: Array<{ name: string; paragraph: string; oldString: string; original: string; accepted: string }> = [
  {
    name: 'comment anchored on "Alpha", reference run inside the range',
    paragraph: `<w:p><w:commentRangeStart w:id="0"/>${T('Alpha')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>${T(' Bravo')}</w:p>`,
    oldString: 'a B',
    original: '⟨commentRangeStart⟩Alpha⟨commentRangeEnd⟩⟨commentReference⟩ Bravo',
    accepted: '⟨commentRangeStart⟩Alph⟨commentRangeEnd⟩⟨commentReference⟩Xravo',
  },
  {
    name: 'empty comment range just before its reference',
    paragraph: `<w:p>${T('Alpha ')}<w:commentRangeStart w:id="0"/><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>${T(' Bravo')}</w:p>`,
    oldString: 'a  B',
    original: 'Alpha ⟨commentRangeStart⟩⟨commentRangeEnd⟩⟨commentReference⟩ Bravo',
    accepted: 'Alph⟨commentRangeStart⟩⟨commentRangeEnd⟩⟨commentReference⟩Xravo',
  },
  {
    name: 'result-less w:fldSimple',
    paragraph: `<w:p>${T('Alpha ')}<w:fldSimple w:instr=" PAGE "/>${T(' Bravo')}</w:p>`,
    oldString: 'a  B',
    original: 'Alpha ⟨fldSimple⟩ Bravo',
    accepted: 'Alph⟨fldSimple⟩Xravo',
  },
];

describe('replace_text — zero-length markers inside a tracked replace stay in place (#1083)', () => {
  registerCleanup();

  for (const c of CASES) {
    test(`tracked save (${c.name}): markers stay live in place, reject-all equals the original, accept-all the target`, async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
      const session = await given('a paragraph with zero-length markers inside the text to replace', () =>
        openSession([], { mgr, xml: wrapDoc(c.paragraph), extraFiles: COMMENT_PARTS }),
      );
      const trackedPath = path.join(session.tmpDir, 'out-tracked.docx');

      await when(`replace_text replaces "${c.oldString}" with "X" and the session is saved tracked`, async () => {
        const replaced = await replaceText(mgr, {
          file_path: session.inputPath,
          target_paragraph_id: session.paraIds[1]!,
          old_string: c.oldString,
          new_string: 'X',
          instruction: 'collapse',
        });
        assertSuccess(replaced, 'replace_text');
        expect(replaced.after_text).toBe('AlphXravo');
        assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
      });

      await then('no marker is inside a w:del or w:ins', async () => {
        const { paragraph } = await loadBodyParagraph(trackedPath);
        const markers = Array.from(paragraph().getElementsByTagNameNS(W_NS, '*'))
          .filter((el) => MARKERS.includes(el.localName ?? ''));
        expect(markers.length).toBeGreaterThan(0);
        for (const m of markers) {
          expect(inside(m, 'del')).toBe(false);
          expect(inside(m, 'ins')).toBe(false);
        }
      });

      await then('reject-all equals the original paragraph, marker positions included', async () => {
        const { doc, paragraph } = await loadBodyParagraph(trackedPath);
        rejectChanges(doc);
        expect(signature(paragraph())).toBe(c.original);
      });

      await then('accept-all equals the target text, and every live comment range has its reference', async () => {
        const { doc, paragraph } = await loadBodyParagraph(trackedPath);
        acceptChanges(doc);
        expect(signature(paragraph())).toBe(c.accepted);
        const refs = new Set(liveIds(paragraph(), 'commentReference'));
        for (const id of [...liveIds(paragraph(), 'commentRangeStart'), ...liveIds(paragraph(), 'commentRangeEnd')]) {
          expect(refs.has(id)).toBe(true);
        }
      });
    });
  }
});
