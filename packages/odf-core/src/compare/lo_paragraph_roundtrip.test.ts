/**
 * LibreOffice accept/reject round-trip of the paragraph-granularity (Slice 1) redline.
 *
 * Gated reference-oracle test (skipped when no soffice binary is available — CI does not install
 * LibreOffice). Drives LibreOffice's native .uno:AcceptAllTrackedChanges /
 * .uno:RejectAllTrackedChanges over `compareOdf` output packaged as a real `.odt`, asserting
 * accept-all reproduces the revised text and reject-all the original.
 *
 * Compositions covered, all batched into ONE headless launch:
 *  - dissimilar whole-paragraph replacement of the LAST paragraph (issue #367 — the deletion
 *    must anchor backward, outside the end-of-document insertion bracket, or reject-all merges
 *    the preceding paragraph with the restored one and leaves a trailing empty paragraph)
 *  - dissimilar mid-document whole-paragraph replacement (round-tripped cleanly before #367's
 *    fix; guards that the anchoring change did not regress it)
 *  - pure end-of-document deletion and pure end-of-document insertion (the two halves of the
 *    failing composition, each clean in isolation)
 *  - dissimilar whole-paragraph replacement of the LAST paragraph where the preceding surviving
 *    block is a table-cell paragraph (issue #380 — a bracket spanning from the cell into the
 *    body encodes a paragraph-break merge LibreOffice cannot perform across the table boundary,
 *    so reject-all left a stray trailing empty paragraph; the emitter now keeps the bracket
 *    within the inserted run and stores the paired deletion without a merge artifact)
 *
 * Also pinned here, G-case style (KNOWN ENGINE BUG, issue #540): a pure end-of-document deletion
 * whose backward anchor is a table-cell paragraph. Its reject target (table + trailing
 * paragraph) IS representable, but the point marker sits at the end of the CELL paragraph, so
 * LibreOffice restores the deleted body paragraph inside the cell. The composition's
 * `expectedAccept`/`expectedReject`/`assertRejectXml` pin today's wrong output so any drift —
 * regression or accidental fix — surfaces.
 *
 * Separately: any document that ENDS with a table gains a trailing empty paragraph on a
 * LibreOffice load/save (observed even on accept-all with no rejection involved), so
 * exact-text round-trip is unrepresentable for accept/reject targets of that shape regardless
 * of the emitted markup; the pinned expectations fold that normalization in. Pure insertion
 * after a trailing table (reject target ends with the table) stays uncovered for that reason.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { probeSofficeUsable, resolveSoffice, runLibreOfficeOracle, type OracleJob } from '@usejunior/docx-core';

import { compareOdf } from './index.js';
import { OdfArchive } from '../shared/odf/OdfArchive.js';
import { OdfDocument } from '../document.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../__fixtures__/sample.odt');

/**
 * Splice test paragraphs into the FIXTURE's own content.xml (keeping its LibreOffice-authored
 * root element). A from-scratch minimal `office:document-content` is rejected by LibreOffice's
 * loader even when schema-plausible — the production flow always reuses a real document's root,
 * so the test does too.
 */
async function contentXml(paras: string[]): Promise<string> {
  return contentXmlBlocks(paras.map(standardParagraph));
}

/** Same splice, from raw block-level XML — so a composition can include a `table:table`. */
async function contentXmlBlocks(blocks: string[]): Promise<string> {
  const base = await (await OdfArchive.load(readFileSync(FIXTURE))).getContentXml();
  return base.replace(/<office:text\b[^>]*>[\s\S]*<\/office:text>/, `<office:text>${blocks.join('')}</office:text>`);
}

function standardParagraph(text: string): string {
  return `<text:p text:style-name="Standard">${text}</text:p>`;
}

/** A one-cell table modeled on the signature table of the issue #380 discovery document. */
const SIGNATURE_TABLE =
  '<table:table table:name="SignatureTable">' +
  '<table:table-column/>' +
  '<table:table-row><table:table-cell office:value-type="string">' +
  '<text:p text:style-name="Standard">Signature cell.</text:p>' +
  '</table:table-cell></table:table-row>' +
  '</table:table>';

/** Package a content.xml into a complete .odt (mimetype-first STORED) on the fixture shell. */
async function packageOdt(content: string): Promise<Buffer> {
  const archive = await OdfArchive.load(readFileSync(FIXTURE));
  archive.setContentXml(content);
  return archive.save();
}

function paragraphTexts(content: string): string[] {
  return OdfDocument.fromContentXml(content)
    .getParagraphs()
    .map((p) => p.text);
}

type Composition = {
  name: string;
  /** Expected visible block texts (including table-cell paragraphs), original / revised. */
  original: string[];
  revised: string[];
  /** Raw block XML overrides; when absent, blocks are plain `Standard` paragraphs of the texts. */
  originalXml?: string[];
  revisedXml?: string[];
  /** Characterization overrides for pinned known-wrong outputs; default to `revised`/`original`. */
  expectedAccept?: string[];
  expectedReject?: string[];
  /** Extra structural pin on the reject-all content.xml (texts alone can hide placement bugs). */
  assertRejectXml?: (content: string) => void;
};

const COMPOSITIONS: Composition[] = [
  {
    name: 'end-of-document whole-paragraph replacement (issue #367)',
    original: ['Stable one.', 'Entirely different clause about apples.'],
    revised: ['Stable one.', 'Zebras graze quietly under moonlight.'],
  },
  {
    name: 'mid-document whole-paragraph replacement',
    original: ['Stable one.', 'Entirely different clause about apples.', 'Trailing stable paragraph.'],
    revised: ['Stable one.', 'Zebras graze quietly under moonlight.', 'Trailing stable paragraph.'],
  },
  {
    name: 'pure end-of-document deletion',
    original: ['Stable one.', 'Drop this final paragraph entirely.'],
    revised: ['Stable one.'],
  },
  {
    name: 'pure end-of-document insertion',
    original: ['Stable one.'],
    revised: ['Stable one.', 'Appended fresh paragraph at the end.'],
  },
  {
    name: 'end-of-document replacement whose backward anchor is a table-cell paragraph (issue #380)',
    original: ['Intro paragraph.', 'Signature cell.', ''],
    revised: ['Intro paragraph.', 'Signature cell.', 'Executed and delivered by the parties.'],
    originalXml: [standardParagraph('Intro paragraph.'), SIGNATURE_TABLE, standardParagraph('')],
    revisedXml: [
      standardParagraph('Intro paragraph.'),
      SIGNATURE_TABLE,
      standardParagraph('Executed and delivered by the parties.'),
    ],
  },
  {
    name: 'coalesced multi-paragraph replacement after a table (issue #380, no-artifact break accounting)',
    original: ['Intro paragraph.', 'Signature cell.', 'Old clause one entirely.', 'Old clause two entirely.'],
    revised: ['Intro paragraph.', 'Signature cell.', 'Executed and delivered by the parties.'],
    originalXml: [
      standardParagraph('Intro paragraph.'),
      SIGNATURE_TABLE,
      standardParagraph('Old clause one entirely.'),
      standardParagraph('Old clause two entirely.'),
    ],
    revisedXml: [
      standardParagraph('Intro paragraph.'),
      SIGNATURE_TABLE,
      standardParagraph('Executed and delivered by the parties.'),
    ],
  },
  {
    // KNOWN ENGINE BUG (issue #540), pinned: the deletion's backward anchor is the table-cell
    // paragraph, so reject-all restores the deleted body paragraph INSIDE the cell (and the
    // accept target ends with the table, so LibreOffice's load/save normalization appends a
    // trailing empty paragraph). Update these pins when the anchoring is fixed.
    name: 'KNOWN BUG (issue #540): pure end-of-document deletion after a table restores inside the cell',
    original: ['Intro paragraph.', 'Signature cell.', 'Drop this trailing paragraph.'],
    revised: ['Intro paragraph.', 'Signature cell.'],
    originalXml: [
      standardParagraph('Intro paragraph.'),
      SIGNATURE_TABLE,
      standardParagraph('Drop this trailing paragraph.'),
    ],
    revisedXml: [standardParagraph('Intro paragraph.'), SIGNATURE_TABLE],
    expectedAccept: ['Intro paragraph.', 'Signature cell.', ''],
    expectedReject: ['Intro paragraph.', 'Signature cell.', 'Drop this trailing paragraph.', ''],
    assertRejectXml: (content) => {
      // The restored paragraph sits inside the table cell — the issue #540 signature.
      expect(content).toMatch(
        /<table:table-cell[^>]*>(?:(?!<\/table:table-cell>)[\s\S])*Drop this trailing paragraph\./,
      );
    },
  },
];

describe('LibreOffice accept/reject round-trip of the paragraph-granularity redline', () => {
  it(
    'accept-all reproduces the revised text; reject-all the original (skipped without soffice)',
    async () => {
      const soffice = resolveSoffice();
      if (!soffice) {
        console.warn('[issue #367] soffice not found — skipping LibreOffice round-trip (set ODF_SOFFICE_BIN to enable).');
        return;
      }
      if (!(await probeSofficeUsable(soffice))) {
        console.warn('[issue #367] soffice present but unusable (aborts on launch) — skipping LibreOffice round-trip.');
        return;
      }

      const jobs: OracleJob[] = [];
      for (const c of COMPOSITIONS) {
        const originalContent = await (c.originalXml ? contentXmlBlocks(c.originalXml) : contentXml(c.original));
        const revisedContent = await (c.revisedXml ? contentXmlBlocks(c.revisedXml) : contentXml(c.revised));
        const { contentXml: redline } = compareOdf(originalContent, revisedContent, {
          author: 'RoundTrip',
        });
        const redlineOdt = await packageOdt(redline);
        jobs.push({ op: 'accept', odt: redlineOdt }, { op: 'reject', odt: redlineOdt });
      }

      const results = await runLibreOfficeOracle(jobs, soffice);
      for (let i = 0; i < COMPOSITIONS.length; i++) {
        const c = COMPOSITIONS[i]!;
        expect(paragraphTexts(results[2 * i]!), `${c.name}: accept-all`).toEqual(c.expectedAccept ?? c.revised);
        expect(paragraphTexts(results[2 * i + 1]!), `${c.name}: reject-all`).toEqual(c.expectedReject ?? c.original);
        c.assertRejectXml?.(results[2 * i + 1]!);
      }
    },
    240_000,
  );
});
