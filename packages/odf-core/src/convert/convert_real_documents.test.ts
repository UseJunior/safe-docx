import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { DocxDocument, tokenizeToonInline, type DocumentViewNode } from '@usejunior/docx-core';

import { convertDocxToOdt } from './docx_to_odt.js';
import { OdfArchive } from '../shared/odf/OdfArchive.js';
import { OdfDocument } from '../document.js';
import { validateOdfArchiveSafety } from '../odf_archive_safety.js';

const FIXTURES = [
  'tests/test_documents/nvca-coi-regression/source.docx',
  'tests/test_documents/open-agreements/common-paper-mutual-nda.docx',
  'tests/test_documents/open-agreements/bonterms-mutual-nda.docx',
  'tests/test_documents/open-agreements/letter-of-intent.docx',
].map((rel) => ({ rel, abs: fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)) }));

/** The visible text a converted node must produce (manual labels are prepended literally). */
function expectedText(node: DocumentViewNode): string {
  const text = tokenizeToonInline(node.tagged_text)
    .filter((t) => t.kind === 'text')
    .map((t) => t.value)
    .join('');
  const isManualLabel = node.list_metadata.list_level >= 0 && !node.list_metadata.is_auto_numbered;
  const label = node.list_metadata.label_string.trim();
  return isManualLabel && label ? `${label} ${text}` : text;
}

describe('convertDocxToOdt — real contract documents', () => {
  it(
    '[CONV-12] real documents convert end-to-end: safe package, reopens, visible text preserved',
    async () => {
      for (const { rel, abs } of FIXTURES) {
        const docx = readFileSync(abs);
        const { odt, lossiness } = await convertDocxToOdt(docx);

        const safety = await validateOdfArchiveSafety(odt);
        expect(safety.ok, `${rel}: archive safety`).toBe(true);

        // Phase 3 acceptance (#406): the in-scope style classes report zero loss on the
        // bundled real fixtures. Only merged-cell grid gaps (out of scope) may remain.
        const inScope = [
          'font-formatting-dropped',
          'unsurfaced-paragraphs-dropped',
          'unknown-highlight-color',
          'unmappable-font-color',
        ];
        const offending = lossiness.filter((e) => inScope.includes(e.construct));
        expect(offending, `${rel}: in-scope lossiness`).toEqual([]);

        // Expected text comes from the same semantic view the converter consumes.
        const source = await DocxDocument.load(docx);
        source.normalize();
        source.insertParagraphBookmarks('_convert_test');
        const { nodes } = source.buildDocumentView({ showFormatting: true, formattingMode: 'full' });
        const expected = nodes.map(expectedText).filter((t) => t.trim() !== '');

        const archive = await OdfArchive.load(odt);
        const reopened = OdfDocument.fromContentXml(await archive.getContentXml());
        // Grid-gap filler cells add empty paragraphs; compare the non-empty sequence.
        const actual = reopened
          .getParagraphs()
          .map((b) => b.text)
          .filter((t) => t.trim() !== '');

        expect(actual, `${rel}: visible text`).toEqual(expected);
      }
    },
    120_000,
  );
});
