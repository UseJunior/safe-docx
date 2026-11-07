import { describe, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { testAllure } from './testing/allure-test.js';
import { convertToOdt } from './tools/convert_to_odt.js';
import { openDocument } from './tools/open_document.js';
import { resolveGDocsSessionForTool } from './tools/session_resolution.js';
import {
  assertFailure,
  openSession,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
} from './testing/session-test-utils.js';
import { resetOdfCoreLoaderForTesting, loadOdfCore } from './odf_loader.js';
import { resetGDocsCoreLoaderForTesting, loadGDocsCore } from './gdocs_loader.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Provider Loader Integration' });

describe('provider_loader integration with MCP tools', () => {
  registerCleanup();

  test('convert_to_odt returns structured ODF_UNAVAILABLE when odf-core loader fails and leaves target untouched', async () => {
    resetOdfCoreLoaderForTesting();
    // Simulate failing loader via injected failing importer
    await loadOdfCore(async () => {
      throw new Error('Injected missing odf-core dependency');
    });

    try {
      const opened = await openSession(['Test paragraph content.']);
      const target = path.join(opened.tmpDir, 'output-never-written.odt');

      const result = await convertToOdt(opened.mgr, {
        file_path: opened.inputPath,
        output_path: target,
      });

      assertFailure(result, 'ODF_UNAVAILABLE');
      const targetExists = await fs.access(target).then(() => true).catch(() => false);
      expect(targetExists).toBe(false);
    } finally {
      resetOdfCoreLoaderForTesting();
    }
  });

  test('open_document returns MISSING_DEPENDENCY for .odt file when odf-core loader fails', async () => {
    resetOdfCoreLoaderForTesting();
    await loadOdfCore(async () => {
      throw new Error('Injected missing odf-core dependency');
    });

    try {
      const mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir();
      const odtPath = path.join(tmpDir, 'document.odt');
      await fs.writeFile(odtPath, 'dummy-odt-bytes');

      const result = await openDocument(mgr, { file_path: odtPath });
      assertFailure(result, 'MISSING_DEPENDENCY');
    } finally {
      resetOdfCoreLoaderForTesting();
    }
  });

  test('resolveGDocsSessionForTool returns MISSING_DEPENDENCY when gdocs-core loader fails', async () => {
    resetGDocsCoreLoaderForTesting();
    await loadGDocsCore(async () => {
      throw new Error('Injected missing gdocs-core dependency');
    });

    try {
      const mgr = createTestSessionManager();
      const result = await resolveGDocsSessionForTool(
        mgr,
        { google_doc_id: 'test-doc-id-failure' },
        { toolName: 'read_file' },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.success).toBe(false);
        expect((result.response as any).error?.code).toBe('MISSING_DEPENDENCY');
      }
    } finally {
      resetGDocsCoreLoaderForTesting();
    }
  });
});
