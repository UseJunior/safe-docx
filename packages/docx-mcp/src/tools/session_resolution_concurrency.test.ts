import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
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

  test('concurrent auto-opens converge to one session', async () => {
    const docPath = await createDoc(['Hello world']);
    const mgr = createTestSessionManager();

    const [r1, r2, r3] = await Promise.all([
      readFile(mgr, { file_path: docPath }),
      readFile(mgr, { file_path: docPath }),
      readFile(mgr, { file_path: docPath }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r3.success).toBe(true);

    const id1 = r1.session_id as string;
    const id2 = r2.session_id as string;
    const id3 = r3.session_id as string;

    expect(id1).toBeTruthy();
    expect(id2).toBe(id1);
    expect(id3).toBe(id1);
  });

  test('concurrent replaceText via file_path converge to same session', async () => {
    const docPath = await createDoc(['Alpha Beta']);
    const mgr = createTestSessionManager();

    // Open+read to get paragraph ID first
    const read = await readFile(mgr, { file_path: docPath });
    expect(read.success).toBe(true);
    const sessionId = read.session_id as string;
    const content = String(read.content);
    const paraId = content
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('_bk_'))
      ?.split('|')[0]
      ?.trim();
    expect(paraId).toBeTruthy();

    // Fire two concurrent replaceText calls using file_path (not session_id)
    // Both should resolve to the same session via getMRU (session already exists)
    const [e1, e2] = await Promise.all([
      replaceText(mgr, {
        file_path: docPath,
        target_paragraph_id: paraId!,
        old_string: 'Alpha',
        new_string: 'ALPHA',
        instruction: 'uppercase Alpha',
      }),
      replaceText(mgr, {
        file_path: docPath,
        target_paragraph_id: paraId!,
        old_string: 'Beta',
        new_string: 'BETA',
        instruction: 'uppercase Beta',
      }),
    ]);

    expect(e1.success).toBe(true);
    expect(e2.success).toBe(true);

    // Both should have resolved to the same session
    expect(e1.session_id).toBe(sessionId);
    expect(e2.session_id).toBe(sessionId);
  });

  test('failed auto-open propagates structured error to all waiters', async () => {
    const mgr = createTestSessionManager();
    const missingPath = '/tmp/safe-docx-definitely-missing-file.docx';

    const [r1, r2, r3] = await Promise.all([
      readFile(mgr, { file_path: missingPath }),
      readFile(mgr, { file_path: missingPath }),
      readFile(mgr, { file_path: missingPath }),
    ]);

    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    expect(r3.success).toBe(false);

    expect(getErrorCode(r1)).toBe('FILE_NOT_FOUND');
    expect(getErrorCode(r2)).toBe('FILE_NOT_FOUND');
    expect(getErrorCode(r3)).toBe('FILE_NOT_FOUND');
  });

  test('single missing-file call produces no unhandledRejection', async () => {
    const mgr = createTestSessionManager();
    const missingPath = '/tmp/safe-docx-no-rejection-test.docx';

    let rejectionFired = false;
    const handler = () => {
      rejectionFired = true;
    };
    process.on('unhandledRejection', handler);

    try {
      const result = await readFile(mgr, { file_path: missingPath });
      expect(result.success).toBe(false);

      // Give the event loop a tick to surface any unhandled rejection
      await new Promise((r) => setTimeout(r, 50));
      expect(rejectionFired).toBe(false);
    } finally {
      process.off('unhandledRejection', handler);
    }
  });

  test('sequential calls still reuse via getMRU', async () => {
    const docPath = await createDoc(['Sequential test']);
    const mgr = createTestSessionManager();

    const r1 = await readFile(mgr, { file_path: docPath });
    expect(r1.success).toBe(true);

    const r2 = await readFile(mgr, { file_path: docPath });
    expect(r2.success).toBe(true);

    expect(r2.session_id).toBe(r1.session_id);
    expect(r2.session_resolution).toBe('reused_existing_session');
  });

  test('different paths are independent', async () => {
    const doc1 = await createDoc(['Doc one'], 'one.docx');
    const doc2 = await createDoc(['Doc two'], 'two.docx');
    const mgr = createTestSessionManager();

    const [r1, r2] = await Promise.all([
      readFile(mgr, { file_path: doc1 }),
      readFile(mgr, { file_path: doc2 }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r1.session_id).not.toBe(r2.session_id);
  });

  test('cross-manager isolation prevents shared pending sessions', async () => {
    const docPath = await createDoc(['Isolation test']);
    const mgr1 = createTestSessionManager();
    const mgr2 = createTestSessionManager();

    const [r1, r2] = await Promise.all([
      readFile(mgr1, { file_path: docPath }),
      readFile(mgr2, { file_path: docPath }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r1.session_id).not.toBe(r2.session_id);
  });
});
