import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { parseXml, readZipText } from '@usejunior/docx-core';
import { SessionManager } from '../session/manager.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { openSession, assertSuccess, registerCleanup } from '../testing/session-test-utils.js';
import { replaceText } from '../tools/replace_text.js';
import { insertParagraph } from '../tools/insert_paragraph.js';
import { formatLayout } from '../tools/format_layout.js';
import { openDocument } from '../tools/open_document.js';
import { readFile } from '../tools/read_file.js';
import { save } from '../tools/save.js';
import { makeDocxWithDocumentXml, extractParaIdsFromToon } from '../testing/docx_test_utils.js';
import { createTrackedTempDir } from '../testing/session-test-utils.js';

// OOXML preservation invariants distilled from the MS-OE376 / Word-behavior
// triage. Each test pins a brownfield-mutation invariant the input already
// satisfies so future refactors cannot silently regress it. Spec section
// citations live in the triage doc and (when the conformance registry covers
// these elements) in follow-up .conformance(...) calls.

const test = testAllure.epic('Document Editing').withLabels({
  feature: 'OOXML Preservation Invariants',
});

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function createManager(): SessionManager {
  return new SessionManager({ ttlMs: 60_000, defaultAiAuthor: 'SafeDocX' });
}

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

async function saveAndReadDocumentXml(
  mgr: SessionManager,
  inputPath: string,
  outputPath: string,
): Promise<string> {
  const saved = await save(mgr, {
    file_path: inputPath,
    save_to_local_path: outputPath,
    save_format: 'clean',
    clean_bookmarks: true,
  });
  assertSuccess(saved, 'save');
  const buffer = await fs.readFile(outputPath);
  const text = await readZipText(buffer, 'word/document.xml');
  if (text === null) throw new Error('Missing word/document.xml after save');
  return text;
}

function wAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(W_NS, localName) ?? el.getAttribute(`w:${localName}`);
}

function directChildren(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let n: Node | null = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      const el = n as Element;
      if (el.namespaceURI === W_NS && el.localName === localName) out.push(el);
    }
  }
  return out;
}

function elementChildren(parent: Element): Element[] {
  const out: Element[] = [];
  for (let n: Node | null = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) out.push(n as Element);
  }
  return out;
}

describe('OOXML preservation invariants: brownfield mutations preserve what the input already satisfies', () => {
  registerCleanup();

  // A. tblGrid preservation under replace_text.
  // Locks in that text mutation inside a cell never rewrites <w:tblGrid> or its
  // <w:gridCol w:w="..."/> widths. There is no active rebuild path that would
  // synthesize this, but no explicit invariant test either — cheap insurance.
  test('tblGrid and gridCol widths survive replace_text in a cell', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a 2x2 table with explicit gridCol widths', async () => {
      const bodyXml =
        `<w:p><w:r><w:t>Anchor.</w:t></w:r></w:p>` +
        `<w:tbl>` +
        `<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>cellA1</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>cellB1</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>cellA2</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>cellB2</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>` +
        `<w:sectPr/>`;
      opened = await openSession([], { mgr: createManager(), xml: makeDocXml(bodyXml) });
    });

    await when('replace_text edits the text inside cell (0,0)', async () => {
      // paraIds order: anchor para, then the four table-cell paragraphs.
      const cellParaId = opened.paraIds[1]!;
      const replaced = await replaceText(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: cellParaId,
        old_string: 'cellA1',
        new_string: 'cellA1-edited',
        instruction: 'Edit cell A1.',
      });
      assertSuccess(replaced, 'replace_text');
      documentXml = await saveAndReadDocumentXml(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'tblgrid-preserve.docx'),
      );
    });

    await then('tblGrid is intact with both gridCol widths unchanged', () => {
      const doc = parseXml(documentXml);
      const tbls = doc.getElementsByTagNameNS(W_NS, 'tbl');
      expect(tbls.length).toBe(1);
      const grids = (tbls.item(0) as Element).getElementsByTagNameNS(W_NS, 'tblGrid');
      expect(grids.length).toBe(1);
      const gridCols = directChildren(grids.item(0) as Element, 'gridCol');
      expect(gridCols.length).toBe(2);
      expect(gridCols.map((g) => wAttr(g, 'w'))).toEqual(['2500', '2500']);
    });
  });

  // B.1 Body-level <w:sectPr> stays as the last element child of <w:body>.
  // insert_paragraph must not insert paragraphs after the final body sectPr.
  test('body-level final sectPr remains the last element child of w:body after insert_paragraph', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a document whose body ends with a sectPr sibling', async () => {
      const bodyXml =
        `<w:p><w:r><w:t>First.</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Second.</w:t></w:r></w:p>` +
        `<w:sectPr/>`;
      opened = await openSession([], { mgr: createManager(), xml: makeDocXml(bodyXml) });
    });

    await when('insert_paragraph appends a paragraph after the last anchor', async () => {
      const inserted = await insertParagraph(opened.mgr, {
        file_path: opened.inputPath,
        positional_anchor_node_id: opened.paraIds[opened.paraIds.length - 1]!,
        new_string: 'Appended.',
        instruction: 'Insert at end.',
        position: 'AFTER',
      });
      assertSuccess(inserted, 'insert_paragraph');
      documentXml = await saveAndReadDocumentXml(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'body-sectpr-preserve.docx'),
      );
    });

    await then('the body still ends with sectPr as its last element child', () => {
      const doc = parseXml(documentXml);
      const body = doc.getElementsByTagNameNS(W_NS, 'body').item(0) as Element;
      const children = elementChildren(body);
      const last = children[children.length - 1]!;
      expect(last.namespaceURI).toBe(W_NS);
      expect(last.localName).toBe('sectPr');
      // Exactly one body-level sectPr — no clones.
      expect(directChildren(body, 'sectPr').length).toBe(1);
    });
  });

  // B.2 Mid-document section break: inserting AFTER a paragraph that carries
  // <w:sectPr> in its <w:pPr> must NOT clone the sectPr into the new paragraph.
  // sectPr is a section terminator, so propagating it would fragment the
  // document's section model.
  test('inserting after a sectPr-carrying paragraph does not clone the section break onto the new paragraph', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;
    let anchorParaId: string;

    await given('a paragraph that carries an inline sectPr as a section break', async () => {
      const bodyXml =
        `<w:p>` +
        `<w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr>` +
        `<w:r><w:t>Section break paragraph.</w:t></w:r>` +
        `</w:p>` +
        `<w:p><w:r><w:t>After break.</w:t></w:r></w:p>` +
        `<w:sectPr/>`;
      opened = await openSession([], { mgr: createManager(), xml: makeDocXml(bodyXml) });
      anchorParaId = opened.paraIds[0]!;
    });

    await when('insert_paragraph inserts a new paragraph AFTER the section-break paragraph', async () => {
      const inserted = await insertParagraph(opened.mgr, {
        file_path: opened.inputPath,
        positional_anchor_node_id: anchorParaId,
        new_string: 'Inserted between sections.',
        instruction: 'Insert next to section break.',
        position: 'AFTER',
      });
      assertSuccess(inserted, 'insert_paragraph');
      documentXml = await saveAndReadDocumentXml(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'mid-sectpr-preserve.docx'),
      );
    });

    await then('only the original paragraph carries sectPr; the new paragraph does not', () => {
      const doc = parseXml(documentXml);
      const body = doc.getElementsByTagNameNS(W_NS, 'body').item(0) as Element;
      const paragraphs = directChildren(body, 'p');

      // Find the original section-break paragraph by its visible text.
      let originalIdx = -1;
      let insertedIdx = -1;
      paragraphs.forEach((p, idx) => {
        const text = Array.from(p.getElementsByTagNameNS(W_NS, 't'))
          .map((t) => t.textContent ?? '')
          .join('');
        if (text.includes('Section break paragraph')) originalIdx = idx;
        if (text.includes('Inserted between sections')) insertedIdx = idx;
      });
      expect(originalIdx).toBeGreaterThanOrEqual(0);
      expect(insertedIdx).toBeGreaterThanOrEqual(0);

      const original = paragraphs[originalIdx]!;
      const inserted = paragraphs[insertedIdx]!;

      const originalPPr = directChildren(original, 'pPr')[0];
      expect(originalPPr).toBeTruthy();
      expect(directChildren(originalPPr!, 'sectPr').length).toBe(1);

      const insertedPPr = directChildren(inserted, 'pPr')[0];
      if (insertedPPr) {
        expect(directChildren(insertedPPr, 'sectPr').length).toBe(0);
      }
    });
  });

  // D. Empty paragraphs (<w:p/> and <w:p><w:pPr/></w:p>) survive a save.
  // readParagraphs filters empty-text paragraphs (document.ts:574-585) so we
  // walk the DOM directly for the assertion. The extract_revisions filter at
  // extract_revisions.ts:355 is extract-only and does not mutate the DOM —
  // future maintainers should not conflate the two.
  test('pre-existing empty paragraphs (bare and pPr-only) survive replace_text + save', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a document with bare <w:p/> and <w:p><w:pPr/></w:p> between content paragraphs', async () => {
      const bodyXml =
        `<w:p><w:r><w:t>Top.</w:t></w:r></w:p>` +
        `<w:p/>` +
        `<w:p><w:pPr/></w:p>` +
        `<w:p><w:r><w:t>Bottom.</w:t></w:r></w:p>` +
        `<w:sectPr/>`;
      opened = await openSession([], { mgr: createManager(), xml: makeDocXml(bodyXml) });
    });

    await when('replace_text edits a non-empty paragraph elsewhere', async () => {
      // Empty paragraphs are invisible to readParagraphs (document.ts:574-585)
      // so opened.paraIds only lists the two non-empty ones.
      expect(opened.paraIds.length).toBe(2);
      const replaced = await replaceText(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[0]!,
        old_string: 'Top',
        new_string: 'Top-edited',
        instruction: 'Edit top.',
      });
      assertSuccess(replaced, 'replace_text');
      documentXml = await saveAndReadDocumentXml(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'empty-para-preserve.docx'),
      );
    });

    await then('both empty paragraphs are still present and still empty', () => {
      const doc = parseXml(documentXml);
      const body = doc.getElementsByTagNameNS(W_NS, 'body').item(0) as Element;
      const paragraphs = directChildren(body, 'p');

      // Count paragraphs with no <w:r> (i.e. truly empty after save).
      const emptyParagraphs = paragraphs.filter(
        (p) => p.getElementsByTagNameNS(W_NS, 'r').length === 0,
      );
      // Two empty paragraphs were in the input; both should survive.
      // safe-docx is allowed to inject bookmarks around content, but it should
      // not invent runs inside empty paragraphs.
      expect(emptyParagraphs.length).toBeGreaterThanOrEqual(2);
    });
  });

  // E. pBdr sibling preservation under format_layout.
  // setParagraphSpacing (layout.ts:149) mutates <w:spacing> inside the existing
  // <w:pPr>; this test pins that it does not disturb its <w:pBdr> sibling.
  // Codex empirically observed the post-state below; this test locks it in:
  //   <w:pPr><w:pBdr><w:between w:val="nil" w:sz="8" w:space="1"/></w:pBdr>
  //          <w:spacing w:after="240"/></w:pPr>
  test('format_layout preserves <w:pBdr> as a sibling when it sets <w:spacing>', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let documentXml: string;

    await given('a paragraph carrying <w:pBdr><w:between .../></w:pBdr> in its pPr', async () => {
      const bodyXml =
        `<w:p>` +
        `<w:pPr><w:pBdr><w:between w:val="nil" w:sz="8" w:space="1"/></w:pBdr></w:pPr>` +
        `<w:r><w:t>Border paragraph.</w:t></w:r>` +
        `</w:p>` +
        `<w:sectPr/>`;
      opened = await openSession([], { mgr: createManager(), xml: makeDocXml(bodyXml) });
    });

    await when('format_layout sets paragraph_spacing.after_twips on that paragraph', async () => {
      const formatted = await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_spacing: {
          paragraph_ids: [opened.paraIds[0]!],
          after_twips: 240,
        },
      });
      assertSuccess(formatted, 'format_layout');
      documentXml = await saveAndReadDocumentXml(
        opened.mgr,
        opened.inputPath,
        path.join(opened.tmpDir, 'pbdr-sibling-preserve.docx'),
      );
    });

    await then('pBdr is intact and a w:spacing sibling with w:after="240" was added', () => {
      const doc = parseXml(documentXml);
      const paragraphs = doc.getElementsByTagNameNS(W_NS, 'p');
      // Pick the paragraph that has visible text "Border paragraph." — that is
      // the original; ignore any agent-injected bookmark paragraphs.
      let target: Element | null = null;
      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs.item(i) as Element;
        const text = Array.from(p.getElementsByTagNameNS(W_NS, 't'))
          .map((t) => t.textContent ?? '')
          .join('');
        if (text.includes('Border paragraph')) {
          target = p;
          break;
        }
      }
      expect(target).toBeTruthy();
      const pPr = directChildren(target!, 'pPr')[0];
      expect(pPr).toBeTruthy();

      const pBdrs = directChildren(pPr!, 'pBdr');
      expect(pBdrs.length).toBe(1);
      const betweens = directChildren(pBdrs[0]!, 'between');
      expect(betweens.length).toBe(1);
      expect(wAttr(betweens[0]!, 'val')).toBe('nil');
      expect(wAttr(betweens[0]!, 'sz')).toBe('8');
      expect(wAttr(betweens[0]!, 'space')).toBe('1');

      const spacings = directChildren(pPr!, 'spacing');
      expect(spacings.length).toBe(1);
      expect(wAttr(spacings[0]!, 'after')).toBe('240');
    });
  });

  // F. rsid round-trip preservation under replace_text.
  // This is a *preservation* test (rsid values survive a real mutation),
  // distinct from add_safe_docx_ts_formatting_parity.test.ts:61 which only
  // proves that the style fingerprint *ignores* rsid (a weaker claim).
  //
  // Opens with skip_normalization=true so we isolate the mutation path itself:
  // even with normalization bypassed at open, the mutation pipeline must not
  // silently strip rsid from runs the caller did not touch.
  //
  // Resolved by #286: mergeRuns() no longer strips rsid from live runs and
  // no longer merges runs whose rsid attributes differ. Untouched flanking
  // runs keep their rsid; paragraph-level rsids on <w:p> are likewise
  // preserved.
  test('replace_text on one run preserves rsid attribute values on untouched runs and the paragraph (skip_normalization) (#286)', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let mgr: SessionManager;
    let tmpDir: string;
    let inputPath: string;
    let paraId: string;
    let documentXml: string;

    await given('a paragraph with rsid attributes on <w:p> and three runs, opened without normalization', async () => {
      const bodyXml =
        `<w:p w:rsidR="00112233" w:rsidRDefault="00445566" w:rsidP="00778899">` +
        `<w:r w:rsidR="AAAAAAAA"><w:t xml:space="preserve">alpha </w:t></w:r>` +
        `<w:r w:rsidR="BBBBBBBB"><w:t xml:space="preserve">beta </w:t></w:r>` +
        `<w:r w:rsidR="CCCCCCCC"><w:t>gamma</w:t></w:r>` +
        `</w:p>` +
        `<w:sectPr/>`;
      const xml = makeDocXml(bodyXml);
      mgr = createManager();
      tmpDir = await createTrackedTempDir('safe-docx-rsid-preserve-');
      inputPath = path.join(tmpDir, 'input.docx');
      const buf = await makeDocxWithDocumentXml(xml);
      await fs.writeFile(inputPath, new Uint8Array(buf));

      const opened = await openDocument(mgr, { file_path: inputPath, skip_normalization: true });
      assertSuccess(opened, 'open');
      const read = await readFile(mgr, { file_path: inputPath, format: 'toon' });
      assertSuccess(read, 'read');
      const ids = extractParaIdsFromToon(String(read.content));
      paraId = ids[0]!;
    });

    await when('replace_text mutates the middle run text only', async () => {
      const replaced = await replaceText(mgr, {
        file_path: inputPath,
        target_paragraph_id: paraId,
        old_string: 'beta',
        new_string: 'BETA',
        instruction: 'Replace beta with BETA.',
      });
      assertSuccess(replaced, 'replace_text');
      documentXml = await saveAndReadDocumentXml(
        mgr,
        inputPath,
        path.join(tmpDir, 'rsid-preserve.docx'),
      );
    });

    await then('paragraph-level rsid values survive and untouched runs keep their rsidR', () => {
      const doc = parseXml(documentXml);
      const paragraphs = doc.getElementsByTagNameNS(W_NS, 'p');
      // Find the paragraph that still contains visible text from this scenario.
      let target: Element | null = null;
      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs.item(i) as Element;
        const text = Array.from(p.getElementsByTagNameNS(W_NS, 't'))
          .map((t) => t.textContent ?? '')
          .join('');
        if (text.includes('alpha') && text.includes('gamma')) {
          target = p;
          break;
        }
      }
      expect(target).toBeTruthy();

      // Paragraph-level rsids: unchanged.
      expect(wAttr(target!, 'rsidR')).toBe('00112233');
      expect(wAttr(target!, 'rsidRDefault')).toBe('00445566');
      expect(wAttr(target!, 'rsidP')).toBe('00778899');

      // The untouched flanking runs keep their original rsidR values. The
      // middle run is rewritten by replace_text (possibly into tracked ins/del
      // wrappers), so we don't pin its rsid — but the flanking ones we do.
      const allRuns = Array.from(target!.getElementsByTagNameNS(W_NS, 'r')) as Element[];
      const alphaRun = allRuns.find((r) => (r.textContent ?? '').includes('alpha'));
      const gammaRun = allRuns.find((r) => (r.textContent ?? '').includes('gamma'));
      expect(alphaRun).toBeTruthy();
      expect(gammaRun).toBeTruthy();
      expect(wAttr(alphaRun!, 'rsidR')).toBe('AAAAAAAA');
      expect(wAttr(gammaRun!, 'rsidR')).toBe('CCCCCCCC');
    });
  });
});
