import JSZip from 'jszip';
import { describe, expect, vi } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { DocxDocument } from './document.js';
import { DocxZip, ZIP_EPOCH, readZipText } from './zip.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Serialization isolation' });

describe('serialization snapshots', () => {
  test('overlapping exports keep independent bookmark policies', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('Alpha')));
    doc.insertParagraphBookmarks('snapshot');
    const ids = doc.readParagraphs().paragraphs.map(p => p.id);
    const [clean, tracked, anotherClean] = await Promise.all([
      doc.toBuffer({ cleanBookmarks: true }),
      doc.toBuffer({ cleanBookmarks: false }),
      doc.toBuffer({ cleanBookmarks: true }),
    ]);
    expect(await readZipText(clean.buffer, 'word/document.xml')).not.toContain('bookmarkStart');
    expect(await readZipText(anotherClean.buffer, 'word/document.xml')).not.toContain('bookmarkStart');
    expect(await readZipText(tracked.buffer, 'word/document.xml')).toContain('bookmarkStart');
    expect(clean.bookmarksRemoved).toBe(1);
    expect(anotherClean.bookmarksRemoved).toBe(1);
    expect(tracked.bookmarksRemoved).toBe(0);
    expect(doc.readParagraphs().paragraphs.map(p => p.id)).toEqual(ids);
  });

  test('captures contents at invocation and never writes overrides into the live archive', async () => {
    const zip = await DocxZip.load(await buildDocxFromBodyXml('<w:p/>'));
    const source = await zip.readText('word/document.xml');
    zip.writeText('word/settings.xml', '<before/>');
    const output = zip.toBuffer({ textOverrides: { 'word/document.xml': '<first/>', 'custom.xml': '<outputOnly/>' } });
    zip.writeText('word/document.xml', '<second/>');
    zip.writeText('word/settings.xml', '<after/>');
    zip.writeText('later.xml', '<later/>');
    const buffer = await output;
    expect(await readZipText(buffer, 'word/document.xml')).toBe('<first/>');
    expect(await readZipText(buffer, 'word/settings.xml')).toBe('<before/>');
    expect(await readZipText(buffer, 'custom.xml')).toBe('<outputOnly/>');
    expect(await readZipText(buffer, 'later.xml')).toBeNull();
    expect(zip.hasFile('custom.xml')).toBe(false);
    expect(await zip.readText('word/document.xml')).toBe('<second/>');
    expect(source).toContain('w:p');
  });

  test('failed generation leaves live entries intact and later export succeeds', async () => {
    const zip = await DocxZip.load(await buildDocxFromBodyXml('<w:p/>'));
    const source = await zip.readText('word/document.xml');
    const baseline = await zip.toBuffer({ fileDate: ZIP_EPOCH });
    const generate = vi.spyOn(JSZip.prototype, 'generateAsync').mockRejectedValueOnce(new Error('injected failure'));
    try {
      await expect(zip.toBuffer({ fileDate: ZIP_EPOCH, textOverrides: { 'word/document.xml': '<override/>' } })).rejects.toThrow('injected failure');
      expect(await zip.readText('word/document.xml')).toBe(source);
      expect(await readZipText(await zip.toBuffer(), 'word/document.xml')).toBe(source);
      expect(await zip.toBuffer({ fileDate: ZIP_EPOCH })).toEqual(baseline);
    } finally {
      generate.mockRestore();
    }
  });

  test('failed clean document export leaves bookmarks, archive, and editing usable', async () => {
    // Capture the actual backing archive without exposing a production accessor.
    const load = vi.spyOn(DocxZip, 'load');
    let zip: DocxZip;
    let doc: DocxDocument;
    try {
      doc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('Alpha')));
      zip = await load.mock.results[0]!.value;
    } finally {
      load.mockRestore();
    }
    doc.insertParagraphBookmarks('failure');
    const before = doc.readParagraphs();
    const trackedBefore = await doc.toBuffer({ fileDate: ZIP_EPOCH });
    const archiveBefore = await zip.toBuffer({ fileDate: ZIP_EPOCH });
    const generate = vi.spyOn(JSZip.prototype, 'generateAsync').mockRejectedValueOnce(new Error('injected document failure'));
    try {
      await expect(doc.toBuffer({ cleanBookmarks: true })).rejects.toThrow('injected document failure');
      expect(doc.readParagraphs()).toEqual(before);
      expect(await zip.toBuffer({ fileDate: ZIP_EPOCH })).toEqual(archiveBefore);
      expect((await doc.toBuffer({ fileDate: ZIP_EPOCH })).buffer).toEqual(trackedBefore.buffer);
      doc.replaceText({ targetParagraphId: before.paragraphs[0]!.id, findText: 'Alpha', replaceText: 'Beta' });
      const recovered = await doc.toBuffer({ cleanBookmarks: true });
      const xml = await readZipText(recovered.buffer, 'word/document.xml');
      expect(xml).toContain('Beta');
      expect(xml).not.toContain('bookmarkStart');
    } finally {
      generate.mockRestore();
    }
  });

  test('snapshot preserves binary parts, comments, and entry dates without removing live directories', async () => {
    // A different package shape is intentional: inherited directory entries,
    // archive/entry comments, and binary payloads exercise snapshot fidelity.
    const source = new JSZip();
    const date = new Date(Date.UTC(2020, 5, 15, 12));
    const binary = Buffer.from([0, 255, 1, 128]);
    source.file('word/media/image.bin', binary, { date, comment: 'binary comment' });
    source.file('word/document.xml', '<document/>', { date });
    const zip = await DocxZip.load(await source.generateAsync({ type: 'nodebuffer', comment: 'archive comment' }));
    const names = zip.listFiles();
    const fixedDate = new Date(ZIP_EPOCH);
    const pending = zip.toBuffer({ fileDate: fixedDate, textOverrides: { 'word/document.xml': '<override/>' } });
    fixedDate.setUTCFullYear(2024);
    const [fixed, normal] = await Promise.all([pending, zip.toBuffer()]);
    const fixedZip = await JSZip.loadAsync(fixed);
    const normalZip = await JSZip.loadAsync(normal);
    expect(await fixedZip.file('word/media/image.bin')!.async('nodebuffer')).toEqual(binary);
    expect(fixedZip.file('word/media/image.bin')!.comment).toBe('binary comment');
    expect((fixedZip as JSZip & { comment: string }).comment).toBe('archive comment');
    expect(Object.values(fixedZip.files).every(file => file.date.getTime() === ZIP_EPOCH.getTime())).toBe(true);
    expect(Object.values(normalZip.files).every(file => file.date.getTime() === date.getTime())).toBe(true);
    expect(Object.values(normalZip.files).some(file => file.dir)).toBe(false);
    expect(zip.listFiles()).toEqual(names);
  });
});
