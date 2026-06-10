import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { resolveSoffice, runLibreOfficeOracle } from '@usejunior/docx-core';

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

// A modify pair (two replaced words), an equal paragraph, a dissimilar MID-document
// whole-paragraph replacement, a trailing equal paragraph, and a pure end-of-document
// insertion. (A dissimilar replacement of the LAST paragraph is deliberately absent: that
// pre-existing Slice-1 composition fails reject-all — characterized below, issue #367.)
const ORIGINAL = [
  'The quick brown fox jumps over the lazy dog.',
  'Second paragraph stays unchanged.',
  'Entirely different clause about apples.',
  'Trailing stable paragraph.',
];
const REVISED = [
  'The quick red fox leaps over the lazy dog.',
  'Second paragraph stays unchanged.',
  'Zebras graze quietly under moonlight.',
  'Trailing stable paragraph.',
  'Appended fresh paragraph at the end.',
];

describe('LibreOffice accept/reject round-trip of the inline redline', () => {
  it(
    '[OCMPI-13] accept-all reproduces the revised text; reject-all the original (skipped without soffice)',
    async () => {
      const soffice = resolveSoffice();
      if (!soffice) {
        console.warn('[OCMPI-13] soffice not found — skipping LibreOffice round-trip (set ODF_SOFFICE_BIN to enable).');
        return;
      }

      const { contentXml: redline, stats } = compareOdf(await contentXml(ORIGINAL), await contentXml(REVISED), {
        author: 'RoundTrip',
      });
      expect(stats).toEqual({ insertions: 4, deletions: 3, modifications: 1 });

      const redlineOdt = await packageOdt(redline);
      const [accepted, rejected] = await runLibreOfficeOracle(
        [
          { op: 'accept', odt: redlineOdt },
          { op: 'reject', odt: redlineOdt },
        ],
        soffice,
      );

      expect(paragraphTexts(accepted!)).toEqual(REVISED);
      expect(paragraphTexts(rejected!)).toEqual(ORIGINAL);
    },
    180_000,
  );

  it(
    'characterization (issue #367): reject-all of an END-OF-DOCUMENT whole-paragraph replacement merges paragraphs',
    async () => {
      const soffice = resolveSoffice();
      if (!soffice) {
        console.warn('[issue #367] soffice not found — skipping characterization (set ODF_SOFFICE_BIN to enable).');
        return;
      }

      // Pre-existing Slice-1 defect: the deletion marker anchors inside the inserted replacement
      // paragraph while the end-of-document insertion bracket starts in the preceding paragraph;
      // rejecting both restores the deleted text into the preceding paragraph and leaves an empty
      // trailing paragraph. Pinned here so a fix for #367 flips this test on purpose.
      const original = ['Stable one.', 'Entirely different clause about apples.'];
      const revised = ['Stable one.', 'Zebras graze quietly under moonlight.'];
      const { contentXml: redline } = compareOdf(await contentXml(original), await contentXml(revised), {
        author: 'RoundTrip',
      });
      const redlineOdt = await packageOdt(redline);
      const [accepted, rejected] = await runLibreOfficeOracle(
        [
          { op: 'accept', odt: redlineOdt },
          { op: 'reject', odt: redlineOdt },
        ],
        soffice,
      );

      expect(paragraphTexts(accepted!)).toEqual(revised); // accept-all is correct
      expect(paragraphTexts(rejected!)).toEqual(['Stable one.Entirely different clause about apples.', '']);
    },
    180_000,
  );
});
