import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';
import { closeFile } from './close_file.js';
import { resolveSessionForTool, resolveOdfSessionForTool } from './session_resolution.js';
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

    await then('all three calls succeed and return the same file_path', () => {
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);
      const fp1 = r1.resolved_file_path as string;
      expect(fp1).toBeTruthy();
      expect((r2.resolved_file_path as string)).toBe(fp1);
      expect((r3.resolved_file_path as string)).toBe(fp1);
    });
  });

  test('concurrent replaceText via file_path converge to same session', async ({ given, when, then }: AllureBddContext) => {
    let docPath: string;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let resolvedPath: string;
    let paraId: string;
    let e1: Awaited<ReturnType<typeof replaceText>>;
    let e2: Awaited<ReturnType<typeof replaceText>>;

    await given('a document is already open with a known paragraph ID', async () => {
      docPath = await createDoc(['Alpha Beta']);
      mgr = createTestSessionManager();
      const read = await readFile(mgr, { file_path: docPath });
      expect(read.success).toBe(true);
      resolvedPath = read.resolved_file_path as string;
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

    await then('both edits succeed and both resolve to the same file path', () => {
      expect(e1.success).toBe(true);
      expect(e2.success).toBe(true);
      expect(e1.resolved_file_path).toBe(resolvedPath);
      expect(e2.resolved_file_path).toBe(resolvedPath);
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

    await then('the second call reuses the existing session', () => {
      expect(r2.resolved_file_path).toBe(r1.resolved_file_path);
      expect(r2.session_resolution).toBe('reused');
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

    await then('each call succeeds and returns a distinct file path', () => {
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r1.resolved_file_path).not.toBe(r2.resolved_file_path);
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

    await then('both succeed and each manager creates its own independent session', () => {
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      // Both managers resolve the same canonical path but maintain separate sessions
      expect(r1.resolved_file_path).toBeTruthy();
      expect(r2.resolved_file_path).toBeTruthy();
    });
  });

  test('in-flight opener cannot publish after close_file targets the path (#1298)', async ({ given, when, then }: AllureBddContext) => {
    let docPath: string;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let createdTmpDir: string | null = null;
    let openResult: Awaited<ReturnType<typeof readFile>>;

    await given('a document file and a session manager where createSession pauses in flight', async () => {
      docPath = await createDoc(['Close during open']);
      mgr = createTestSessionManager();
    });

    await when('close_file runs while readFile is opening the session', async () => {
      const origCreate = mgr.createSession.bind(mgr);
      let enteredCreate!: () => void;
      const enteredCreatePromise = new Promise<void>((r) => {
        enteredCreate = r;
      });
      let resumeCreate!: () => void;
      const resumeCreatePromise = new Promise<void>((r) => {
        resumeCreate = r;
      });

      mgr.createSession = async (content, filename, originalPath, opts) => {
        enteredCreate();
        await resumeCreatePromise;
        const session = await origCreate(content, filename, originalPath, opts);
        createdTmpDir = path.dirname(session.tmpPath);
        return session;
      };

      try {
        const inFlightRead = readFile(mgr, { file_path: docPath });
        await enteredCreatePromise;

        const closeRes = await closeFile(mgr, { file_path: docPath });
        expect(closeRes.success).toBe(true);

        resumeCreate();
        openResult = await inFlightRead;
      } finally {
        mgr.createSession = origCreate;
      }
    });

    await then('the pre-close opener is rejected, cleans up its artifacts, and leaves no published session', async () => {
      expect(openResult.success).toBe(false);
      expect(getErrorCode(openResult)).toBe('SESSION_CLOSED');
      expect(await mgr.getSessionByFilePath(docPath)).toBeNull();
      expect(mgr.listSessions()).toHaveLength(0);
      if (createdTmpDir) {
        const stat = await fs.stat(createdTmpDir).catch(() => null);
        expect(stat).toBeNull();
      }
    });
  });

  test('in-flight opener cannot publish after clearAllSessions runs (#1298)', async ({ given, when, then }: AllureBddContext) => {
    let docPath: string;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let openOutcome: Awaited<ReturnType<typeof resolveSessionForTool>>;

    await given('a document file and a session manager where finalizeNewSession pauses in flight', async () => {
      docPath = await createDoc(['Clear all during open']);
      mgr = createTestSessionManager();
    });

    await when('clearAllSessions runs while resolveSessionForTool is finalizing a session', async () => {
      const origFinalize = mgr.finalizeNewSession.bind(mgr);
      let enteredFinalize!: () => void;
      const enteredFinalizePromise = new Promise<void>((r) => {
        enteredFinalize = r;
      });
      let resumeFinalize!: () => void;
      const resumeFinalizePromise = new Promise<void>((r) => {
        resumeFinalize = r;
      });

      mgr.finalizeNewSession = async (session, opts) => {
        enteredFinalize();
        await resumeFinalizePromise;
        return origFinalize(session, opts);
      };

      try {
        const inFlightOpen = resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
        await enteredFinalizePromise;

        const closeRes = await closeFile(mgr, { clear_all: true, confirm: true });
        expect(closeRes.success).toBe(true);

        resumeFinalize();
        openOutcome = await inFlightOpen;
      } finally {
        mgr.finalizeNewSession = origFinalize;
      }
    });

    await then('the pre-close opener does not publish after clearAllSessions', async () => {
      expect(openOutcome.ok).toBe(false);
      if (!openOutcome.ok) {
        expect(getErrorCode(openOutcome.response)).toBe('SESSION_CLOSED');
      }
      expect(await mgr.getSessionByFilePath(docPath)).toBeNull();
      expect(mgr.listSessions()).toHaveLength(0);
    });
  });

  test('post-close opener succeeds and is not clobbered by a slower pre-close opener (#1298)', async ({ given, when, then }: AllureBddContext) => {
    let docPath: string;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let preCloseOutcome: Awaited<ReturnType<typeof resolveSessionForTool>>;
    let postCloseOutcome1: Awaited<ReturnType<typeof resolveSessionForTool>>;
    let postCloseOutcome2: Awaited<ReturnType<typeof resolveSessionForTool>>;

    await given('a document file and a session manager with a controllable first open', async () => {
      docPath = await createDoc(['Generation handoff']);
      mgr = createTestSessionManager();
    });

    await when('close_file invalidates the first opener and a new opener starts before the first settles', async () => {
      const origCreate = mgr.createSession.bind(mgr);
      let callCount = 0;
      let firstEntered!: () => void;
      const firstEnteredPromise = new Promise<void>((r) => {
        firstEntered = r;
      });
      let releaseFirst!: () => void;
      const releaseFirstPromise = new Promise<void>((r) => {
        releaseFirst = r;
      });

      mgr.createSession = async (content, filename, originalPath, opts) => {
        callCount += 1;
        if (callCount === 1) {
          firstEntered();
          await releaseFirstPromise;
        }
        return origCreate(content, filename, originalPath, opts);
      };

      try {
        const preClosePromise = resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
        await firstEnteredPromise;

        // Close invalidates generation 0 and evicts the pre-close pending entry
        await mgr.clearSessionByPath(docPath);

        // Start two concurrent post-close openers while the pre-close opener is still blocked
        const postClosePromise1 = resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
        const postClosePromise2 = resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });

        // Now release the slower pre-close opener and let all settle
        releaseFirst();
        [preCloseOutcome, postCloseOutcome1, postCloseOutcome2] = await Promise.all([
          preClosePromise,
          postClosePromise1,
          postClosePromise2,
        ]);
      } finally {
        mgr.createSession = origCreate;
      }
    });

    await then('the pre-close opener fails with SESSION_CLOSED while the post-close openers converge on the active session', async () => {
      expect(preCloseOutcome.ok).toBe(false);
      if (!preCloseOutcome.ok) {
        expect(getErrorCode(preCloseOutcome.response)).toBe('SESSION_CLOSED');
      }
      expect(postCloseOutcome1.ok).toBe(true);
      expect(postCloseOutcome2.ok).toBe(true);
      if (postCloseOutcome1.ok && postCloseOutcome2.ok) {
        expect(postCloseOutcome1.session).toBe(postCloseOutcome2.session);
        const active = await mgr.getSessionByFilePath(docPath);
        expect(active).toBe(postCloseOutcome1.session);
      }
    });
  });

  test('synchronous or immediate leader failure cleans pending entry by identity so subsequent opens succeed (#1298)', async ({ given, when, then }: AllureBddContext) => {
    let docPath: string;
    let mgr: ReturnType<typeof createTestSessionManager>;
    let secondOutcome: Awaited<ReturnType<typeof resolveSessionForTool>>;

    await given('a document file and a session manager where the first createSession throws synchronously', async () => {
      docPath = await createDoc(['Sync failure recovery']);
      mgr = createTestSessionManager();
    });

    await when('the first resolveSessionForTool call throws synchronously and a second call follows', async () => {
      const origCreate = mgr.createSession.bind(mgr);
      let failedOnce = false;
      mgr.createSession = ((content: Buffer, filename: string, originalPath: string, opts?: any) => {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error('SYNCHRONOUS_CREATE_FAILURE');
        }
        return origCreate(content, filename, originalPath, opts);
      }) as typeof mgr.createSession;

      try {
        await expect(
          resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' }),
        ).rejects.toThrow('SYNCHRONOUS_CREATE_FAILURE');

        // Also verify ODF resolver does not poison DOCX pending state for the same path
        const odfMismatch = await resolveOdfSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
        expect(odfMismatch.ok).toBe(false);

        secondOutcome = await resolveSessionForTool(mgr, { file_path: docPath }, { toolName: 'read_file' });
      } finally {
        mgr.createSession = origCreate;
      }
    });

    await then('the pending entry was cleaned up and the subsequent open succeeds', async () => {
      expect(secondOutcome.ok).toBe(true);
      if (secondOutcome.ok) {
        expect(await mgr.getSessionByFilePath(docPath)).toBe(secondOutcome.session);
      }
    });
  });
});
