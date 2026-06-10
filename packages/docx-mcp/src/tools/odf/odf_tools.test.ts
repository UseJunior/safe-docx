import { afterEach, describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OdfArchive, OdfDocument } from '@usejunior/odf-core';
import { testAllure as it, type AllureBddContext } from '../../testing/allure-test.js';
import { dispatchToolCall } from '../../server.js';
import { SessionManager } from '../../session/manager.js';
import { openDocument } from '../open_document.js';

const TEST_FEATURE = 'add-odf-core';
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-tools-'));
  tmpDirs.push(dir);
  const filePath = path.join(dir, name);
  await fs.copyFile(FIXTURE, filePath);
  return filePath;
}

type SuccessResult = { success: true; [key: string]: unknown };
type ErrorResult = { success: false; error: { code: string; message: string; hint?: string } };

function assertSuccess(result: Record<string, unknown>, label: string): asserts result is SuccessResult {
  expect(result.success, `${label} failed: ${JSON.stringify((result as ErrorResult).error)}`).toBe(true);
}

function assertError(result: Record<string, unknown>, code: string): asserts result is ErrorResult {
  expect(result.success).toBe(false);
  expect((result as ErrorResult).error.code).toBe(code);
}

async function readSavedParagraphs(filePath: string): Promise<Array<{ id: string; text: string }>> {
  const archive = await OdfArchive.load(await fs.readFile(filePath) as Buffer);
  const doc = OdfDocument.fromContentXml(await archive.getContentXml());
  return doc.getParagraphs();
}

describe('ODF MCP provider lane', () => {
  test.openspec('[OPLR-01] Open a local `.odt`')(
    'open_document creates an ODF session and returns paragraph metadata',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof openDocument>>;

      await given('a real .odt fixture', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
      });
      await when('open_document opens the fixture', async () => {
        result = await openDocument(manager, { file_path: filePath });
      });
      await then('the response reports an ODF provider and paragraphs', () => {
        assertSuccess(result, 'open_document');
        expect(result.provider).toBe('odf');
        expect((result.document as { paragraphs: number }).paragraphs).toBeGreaterThan(0);
      });
    },
  );

  test.openspec('[OPLR-02] Unsupported extensions still rejected')(
    'open_document keeps INVALID_FILE_TYPE for unsupported extensions',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof openDocument>>;

      await given('an unsupported local file', async () => {
        manager = new SessionManager();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-invalid-'));
        tmpDirs.push(dir);
        filePath = path.join(dir, 'bad.rtf');
        await fs.writeFile(filePath, '{\\rtf1 bad}');
      });
      await when('open_document is called', async () => {
        result = await openDocument(manager, { file_path: filePath });
      });
      await then('the extension is rejected with INVALID_FILE_TYPE', () => {
        assertError(result, 'INVALID_FILE_TYPE');
      });
    },
  );

  test.openspec('[OPLR-03] Supported tools route to the ODF handler')(
    'read_file replace_text save get_file_status and close_file use ODF session data',
    async ({ given, when, then, and }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let outputPath: string;
      let paragraphId: string;

      await given('a file-first ODF session', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
        outputPath = path.join(path.dirname(filePath), 'edited.odt');
      });
      await when('read_file auto-opens the ODF document', async () => {
        const read = await dispatchToolCall(manager, 'read_file', { file_path: filePath, format: 'json', limit: 100 });
        assertSuccess(read, 'read_file');
        expect(read.provider).toBe('odf');
        const nodes = JSON.parse(String(read.content)) as Array<{ id: string; text: string }>;
        const target = nodes.find((node) => node.text.includes('quick brown fox'));
        expect(target).toBeTruthy();
        paragraphId = target!.id;
      });
      await and('replace_text edits through the ODF handler', async () => {
        const replaced = await dispatchToolCall(manager, 'replace_text', {
          file_path: filePath,
          target_paragraph_id: paragraphId,
          old_string: 'quick brown fox',
          new_string: 'slow grey cat',
          instruction: 'test ODF replacement',
        });
        assertSuccess(replaced, 'replace_text');
        expect(replaced.provider).toBe('odf');
        expect(replaced.replacements_made).toBe(1);
      });
      await and('get_file_status reports the ODF provider', async () => {
        const status = await dispatchToolCall(manager, 'get_file_status', { file_path: filePath });
        assertSuccess(status, 'get_file_status');
        expect(status.provider).toBe('odf');
        expect(status.session_resolution).toBe('reused');
      });
      await and('save writes a valid .odt package', async () => {
        const saved = await dispatchToolCall(manager, 'save', {
          file_path: filePath,
          save_to_local_path: outputPath,
        });
        assertSuccess(saved, 'save');
        expect(saved.provider).toBe('odf');
        const paragraphs = await readSavedParagraphs(outputPath);
        expect(paragraphs.find((p) => p.id === paragraphId)?.text).toContain('slow grey cat');
      });
      await then('close_file clears the ODF session', async () => {
        const closed = await dispatchToolCall(manager, 'close_file', { file_path: filePath });
        assertSuccess(closed, 'close_file');
        expect(closed.cleared_count).toBe(1);
      });
    },
  );

  test.openspec('[OPLR-04] Unsupported tools are guarded for ODF')(
    'format_layout on an .odt session returns UNSUPPORTED_FOR_ODF before DOCX logic',
    async ({ given, when, then }: AllureBddContext) => {
      // Originally exercised via compare_documents, then add_comment — both became supported
      // (add-odf-compare / add-odf-compare-session / add-odf-comments), so the guard example was
      // re-pointed at format_layout, which remains DOCX-only.
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('an ODF session', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
        const read = await dispatchToolCall(manager, 'read_file', { file_path: filePath });
        assertSuccess(read, 'read_file');
      });
      await when('a DOCX-only tool targets the .odt path', async () => {
        result = await dispatchToolCall(manager, 'format_layout', {
          file_path: filePath,
          page_size: 'LETTER',
        });
      });
      await then('the provider chokepoint returns UNSUPPORTED_FOR_ODF', () => {
        assertError(result, 'UNSUPPORTED_FOR_ODF');
      });
    },
  );

  test.openspec('[OPLR-05] File-first `.odt` auto-opens')(
    'read_file auto-opens an ODF session without prior open_document',
    async ({ given, when, then }: AllureBddContext) => {
      let manager: SessionManager;
      let filePath: string;
      let result: Awaited<ReturnType<typeof dispatchToolCall>>;

      await given('a fresh manager and an .odt file', async () => {
        manager = new SessionManager();
        filePath = await copyFixture();
      });
      await when('read_file is called first', async () => {
        result = await dispatchToolCall(manager, 'read_file', { file_path: filePath, format: 'simple' });
      });
      await then('the ODF resolver opens and reads the file', () => {
        assertSuccess(result, 'read_file');
        expect(result.provider).toBe('odf');
        expect(result.session_resolution).toBe('opened');
        expect(String(result.content)).toContain('quick brown fox');
      });
    },
  );
});

// Branch-coverage tests for the ODF handlers' error/format paths. Plain `it`
// (= testAllure) labeled tests, no OpenSpec mapping — they exercise the handler
// branches the OPLR happy-path scenarios don't reach.
describe('ODF handler branch coverage', () => {
  async function openAndFirstId(manager: SessionManager, filePath: string): Promise<string> {
    const read = await dispatchToolCall(manager, 'read_file', { file_path: filePath, format: 'json', limit: 500 });
    assertSuccess(read, 'read_file');
    const nodes = JSON.parse(String(read.content)) as Array<{ id: string }>;
    return nodes[0]!.id;
  }

  it('read_file rejects an invalid format', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'read_file', { file_path: filePath, format: 'csv' });
    assertError(res, 'INVALID_FORMAT');
  });

  it('read_file renders the simple format', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    // An explicit limit disables the token-budget path so the requested format is honored.
    const res = await dispatchToolCall(manager, 'read_file', { file_path: filePath, format: 'simple', limit: 500 });
    assertSuccess(res, 'read_file simple');
    expect(String(res.content)).toContain('#TOON id | text');
  });

  it('read_file honors limit + offset pagination', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'read_file', { file_path: filePath, offset: 1, limit: 1 });
    assertSuccess(res, 'read_file paginated');
    expect(res.paragraphs_returned).toBe(1);
  });

  it('read_file accepts a negative offset (from end)', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const res = await dispatchToolCall(manager, 'read_file', { file_path: filePath, offset: -1, limit: 1 });
    assertSuccess(res, 'read_file negative offset');
    expect(res.paragraphs_returned).toBe(1);
  });

  it('read_file filters by node_ids', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const id = await openAndFirstId(manager, filePath);
    const res = await dispatchToolCall(manager, 'read_file', { file_path: filePath, node_ids: [id], format: 'json' });
    assertSuccess(res, 'read_file node_ids');
    const nodes = JSON.parse(String(res.content)) as Array<{ id: string }>;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe(id);
  });

  it('replace_text reports TEXT_NOT_FOUND for an absent find string', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const id = await openAndFirstId(manager, filePath);
    const res = await dispatchToolCall(manager, 'replace_text', {
      file_path: filePath,
      target_paragraph_id: id,
      old_string: 'this string is absent from the document',
      new_string: 'x',
      instruction: 'coverage',
    });
    assertError(res, 'TEXT_NOT_FOUND');
  });

  it('replace_text reports ANCHOR_NOT_FOUND for an unknown paragraph id', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    await openAndFirstId(manager, filePath);
    const res = await dispatchToolCall(manager, 'replace_text', {
      file_path: filePath,
      target_paragraph_id: 'p99999',
      old_string: 'anything',
      new_string: 'x',
      instruction: 'coverage',
    });
    assertError(res, 'ANCHOR_NOT_FOUND');
  });

  it('save requires save_to_local_path', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    await openAndFirstId(manager, filePath);
    const res = await dispatchToolCall(manager, 'save', { file_path: filePath });
    assertError(res, 'MISSING_SAVE_PATH');
  });

  it('save blocks overwriting the original without allow_overwrite', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    await openAndFirstId(manager, filePath);
    const res = await dispatchToolCall(manager, 'save', { file_path: filePath, save_to_local_path: filePath });
    assertError(res, 'OVERWRITE_BLOCKED');
  });

  it('read_file reports FILE_NOT_FOUND for a missing .odt path', async () => {
    const manager = new SessionManager();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-missing-'));
    tmpDirs.push(dir);
    const res = await dispatchToolCall(manager, 'read_file', { file_path: path.join(dir, 'nope.odt') });
    assertError(res, 'FILE_NOT_FOUND');
  });

  it('read_file rejects a corrupt .odt (archive-safety guard)', async () => {
    const manager = new SessionManager();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-corrupt-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'corrupt.odt');
    await fs.writeFile(filePath, 'this is not a zip archive');
    const res = await dispatchToolCall(manager, 'read_file', { file_path: filePath });
    expect(res.success).toBe(false);
  });

  it('get_file_status reports an unedited ODF session', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    await openAndFirstId(manager, filePath);
    const res = await dispatchToolCall(manager, 'get_file_status', { file_path: filePath });
    assertSuccess(res, 'get_file_status');
    expect(res.provider).toBe('odf');
    expect(res.edit_count).toBe(0);
  });

  it('open_document rejects a corrupt .odt before creating a session', async () => {
    const manager = new SessionManager();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-corrupt2-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'corrupt.odt');
    await fs.writeFile(filePath, 'not a zip');
    const res = await openDocument(manager, { file_path: filePath });
    expect(res.success).toBe(false);
  });

  it('save writes to a fresh path with allow_overwrite', async () => {
    const manager = new SessionManager();
    const filePath = await copyFixture();
    const id = await openAndFirstId(manager, filePath);
    await dispatchToolCall(manager, 'replace_text', {
      file_path: filePath,
      target_paragraph_id: id,
      old_string: 'quick brown fox',
      new_string: 'slow grey cat',
      instruction: 'coverage save',
    });
    const outPath = path.join(path.dirname(filePath), 'out-overwrite.odt');
    const res = await dispatchToolCall(manager, 'save', {
      file_path: filePath,
      save_to_local_path: outPath,
      allow_overwrite: true,
    });
    assertSuccess(res, 'save allow_overwrite');
    const paragraphs = await readSavedParagraphs(outPath);
    expect(paragraphs.some((p) => p.text.includes('slow grey cat'))).toBe(true);
  });
});
