import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WML_STRICT_NS, buildSyntheticDocx } from '@usejunior/docx-core';
import { makeStrictDocx } from '../testing/docx_test_utils.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { compareDocuments_tool } from './compare_documents.js';
import { grep } from './grep.js';
import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { UNSUPPORTED_CONFORMANCE_CLASS } from './conformance_refusal.js';

const TEST_FEATURE = 'refuse-wml-strict-documents';

const test = testAllure
  .epic('Document Reading')
  .withLabels({ feature: 'Conformance Refusal' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '2.1' });

const BODY_TEXT = 'Alpha bravo charlie.';

async function writeFixtures(): Promise<{ dir: string; transitionalPath: string; strictPath: string }> {
  const dir = await createTrackedTempDir('safe-docx-strict-');
  const transitional = await buildSyntheticDocx({ paragraphs: [BODY_TEXT] });
  const strict = await makeStrictDocx(transitional);

  const transitionalPath = path.join(dir, 'transitional.docx');
  const strictPath = path.join(dir, 'strict.docx');
  await fs.writeFile(transitionalPath, new Uint8Array(transitional));
  await fs.writeFile(strictPath, new Uint8Array(strict));
  return { dir, transitionalPath, strictPath };
}

describe('WML Strict documents are refused with a typed tool error', () => {
  registerCleanup();

  test.openspec('[SDX-CONF-04] Document tools refuse a WML Strict file with UNSUPPORTED_CONFORMANCE_CLASS')(
    '[SDX-CONF-04] read_file, open_document, grep and compare_documents return the typed refusal',
    async ({ given, when, then, and }: AllureBddContext) => {
      let mgr: ReturnType<typeof createTestSessionManager>;
      let strictPath: string;
      let transitionalPath: string;
      let read: Awaited<ReturnType<typeof readFile>>;
      let opened: Awaited<ReturnType<typeof openDocument>>;
      let grepped: Awaited<ReturnType<typeof grep>>;
      let grepMulti: Awaited<ReturnType<typeof grep>>;
      let compared: Awaited<ReturnType<typeof compareDocuments_tool>>;

      await given('a Strict-namespace .docx and its Transitional twin on disk', async () => {
        mgr = createTestSessionManager();
        ({ strictPath, transitionalPath } = await writeFixtures());
      }, { namespace: WML_STRICT_NS });

      await when('each entry point is called on the Strict file', async () => {
        read = await readFile(mgr, { file_path: strictPath });
        opened = await openDocument(mgr, { file_path: strictPath });
        grepped = await grep(mgr, { file_path: strictPath, patterns: ['Alpha'] });
        grepMulti = await grep(mgr, { file_paths: [strictPath], patterns: ['Alpha'] });
        compared = await compareDocuments_tool(mgr, {
          original_file_path: transitionalPath,
          revised_file_path: strictPath,
          save_to_local_path: path.join(path.dirname(strictPath), 'redline.docx'),
        });
      });

      await then('read_file fails with the typed code, a message naming the class, and a hint', () => {
        assertFailure(read, UNSUPPORTED_CONFORMANCE_CLASS, 'read_file');
        expect(read.error.message).toContain('WML Strict');
        expect(read.error.message).toContain(WML_STRICT_NS);
        expect(read.error.hint).toMatch(/Transitional/);
        expect(read.error.message).not.toMatch(/\n\s+at /);
      });

      await and('open_document, grep and compare_documents report the same code', () => {
        assertFailure(opened, UNSUPPORTED_CONFORMANCE_CLASS, 'open_document');
        assertFailure(grepped, UNSUPPORTED_CONFORMANCE_CLASS, 'grep');
        assertFailure(compared, UNSUPPORTED_CONFORMANCE_CLASS, 'compare_documents');
        expect(compared.error.message).toContain("the revised document's word/document.xml");
      });

      await and('multi-file grep reports the refusal per file instead of an empty match set', () => {
        assertSuccess(grepMulti, 'grep multi-file');
        const files = grepMulti.files as Array<Record<string, unknown>>;
        expect(files).toHaveLength(1);
        expect(files[0]!.error_code).toBe(UNSUPPORTED_CONFORMANCE_CLASS);
        expect(String(files[0]!.error)).toContain('WML Strict');
      });

      await and('no session is left open for the refused file', async () => {
        const canonical = await mgr.canonicalizePath(strictPath);
        expect(mgr.getSessionByPath(canonical)).toBeNull();
      });
    },
  );

  test('the Transitional control file reads its text through read_file', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let transitionalPath: string;
    let read: Awaited<ReturnType<typeof readFile>>;

    await given('the Transitional twin on disk', async () => {
      mgr = createTestSessionManager();
      ({ transitionalPath } = await writeFixtures());
    });

    await when('read_file is called', async () => {
      read = await readFile(mgr, { file_path: transitionalPath, format: 'simple' });
    });

    await then('it succeeds and the body text is present', () => {
      assertSuccess(read, 'read_file');
      expect(String(read.content)).toContain(BODY_TEXT);
    });
  });
});
