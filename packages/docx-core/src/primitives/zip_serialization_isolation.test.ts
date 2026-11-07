import JSZip from 'jszip';
import { describe, expect, vi } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from './document.js';
import { DocxZip, ZIP_EPOCH, createZipBuffer, readZipText } from './zip.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Document Primitives' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

async function makeDocxBuffer(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', makeDocXml(bodyXml));
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

describe('DocxZip snapshot and per-call overrides (issue #1318)', () => {
  test('snapshot creates an isolated copy with per-call overrides and entry removal', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let sourceZip: DocxZip;
    let snapshotZip: DocxZip;
    let snapshotBuffer: Buffer;
    let sourceBuffer: Buffer;

    await given('a source DocxZip with multiple files', async () => {
      sourceZip = await DocxZip.load(
        await createZipBuffer({
          'word/document.xml': '<document>original</document>',
          'word/settings.xml': '<settings/>',
          'word/styles.xml': '<styles/>',
        }),
      );
    });

    await when('a snapshot is taken with overrides replacing one file and removing another', async () => {
      snapshotZip = sourceZip.snapshot({
        'word/document.xml': '<document>overridden</document>',
        'word/settings.xml': null,
      });
      snapshotBuffer = await snapshotZip.toBuffer();
      sourceBuffer = await sourceZip.toBuffer();
    });

    await then('the snapshot reflects the overrides and deletions', async () => {
      expect(await readZipText(snapshotBuffer, 'word/document.xml')).toBe('<document>overridden</document>');
      expect(await readZipText(snapshotBuffer, 'word/settings.xml')).toBeNull();
      expect(await readZipText(snapshotBuffer, 'word/styles.xml')).toBe('<styles/>');
    });

    await and('the source archive is completely unmodified', async () => {
      expect(await readZipText(sourceBuffer, 'word/document.xml')).toBe('<document>original</document>');
      expect(await readZipText(sourceBuffer, 'word/settings.xml')).toBe('<settings/>');
      expect(await readZipText(sourceBuffer, 'word/styles.xml')).toBe('<styles/>');
      expect(sourceZip.hasFile('word/settings.xml')).toBe(true);
    });
  });

  test('toBuffer with per-call overrides serializes isolated output without mutating live zip', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let sourceZip: DocxZip;
    let overriddenBuffer: Buffer;
    let defaultBuffer: Buffer;

    await given('a loaded DocxZip', async () => {
      sourceZip = await DocxZip.load(
        await createZipBuffer({
          'word/document.xml': '<document>original</document>',
        }),
      );
    });

    await when('toBuffer is called with per-call overrides', async () => {
      overriddenBuffer = await sourceZip.toBuffer({
        overrides: { 'word/document.xml': '<document>clean</document>' },
      });
      defaultBuffer = await sourceZip.toBuffer();
    });

    await then('the overridden buffer contains the override text', async () => {
      expect(await readZipText(overriddenBuffer, 'word/document.xml')).toBe('<document>clean</document>');
    });

    await and('the default buffer and live zip retain original content', async () => {
      expect(await readZipText(defaultBuffer, 'word/document.xml')).toBe('<document>original</document>');
      expect(await sourceZip.readText('word/document.xml')).toBe('<document>original</document>');
    });
  });
});

describe('DocxDocument isolated serialization (issue #1318)', () => {
  test('concurrent clean and tracked output retain their own bookmark policies', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let doc: DocxDocument;
    let cleanBuffer: Buffer;
    let trackedBuffer: Buffer;
    let cleanRemoved: number;
    let trackedRemoved: number;
    let paragraphId: string;

    await given('a document with multiple paragraphs and inserted bookmarks', async () => {
      const buffer = await makeDocxBuffer(
        `<w:p><w:r><w:t>Paragraph One</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Paragraph Two</w:t></w:r></w:p>`,
      );
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('session_test');
      const paras = doc.readParagraphs();
      expect(paras.paragraphs.length).toBe(2);
      paragraphId = paras.paragraphs[0]!.id;
      expect(paragraphId).toMatch(/^_bk_/);
    });

    await when('cleanBookmarks=true and cleanBookmarks=false are invoked concurrently', async () => {
      const cleanPromise = doc.toBuffer({ cleanBookmarks: true, fileDate: ZIP_EPOCH });
      const trackedPromise = doc.toBuffer({ cleanBookmarks: false });

      const [cleanResult, trackedResult] = await Promise.all([cleanPromise, trackedPromise]);
      cleanBuffer = cleanResult.buffer;
      cleanRemoved = cleanResult.bookmarksRemoved;
      trackedBuffer = trackedResult.buffer;
      trackedRemoved = trackedResult.bookmarksRemoved;
    });

    await then('the clean output has all internal bookmarks stripped', async () => {
      expect(cleanRemoved).toBeGreaterThan(0);
      const cleanXml = await readZipText(cleanBuffer, 'word/document.xml');
      expect(cleanXml).not.toBeNull();
      expect(cleanXml!).not.toContain('_bk_');
      expect(cleanXml!).not.toContain('w:bookmarkStart');
      expect(cleanXml!).not.toContain('w:bookmarkEnd');
    });

    await and('the tracked output retains all internal bookmarks', async () => {
      expect(trackedRemoved).toBe(0);
      const trackedXml = await readZipText(trackedBuffer, 'word/document.xml');
      expect(trackedXml).not.toBeNull();
      expect(trackedXml!).toContain('_bk_');
      expect(trackedXml!).toContain('w:bookmarkStart');
      expect(trackedXml!).toContain('w:bookmarkEnd');
    });

    await and('in-memory live session state remains intact and paragraphs are addressable', () => {
      expect(doc.getParagraphTextById(paragraphId)).toBe('Paragraph One');
      const paragraphsAfter = doc.readParagraphs();
      expect(paragraphsAfter.paragraphs[0]!.id).toBe(paragraphId);
    });
  });

  test('injected serialization failure leaves live state usable and unchanged', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let doc: DocxDocument;
    let paragraphId: string;
    let caughtError: Error | null = null;

    await given('a loaded document with internal paragraph bookmarks', async () => {
      const buffer = await makeDocxBuffer(
        `<w:p><w:r><w:t>Critical Legal Content</w:t></w:r></w:p>`,
      );
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('failure_test');
      paragraphId = doc.readParagraphs().paragraphs[0]!.id;
      expect(paragraphId).toMatch(/^_bk_/);
    });

    await when('an injected serialization failure occurs during toBuffer(cleanBookmarks=true)', async () => {
      const liveZip = (doc as unknown as { zip: DocxZip }).zip;

      // Inject a failure into the ZIP serialization
      vi.spyOn(liveZip, 'toBuffer').mockRejectedValueOnce(
        new Error('Injected disk I/O / serialization failure'),
      );

      try {
        await doc.toBuffer({ cleanBookmarks: true });
      } catch (err) {
        caughtError = err as Error;
      } finally {
        vi.restoreAllMocks();
      }
    });

    await then('the serialization error was surfaced to the caller', () => {
      expect(caughtError).not.toBeNull();
      expect(caughtError?.message).toBe('Injected disk I/O / serialization failure');
    });

    await and('live document state is completely uncorrupted and still has bookmarks', async () => {
      // Paragraph bookmark lookups still work
      expect(doc.getParagraphTextById(paragraphId)).toBe('Critical Legal Content');

      // The live ZIP's document.xml still contains the bookmarks
      const liveZip = (doc as unknown as { zip: DocxZip }).zip;
      const liveXml = await liveZip.readText('word/document.xml');
      expect(liveXml).toContain('_bk_');
      expect(liveXml).toContain('w:bookmarkStart');

      // Subsequent saves work cleanly
      const healthySave = await doc.toBuffer({ cleanBookmarks: false });
      const healthyXml = await readZipText(healthySave.buffer, 'word/document.xml');
      expect(healthyXml).toContain('_bk_');
      expect(healthyXml).toContain('Critical Legal Content');
    });
  });
});
