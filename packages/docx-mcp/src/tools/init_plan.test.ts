import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { initPlan } from './init_plan.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';
import { openDocument } from './open_document.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

async function writeDocx(paragraphs: string[], filename = 'input.docx'): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-init-plan-');
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

describe('init_plan tool', () => {
  registerCleanup();
  const test = testAllure.epic('Document Editing').withLabels({ feature: 'init_plan tool' });

  test('creates revision-bound plan context from explicit session_id', async ({ given, when, then }: AllureBddContext) => {
    let manager: ReturnType<typeof createTestSessionManager>;
    let opened: Awaited<ReturnType<typeof openDocument>>;
    let result: Awaited<ReturnType<typeof initPlan>>;

    await given('a document is open in a known session', async () => {
      manager = createTestSessionManager();
      const filePath = await writeDocx(['Alpha paragraph']);
      opened = await openDocument(manager, { file_path: filePath });
      expect(opened.success).toBe(true);
    });

    await when('initPlan is called with the session_id, plan_name, and orchestrator_id', async () => {
      if (!opened.success) return;
      result = await initPlan(manager, {
        session_id: String(opened.session_id),
        plan_name: 'agreement-review',
        orchestrator_id: 'coordinator-1',
      });
    });

    await then('a valid plan_context_id is returned at base_revision 0 with the supplied metadata', () => {
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plan_context_id).toMatch(/^plctx_[A-Za-z0-9]{12}$/);
      expect(result.base_revision).toBe(0);
      expect(result.plan_context).toMatchObject({
        plan_name: 'agreement-review',
        orchestrator_id: 'coordinator-1',
      });
    });
  });

  test('supports file-first session resolution', async ({ given, when, then }: AllureBddContext) => {
    let manager: ReturnType<typeof createTestSessionManager>;
    let filePath: string;
    let result: Awaited<ReturnType<typeof initPlan>>;

    await given('a document file on disk with no pre-existing session', async () => {
      manager = createTestSessionManager();
      filePath = await writeDocx(['Beta paragraph'], 'beta.docx');
    });

    await when('initPlan is called using file_path instead of session_id', async () => {
      result = await initPlan(manager, { file_path: filePath });
    });

    await then('the session is auto-opened and the plan context reflects the resolved session', () => {
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.base_revision).toBe(0);
      expect(result.resolved_file_path).toBe(manager.normalizePath(filePath));
      expect(typeof result.resolved_session_id).toBe('string');
      expect(result.session_resolution).toBe('opened_new_session');
    });
  });
});
