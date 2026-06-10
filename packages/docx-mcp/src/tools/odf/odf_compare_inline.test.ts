import { afterEach, describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testAllure as it, type AllureBddContext } from '../../testing/allure-test.js';
import { dispatchToolCall } from '../../server.js';
import { SessionManager } from '../../session/manager.js';

const TEST_FEATURE = 'add-odf-intra-paragraph-compare';
const test = it.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../odf-core/src/__fixtures__/sample.odt',
);

const tmpDirs: string[] = [];
afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function tmpdir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-inline-'));
  tmpDirs.push(dir);
  return dir;
}

type Stats = { insertions: number; deletions: number; modifications: number };
type ErrorResult = { success: false; error: { code: string; message: string; hint?: string } };
function assertSuccess(result: Record<string, unknown>, label: string): asserts result is { success: true; [k: string]: unknown } {
  expect(result.success, `${label} failed: ${JSON.stringify((result as ErrorResult).error)}`).toBe(true);
}

/** Copy the fixture twice and apply one in-paragraph replacement to the revised copy. */
async function buildPair(dir: string, oldString: string, newString: string): Promise<{ original: string; revised: string }> {
  const original = path.join(dir, 'original.odt');
  const revised = path.join(dir, 'revised.odt');
  await fs.copyFile(FIXTURE, original);
  await fs.copyFile(FIXTURE, revised);
  const mgr = new SessionManager();
  const edit = await dispatchToolCall(mgr, 'replace_text', {
    file_path: revised,
    target_paragraph_id: 'p2',
    old_string: oldString,
    new_string: newString,
    instruction: 'Apply the revision under test.',
  });
  assertSuccess(edit, 'replace_text');
  const saved = await dispatchToolCall(mgr, 'save', { file_path: revised, save_to_local_path: revised, allow_overwrite: true });
  assertSuccess(saved, 'save');
  return { original, revised };
}

describe('ODF compare_documents — inline granularity surface', () => {
  test.openspec('[OPDI-01] Two-file `.odt` compare reports inline granularity and meaningful modifications')(
    'a one-phrase in-paragraph edit reports granularity inline and modifications >= 1',
    async ({ given, when, then }: AllureBddContext) => {
      let result: Record<string, unknown> = {};
      await given('an original and a revision differing by one phrase inside a paragraph', async () => {
        const dir = await tmpdir();
        const { original, revised } = await buildPair(dir, 'Acme Manufacturing', 'Globex Corporation');
        result = await dispatchToolCall(new SessionManager(), 'compare_documents', {
          original_file_path: original,
          revised_file_path: revised,
          save_to_local_path: path.join(dir, 'redline.odt'),
        });
      });
      await when('the comparison runs', () => {});
      await then('the response reports inline granularity with the pair counted as a modification', () => {
        assertSuccess(result, 'compare_documents');
        expect(result.granularity).toBe('inline');
        const stats = result.stats as Stats;
        expect(stats.modifications).toBeGreaterThanOrEqual(1);
        expect(stats.insertions).toBeGreaterThanOrEqual(1);
        expect(stats.deletions).toBeGreaterThanOrEqual(1);
      });
    },
  );

  test.openspec('[OPDI-02] Whole-paragraph-only diffs still report zero modifications')(
    'a wholesale (dissimilar) paragraph replacement keeps modifications 0',
    async ({ given, then }: AllureBddContext) => {
      let stats: Stats = { insertions: 0, deletions: 0, modifications: 0 };
      await given('a revision whose paragraph shares no words with the original', async () => {
        const dir = await tmpdir();
        const { original, revised } = await buildPair(
          dir,
          'Third paragraph mentions Acme Manufacturing.',
          'Zebras graze quietly under moonlit skies tonight.',
        );
        const result = await dispatchToolCall(new SessionManager(), 'compare_documents', {
          original_file_path: original,
          revised_file_path: revised,
          save_to_local_path: path.join(dir, 'redline.odt'),
        });
        assertSuccess(result, 'compare_documents');
        stats = result.stats as Stats;
      });
      await then('the pair stays a whole-paragraph delete+insert', () => {
        expect(stats.modifications).toBe(0);
        expect(stats.insertions).toBe(1);
        expect(stats.deletions).toBe(1);
      });
    },
  );
});
