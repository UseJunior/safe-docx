import { afterEach, describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testAllure as it, type AllureBddContext } from '../../testing/allure-test.js';
import { dispatchToolCall } from '../../server.js';
import { SessionManager } from '../../session/manager.js';

const TEST_FEATURE = 'add-odf-comments';
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-cm-'));
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

type McpComment = {
  id: number;
  author: string;
  date: string | null;
  initials: string;
  text: string;
  anchored_paragraph_id: string | null;
  replies: McpComment[];
};

describe('ODF add_comment + get_comments lane', () => {
  test.openspec('[OPCM-01] `add_comment` annotates a whole ODF paragraph')(
    'add_comment routes to the ODF handler and anchors a whole-paragraph comment',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('a file-first ODF session', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
      });
      await when('add_comment is called with a .odt path and no anchor_text', async () => {
        result = await dispatchToolCall(manager, 'add_comment', {
          file_path: filePath,
          target_paragraph_id: 'p1',
          author: 'Jane Doe',
          text: 'Whole-paragraph note',
        });
      });
      await then('the ODF handler inserts a root annotation on that paragraph', () => {
        assertSuccess(result, 'add_comment');
        expect(result.provider).toBe('odf');
        expect(result.mode).toBe('root');
        expect(result.anchor_paragraph_id).toBe('p1');
        expect(result.anchor_text).toBeNull();
        expect(typeof result.comment_id).toBe('number');
      });
    },
  );

  test.openspec('[OPCM-02] `add_comment` annotates a substring via `anchor_text`')(
    'add_comment brackets the matched substring and echoes the anchor_text',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('a file-first ODF session', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
      });
      await when('add_comment is called with an anchor_text present once', async () => {
        result = await dispatchToolCall(manager, 'add_comment', {
          file_path: filePath,
          target_paragraph_id: 'p0',
          anchor_text: 'quick brown',
          author: 'Jane Doe',
          text: 'on the phrase',
        });
      });
      await then('the response echoes the anchor_text and the comment is anchored', () => {
        assertSuccess(result, 'add_comment ranged');
        expect(result.provider).toBe('odf');
        expect(result.anchor_text).toBe('quick brown');
        expect(result.anchor_paragraph_id).toBe('p0');
      });
    },
  );

  test.openspec('[OPCM-03] `get_comments` returns ODF annotations')(
    'get_comments returns the added comment with author, body, anchor, and empty replies',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('an ODF session with one comment added', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
        const add = await dispatchToolCall(manager, 'add_comment', {
          file_path: filePath,
          target_paragraph_id: 'p2',
          author: 'Jane Doe',
          text: 'Check this figure',
        });
        assertSuccess(add, 'add_comment');
      });
      await when('get_comments is called on the .odt path', async () => {
        result = await dispatchToolCall(manager, 'get_comments', { file_path: filePath });
      });
      await then('the comment is returned with metadata and no replies', () => {
        assertSuccess(result, 'get_comments');
        expect(result.provider).toBe('odf');
        const comments = result.comments as McpComment[];
        expect(comments).toHaveLength(1);
        expect(comments[0]!.author).toBe('Jane Doe');
        expect(comments[0]!.text).toBe('Check this figure');
        expect(comments[0]!.anchored_paragraph_id).toBe('p2');
        expect(comments[0]!.replies).toEqual([]);
        expect(comments[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      });
    },
  );

  test.openspec('[OPCM-04] Replies are unsupported for ODF')(
    'add_comment with parent_comment_id on a .odt returns UNSUPPORTED_FOR_ODF',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('a file-first ODF session', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
      });
      await when('add_comment is called with a parent_comment_id', async () => {
        result = await dispatchToolCall(manager, 'add_comment', {
          file_path: filePath,
          parent_comment_id: 1,
          author: 'Jane Doe',
          text: 'a reply',
        });
      });
      await then('the ODF handler rejects the reply', () => {
        assertError(result, 'UNSUPPORTED_FOR_ODF');
      });
    },
  );

  test.openspec('[OPCM-05] Missing or ambiguous `anchor_text` is rejected')(
    'add_comment returns TEXT_NOT_FOUND for an absent anchor_text and MULTIPLE_MATCHES for an ambiguous one',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let notFound: Awaited<ReturnType<typeof dispatchToolCall>>;
      let multiple: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('a file-first ODF session', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
      });
      await when('add_comment is called with absent then ambiguous anchor_text', async () => {
        notFound = await dispatchToolCall(manager, 'add_comment', {
          file_path: filePath, target_paragraph_id: 'p0', anchor_text: 'zebra', author: 'A', text: 'x',
        });
        multiple = await dispatchToolCall(manager, 'add_comment', {
          file_path: filePath, target_paragraph_id: 'p0', anchor_text: 'o', author: 'A', text: 'x',
        });
      });
      await then('each rejection carries the right error code', () => {
        assertError(notFound, 'TEXT_NOT_FOUND');
        assertError(multiple, 'MULTIPLE_MATCHES');
      });
    },
  );
});

// Branch-coverage tests for the ODF comment handlers.
describe('ODF comments branch coverage', () => {
  it('add_comment requires target_paragraph_id for root comments', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'add_comment', {
      file_path: filePath, author: 'A', text: 'orphan',
    });
    assertError(res, 'MISSING_PARAMETER');
  });

  it('add_comment returns ANCHOR_NOT_FOUND for an unknown paragraph id', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'add_comment', {
      file_path: filePath, target_paragraph_id: 'p99', author: 'A', text: 'x',
    });
    assertError(res, 'ANCHOR_NOT_FOUND');
  });

  it('comments survive a save → reopen round trip', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const add = await dispatchToolCall(manager, 'add_comment', {
      file_path: filePath, target_paragraph_id: 'p0', anchor_text: 'lazy dog', author: 'Jane Doe', text: 'persisted',
    });
    assertSuccess(add, 'add_comment');
    const savePath = path.join(path.dirname(filePath), 'with-comment.odt');
    const save = await dispatchToolCall(manager, 'save', { file_path: filePath, save_to_local_path: savePath });
    assertSuccess(save, 'save');

    // Reopen the saved file in a fresh manager and confirm the comment reads back.
    const fresh = new SessionManager();
    const got = await dispatchToolCall(fresh, 'get_comments', { file_path: savePath });
    assertSuccess(got, 'get_comments after reopen');
    const comments = got.comments as McpComment[];
    expect(comments).toHaveLength(1);
    expect(comments[0]!.text).toBe('persisted');
    expect(comments[0]!.author).toBe('Jane Doe');
    expect(comments[0]!.anchored_paragraph_id).toBe('p0');
  });

  it('get_comments returns an empty list when there are no annotations', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'get_comments', { file_path: filePath });
    assertSuccess(res, 'get_comments empty');
    expect(res.comments).toEqual([]);
  });
});
