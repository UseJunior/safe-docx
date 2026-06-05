import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import JSZip from 'jszip';
import { describe, it, expect } from 'vitest';

import { OdfArchive } from './OdfArchive.js';
import { ODT_MIMETYPE } from './namespaces.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../__fixtures__/sample.odt');
const sampleBuffer = (): Buffer => readFileSync(FIXTURE);

/** Read the first local-file-header entry name + compression method from a zip buffer. */
function firstEntry(buf: Buffer): { name: string; method: number } {
  const nameLen = buf.readUInt16LE(26);
  return { name: buf.subarray(30, 30 + nameLen).toString('latin1'), method: buf.readUInt16LE(8) };
}

describe('OdfArchive', () => {
  it('[OARCH-01] loads a valid .odt and exposes content.xml', async () => {
    const archive = await OdfArchive.load(sampleBuffer());
    const content = await archive.getContentXml();
    expect(content).toContain('office:document-content');
  });

  it('[OARCH-02] rejects a buffer missing required parts', async () => {
    const zip = new JSZip();
    zip.file('mimetype', ODT_MIMETYPE, { compression: 'STORE' });
    zip.file('content.xml', '<doc/>'); // no META-INF/manifest.xml
    const buf = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
    await expect(OdfArchive.load(buf)).rejects.toThrow(/manifest/i);
  });

  it('[OARCH-03] keeps mimetype first + uncompressed (STORE) across a load→modify→save round trip', async () => {
    const archive = await OdfArchive.load(sampleBuffer());
    archive.setContentXml((await archive.getContentXml()).replace('lazy dog', 'lazy cat'));
    const saved = await archive.save();
    const first = firstEntry(saved);
    expect(first.name).toBe('mimetype');
    expect(first.method).toBe(0); // 0 = STORE, 8 = DEFLATE
    const reloaded = await JSZip.loadAsync(saved);
    expect((await reloaded.file('mimetype')!.async('string')).trim()).toBe(ODT_MIMETYPE);
  });

  it('[OARCH-04] preserves untouched entries with byte-identical decompressed content', async () => {
    const original = await JSZip.loadAsync(sampleBuffer());
    const archive = await OdfArchive.load(sampleBuffer());
    archive.setContentXml((await archive.getContentXml()).replace('lazy dog', 'lazy cat'));
    const saved = await JSZip.loadAsync(await archive.save());

    for (const name of Object.keys(original.files)) {
      if (original.files[name].dir || name === 'content.xml') continue;
      const before = await original.file(name)!.async('nodebuffer');
      const afterFile = saved.file(name);
      expect(afterFile, `entry ${name} should survive`).not.toBeNull();
      const after = await afterFile!.async('nodebuffer');
      expect(Buffer.compare(before, after), `entry ${name} decompressed content`).toBe(0);
    }
  });
});
