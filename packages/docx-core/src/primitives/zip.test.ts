/**
 * Regression tests for issue #408's archive symptoms: saves came back with
 * STORED (uncompressed) entries — ~6x on-disk inflation — plus a stray
 * `word/` directory entry the Word-authored input never had.
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { DocxZip, ZIP_EPOCH, createZipBuffer, inspectZipEntries, readZipText } from './zip.js';

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

async function entryDates(buffer: Buffer): Promise<Set<number>> {
  const zip = await JSZip.loadAsync(buffer);
  return new Set(Object.values(zip.files).map((file) => file.date.getTime()));
}

describe('DocxZip fixed entry dates (issue #1110)', () => {
  const SOURCE_DATE = new Date(Date.UTC(2020, 5, 15, 12, 0, 0));

  async function buildDatedArchive(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('word/document.xml', COMPRESSIBLE_XML, { createFolders: false, date: SOURCE_DATE });
    zip.file('[Content_Types].xml', '<Types/>', { createFolders: false, date: SOURCE_DATE });
    return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
  }

  test('a fileDate save stamps every entry, and an overlapping default save keeps the source dates', async ({ given, when, then }: AllureBddContext) => {
    let zip: DocxZip;
    let fixed: Buffer;
    let concurrentDefault: Buffer;
    let laterDefault: Buffer;

    await given('a loaded archive whose entries carry their source dates', async () => {
      zip = await DocxZip.load(await buildDatedArchive());
    });

    await when('a fixed-date save and a default save start before either settles', async () => {
      const fixedSave = zip.toBuffer({ fileDate: ZIP_EPOCH });
      const defaultSave = zip.toBuffer();
      [fixed, concurrentDefault] = await Promise.all([fixedSave, defaultSave]);
      laterDefault = await zip.toBuffer();
    });

    await then('only the fixed-date save carries the fixed date', async () => {
      expect(await entryDates(fixed)).toEqual(new Set([ZIP_EPOCH.getTime()]));
      expect(await entryDates(concurrentDefault)).toEqual(new Set([SOURCE_DATE.getTime()]));
      expect(await entryDates(laterDefault)).toEqual(new Set([SOURCE_DATE.getTime()]));
      expect(laterDefault.equals(concurrentDefault)).toBe(true);
    });
  });
});

describe('readZipText byte-order mark', () => {
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';

  test('drops a leading UTF-8 BOM from an XML part so the text parses', async ({ given, when, then }: AllureBddContext) => {
    let archive: Buffer;
    let text: string | null;

    await given('an archive whose relationships part starts with a UTF-8 BOM', async () => {
      archive = await createZipBuffer({
        'word/_rels/document.xml.rels': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(XML, 'utf8')]),
      });
    });

    await when('the part is read with readZipText', async () => {
      text = await readZipText(archive, 'word/_rels/document.xml.rels');
    });

    await then('the text starts at the XML declaration and parses', () => {
      expect(text).toBe(XML);
      expect(parseXml(text!).documentElement.localName).toBe('Relationships');
    });
  });

  test('keeps a BOM-free part and a missing entry unchanged', async ({ given, then }: AllureBddContext) => {
    let archive: Buffer;

    await given('an archive with a BOM-free XML part', async () => {
      archive = await createZipBuffer({ 'word/document.xml': XML });
    });

    await then('the part reads back byte-for-byte and a missing entry is null', async () => {
      expect(await readZipText(archive, 'word/document.xml')).toBe(XML);
      expect(await readZipText(archive, 'word/missing.xml')).toBeNull();
    });
  });
});
