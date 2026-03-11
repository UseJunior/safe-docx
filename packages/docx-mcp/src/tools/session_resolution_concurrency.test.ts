import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';
import {
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

const FEATURE = 'Session Resolution Concurrency';

async function createDoc(paragraphs: string[], name = 'input.docx'): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-concurrency-');
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

function getErrorCode(result: Record<string, unknown>): string | undefined {
  const err = result.error as { code?: string } | undefined;
  return err?.code;
}

describe(FEATURE, () => {
  registerCleanup();
  const test = testAllure.epic('Document Reading').withLabels({ feature: FEATURE });

  test('concurrent auto-opens converge to one session', async ({ given, when, then }: AllureBddContext) => {
    let docPath: string;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let r1: Awaited<ReturnType<typeof readFile>>;
    let r2: Awaited<ReturnType<typeof readFile>>;
    let r3: Awaited<ReturnType<typeof readFile>>;

    await given('a document file on disk and a fresh session manager', async () => {
      docPath = await createDoc(['Hello world']);
      mgr = createTestSessionManager();
    });

    await when('three concurrent readFile calls are made using the same file_path', async () => {
      [r1, r2, r3] = await Promise.all([
        readFile(mgr, { file_path: docPath }),
        readFile(mgr, { file_path: docPath }),
        readFile(mgr, { file_path: docPath }),
      ]);
    });

    await then('all three calls succeed and return the same session ID', () => {
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);
      const id1 = r1.session_id as string;
      expect(id1).toBeTruthy();
      expect((r2.session_id as string)).toBe(id1);
      expect((r3.session_id as string)).toBe(id1);
    });
  });

  test('concurrent replaceText via file_path converge to same session', async ({ given, when, then }: AllureBddContext) => {
    let docPath: string;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let sessionId: string;
    let paraId: string;
    let e1: Awaited<ReturnType<typeof replaceText>>;
    let e2: Awaited<ReturnType<typeof replaceText>>;

    await given('a document is already open with a known paragraph ID', async () => {
      docPath = await createDoc(['Alpha Beta']);
      mgr = createTestSessionManager();
      const read = await readFile(mgr, { file_path: docPath });
      expect(read.success).toBe(true);
      sessionId = read.session_id as string;
      const content = String(read.content);
      paraId = content
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('_bk_'))
        ?.split('|')[0]
        ?.trim() ?? '';
      expect(paraId).toBeTruthy();
    });

    await when('two concurrent replaceText calls target different tokens using file_path', async () => {
      [e1, e2] = await Promise.all([
        replaceText(mgr, {
          file_path: docPath,
          target_paragraph_id: paraId,
          old_string: 'Alpha',
          new_string: 'ALPHA',
          instruction: 'uppercase Alpha',
        }),
        replaceText(mgr, {
          file_path: docPath,
          target_paragraph_id: paraId,
          old_string: 'Beta',
          new_string: 'BETA',
          instruction: 'uppercase Beta',
        }),
      ]);
    });

    await then('both edits succeed and both resolve to the same session', () => {
      expect(e1.success).toBe(true);
      expect(e2.success).toBe(true);
      expect(e1.session_id).toBe(sessionId);
      expect(e2.session_id).toBe(sessionId);
    });
  });

  test('failed auto-open propagates structured error to all waiters', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    const missingPath = '/tmp/safe-docx-definitely-missing-file.docx';
    let r1: Awaited<ReturnType<typeof readFile>>;
    let r2: Awaited<ReturnType<typeof readFile>>;
    let r3: Awaited<ReturnType<typeof readFile>>;

    await given('a session manager and a path to a file that does not exist', () => {
      mgr = createTestSessionManager();
    });

    await when('three concurrent readFile calls target the missing file', async () => {
      [r1, r2, r3] = await Promise.all([
        readFile(mgr, { file_path: missingPath }),
        readFile(mgr, { file_path: missingPath }),
        readFile(mgr, { file_path: missingPath }),
      ]);
    });

    await then('all three calls fail with FILE_NOT_FOUND', () => {
      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
      expect(r3.success).toBe(false);
      expect(getErrorCode(r1)).toBe('FILE_NOT_FOUND');
      expect(getErrorCode(r2)).toBe('FILE_NOT_FOUND');
      expect(getErrorCode(r3)).toBe('FILE_NOT_FOUND');
    });
  });

  test('single missing-file call produces no unhandledRejection', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    const missingPath = '/tmp/safe-docx-no-rejection-test.docx';
    let result: Awaited<ReturnType<typeof readFile>>;
    let rejectionFired = false;
    let handler: () => void;

    await given('a session manager and an unhandledRejection listener installed', () => {
      mgr = createTestSessionManager();
      handler = () => { rejectionFired = true; };
      process.on('unhandledRejection', handler);
    });

    try {
      await when('a single readFile call targets a missing file', async () => {
        result = await readFile(mgr, { file_path: missingPath });
        // Give the event loop a tick to surface any unhandled rejection
        await new Promise((r) => setTimeout(r, 50));
      });

      await then('the call fails gracefully and no unhandledRejection event fires', () => {
        expect(result.success).toBe(false);
        expect(rejectionFired).toBe(false);
      });
    } finally {
      process.off('unhandledRejection', handler!);
    }
  });

  test('sequential calls still reuse via getMRU', async ({ given, when, then }: AllureBddContext) => {
    let docPath: string;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let r1: Awaited<ReturnType<typeof readFile>>;
    let r2: Awaited<ReturnType<typeof readFile>>;

    await given('a document file on disk and a fresh session manager', async () => {
      docPath = await createDoc(['Sequential test']);
      mgr = createTestSessionManager();
    });

    await when('two sequential readFile calls target the same file_path', async () => {
      r1 = await readFile(mgr, { file_path: docPath });
      expect(r1.success).toBe(true);
      r2 = await readFile(mgr, { file_path: docPath });
      expect(r2.success).toBe(true);
    });

    await then('the second call reuses the existing session via getMRU', () => {
      expect(r2.session_id).toBe(r1.session_id);
      expect(r2.session_resolution).toBe('reused_existing_session');
    });
  });

  test('different paths are independent', async ({ given, when, then }: AllureBddContext) => {
    let doc1: string;
    let doc2: string;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let r1: Awaited<ReturnType<typeof readFile>>;
    let r2: Awaited<ReturnType<typeof readFile>>;

    await given('two distinct document files on disk and a fresh session manager', async () => {
      doc1 = await createDoc(['Doc one'], 'one.docx');
      doc2 = await createDoc(['Doc two'], 'two.docx');
      mgr = createTestSessionManager();
    });

    await when('two concurrent readFile calls target different file paths', async () => {
      [r1, r2] = await Promise.all([
        readFile(mgr, { file_path: doc1 }),
        readFile(mgr, { file_path: doc2 }),
      ]);
    });

    await then('each call succeeds and returns a distinct session ID', () => {
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r1.session_id).not.toBe(r2.session_id);
    });
  });

  test('cross-manager isolation prevents shared pending sessions', async ({ given, when, then }: AllureBddContext) => {
    let docPath: string;
    let mgr1: ReturnType<typeof createTestSessionManager>;
    let mgr2: ReturnType<typeof createTestSessionManager>;
    let r1: Awaited<ReturnType<typeof readFile>>;
    let r2: Awaited<ReturnType<typeof readFile>>;

    await given('the same document file and two independent session managers', async () => {
      docPath = await createDoc(['Isolation test']);
      mgr1 = createTestSessionManager();
      mgr2 = createTestSessionManager();
    });

    await when('each manager opens the same file concurrently', async () => {
      [r1, r2] = await Promise.all([
        readFile(mgr1, { file_path: docPath }),
        readFile(mgr2, { file_path: docPath }),
      ]);
    });

    await then('both succeed and each manager creates its own independent session ID', () => {
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r1.session_id).not.toBe(r2.session_id);
    });
  });
});
