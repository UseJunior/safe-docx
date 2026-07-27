import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { DocxDocument } from '@usejunior/docx-core';
import { openDocument } from './tools/open_document.js';
import { readFile } from './tools/read_file.js';
import { grep } from './tools/grep.js';
import { replaceText } from './tools/replace_text.js';
import { insertParagraph } from './tools/insert_paragraph.js';
import { save } from './tools/save.js';
import { getFileStatus } from './tools/get_file_status.js';
import { MCP_TOOLS, MCP_TRANSPORT } from './server.js';
import {
  extractParaIdsFromToon,
  firstParaIdFromToon,
  makeDocxWithDocumentXml,
  makeMinimalDocx,
  readDocumentXmlFromPath,
} from './testing/docx_test_utils.js';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { openSession, assertSuccess, registerCleanup, createTrackedTempDir, createTestSessionManager } from './testing/session-test-utils.js';

type ToolName = (typeof MCP_TOOLS)[number]['name'];

interface ToolDocMetadata {
  document?: { filename?: string; paragraphs?: number };
  save_defaults?: { default_save_format?: string };
}

interface PackageJsonMetadata {
  name?: string;
  bin?: Record<string, string>;
  main?: string;
  types?: string;
  publishConfig?: { access?: string };
  repository?: { url?: string };
  license?: string;
}

const TEST_FEATURE = 'add-typescript-mcp-server';

describe('TypeScript MCP server behavior', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });

  registerCleanup();

  humanReadableTest.openspec('Zero-friction installation on Claude Desktop')('Scenario: Zero-friction installation on Claude Desktop + core tools registered', async () => {
    const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as PackageJsonMetadata;

    expect(pkg.name).toBe('@usejunior/docx-mcp');
    expect(pkg.bin?.['safe-docx']).toBe('dist/cli.js');
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.publishConfig?.access).toBe('public');

    const toolNames = new Set(MCP_TOOLS.map((t) => t.name));
    const expectedToolNames = [
      'read_file',
      'grep',
      'batch_edit',
      'replace_text',
      'insert_paragraph',
      'format_layout',
      'format_numbering',
      'save',
      'has_tracked_changes',
      'get_file_status',
    ] as const satisfies ReadonlyArray<ToolName>;
    for (const expected of expectedToolNames) {
      expect(toolNames.has(expected)).toBe(true);
    }
  });

  humanReadableTest.openspec('NPM package availability')('Scenario: NPM package availability metadata includes type definitions', async () => {
    const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as PackageJsonMetadata;
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.repository?.url?.toLowerCase()).toContain('github.com/usejunior/safe-docx');
    expect(pkg.license).toBe('Apache-2.0');
  });

  humanReadableTest.openspec('Read-only tools annotated correctly')('Scenario: Read-only tools annotated correctly', async () => {
    const readOnlyTools = new Set(['read_file', 'grep', 'has_tracked_changes', 'get_file_status']);
    for (const tool of MCP_TOOLS) {
      if (!readOnlyTools.has(tool.name)) continue;
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  humanReadableTest.openspec('Destructive tools annotated correctly')('Scenario: Destructive tools annotated correctly', async () => {
    const destructiveTools = new Set(['batch_edit', 'replace_text', 'insert_paragraph', 'format_layout', 'format_numbering', 'save']);
    for (const tool of MCP_TOOLS) {
      if (!destructiveTools.has(tool.name)) continue;
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.annotations.destructiveHint).toBe(true);
    }
  });

  humanReadableTest.openspec('Session creation')('Scenario: Session creation', async () => {
    const mgr = createTestSessionManager();
    const { inputPath } = await openSession(['Hello world'], { mgr });

    const status = await getFileStatus(mgr, { file_path: inputPath });
    assertSuccess(status, 'status');
    const statusMeta = status as typeof status & ToolDocMetadata;
    expect(statusMeta.document?.filename).toContain('.docx');
    expect(statusMeta.save_defaults?.default_save_format).toBe('both');
  });

  humanReadableTest.openspec('Session expiration auto-reopens')('Scenario: Session expiration auto-reopens', async () => {
    const mgr = createTestSessionManager({ ttlMs: 5 });
    const { inputPath } = await openSession(['Hello world'], { mgr });
    await sleep(15);
    // With file-path-only API, expired sessions auto-reopen from the file
    const read = await readFile(mgr, { file_path: inputPath });
    expect(read.success).toBe(true);
    expect(read.session_resolution).toBe('opened');
  });

  humanReadableTest.openspec('Concurrent sessions')('Scenario: Concurrent sessions', async () => {
    const mgr = createTestSessionManager();
    const a = await openSession(['Alpha value'], { mgr });
    const b = await openSession(['Beta value'], { mgr });

    const editA = await replaceText(mgr, {
      file_path: a.inputPath,
      target_paragraph_id: a.firstParaId,
      old_string: 'Alpha',
      new_string: 'AlphaX',
      instruction: 'independent session edit',
    });
    expect(editA.success).toBe(true);

    const readA = await readFile(mgr, { file_path: a.inputPath, node_ids: [a.firstParaId] });
    const readB = await readFile(mgr, { file_path: b.inputPath, node_ids: [b.firstParaId] });
    assertSuccess(readA, 'readA');
    assertSuccess(readB, 'readB');
    expect(String(readA.content)).toContain('AlphaX value');
    expect(String(readB.content)).toContain('Beta value');
  });

  humanReadableTest.openspec('macOS compatibility')('Scenario: macOS compatibility (~ path expansion + stdio transport)', async () => {
    const mgr = createTestSessionManager();
    const tempHome = await createTrackedTempDir('safe-docx-home-');
    const inputName = 'tilde-open.docx';
    const inputPath = path.join(tempHome, inputName);
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Home relative path'])));

    const prevHome = process.env.HOME;
    process.env.HOME = tempHome;
    try {
      const opened = await openDocument(mgr, { file_path: `~/${inputName}` });
      expect(opened.success).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
    expect(MCP_TRANSPORT).toBe('stdio');
  });

  humanReadableTest.openspec('Windows compatibility')('Scenario: Windows compatibility (backslash path handling + stdio transport)', async ({ and }: AllureBddContext) => {
    expect(MCP_TRANSPORT).toBe('stdio');
    if (process.platform !== 'win32') {
      await and('Non-Windows runner: backslash path behavior validated in win32 CI only', async () => {});
      return;
    }

    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-win-path-');
    const posixPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(posixPath, new Uint8Array(await makeMinimalDocx(['Windows path input'])));
    const windowsPath = posixPath.replaceAll('/', '\\');

    const opened = await openDocument(mgr, { file_path: windowsPath });
    expect(opened.success).toBe(true);
  });

  humanReadableTest.openspec('File not found error')('Scenario: File not found error', async () => {
    const mgr = createTestSessionManager();
    const opened = await openDocument(mgr, { file_path: '/definitely/not/found/input.docx' });
    expect(opened.success).toBe(false);
    if (opened.success) throw new Error('expected FILE_NOT_FOUND');
    expect(opened.error.code).toBe('FILE_NOT_FOUND');
  });

  humanReadableTest.openspec('Invalid file type error')('Scenario: Invalid file type error', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-invalid-type-');
    const txtPath = path.join(tmpDir, 'input.txt');
    await fs.writeFile(txtPath, 'plain text');

    const opened = await openDocument(mgr, { file_path: txtPath });
    expect(opened.success).toBe(false);
    if (opened.success) throw new Error('expected INVALID_FILE_TYPE');
    expect(opened.error.code).toBe('INVALID_FILE_TYPE');
  });

  humanReadableTest.openspec('File not found error')('Scenario: File not found error', async () => {
    const mgr = createTestSessionManager();
    const res = await readFile(mgr, { file_path: '/nonexistent/path/to/doc.docx' });
    expect(res.success).toBe(false);
    if (res.success) throw new Error('expected FILE_NOT_FOUND');
    expect(res.error.code).toBe('FILE_NOT_FOUND');
  });

  humanReadableTest.openspec('open_document tool')('Scenario: open_document tool', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-open-tool-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Open tool paragraph'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    expect(String(opened.file_path)).toBeTruthy();
    const openMeta = opened as typeof opened & ToolDocMetadata;
    expect(openMeta.document?.filename).toBe('input.docx');
    expect(typeof openMeta.document?.paragraphs).toBe('number');
  });

  humanReadableTest.openspec('read_file tool')('Scenario: read_file tool', async () => {
    const mgr = createTestSessionManager();
    const { inputPath } = await openSession(['Read tool paragraph'], { mgr });
    const read = await readFile(mgr, { file_path: inputPath, format: 'simple' });
    assertSuccess(read, 'read');
    expect(read.total_paragraphs).toBeGreaterThan(0);
    expect(read.paragraphs_returned).toBeGreaterThan(0);
    expect(typeof read.has_more).toBe('boolean');
  });

  humanReadableTest.openspec('grep tool')('Scenario: grep tool', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-grep-tool-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(
      inputPath,
      new Uint8Array(await makeMinimalDocx(['Alpha term appears here', 'No match paragraph'])),
    );

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const res = await grep(mgr, { file_path: inputPath, patterns: ['Alpha'] });
    assertSuccess(res, 'grep');
    expect(res.total_matches).toBe(1);
    expect(Array.isArray(res.matches)).toBe(true);
    expect(String((res.matches as Array<{ para_id: string }>)[0]?.para_id)).toMatch(/^_bk_[0-9a-f]{12}$/);
    expect(Number((res.matches as Array<{ para_index_1based: number }>)[0]?.para_index_1based)).toBe(1);
    expect(Number((res.matches as Array<{ match_count_in_paragraph: number }>)[0]?.match_count_in_paragraph)).toBe(1);
    expect(typeof (res.matches as Array<{ list_label: string }>)[0]?.list_label).toBe('string');
    expect(typeof (res.matches as Array<{ header: string }>)[0]?.header).toBe('string');
  });

  humanReadableTest.openspec('replace_text tool')('Scenario: replace_text tool', async () => {
    const mgr = createTestSessionManager();
    const { inputPath, firstParaId: paraId } = await openSession(['Edit me'], { mgr });
    const edited = await replaceText(mgr, {
      file_path: inputPath,
      target_paragraph_id: paraId,
      old_string: 'Edit',
      new_string: 'Update',
      instruction: 'tool behavior test',
    });
    assertSuccess(edited, 'edit');
    expect(edited.replacements_made).toBe(1);
  });

  humanReadableTest.openspec('insert_paragraph tool')('Scenario: insert_paragraph tool', async () => {
    const mgr = createTestSessionManager();
    const { inputPath, firstParaId: paraId } = await openSession(['Anchor paragraph'], { mgr });
    const inserted = await insertParagraph(mgr, {
      file_path: inputPath,
      positional_anchor_node_id: paraId,
      new_string: 'Inserted paragraph',
      instruction: 'tool behavior test',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert');
    expect(String(inserted.new_paragraph_id)).toMatch(/^_bk_[0-9a-f]{12}$/);
  });

  humanReadableTest.openspec('download tool')('Scenario: download tool', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-download-tool-');
    const inputPath = path.join(tmpDir, 'input.docx');
    const outputPath = path.join(tmpDir, 'out.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Download paragraph'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');

    const saved = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outputPath,
      save_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(saved, 'save');
    await expect(fs.stat(outputPath)).resolves.toBeTruthy();
  });

  humanReadableTest.openspec('get_file_status tool')('Scenario: get_file_status tool', async () => {
    const mgr = createTestSessionManager();
    const { inputPath } = await openSession(['Status paragraph'], { mgr });
    const status = await getFileStatus(mgr, { file_path: inputPath });
    assertSuccess(status, 'status');
    expect(status.file_path).toBe(inputPath);
    expect(typeof status.edit_count).toBe('number');
    expect(typeof status.edit_revision).toBe('number');
  });

  humanReadableTest.openspec('Format-preserving text replacement')('Scenario: Format-preserving text replacement + bookmark-based targeting', async () => {
    const mgr = createTestSessionManager();
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Repeated text.</w:t></w:r></w:p>` +
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Repeated text.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-formatting-');
    const inputPath = path.join(tmpDir, 'input.docx');
    const outputPath = path.join(tmpDir, 'output.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const filePath = opened.file_path as string;

    const before = await readFile(mgr, { file_path: inputPath, format: 'simple' });
    assertSuccess(before, 'read before');
    const ids = extractParaIdsFromToon(String(before.content));
    expect(ids.length).toBe(2);

    const edit = await replaceText(mgr, {
      file_path: inputPath,
      target_paragraph_id: ids[1]!,
      old_string: 'Repeated',
      new_string: 'Updated',
      instruction: 'target only second paragraph',
    });
    expect(edit.success).toBe(true);

    const afterFirst = await readFile(mgr, { file_path: inputPath, node_ids: [ids[0]!], format: 'simple' });
    const afterSecond = await readFile(mgr, { file_path: inputPath, node_ids: [ids[1]!], format: 'simple' });
    assertSuccess(afterFirst, 'read after first');
    assertSuccess(afterSecond, 'read after second');
    expect(String(afterFirst.content)).toContain('Repeated text.');
    expect(String(afterSecond.content)).toContain('Updated text.');

    const saved = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outputPath,
      save_format: 'clean',
      clean_bookmarks: true,
    });
    expect(saved.success).toBe(true);

    const outBuf = await fs.readFile(outputPath);
    await expect(DocxDocument.load(outBuf as Buffer)).resolves.toBeTruthy();
    const outXml = await readDocumentXmlFromPath(outputPath);
    expect(outXml.includes('<w:b')).toBe(true);
  });

  humanReadableTest.openspec('Bookmark-based targeting')('Scenario: Bookmark-based targeting', async () => {
    const mgr = createTestSessionManager();
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Duplicate paragraph text</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Duplicate paragraph text</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const tmpDir = await createTrackedTempDir('safe-docx-bookmark-target-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(xml)));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');

    const before = await readFile(mgr, { file_path: inputPath, format: 'simple' });
    assertSuccess(before, 'read before');
    const ids = extractParaIdsFromToon(String(before.content));
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);

    const edited = await replaceText(mgr, {
      file_path: inputPath,
      target_paragraph_id: ids[1]!,
      old_string: 'Duplicate',
      new_string: 'Updated',
      instruction: 'bookmark targeting validation',
    });
    expect(edited.success).toBe(true);

    const firstOnly = await readFile(mgr, { file_path: inputPath, node_ids: [ids[0]!], format: 'simple' });
    const secondOnly = await readFile(mgr, { file_path: inputPath, node_ids: [ids[1]!], format: 'simple' });
    assertSuccess(firstOnly, 'read first');
    assertSuccess(secondOnly, 'read second');
    expect(String(firstOnly.content)).toContain('Duplicate paragraph text');
    expect(String(secondOnly.content)).toContain('Updated paragraph text');
  });

  humanReadableTest.openspec('No XML corruption')('Scenario: No XML corruption after edit + insert + download workflow', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-ooxml-');
    const inputPath = path.join(tmpDir, 'input.docx');
    const outPath = path.join(tmpDir, 'output.docx');
    await fs.writeFile(inputPath, new Uint8Array(await makeMinimalDocx(['Hello world'])));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');

    const read = await readFile(mgr, { file_path: inputPath });
    assertSuccess(read, 'read');
    const paraId = firstParaIdFromToon(String(read.content));

    const edited = await replaceText(mgr, {
      file_path: inputPath,
      target_paragraph_id: paraId,
      old_string: 'Hello',
      new_string: 'Hi',
      instruction: 'xml integrity',
    });
    expect(edited.success).toBe(true);

    const inserted = await insertParagraph(mgr, {
      file_path: inputPath,
      positional_anchor_node_id: paraId,
      new_string: 'Inserted paragraph',
      instruction: 'xml integrity insert',
      position: 'AFTER',
    });
    expect(inserted.success).toBe(true);

    const searched = await grep(mgr, { file_path: inputPath, patterns: ['Inserted'] });
    assertSuccess(searched, 'grep');
    expect(Number((searched as { total_matches?: number }).total_matches)).toBe(1);

    const saved = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outPath,
      save_format: 'clean',
      clean_bookmarks: true,
    });
    expect(saved.success).toBe(true);
    const outBuf = await fs.readFile(outPath);
    await expect(DocxDocument.load(outBuf as Buffer)).resolves.toBeTruthy();
  });
});
