/**
 * Regression test for issue #1044: a tracked replace_text whose range spans a
 * run holding only a `w:sym` (a Wingdings checkbox, as in legal forms) used to
 * detach that run without a `w:del`, so the tracked save silently lost the
 * symbol and reject-all could not bring it back. Since issue #1046 the symbol
 * is one character of the paragraph text (U+F0A8 here), so the caller sees it
 * in the text it matches and its range names it explicitly.
 *
 * Exercises the full package path — open → replace_text → save — in the
 * default tracked mode and with tracked emission disabled, and asserts the
 * issue's acceptance criteria: the tracked save carries the symbol inside
 * `w:del` (a package-level reject-all restores it) and the clean save yields
 * the intended text. The symbol is visible, so the response carries no
 * warning about it.
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
import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { grep } from './grep.js';
import { batchEdit } from './batch_edit.js';

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

  test('tracked mode: the symbol is deleted inside w:del and reject-all restores it', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });

    const session = await given('a form paragraph whose checkbox sits in a sym-only run between two text runs', () =>
      openSession([], { mgr, xml: DOCUMENT_XML }),
    );
    const paraId = session.paraIds[1]!;
    // The symbol is part of the paragraph text the caller matches against (#1046).
    expect(session.content).toContain('Alpha \uF0A8 Bravo');

    const trackedPath = path.join(session.tmpDir, 'out-tracked.docx');
    const cleanPath = path.join(session.tmpDir, 'out-clean.docx');
    await when('replace_text replaces "a <checkbox> B" with "X" and the session is saved tracked and clean', async () => {
      const replaced = await replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: paraId,
        old_string: 'a \uF0A8 B',
        new_string: 'X',
        instruction: 'collapse the election',
      });
      assertSuccess(replaced, 'replace_text');
      expect(replaced.after_text).toBe('AlphXravo');
      const warnings = (replaced as { warnings?: string[] }).warnings ?? [];
      expect(warnings.filter((w) => w.includes('w:sym'))).toHaveLength(0);
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: trackedPath, save_format: 'tracked' }), 'save tracked');
      assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: cleanPath, save_format: 'clean' }), 'save clean');
    });

    await then('the tracked save carries the original w:sym inside the deletion, next to the deleted text', async () => {
      const doc = await loadDocumentXml(trackedPath);
      expect(symbols(doc)).toHaveLength(1);
      expect(insideDeletion(symbols(doc)[0]!)).toBe(true);
      const p = symbols(doc)[0]!.parentNode!.parentNode!.parentNode as Element;
      expect(p.localName).toBe('p');
      expect(textOf(p, 'delText')).toBe('a  B'); // the symbol is the w:sym between the two spaces
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

  test('untracked mode: the clean replace removes the symbol with the range', async ({ given, when, then }: AllureBddContext) => {
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
        old_string: 'a \uF0A8 B',
        new_string: 'X',
        instruction: 'collapse the election',
      });
      assertSuccess(replaced, 'replace_text');
      expect(replaced.after_text).toBe('AlphXravo');
      const warnings = (replaced as { warnings?: string[] }).warnings ?? [];
      expect(warnings).toHaveLength(0);
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

  test('read_file shows the checkbox glyph and grep finds it (#1046)', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
    const session = await given('the same form paragraph', () => openSession([], { mgr, xml: DOCUMENT_XML }));

    let json: Array<{ id: string; clean_text: string }> = [];
    let grepContent = '';
    await when('read_file (JSON) and grep for the glyph run', async () => {
      const read = await readFile(mgr, { file_path: session.inputPath, format: 'json' });
      assertSuccess(read, 'read_file');
      json = JSON.parse(String(read.content)) as typeof json;
      const found = await grep(mgr, { file_path: session.inputPath, patterns: ['\uF0A8'] });
      assertSuccess(found, 'grep');
      grepContent = JSON.stringify(found);
    });

    await then('the paragraph text carries U+F0A8 between the two words, and grep matches that paragraph only', () => {
      expect(json[1]!.clean_text).toBe('Alpha \uF0A8 Bravo');
      expect(grepContent).toContain(session.paraIds[1]!);
      expect(grepContent).not.toContain(session.paraIds[0]!);
      expect(grepContent).not.toContain(session.paraIds[2]!);
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

/**
 * A formatting-only edit over a symbol rebuilds the range from plain text. The
 * symbol's glyph comes from its own `w:font`, which the run properties need
 * not repeat, so the rebuilt run must carry the `w:sym` again rather than the
 * private-use character as literal text (issue #1046 review).
 */
const FONTLESS_CHECKBOX_PARAGRAPHS = [
  // 1: sym-only run with no rFonts
  `<w:p><w:r><w:t xml:space="preserve">Own run </w:t></w:r><w:r>${CHECKBOX}</w:r><w:r><w:t xml:space="preserve"> end</w:t></w:r></w:p>`,
  // 2: symbol mid-run
  `<w:p><w:r><w:t>a</w:t>${CHECKBOX}<w:t>b</w:t></w:r></w:p>`,
  // 3: symbol inside an existing tracked insertion
  `<w:p><w:r><w:t xml:space="preserve">Inserted </w:t></w:r><w:ins w:id="41" w:author="Earlier" w:date="2026-01-01T00:00:00Z"><w:r>${CHECKBOX}</w:r></w:ins></w:p>`,
];

const FONTLESS_DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<w:body>' +
  '<w:p><w:r><w:t xml:space="preserve">Symbols without a run font:</w:t></w:r></w:p>' +
  FONTLESS_CHECKBOX_PARAGRAPHS.join('') +
  '</w:body></w:document>';

function liveSymbolsIn(p: Element): Element[] {
  return Array.from(p.getElementsByTagNameNS(W_NS, 'sym')).filter((el) => !insideDeletion(el));
}

function isBoldRun(run: Element): boolean {
  const rPr = Array.from(run.childNodes).find((c): c is Element => c.nodeType === 1 && (c as Element).localName === 'rPr');
  return !!rPr && rPr.getElementsByTagNameNS(W_NS, 'b').length > 0;
}

describe('replace_text — formatting a w:sym keeps the symbol and its font (#1046)', () => {
  registerCleanup();

  const cases = [
    { name: 'a sym-only run', paragraph: 1, old: '\uF0A8', expected: 'Own run \uF0A8 end' },
    { name: 'a symbol mid-run', paragraph: 2, old: 'a\uF0A8b', expected: 'a\uF0A8b' },
    { name: 'a symbol inside an existing insertion', paragraph: 3, old: '\uF0A8', expected: 'Inserted \uF0A8' },
  ];

  for (const tracked of [true, false]) {
    for (const c of cases) {
      test(`${tracked ? 'tracked' : 'untracked'}: bolding ${c.name} writes the w:sym back with its font`, async ({ given, when, then }: AllureBddContext) => {
        const mgr = createTestSessionManager({ defaultAiAuthor: tracked ? 'SafeDocX' : null });
        const session = await given('paragraphs whose checkbox font lives only on the w:sym element', () =>
          openSession([], { mgr, xml: FONTLESS_DOCUMENT_XML }),
        );
        const paraId = session.paraIds[c.paragraph]!;

        const outPath = path.join(session.tmpDir, `out-format-${c.paragraph}.docx`);
        await when(`replace_text wraps "${c.old}" in <b> with normalize_first`, async () => {
          const replaced = await replaceText(mgr, {
            file_path: session.inputPath,
            target_paragraph_id: paraId,
            old_string: c.old,
            new_string: `<b>${c.old}</b>`,
            instruction: 'bold the checkbox',
            normalize_first: true,
          });
          assertSuccess(replaced, 'replace_text');
          expect(replaced.after_text).toBe(c.expected);
          assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: outPath, save_format: tracked ? 'tracked' : 'clean' }), 'save');
        });

        await then('after accepting every change the paragraph holds one bold w:sym with the Wingdings font and no literal glyph text', async () => {
          const doc = await loadDocumentXml(outPath);
          if (tracked) acceptChanges(doc);
          const p = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))[c.paragraph]!;
          const live = liveSymbolsIn(p);
          expect(live).toHaveLength(1);
          expect(live[0]!.getAttribute('w:font')).toBe('Wingdings');
          expect(live[0]!.getAttribute('w:char')).toBe('F0A8');
          expect(isBoldRun(live[0]!.parentNode as Element)).toBe(true);
          expect(textOf(p, 't')).not.toContain('\uF0A8');
        });

        if (tracked) {
          await then('rejecting every change restores the original symbol, not bold', async () => {
            const doc = await loadDocumentXml(outPath);
            rejectChanges(doc);
            const p = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))[c.paragraph]!;
            const live = liveSymbolsIn(p);
            // Reject-all also removes the pre-existing insertion of case 3.
            expect(live).toHaveLength(c.paragraph === 3 ? 0 : 1);
            for (const sym of live) {
              expect(sym.getAttribute('w:font')).toBe('Wingdings');
              expect(isBoldRun(sym.parentNode as Element)).toBe(false);
            }
          });
        }
      });
    }
  }
});

/**
 * Literal text can equal a symbol's character: a Latin A beside a symbol with
 * `w:char="0041"`, or a private-use character typed as text beside the
 * checkbox. A formatting-only edit must keep each position in its own form,
 * so the symbol stays a `w:sym` and the literal stays text (issue #1046
 * review, round 2).
 */
const MIXED_DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<w:body>' +
  '<w:p><w:r><w:t xml:space="preserve">Literal text beside equal symbol characters:</w:t></w:r></w:p>' +
  `<w:p><w:r><w:t>A</w:t><w:sym w:font="Wingdings" w:char="0041"/><w:t>\uF0A8</w:t>${CHECKBOX}</w:r></w:p>` +
  '</w:body></w:document>';

function contentKinds(p: Element): string[] {
  return Array.from(p.getElementsByTagNameNS(W_NS, 'r'))
    .filter((run) => !insideDeletion(run))
    .flatMap((run) => Array.from(run.childNodes)
      .filter((c): c is Element => c.nodeType === 1 && (c as Element).localName !== 'rPr')
      .map((el) => el.localName === 'sym' ? `sym:${el.getAttribute('w:char')}` : `${el.localName}:${el.textContent ?? ''}`));
}

describe('replace_text — formatting literal text that equals a symbol character keeps both forms (#1046)', () => {
  registerCleanup();

  const modes = [
    { name: 'tracked replace_text', tracked: true, batch: false },
    { name: 'untracked replace_text', tracked: false, batch: false },
    { name: 'tracked batch_edit', tracked: true, batch: true },
  ];

  for (const mode of modes) {
    test(`${mode.name}: bolding "A<sym 0041><literal U+F0A8><checkbox>" keeps literal, symbol, literal, symbol`, async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager({ defaultAiAuthor: mode.tracked ? 'SafeDocX' : null });
      const session = await given('a run alternating literal characters and symbols with the same characters', () =>
        openSession([], { mgr, xml: MIXED_DOCUMENT_XML }),
      );
      const paraId = session.paraIds[1]!;
      const text = 'AA\uF0A8\uF0A8';
      const outPath = path.join(session.tmpDir, 'out-mixed.docx');

      await when('the whole run is bolded with identical text and saved', async () => {
        const step = {
          target_paragraph_id: paraId,
          old_string: text,
          new_string: `<b>${text}</b>`,
          instruction: 'bold the run',
          normalize_first: true,
        };
        const result = mode.batch
          ? await batchEdit(mgr, { file_path: session.inputPath, steps: [{ step_id: 'bold', operation: 'replace_text', ...step }] })
          : await replaceText(mgr, { file_path: session.inputPath, ...step });
        assertSuccess(result, mode.batch ? 'batch_edit' : 'replace_text');
        assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: outPath, save_format: mode.tracked ? 'tracked' : 'clean' }), 'save');
      });

      await then('after accept-all the run holds A, the 0041 symbol, the literal glyph, the checkbox symbol, in that order', async () => {
        const doc = await loadDocumentXml(outPath);
        if (mode.tracked) acceptChanges(doc);
        const p = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))[1]!;
        expect(contentKinds(p)).toEqual(['t:A', 'sym:0041', 't:\uF0A8', 'sym:F0A8']);
        expect(liveSymbolsIn(p).every((sym) => isBoldRun(sym.parentNode as Element))).toBe(true);
      });
    });
  }
});

