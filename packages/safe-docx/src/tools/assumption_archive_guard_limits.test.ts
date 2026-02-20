import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

import { openDocument } from './open_document.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';

async function makeHighlyCompressedDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`,
  );
  // Highly compressible payload to trip compression-ratio guard.
  zip.file('customXml/item1.xml', 'A'.repeat(8 * 1024 * 1024));
  return (await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })) as Buffer;
}

describe('assumption: malformed/hostile archive guards (A21)', () => {
  registerCleanup();

  test('open_document rejects archive entries with extreme compression ratio', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-assumption-archive-guard-');
    const inputPath = path.join(tmpDir, 'compressed.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeHighlyCompressedDocx()));

    const opened = await openDocument(mgr, { file_path: inputPath });
    expect(opened.success).toBe(false);
    if (!opened.success) {
      expect(opened.error.code).toBe('DOCX_ARCHIVE_COMPRESSION_RATIO_TOO_HIGH');
    }
  });
});
