import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { initPlan } from './init_plan.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';
import { openDocument } from './open_document.js';
import { testAllure } from '../testing/allure-test.js';

async function writeDocx(paragraphs: string[], filename = 'input.docx'): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-init-plan-');
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

describe('init_plan tool', () => {
  registerCleanup();
  const test = testAllure.epic('Document Editing').withLabels({ feature: 'init_plan tool' });

  test('creates revision-bound plan context from explicit session_id', async () => {
    const manager = createTestSessionManager();
    const filePath = await writeDocx(['Alpha paragraph']);
    const opened = await openDocument(manager, { file_path: filePath });
    expect(opened.success).toBe(true);
    if (!opened.success) return;

    const result = await initPlan(manager, {
      session_id: String(opened.session_id),
      plan_name: 'agreement-review',
      orchestrator_id: 'coordinator-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan_context_id).toMatch(/^plctx_[A-Za-z0-9]{12}$/);
    expect(result.base_revision).toBe(0);
    expect(result.plan_context).toMatchObject({
      plan_name: 'agreement-review',
      orchestrator_id: 'coordinator-1',
    });
  });

  test('supports file-first session resolution', async () => {
    const manager = createTestSessionManager();
    const filePath = await writeDocx(['Beta paragraph'], 'beta.docx');

    const result = await initPlan(manager, { file_path: filePath });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.base_revision).toBe(0);
    expect(result.resolved_file_path).toBe(manager.normalizePath(filePath));
    expect(typeof result.resolved_session_id).toBe('string');
    expect(result.session_resolution).toBe('opened_new_session');
  });
});
