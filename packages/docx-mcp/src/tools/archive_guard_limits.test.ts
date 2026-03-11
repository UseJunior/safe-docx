import { describe, expect } from 'vitest';
import { testAllure as test, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createZipBuffer } from '@usejunior/docx-core';

import { openDocument } from './open_document.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';

async function makeHighlyCompressedDocx(): Promise<Buffer> {
  return createZipBuffer(
    {
      'word/document.xml':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`,
      // Highly compressible payload to trip compression-ratio guard.
      'customXml/item1.xml': 'A'.repeat(8 * 1024 * 1024),
    },
    { compression: 'DEFLATE', compressionLevel: 9 },
  );
}

describe('open_document: archive guard limits', () => {
  registerCleanup();

  test('open_document rejects archive entries with extreme compression ratio', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let inputPath: string;
    let opened: Awaited<ReturnType<typeof openDocument>>;

    await given('a docx file with a highly compressed payload triggering the compression-ratio guard', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-archive-guard-');
      inputPath = path.join(tmpDir, 'compressed.docx');
      await fs.writeFile(inputPath, new Uint8Array(await makeHighlyCompressedDocx()));
    });

    await when('open_document is called on that file', async () => {
      opened = await openDocument(mgr, { file_path: inputPath });
    });

    await then('the operation fails with DOCX_ARCHIVE_COMPRESSION_RATIO_TOO_HIGH', () => {
      expect(opened.success).toBe(false);
      if (!opened.success) {
        expect(opened.error.code).toBe('DOCX_ARCHIVE_COMPRESSION_RATIO_TOO_HIGH');
      }
    });
  });
});
