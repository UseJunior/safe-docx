/**
 * Regression test for issue #1082: a tracked replace_text whose range spans a
 * complex field with no cached result (begin, instruction, end, no
 * `separate`; an XE index entry or a TC entry has this shape) used to delete
 * the field without tracking it. With each marker in its own run, none of the
 * three field runs reached the tracked save; with the markers sharing a run
 * with text, reject-all brought back an empty field shell with no
 * instruction.
 *
 * Exercises the full package path — open → replace_text → save tracked — and
 * resolves the saved package with accept-all and reject-all: reject-all must
 * give back the original paragraph, field included, and accept-all the target
 * text. A range that ends before the field is the control: the field stays
 * live.
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

const separateRuns = (instruction: string): string =>
  `<w:p>${T('Alpha ')}` +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
  `${T(' Bravo')}</w:p>`;

const sharedRun = (instruction: string): string =>
  '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t>' +
  '<w:fldChar w:fldCharType="begin"/>' +
  `<w:instrText xml:space="preserve">${instruction}</w:instrText>` +
  '<w:fldChar w:fldCharType="end"/>' +
  '<w:t xml:space="preserve"> Bravo</w:t></w:r></w:p>';

function wrapDoc(paragraph: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    '<w:body>' +
    '<w:p><w:r><w:t xml:space="preserve">Intro paragraph.</w:t></w:r></w:p>' +
    paragraph +
    '<w:p><w:r><w:t xml:space="preserve">Closing paragraph.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
}

function insideDeletion(el: Element): boolean {
  for (let node: Node | null = el.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === 'del') return true;
  }
  return false;
}

/**
 * Paragraph signature in document order: w:t / w:delText text, field markers
 * as ⟨begin⟩/⟨end⟩, instructions as ⟨instr:…⟩ and deleted instructions as
 * ⟨delInstr:…⟩ (so a dropped instruction cannot hide behind the rename).
 */
function signature(p: Element): string {
  let out = '';
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== W_NS) continue;
      if (el.localName === 't' || el.localName === 'delText') out += el.textContent ?? '';
      else if (el.localName === 'fldChar') out += `⟨${el.getAttribute('w:fldCharType')}⟩`;
      else if (el.localName === 'instrText') out += `⟨instr:${el.textContent ?? ''}⟩`;
      else if (el.localName === 'delInstrText') out += `⟨delInstr:${el.textContent ?? ''}⟩`;
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

/** Field markers of the paragraph, in document order. */
function fieldMarkers(p: Element): Element[] {
  return Array.from(p.getElementsByTagNameNS(W_NS, '*'))
    .filter((el) => ['fldChar', 'instrText', 'delInstrText'].includes(el.localName ?? ''));
}

const CASES: Array<{ name: string; paragraph: string; instruction: string }> = [
  { name: 'XE index entry, each marker in its own run', paragraph: separateRuns(' XE "Alpha" '), instruction: ' XE "Alpha" ' },
  { name: 'TC entry, each marker in its own run', paragraph: separateRuns(' TC "Alpha" \\l 1 '), instruction: ' TC "Alpha" \\l 1 ' },
  { name: 'PAGE without a result, each marker in its own run', paragraph: separateRuns(' PAGE '), instruction: ' PAGE ' },
  { name: 'XE index entry, markers sharing one run with the text', paragraph: sharedRun(' XE "Alpha" '), instruction: ' XE "Alpha" ' },
  { name: 'PAGE without a result, markers sharing one run with the text', paragraph: sharedRun(' PAGE '), instruction: ' PAGE ' },
];

describe('replace_text — a range spanning a result-less complex field (#1082)', () => {
  registerCleanup();

  for (const c of CASES) {
    test(`tracked save (${c.name}): the field is inside w:del, reject-all restores it, accept-all gives the target text`, async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
      const original = `Alpha ⟨begin⟩⟨instr:${c.instruction}⟩⟨end⟩ Bravo`;

      const session = await given('a paragraph with a result-less field between "Alpha " and " Bravo"', () =>
        openSession([], { mgr, xml: wrapDoc(c.paragraph) }),
      );
      const paraId = session.paraIds[1]!;
      expect(session.content).toContain('Alpha  Bravo');

      const trackedPath = path.join(session.tmpDir, 'out-tracked.docx');
      await when('replace_text replaces "a  B" (which spans the field) with "X" and the session is saved tracked', async () => {
        const replaced = await replaceText(mgr, {
          file_path: session.inputPath,
          target_paragraph_id: paraId,
          old_string: 'a  B',
          new_string: 'X',
          instruction: 'collapse the entry',
        });
        assertSuccess(replaced, 'replace_text');
        expect(replaced.after_text).toBe('AlphXravo');
        assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
      });

      await then('all three field markers are in the tracked save, each inside w:del', async () => {
        const { paragraph } = await loadBodyParagraph(trackedPath);
        const markers = fieldMarkers(paragraph());
        expect(markers.map((m) => m.localName)).toEqual(['fldChar', 'delInstrText', 'fldChar']);
        for (const marker of markers) expect(insideDeletion(marker)).toBe(true);
      });

      await then('reject-all equals the original paragraph, field included', async () => {
        const { doc, paragraph } = await loadBodyParagraph(trackedPath);
        rejectChanges(doc);
        expect(signature(paragraph())).toBe(original);
      });

      await then('accept-all equals the target text with no field left', async () => {
        const { doc, paragraph } = await loadBodyParagraph(trackedPath);
        acceptChanges(doc);
        expect(signature(paragraph())).toBe('AlphXravo');
        expect(fieldMarkers(paragraph())).toHaveLength(0);
      });
    });
  }

  test('control: a range that ends before the field leaves the field live', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
    const session = await given('a paragraph with an XE field in its own runs', () =>
      openSession([], { mgr, xml: wrapDoc(separateRuns(' XE "Alpha" ')) }),
    );
    const trackedPath = path.join(session.tmpDir, 'out-tracked.docx');

    await when('replace_text replaces "pha " (ending where the field starts) with "X" and saves tracked', async () => {
      assertSuccess(await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: session.paraIds[1]!,
        old_string: 'pha ',
        new_string: 'X',
        instruction: 'edit before the entry',
      }), 'replace_text');
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
    });

    await then('the field markers are live and follow the tracked replacement', async () => {
      const { doc, paragraph } = await loadBodyParagraph(trackedPath);
      const markers = fieldMarkers(paragraph());
      expect(markers.map((m) => m.localName)).toEqual(['fldChar', 'instrText', 'fldChar']);
      for (const marker of markers) expect(insideDeletion(marker)).toBe(false);
      acceptChanges(doc);
      expect(signature(paragraph())).toBe('AlX⟨begin⟩⟨instr: XE "Alpha" ⟩⟨end⟩ Bravo');
    });
  });
});
