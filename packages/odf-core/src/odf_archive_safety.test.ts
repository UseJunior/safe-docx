import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import JSZip from 'jszip';
import { describe, it, expect } from 'vitest';

import { validateOdfArchiveSafety } from './odf_archive_safety.js';
import { ODT_MIMETYPE } from './shared/odf/namespaces.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/sample.odt');

describe('validateOdfArchiveSafety', () => {
  it('accepts a real .odt', async () => {
    const result = await validateOdfArchiveSafety(readFileSync(FIXTURE));
    expect(result.ok).toBe(true);
  });

  it('[OSAFE-02] rejects a ZIP without the ODF mimetype', async () => {
    const zip = new JSZip();
    zip.file('content.xml', '<doc/>');
    zip.file('META-INF/manifest.xml', '<manifest/>');
    const buf = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
    const result = await validateOdfArchiveSafety(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_ODF_ARCHIVE');
  });

  it('[OSAFE-02] rejects a ZIP whose mimetype is wrong', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', { compression: 'STORE' });
    zip.file('content.xml', '<doc/>');
    const buf = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
    const result = await validateOdfArchiveSafety(buf);
    expect(result.ok).toBe(false);
  });

  it('[OSAFE-01] rejects a compression-ratio bomb', async () => {
    const zip = new JSZip();
    zip.file('mimetype', ODT_MIMETYPE, { compression: 'STORE' });
    // ~5MB of zeros compresses to almost nothing → very high ratio.
    zip.file('content.xml', Buffer.alloc(5 * 1024 * 1024, 0), { compression: 'DEFLATE' });
    const buf = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })) as Buffer;
    const result = await validateOdfArchiveSafety(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ODF_ARCHIVE_COMPRESSION_RATIO_TOO_HIGH');
  });

  it('rejects a non-zip buffer', async () => {
    const result = await validateOdfArchiveSafety(Buffer.from('not a zip'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_ODF_ARCHIVE');
  });
});
