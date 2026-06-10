import { afterEach, describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZipBuffer } from '@usejunior/docx-core';

import { testAllure as it, type AllureBddContext } from '../../testing/allure-test.js';
import { dispatchToolCall } from '../../server.js';
import { SessionManager } from '../../session/manager.js';

const TEST_FEATURE = 'add-odf-compare';
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-cmp-'));
  tmpDirs.push(dir);
  return dir;
}

async function copyFixtureTo(dir: string, name: string): Promise<string> {
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

const SMALL_DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const SMALL_DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
async function writeTestDocx(dir: string, name: string, paragraphs: string[]): Promise<string> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    paragraphs.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('') +
    `</w:body></w:document>`;
  const buf = await createZipBuffer({
    '[Content_Types].xml': SMALL_DOCX_CONTENT_TYPES,
    '_rels/.rels': SMALL_DOCX_RELS,
    'word/document.xml': documentXml,
  });
  const p = path.join(dir, name);
  await fs.writeFile(p, new Uint8Array(buf));
  return p;
}

/** Make a revised .odt using a single manager (edits persist to the saved file). */
async function buildOriginalAndRevised(dir: string): Promise<{ original: string; revised: string }> {
  const original = await copyFixtureTo(dir, 'original.odt');
  const revised = await copyFixtureTo(dir, 'revised.odt');
  const mgr = new SessionManager();
  const edit = await dispatchToolCall(mgr, 'replace_text', {
    file_path: revised,
    target_paragraph_id: 'p2',
    old_string: 'Acme Manufacturing',
    new_string: 'Globex Corporation',
    instruction: 'Rename the company referenced in the third paragraph.',
  });
  assertSuccess(edit, 'replace_text');
  const saved = await dispatchToolCall(mgr, 'save', { file_path: revised, save_to_local_path: revised, allow_overwrite: true });
  assertSuccess(saved, 'save');
  return { original, revised };
}

describe('ODF compare_documents lane (two-file, paragraph granularity)', () => {
  test.openspec('[OPCD-01] Two-file `.odt` compare produces a redline')(
    'compare_documents routes to the ODF handler and writes a tracked-changes .odt',
    async ({ given, when, then }: AllureBddContext) => {
      let dir = '';
      let result: Record<string, unknown> = {};
      let out = '';
      await given('an original and a revised .odt that differ by one paragraph', async () => {
        dir = await tmpdir();
        const { original, revised } = await buildOriginalAndRevised(dir);
        out = path.join(dir, 'redline.odt');
        result = await dispatchToolCall(new SessionManager(), 'compare_documents', {
          original_file_path: original,
          revised_file_path: revised,
          save_to_local_path: out,
        });
      });
      await when('the comparison runs', () => {});
      await then('the ODF handler writes a paragraph-granularity redline .odt', async () => {
        assertSuccess(result, 'compare_documents');
        expect(result.provider).toBe('odf');
        expect(result.mode).toBe('two_file');
        expect(result.granularity).toBe('paragraph');
        const stat = await fs.stat(out);
        expect(stat.size).toBeGreaterThan(0);
      });
    },
  );

  test.openspec('[OPCD-02] Inserted and deleted paragraphs are counted')(
    'a modified paragraph counts as one deletion and one insertion (modifications 0)',
    async ({ given, then }: AllureBddContext) => {
      let stats: { insertions: number; deletions: number; modifications: number } = { insertions: 0, deletions: 0, modifications: 0 };
      await given('a compare of an original vs a one-paragraph-modified revision', async () => {
        const dir = await tmpdir();
        const { original, revised } = await buildOriginalAndRevised(dir);
        const result = await dispatchToolCall(new SessionManager(), 'compare_documents', {
          original_file_path: original,
          revised_file_path: revised,
          save_to_local_path: path.join(dir, 'redline.odt'),
        });
        assertSuccess(result, 'compare_documents');
        stats = result.stats as typeof stats;
      });
      await then('insertions and deletions are each at least 1 and modifications is 0', () => {
        expect(stats.insertions).toBeGreaterThanOrEqual(1);
        expect(stats.deletions).toBeGreaterThanOrEqual(1);
        expect(stats.modifications).toBe(0);
      });
    },
  );

  test.openspec('[OPCD-03] DOCX two-file compare is unchanged')(
    'two .docx inputs run the DOCX comparison and return the DOCX response shape',
    async ({ given, then }: AllureBddContext) => {
      let result: Record<string, unknown> = {};
      await given('two .docx files', async () => {
        const dir = await tmpdir();
        const original = await writeTestDocx(dir, 'a.docx', ['Hello world']);
        const revised = await writeTestDocx(dir, 'b.docx', ['Hello brave new world']);
        result = await dispatchToolCall(new SessionManager(), 'compare_documents', {
          original_file_path: original,
          revised_file_path: revised,
          save_to_local_path: path.join(dir, 'out.docx'),
        });
      });
      await then('the DOCX engine runs (engine_used present) and no ODF granularity is set', () => {
        assertSuccess(result, 'compare_documents');
        expect(result.engine_used).toBeDefined();
        expect(result.granularity).toBeUndefined();
        expect(result.provider).not.toBe('odf');
      });
    },
  );

  test.openspec('[OPCD-04] Still-unsupported tools remain guarded for ODF sessions')(
    'accept_changes against an open .odt session returns UNSUPPORTED_FOR_ODF',
    async ({ given, when, then }: AllureBddContext) => {
      // Session-mode .odt compare became supported in add-odf-compare-session; this scenario was
      // re-pointed at a still-unsupported tool (the same flip OPLR-08 got when two-file compare
      // landed). Session-mode compare coverage lives in odf_compare_session.test.ts (OPCS-*).
      let result: Record<string, unknown> = {};
      const manager = new SessionManager();
      let odt = '';
      await given('an open .odt session', async () => {
        const dir = await tmpdir();
        odt = await copyFixtureTo(dir, 'session.odt');
        const read = await dispatchToolCall(manager, 'read_file', { file_path: odt });
        assertSuccess(read, 'read_file');
      });
      await when('a still-unsupported tool targets the session', async () => {
        result = await dispatchToolCall(manager, 'accept_changes', { file_path: odt });
      });
      await then('UNSUPPORTED_FOR_ODF is returned', () => {
        assertError(result, 'UNSUPPORTED_FOR_ODF');
      });
    },
  );

  test.openspec('[OPCD-05] The redline reopens with the changes preserved')(
    'the redline parses back: unchanged paragraphs preserved, deleted content does not leak',
    async ({ given, then }: AllureBddContext) => {
      let content = '';
      await given('a redline produced from a one-paragraph modification', async () => {
        const dir = await tmpdir();
        const { original, revised } = await buildOriginalAndRevised(dir);
        const out = path.join(dir, 'redline.odt');
        const result = await dispatchToolCall(new SessionManager(), 'compare_documents', {
          original_file_path: original,
          revised_file_path: revised,
          save_to_local_path: out,
        });
        assertSuccess(result, 'compare_documents');
        // read_file reopens the redline through OdfDocument (which skips text:tracked-changes).
        const reread = await dispatchToolCall(new SessionManager(), 'read_file', { file_path: out });
        assertSuccess(reread, 'read_file');
        content = String(reread.content ?? '');
      });
      await then('the body shows the revised text and the deleted original text does not leak', () => {
        expect(content).toContain('quick brown fox'); // unchanged paragraph preserved
        expect(content).toContain('Globex Corporation'); // revised paragraph
        expect(content).not.toContain('Acme Manufacturing'); // deleted content stays out-of-line
      });
    },
  );

  test.openspec('[OPCD-06] Output path may not overwrite a source')(
    'save_to_local_path resolving to a source file is rejected',
    async ({ given, then }: AllureBddContext) => {
      let result: Record<string, unknown> = {};
      let original = '';
      await given('a compare whose save_to_local_path equals the original source', async () => {
        const dir = await tmpdir();
        const built = await buildOriginalAndRevised(dir);
        original = built.original;
        result = await dispatchToolCall(new SessionManager(), 'compare_documents', {
          original_file_path: original,
          revised_file_path: built.revised,
          save_to_local_path: original,
        });
      });
      await then('OVERWRITE_BLOCKED is returned and the source is untouched', () => {
        assertError(result, 'OVERWRITE_BLOCKED');
      });
    },
  );
});
