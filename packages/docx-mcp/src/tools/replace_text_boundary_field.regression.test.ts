/**
 * Regression test for issue #1096: when a result-less field (an `XE` index
 * entry: begin, instruction, end, no `separate`) shared a run with the text
 * that followed it, a replace_text whose range started at that text also
 * deleted the field. Tracked, the field went into the `w:del`, so accept-all
 * removed an index entry the caller never targeted; clean, it was removed
 * silently. The range-start split left the run's leading zero-length
 * children on the in-range side.
 *
 * Exercises the full package path — open → replace_text → save — in tracked
 * and clean modes: the field must stay live and in place and only the
 * matched text may change. The mirror (field after the last matched
 * character, same run) is covered too, and a range that genuinely spans the
 * field still deletes it as in #1082.
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
const XE = ' XE "B" ';
const XE_MARKERS =
  '<w:fldChar w:fldCharType="begin"/>' +
  `<w:instrText xml:space="preserve">${XE}</w:instrText>` +
  '<w:fldChar w:fldCharType="end"/>';
const FIELD = `⟨begin⟩⟨instr:${XE}⟩⟨end⟩`;

/** The issue's paragraph: "Alpha ", then one run holding the field and "Bravo Charlie". */
const FIELD_LEADS_RUN = `<w:p>${T('Alpha ')}<w:r>${XE_MARKERS}<w:t>Bravo Charlie</w:t></w:r></w:p>`;
/** The field-plus-text run is the first run of the paragraph. */
const FIELD_LEADS_PARAGRAPH = `<w:p><w:r>${XE_MARKERS}<w:t>Bravo Charlie</w:t></w:r></w:p>`;
/** Mirror: the field follows the matched text in the same run. */
const FIELD_TRAILS_RUN = `<w:p><w:r><w:t xml:space="preserve">Alpha Bravo</w:t>${XE_MARKERS}</w:r>${T(' Charlie')}</w:p>`;

function wrapDoc(paragraph: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    '<w:body>' +
    '<w:p><w:r><w:t xml:space="preserve">Intro paragraph.</w:t></w:r></w:p>' +
    paragraph +
    '<w:p><w:r><w:t xml:space="preserve">Closing paragraph.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
}

function insideRevision(el: Element): boolean {
  for (let node: Node | null = el.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W_NS && ['del', 'ins'].includes((node as Element).localName ?? '')) return true;
  }
  return false;
}

/** Paragraph signature in document order: text, field markers as ⟨begin⟩/⟨end⟩, instructions as ⟨instr:…⟩ / ⟨delInstr:…⟩. */
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

function fieldMarkers(p: Element): Element[] {
  return Array.from(p.getElementsByTagNameNS(W_NS, '*'))
    .filter((el) => ['fldChar', 'instrText', 'delInstrText'].includes(el.localName ?? ''));
}

function expectFieldLive(p: Element): void {
  const markers = fieldMarkers(p);
  expect(markers.map((m) => m.localName)).toEqual(['fldChar', 'instrText', 'fldChar']);
  for (const marker of markers) expect(insideRevision(marker)).toBe(false);
}

const CASES: Array<{ name: string; paragraph: string; original: string; target: string }> = [
  { name: 'field leads the run (the issue\'s paragraph)', paragraph: FIELD_LEADS_RUN, original: `Alpha ${FIELD}Bravo Charlie`, target: `Alpha ${FIELD}Delta Charlie` },
  { name: 'field leads the first run of the paragraph', paragraph: FIELD_LEADS_PARAGRAPH, original: `${FIELD}Bravo Charlie`, target: `${FIELD}Delta Charlie` },
  { name: 'field trails the run (mirror case)', paragraph: FIELD_TRAILS_RUN, original: `Alpha Bravo${FIELD} Charlie`, target: `Alpha Delta${FIELD} Charlie` },
];

describe('replace_text — zero-length content at a range boundary stays outside the range (#1096)', () => {
  registerCleanup();

  for (const c of CASES) {
    for (const tracked of [true, false]) {
      test(`${tracked ? 'tracked' : 'clean'} save (${c.name}): the XE field stays live and in place; only "Bravo" is replaced`, async ({ given, when, then }: AllureBddContext) => {
        const mgr = createTestSessionManager({ defaultAiAuthor: tracked ? 'SafeDocX' : null });
        const session = await given('a paragraph with a result-less XE field sharing a run with "Bravo"', () =>
          openSession([], { mgr, xml: wrapDoc(c.paragraph) }),
        );
        const outPath = path.join(session.tmpDir, 'out.docx');

        await when(`replace_text replaces "Bravo" with "Delta" and the session is saved ${tracked ? 'tracked' : 'clean'}`, async () => {
          const replaced = await replaceText(mgr, {
            file_path: session.inputPath,
            target_paragraph_id: session.paraIds[1]!,
            old_string: 'Bravo',
            new_string: 'Delta',
            instruction: 'rename',
          });
          assertSuccess(replaced, 'replace_text');
          assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: outPath, save_format: tracked ? 'tracked' : 'clean' }), 'save');
        });

        if (tracked) {
          await then('the field markers are live in the tracked save; accept-all keeps the field and reject-all yields the original', async () => {
            const saved = await loadBodyParagraph(outPath);
            expectFieldLive(saved.paragraph());
            acceptChanges(saved.doc);
            expect(signature(saved.paragraph())).toBe(c.target);
            expectFieldLive(saved.paragraph());

            const rejected = await loadBodyParagraph(outPath);
            rejectChanges(rejected.doc);
            expect(signature(rejected.paragraph())).toBe(c.original);
            expectFieldLive(rejected.paragraph());
          });
        } else {
          await then('the clean save keeps the field and reads as intended', async () => {
            const { paragraph } = await loadBodyParagraph(outPath);
            expectFieldLive(paragraph());
            expect(signature(paragraph())).toBe(c.target);
          });
        }
      });
    }
  }

  test('tracked save: a range that genuinely spans the field still deletes it, as in #1082', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
    const session = await given('the issue\'s paragraph', () => openSession([], { mgr, xml: wrapDoc(FIELD_LEADS_RUN) }));
    const outPath = path.join(session.tmpDir, 'out-tracked.docx');

    // The replacement shares no prefix or suffix with the match, so the tool
    // cannot narrow the changed range to "Bravo" and the range truly spans the field.
    await when('replace_text replaces "a Bravo" (spanning the field) with "X" and saves tracked', async () => {
      assertSuccess(await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: session.paraIds[1]!,
        old_string: 'a Bravo',
        new_string: 'X',
        instruction: 'collapse across the entry',
      }), 'replace_text');
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: outPath, save_format: 'tracked' }), 'save tracked');
    });

    await then('every field marker is inside w:del; accept-all drops the field and reject-all restores it', async () => {
      const saved = await loadBodyParagraph(outPath);
      const markers = fieldMarkers(saved.paragraph());
      expect(markers.map((m) => m.localName)).toEqual(['fldChar', 'delInstrText', 'fldChar']);
      for (const marker of markers) expect(insideRevision(marker)).toBe(true);
      acceptChanges(saved.doc);
      expect(signature(saved.paragraph())).toBe('AlphX Charlie');
      expect(fieldMarkers(saved.paragraph())).toHaveLength(0);

      const rejected = await loadBodyParagraph(outPath);
      rejectChanges(rejected.doc);
      expect(signature(rejected.paragraph())).toBe(`Alpha ${FIELD}Bravo Charlie`);
    });
  });
});
