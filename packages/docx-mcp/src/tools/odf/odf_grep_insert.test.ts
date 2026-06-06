import { afterEach, describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testAllure as it, type AllureBddContext } from '../../testing/allure-test.js';
import { dispatchToolCall } from '../../server.js';
import { SessionManager } from '../../session/manager.js';

const TEST_FEATURE = 'add-odf-grep-insert';
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

async function copyFixture(name = 'sample.odt'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-gi-'));
  tmpDirs.push(dir);
  const filePath = path.join(dir, name);
  await fs.copyFile(FIXTURE, filePath);
  return filePath;
}

type ErrorResult = { success: false; error: { code: string; message: string; hint?: string } };

function assertSuccess(result: Record<string, unknown>, label: string): asserts result is { success: true; [k: string]: unknown } {
  expect(result.success, `${label} failed: ${JSON.stringify((result as ErrorResult).error)}`).toBe(true);
}
function assertError(result: Record<string, unknown>, code: string): asserts result is ErrorResult {
  expect(result.success).toBe(false);
  expect((result as ErrorResult).error.code).toBe(code);
}

async function firstId(manager: SessionManager, filePath: string): Promise<string> {
  const read = await dispatchToolCall(manager, 'read_file', { file_path: filePath, format: 'json', limit: 500 });
  assertSuccess(read, 'read_file');
  const nodes = JSON.parse(String(read.content)) as Array<{ id: string }>;
  return nodes[0]!.id;
}

describe('ODF grep + insert_paragraph lane', () => {
  test.openspec('[OPLR-06] `grep` searches an ODF session')(
    'grep routes to the ODF handler and returns matches with paragraph IDs',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('a file-first ODF session', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
      });
      await when('grep is called with a pattern on the .odt path', async () => {
        result = await dispatchToolCall(manager, 'grep', { file_path: filePath, pattern: 'quick brown fox' });
      });
      await then('the ODF handler returns matches with a paragraph id and context', () => {
        assertSuccess(result, 'grep');
        expect(result.provider).toBe('odf');
        expect(result.total_matches as number).toBeGreaterThan(0);
        const matches = result.matches as Array<{ para_id: string; context: string; list_label: string; header: string }>;
        expect(matches[0]!.para_id).toMatch(/^p\d+$/);
        expect(matches[0]!.context).toContain('quick brown fox');
        // ODF carries no list-label / header context.
        expect(matches[0]!.list_label).toBe('');
        expect(matches[0]!.header).toBe('');
      });
    },
  );

  test.openspec('[OPLR-07] `insert_paragraph` inserts into an ODF session')(
    'insert_paragraph adds a paragraph and returns ID-invalidation fields',
    async ({ given, when, then, and }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let anchorId: string;
      let result: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('an ODF session with a known anchor paragraph', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
        anchorId = await firstId(manager, filePath);
      });
      await when('insert_paragraph inserts AFTER the anchor', async () => {
        result = await dispatchToolCall(manager, 'insert_paragraph', {
          file_path: filePath,
          positional_anchor_node_id: anchorId,
          new_string: 'Inserted clause from the agent.',
          instruction: 'add a clause',
          position: 'AFTER',
        });
      });
      await then('the response reports the new positional id and ID-invalidation contract', () => {
        assertSuccess(result, 'insert_paragraph');
        expect(result.provider).toBe('odf');
        expect(result.new_paragraph_id as string).toMatch(/^p\d+$/);
        expect(result.invalidates_paragraph_ids_after).toBe(anchorId);
        expect(result.requires_reread_before_next_edit).toBe(true);
      });
      await and('re-reading the document reflects the inserted text', async () => {
        const read = await dispatchToolCall(manager, 'read_file', { file_path: filePath, format: 'json', limit: 500 });
        assertSuccess(read, 'read_file');
        expect(String(read.content)).toContain('Inserted clause from the agent.');
      });
    },
  );

  test.openspec('[OPLR-08] Still-unsupported tools remain guarded')(
    'a tool outside the ODF supported set still returns UNSUPPORTED_FOR_ODF after grep/insert are added',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('an ODF session', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
        await firstId(manager, filePath);
      });
      await when('a still-unsupported tool targets the .odt path', async () => {
        result = await dispatchToolCall(manager, 'add_comment', {
          file_path: filePath,
          target_paragraph_id: 'p0',
          comment_text: 'should be rejected',
          author: 'Jane Doe',
        });
      });
      await then('the provider guard returns UNSUPPORTED_FOR_ODF', () => {
        assertError(result, 'UNSUPPORTED_FOR_ODF');
      });
    },
  );
});

// Branch-coverage tests for the ODF grep + insert handlers.
describe('ODF grep + insert branch coverage', () => {
  it('grep requires a pattern', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'grep', { file_path: filePath });
    assertError(res, 'MISSING_PATTERN');
  });

  it('grep returns zero matches for an absent pattern', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'grep', { file_path: filePath, pattern: 'zzz-not-present-zzz' });
    assertSuccess(res, 'grep');
    expect(res.total_matches).toBe(0);
    expect((res.matches as unknown[]).length).toBe(0);
  });

  it('grep honors dedupe_by_paragraph=false (per-match rows)', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'grep', {
      file_path: filePath,
      pattern: 'o',
      dedupe_by_paragraph: false,
      max_results: 5,
    });
    assertSuccess(res, 'grep per-match');
    expect(res.provider).toBe('odf');
    expect((res.matches as unknown[]).length).toBeLessThanOrEqual(5);
  });

  it('grep supports search_xml over content.xml', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'grep', { file_path: filePath, pattern: 'text:p', search_xml: true });
    assertSuccess(res, 'grep xml');
    expect(res.search_xml).toBe(true);
    expect(res.total_matches as number).toBeGreaterThan(0);
  });

  it('grep supports whole_word matching', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'grep', { file_path: filePath, pattern: 'fox', whole_word: true });
    assertSuccess(res, 'grep whole_word');
    expect(res.total_matches as number).toBeGreaterThan(0);
  });

  it('insert_paragraph rejects an invalid position', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const id = await firstId(manager, filePath);
    const res = await dispatchToolCall(manager, 'insert_paragraph', {
      file_path: filePath,
      positional_anchor_node_id: id,
      new_string: 'x',
      instruction: 'bad position',
      position: 'SIDEWAYS',
    });
    assertError(res, 'INVALID_POSITION');
  });

  it('insert_paragraph reports ANCHOR_NOT_FOUND for an unknown id', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    await firstId(manager, filePath);
    const res = await dispatchToolCall(manager, 'insert_paragraph', {
      file_path: filePath,
      positional_anchor_node_id: 'p99999',
      new_string: 'x',
      instruction: 'bad anchor',
    });
    assertError(res, 'ANCHOR_NOT_FOUND');
  });

  it('insert_paragraph splits blank lines into multiple paragraphs', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const id = await firstId(manager, filePath);
    const res = await dispatchToolCall(manager, 'insert_paragraph', {
      file_path: filePath,
      positional_anchor_node_id: id,
      new_string: 'First inserted.\n\nSecond inserted.',
      instruction: 'two paragraphs',
      position: 'AFTER',
    });
    assertSuccess(res, 'insert multi');
    expect((res.new_paragraph_ids as string[]).length).toBe(2);
  });

  it('insert_paragraph defaults to AFTER and round-trips through save', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const id = await firstId(manager, filePath);
    const ins = await dispatchToolCall(manager, 'insert_paragraph', {
      file_path: filePath,
      positional_anchor_node_id: id,
      new_string: 'Persisted paragraph.',
      instruction: 'default position',
    });
    assertSuccess(ins, 'insert default');
    expect(ins.position).toBe('AFTER');
    const outPath = path.join(path.dirname(filePath), 'inserted.odt');
    const saved = await dispatchToolCall(manager, 'save', { file_path: filePath, save_to_local_path: outPath });
    assertSuccess(saved, 'save inserted');
    const reread = await dispatchToolCall(manager, 'read_file', { file_path: outPath, format: 'json', limit: 500 });
    assertSuccess(reread, 'reread inserted');
    expect(String(reread.content)).toContain('Persisted paragraph.');
  });
});
