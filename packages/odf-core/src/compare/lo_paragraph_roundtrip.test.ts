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
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { resolveSoffice, runLibreOfficeOracle, type OracleJob } from '@usejunior/docx-core';

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
  const base = await (await OdfArchive.load(readFileSync(FIXTURE))).getContentXml();
  const body = paras.map((t) => `<text:p text:style-name="Standard">${t}</text:p>`).join('');
  return base.replace(/<office:text\b[^>]*>[\s\S]*<\/office:text>/, `<office:text>${body}</office:text>`);
}

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

type Composition = { name: string; original: string[]; revised: string[] };

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

      const jobs: OracleJob[] = [];
      for (const c of COMPOSITIONS) {
        const { contentXml: redline } = compareOdf(await contentXml(c.original), await contentXml(c.revised), {
          author: 'RoundTrip',
        });
        const redlineOdt = await packageOdt(redline);
        jobs.push({ op: 'accept', odt: redlineOdt }, { op: 'reject', odt: redlineOdt });
      }

      const results = await runLibreOfficeOracle(jobs, soffice);
      for (let i = 0; i < COMPOSITIONS.length; i++) {
        const c = COMPOSITIONS[i]!;
        expect(paragraphTexts(results[2 * i]!), `${c.name}: accept-all`).toEqual(c.revised);
        expect(paragraphTexts(results[2 * i + 1]!), `${c.name}: reject-all`).toEqual(c.original);
      }
    },
    240_000,
  );
});
