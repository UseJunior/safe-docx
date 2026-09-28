/**
 * Regression test for issue #1094: a tracked replace_text whose range covered
 * a footnote reference that sat alone in a run carrying `w:rStyle` (the shape
 * Word writes) dropped the reference: it was neither kept live nor wrapped in
 * `w:del`, so reject-all could not restore the note and the footnote body was
 * orphaned. The unstyled control run was merged into a neighbouring text run
 * on open and so was already tracked; the styled run stays on its own, which
 * is why the regression needs this exact shape.
 *
 * Exercises the full package path — open → replace_text → save tracked — and
 * resolves the saved package with reject-all (must equal the original,
 * reference included) and accept-all (target text, reference gone). Covers
 * `w:footnoteReference` and `w:endnoteReference`, a whole-text range and a
 * partial range that spans the reference.
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

const T = (s: string): string => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;

/** The issue's paragraph: "Alpha", the reference alone in a styled run, " Bravo". */
const issueParagraph = (local: string, style: string): string =>
  `<w:p>${T('Alpha')}` +
  `<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:${local} w:id="1"/></w:r>` +
  `${T(' Bravo')}</w:p>`;

function wrapDoc(paragraph: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    '<w:body>' +
    '<w:p><w:r><w:t xml:space="preserve">Intro paragraph.</w:t></w:r></w:p>' +
    paragraph +
    '<w:p><w:r><w:t xml:space="preserve">Closing paragraph.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
}

const NOTE_PARTS: Record<string, Record<string, string>> = {
  footnoteReference: {
    'word/footnotes.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:footnotes xmlns:w="${W_NS}">` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Note text.</w:t></w:r></w:p></w:footnote>' +
      '</w:footnotes>',
  },
  endnoteReference: {
    'word/endnotes.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:endnotes xmlns:w="${W_NS}">` +
      '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
      '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
      '<w:endnote w:id="1"><w:p><w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> Note text.</w:t></w:r></w:p></w:endnote>' +
      '</w:endnotes>',
  },
};

function insideDeletion(el: Element): boolean {
  for (let node: Node | null = el.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === 'del') return true;
  }
  return false;
}

/** Paragraph signature in document order: w:t / w:delText text and the note reference as ⟨ref⟩. */
function signature(p: Element, local: string): string {
  let out = '';
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== W_NS) continue;
      if (el.localName === 't' || el.localName === 'delText') out += el.textContent ?? '';
      else if (el.localName === local) out += '⟨ref⟩';
      else if (el.localName !== 'rPr' && el.localName !== 'pPr') walk(el);
    }
  };
  walk(p);
  return out;
}

async function loadBodyParagraph(outPath: string): Promise<{ doc: Document; paragraph: () => Element }> {
  const archive = await DocxArchive.load(await fs.readFile(outPath));
  const xml = await archive.getFile('word/document.xml');
  expect(xml).toBeTruthy();
  const doc = parseXml(xml!);
  return { doc, paragraph: () => Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))[1]! };
}

const references = (p: Element, local: string): Element[] => Array.from(p.getElementsByTagNameNS(W_NS, local));

const NOTES: Array<{ local: string; style: string }> = [
  { local: 'footnoteReference', style: 'FootnoteReference' },
  { local: 'endnoteReference', style: 'EndnoteReference' },
];
const RANGES: Array<{ name: string; oldString: string; newString: string; afterText: string; accepted: string }> = [
  { name: 'the whole text', oldString: 'Alpha Bravo', newString: 'Charlie', afterText: 'Charlie', accepted: 'Charlie' },
  { name: 'a partial range spanning the reference', oldString: 'ha Br', newString: 'X', afterText: 'AlpXavo', accepted: 'AlpXavo' },
];

describe('replace_text — a note reference alone in a styled run inside a tracked replace (#1094)', () => {
  registerCleanup();

  for (const note of NOTES) {
    for (const range of RANGES) {
      test(`tracked save (w:${note.local}, ${range.name}): the reference is inside w:del, reject-all restores it, accept-all removes it`, async ({ given, when, then }: AllureBddContext) => {
        const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
        const original = 'Alpha⟨ref⟩ Bravo';

        const session = await given(`a paragraph "Alpha Bravo" with a w:${note.local} alone in a w:rStyle run after "Alpha"`, () =>
          openSession([], { mgr, xml: wrapDoc(issueParagraph(note.local, note.style)), extraFiles: NOTE_PARTS[note.local] }),
        );
        const paraId = session.paraIds[1]!;

        const trackedPath = path.join(session.tmpDir, 'out-tracked.docx');
        await when(`replace_text replaces "${range.oldString}" with "${range.newString}" and the session is saved tracked`, async () => {
          const replaced = await replaceText(mgr, {
            file_path: session.inputPath,
            target_paragraph_id: paraId,
            old_string: range.oldString,
            new_string: range.newString,
            instruction: 'rewrite the sentence',
          });
          assertSuccess(replaced, 'replace_text');
          expect(replaced.after_text).toBe(range.afterText);
          assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
        });

        await then('the reference is in the tracked save, inside w:del, in its styled run', async () => {
          const { paragraph } = await loadBodyParagraph(trackedPath);
          const refs = references(paragraph(), note.local);
          expect(refs).toHaveLength(1);
          expect(insideDeletion(refs[0]!)).toBe(true);
          const rPr = (refs[0]!.parentNode as Element).getElementsByTagNameNS(W_NS, 'rStyle').item(0);
          expect(rPr?.getAttribute('w:val')).toBe(note.style);
        });

        await then('reject-all equals the original paragraph, reference included', async () => {
          const { doc, paragraph } = await loadBodyParagraph(trackedPath);
          rejectChanges(doc);
          expect(signature(paragraph(), note.local)).toBe(original);
          const refs = references(paragraph(), note.local);
          expect(refs).toHaveLength(1);
          expect(refs[0]!.getAttribute('w:id')).toBe('1');
          expect(insideDeletion(refs[0]!)).toBe(false);
        });

        await then('accept-all equals the target text with the reference gone', async () => {
          const { doc, paragraph } = await loadBodyParagraph(trackedPath);
          acceptChanges(doc);
          expect(signature(paragraph(), note.local)).toBe(range.accepted);
          expect(references(paragraph(), note.local)).toHaveLength(0);
        });
      });
    }
  }

  test('control: an edit elsewhere in the paragraph leaves the styled reference live', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
    const session = await given('the footnote paragraph', () =>
      openSession([], { mgr, xml: wrapDoc(issueParagraph('footnoteReference', 'FootnoteReference')), extraFiles: NOTE_PARTS.footnoteReference }),
    );
    const trackedPath = path.join(session.tmpDir, 'out-tracked.docx');

    await when('replace_text replaces "Bravo" (after the reference) with "Delta" and saves tracked', async () => {
      assertSuccess(await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: session.paraIds[1]!,
        old_string: 'Bravo',
        new_string: 'Delta',
        instruction: 'edit after the note',
      }), 'replace_text');
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
    });

    await then('the reference is live, and accept-all keeps it before the new text', async () => {
      const { doc, paragraph } = await loadBodyParagraph(trackedPath);
      const refs = references(paragraph(), 'footnoteReference');
      expect(refs).toHaveLength(1);
      expect(insideDeletion(refs[0]!)).toBe(false);
      acceptChanges(doc);
      expect(signature(paragraph(), 'footnoteReference')).toBe('Alpha⟨ref⟩ Delta');
    });
  });
});
