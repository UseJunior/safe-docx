import { afterEach, describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZipBuffer } from '@usejunior/docx-core';
import { OdfArchive } from '@usejunior/odf-core';

import { testAllure as it, type AllureBddContext } from '../../testing/allure-test.js';
import { dispatchToolCall } from '../../server.js';
import { SessionManager } from '../../session/manager.js';

const TEST_FEATURE = 'add-odf-compare-session';
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-odf-cmp-session-'));
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

/** Edit the session's third paragraph (Acme → Globex) so a compare yields one delete+insert pair. */
async function editSession(manager: SessionManager, filePath: string): Promise<void> {
  const edit = await dispatchToolCall(manager, 'replace_text', {
    file_path: filePath,
    target_paragraph_id: 'p2',
    old_string: 'Acme Manufacturing',
    new_string: 'Globex Corporation',
    instruction: 'Rename the company referenced in the third paragraph.',
  });
  assertSuccess(edit, 'replace_text');
}

async function readContentXml(odtPath: string): Promise<string> {
  const archive = await OdfArchive.load(await fs.readFile(odtPath));
  return archive.getContentXml();
}

/**
 * content.xml exercising serialization-sensitive constructs: text:s, text:tab, text:line-break,
 * text:h, entity-escaped text, and an office:annotation. Used to pin that the raw open-time
 * content.xml is a faithful comparison baseline (a parse→serialize round-trip must not surface
 * phantom changes through any of these).
 */
const SERIALIZATION_SENSITIVE_CONTENT_XML =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"` +
  ` xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"` +
  ` xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.4"><office:body><office:text>` +
  `<text:h text:outline-level="1">Heading &amp; overview</text:h>` +
  `<text:p>Spaced<text:s text:c="3"/>words</text:p>` +
  `<text:p>Tabbed<text:tab/>and<text:line-break/>broken</text:p>` +
  `<text:p>Entities &amp; angles &lt;tag&gt; stay.</text:p>` +
  `<text:p>Annotated<office:annotation><dc:creator>Reviewer</dc:creator>` +
  `<dc:date>2026-06-10T00:00:00</dc:date><text:p>A note.</text:p></office:annotation> body.</text:p>` +
  `</office:text></office:body></office:document-content>`;

/** Write a valid .odt whose content.xml is `contentXml`, reusing the fixture's package shell. */
async function writeOdtWithContent(dir: string, name: string, contentXml: string): Promise<string> {
  const archive = await OdfArchive.load(await fs.readFile(FIXTURE));
  archive.setContentXml(contentXml);
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, new Uint8Array(await archive.save()));
  return filePath;
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

describe('ODF compare_documents session mode', () => {
  test.openspec('[OPCS-01] Session edits produce a tracked-changes redline')(
    'a .odt file_path routes to the ODF session handler and writes a redline of the edits',
    async ({ given, when, then }: AllureBddContext) => {
      let result: Record<string, unknown> = {};
      let out = '';
      await given('a .odt session with one edited paragraph', async () => {
        const dir = await tmpdir();
        const manager = new SessionManager();
        const filePath = await copyFixtureTo(dir, 'session.odt');
        await editSession(manager, filePath);
        out = path.join(dir, 'redline.odt');
        await when('compare_documents runs with the session file_path', async () => {
          result = await dispatchToolCall(manager, 'compare_documents', {
            file_path: filePath,
            save_to_local_path: out,
          });
        });
      });
      await then('an inline-granularity session redline is written', async () => {
        assertSuccess(result, 'compare_documents');
        expect(result.provider).toBe('odf');
        expect(result.mode).toBe('session');
        expect(result.granularity).toBe('inline');
        const stats = result.stats as { insertions: number; deletions: number; modifications: number };
        // The edited paragraph is similar to its original, so it pairs as one modification with
        // its changed spans counted in insertions/deletions (inline granularity, issue #356).
        expect(stats.insertions).toBeGreaterThanOrEqual(1);
        expect(stats.deletions).toBeGreaterThanOrEqual(1);
        expect(stats.modifications).toBe(1);
        const content = await readContentXml(out);
        expect(content).toContain('tracked-changes');
        // Inline granularity brackets each replaced word, so change markers sit between the two
        // inserted words in the raw XML — assert them individually, not as one substring.
        expect(content).toContain('Globex');
        expect(content).toContain('Corporation');
      });
    },
  );

  test.openspec('[OPCS-02] An unedited session produces an empty redline')(
    'no-op compares yield zero stats, including on serialization-sensitive content',
    async ({ given, then }: AllureBddContext) => {
      const allStats: Array<{ insertions: number; deletions: number; modifications: number }> = [];
      await given('unedited sessions over the sample fixture and a serialization-sensitive .odt', async () => {
        const dir = await tmpdir();
        for (const filePath of [
          await copyFixtureTo(dir, 'plain.odt'),
          await writeOdtWithContent(dir, 'sensitive.odt', SERIALIZATION_SENSITIVE_CONTENT_XML),
        ]) {
          const result = await dispatchToolCall(new SessionManager(), 'compare_documents', {
            file_path: filePath,
            save_to_local_path: path.join(dir, `redline-${path.basename(filePath)}`),
          });
          assertSuccess(result, `compare_documents (${path.basename(filePath)})`);
          allStats.push(result.stats as (typeof allStats)[number]);
        }
      });
      await then('both compares succeed with zero insertions, deletions, and modifications', () => {
        for (const stats of allStats) {
          expect(stats).toEqual({ insertions: 0, deletions: 0, modifications: 0 });
        }
      });
    },
  );

  test.openspec('[OPCS-03] The session redline reopens with deleted content out-of-line')(
    'the redline shows the revised text and does not leak the deleted original text',
    async ({ given, then }: AllureBddContext) => {
      let content = '';
      await given('a session redline produced from a one-paragraph modification', async () => {
        const dir = await tmpdir();
        const manager = new SessionManager();
        const filePath = await copyFixtureTo(dir, 'session.odt');
        await editSession(manager, filePath);
        const out = path.join(dir, 'redline.odt');
        const result = await dispatchToolCall(manager, 'compare_documents', {
          file_path: filePath,
          save_to_local_path: out,
        });
        assertSuccess(result, 'compare_documents');
        // read_file reopens the redline through OdfDocument (which skips text:tracked-changes).
        const reread = await dispatchToolCall(new SessionManager(), 'read_file', { file_path: out });
        assertSuccess(reread, 'read_file');
        content = String(reread.content ?? '');
      });
      await then('the body shows the revised text and the deleted original stays out-of-line', () => {
        expect(content).toContain('quick brown fox'); // unchanged paragraph preserved
        expect(content).toContain('Globex Corporation'); // revised paragraph
        expect(content).not.toContain('Acme Manufacturing'); // deleted content stays out-of-line
      });
    },
  );

  test.openspec("[OPCS-04] Output path may not overwrite the session's original")(
    'save_to_local_path resolving to the session original is rejected',
    async ({ given, then }: AllureBddContext) => {
      let result: Record<string, unknown> = {};
      let filePath = '';
      let originalBytes = Buffer.alloc(0);
      await given('a session compare whose save_to_local_path equals the session original', async () => {
        const dir = await tmpdir();
        const manager = new SessionManager();
        filePath = await copyFixtureTo(dir, 'session.odt');
        originalBytes = Buffer.from(await fs.readFile(filePath));
        await editSession(manager, filePath);
        result = await dispatchToolCall(manager, 'compare_documents', {
          file_path: filePath,
          save_to_local_path: filePath,
        });
      });
      await then('OVERWRITE_BLOCKED is returned and the original file is untouched', async () => {
        assertError(result, 'OVERWRITE_BLOCKED');
        expect(Buffer.compare(originalBytes, await fs.readFile(filePath))).toBe(0);
      });
    },
  );

  test.openspec('[OPCS-05] Session-resolution metadata is attached')(
    'a fresh path reports opened; a pre-edited session reports reused with context',
    async ({ given, when, then }: AllureBddContext) => {
      let opened: Record<string, unknown> = {};
      let reused: Record<string, unknown> = {};
      const manager = new SessionManager();
      let dir = '';
      let filePath = '';
      await given('a never-opened .odt path', async () => {
        dir = await tmpdir();
        filePath = await copyFixtureTo(dir, 'session.odt');
        opened = await dispatchToolCall(manager, 'compare_documents', {
          file_path: filePath,
          save_to_local_path: path.join(dir, 'noop.odt'),
        });
      });
      await when('the session is edited and compared again', async () => {
        await editSession(manager, filePath);
        reused = await dispatchToolCall(manager, 'compare_documents', {
          file_path: filePath,
          save_to_local_path: path.join(dir, 'redline.odt'),
        });
      });
      await then('the first compare opened a session and the second reused it with context', () => {
        assertSuccess(opened, 'compare_documents (opened)');
        expect(opened.session_resolution).toBe('opened');
        expect(opened.resolved_file_path).toBeDefined();
        assertSuccess(reused, 'compare_documents (reused)');
        expect(reused.session_resolution).toBe('reused');
        const context = reused.reused_session_context as { edit_count: number } | undefined;
        expect(context).toBeDefined();
        expect(context!.edit_count).toBeGreaterThanOrEqual(1);
      });
    },
  );

  test.openspec('[OPCS-06] Comparison does not mutate the live session')(
    'a save after compare writes the edited document without tracked-changes markup',
    async ({ given, when, then }: AllureBddContext) => {
      let savedContent = '';
      await given('a .odt session with one edit that has been compared', async () => {
        const dir = await tmpdir();
        const manager = new SessionManager();
        const filePath = await copyFixtureTo(dir, 'session.odt');
        await editSession(manager, filePath);
        const compared = await dispatchToolCall(manager, 'compare_documents', {
          file_path: filePath,
          save_to_local_path: path.join(dir, 'redline.odt'),
        });
        assertSuccess(compared, 'compare_documents');
        await when('the session is saved', async () => {
          const out = path.join(dir, 'saved.odt');
          const saved = await dispatchToolCall(manager, 'save', { file_path: filePath, save_to_local_path: out });
          assertSuccess(saved, 'save');
          savedContent = await readContentXml(out);
        });
      });
      await then('the saved document has the edits and no redline markup', () => {
        expect(savedContent).toContain('Globex Corporation');
        expect(savedContent).not.toContain('Acme Manufacturing');
        expect(savedContent).not.toContain('tracked-changes');
      });
    },
  );

  test.openspec('[OPCS-07] Two-file mode keeps precedence over a stray `file_path`')(
    'two .docx inputs plus a stray .odt file_path still run the DOCX two-file comparison',
    async ({ given, then }: AllureBddContext) => {
      let result: Record<string, unknown> = {};
      await given('two .docx inputs and an unrelated .odt file_path', async () => {
        const dir = await tmpdir();
        const original = await writeTestDocx(dir, 'a.docx', ['Hello world']);
        const revised = await writeTestDocx(dir, 'b.docx', ['Hello brave new world']);
        const strayOdt = await copyFixtureTo(dir, 'stray.odt');
        result = await dispatchToolCall(new SessionManager(), 'compare_documents', {
          original_file_path: original,
          revised_file_path: revised,
          file_path: strayOdt,
          save_to_local_path: path.join(dir, 'out.docx'),
        });
      });
      await then('the DOCX two-file comparison runs and no ODF session logic is involved', () => {
        assertSuccess(result, 'compare_documents');
        expect(result.mode).toBe('two_file');
        expect(result.engine_used).toBeDefined();
        expect(result.provider).not.toBe('odf');
        expect(result.session_resolution).toBeUndefined();
      });
    },
  );
});
