/**
 * Regression tests for issue #408's archive symptoms: saves came back with
 * STORED (uncompressed) entries — ~6x on-disk inflation — plus a stray
 * `word/` directory entry the Word-authored input never had.
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxZip, inspectZipEntries, readZipText } from './zip.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Document Primitives' });

const COMPRESSIBLE_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document>` +
  `<w:p><w:r><w:t>repeat me </w:t></w:r></w:p>`.repeat(200) +
  `</w:document>`;

/** Source archive that, like fixture-built packages, carries directory entries. */
async function buildArchiveWithDirectoryEntries(): Promise<Buffer> {
  const zip = new JSZip();
  // createFolders defaults to true: this adds `word/` and `_rels/` entries.
  zip.file('word/document.xml', COMPRESSIBLE_XML);
  zip.file('_rels/.rels', '<Relationships/>');
  zip.file('[Content_Types].xml', '<Types/>');
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

describe('DocxZip archive packing (issue #408)', () => {
  test('saves entries DEFLATE-compressed', async ({ given, when, then }: AllureBddContext) => {
    let source: Buffer;
    let output: Buffer;

    await given('a loaded archive with a highly compressible document.xml', async () => {
      source = await buildArchiveWithDirectoryEntries();
    });

    await when('the archive is written back', async () => {
      const zip = await DocxZip.load(source);
      zip.writeText('word/document.xml', COMPRESSIBLE_XML);
      output = await zip.toBuffer();
    });

    await then('document.xml is smaller on disk than its content', async () => {
      const entries = await inspectZipEntries(output);
      const doc = entries.find((e) => e.name === 'word/document.xml')!;
      expect(doc.compressedSize).toBeGreaterThan(0);
      expect(doc.compressedSize).toBeLessThan(doc.uncompressedSize);
      expect(await readZipText(output, 'word/document.xml')).toBe(COMPRESSIBLE_XML);
    });
  });

  test('emits zero directory entries, including ones inherited from the source archive', async ({ given, when, then }: AllureBddContext) => {
    let source: Buffer;
    let output: Buffer;

    await given('a source archive that already contains directory entries', async () => {
      source = await buildArchiveWithDirectoryEntries();
      const sourceEntries = await inspectZipEntries(source);
      expect(sourceEntries.some((e) => e.isDirectory)).toBe(true);
    });

    await when('a nested path is written and the archive is saved', async () => {
      const zip = await DocxZip.load(source);
      zip.writeText('word/settings.xml', '<w:settings/>');
      output = await zip.toBuffer();
    });

    await then('the output has every file but no directory entries', async () => {
      const entries = await inspectZipEntries(output);
      expect(entries.some((e) => e.isDirectory)).toBe(false);
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/settings.xml']);
    });
  });
});
