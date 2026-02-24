import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';

import { MCP_TOOLS, dispatchToolCall } from '../server.js';
import { mergePlans } from './merge_plans.js';
import { readFile } from './read_file.js';
import { testAllure } from '../testing/allure-test.js';
import {
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

const TEST_FEATURE = 'add-safe-docx-batch-apply-and-strict-anchor-resolution';

async function writeDocx(paragraphs: string[], filename = 'input.docx'): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-surface-');
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

describe('Traceability: Batch Apply and Strict Anchor Resolution', () => {
  registerCleanup();
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });

  humanReadableTest.openspec('canonical names are advertised')(
    'Scenario: canonical names are advertised',
    async () => {
      const toolNames = new Set<string>(MCP_TOOLS.map((tool) => tool.name));
      expect(toolNames.has('replace_text')).toBe(true);
      expect(toolNames.has('insert_paragraph')).toBe(true);
    },
  );

  humanReadableTest.openspec('legacy aliases are unavailable')(
    'Scenario: legacy aliases are unavailable',
    async () => {
      const toolNames = new Set<string>(MCP_TOOLS.map((tool) => tool.name));
      expect(toolNames.has('smart_edit')).toBe(false);
      expect(toolNames.has('smart_insert')).toBe(false);
    },
  );

  humanReadableTest.openspec('legacy aliases are rejected inside plan operations')(
    'Scenario: legacy aliases are rejected inside plan operations',
    async () => {
      const result = await mergePlans({
        plans: [
          {
            plan_id: 'legacy-edit',
            base_revision: 1,
            steps: [
              {
                step_id: 's1',
                operation: 'smart_edit',
                target_paragraph_id: '_bk_1',
                old_string: 'old',
                new_string: 'new',
                instruction: 'legacy operation',
              },
            ],
          },
          {
            plan_id: 'legacy-insert',
            base_revision: 1,
            steps: [
              {
                step_id: 's2',
                operation: 'smart_insert',
                positional_anchor_node_id: '_bk_1',
                new_string: 'new paragraph',
                instruction: 'legacy operation',
              },
            ],
          },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((conflict) => conflict.code === 'INVALID_STEP_OPERATION')).toBe(true);
    },
  );

  humanReadableTest.openspec('MCP catalog omits open_document')(
    'Scenario: MCP catalog omits open_document',
    async () => {
      const toolNames = new Set<string>(MCP_TOOLS.map((tool) => tool.name));
      expect(toolNames.has('open_document')).toBe(false);
      expect(toolNames.has('read_file')).toBe(true);
      expect(toolNames.has('grep')).toBe(true);
    },
  );

  humanReadableTest.openspec('open_document call is rejected as unsupported')(
    'Scenario: open_document call is rejected as unsupported',
    async () => {
      const manager = createTestSessionManager();
      const result = await dispatchToolCall(manager, 'open_document', {});

      expect(result.success).toBe(false);
      expect((result.error as { code?: string }).code).toBe('UNKNOWN_TOOL');
      expect(String((result.error as { message?: string }).message ?? '')).toContain('open_document');
      expect(String((result.error as { hint?: string }).hint ?? '')).toContain('read_file');
    },
  );

  humanReadableTest.openspec('document tools accept file-first entry without pre-open')(
    'Scenario: document tools accept file-first entry without pre-open',
    async () => {
      const manager = createTestSessionManager();
      const filePath = await writeDocx(['Alpha clause']);

      const read = await readFile(manager, { file_path: filePath, format: 'simple' });

      expect(read.success).toBe(true);
      if (!read.success) return;
      expect(read.session_resolution).toBe('opened_new_session');
      expect(typeof read.resolved_session_id).toBe('string');
      expect(read.resolved_file_path).toBe(manager.normalizePath(filePath));
    },
  );
});
