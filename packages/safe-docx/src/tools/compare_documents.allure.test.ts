import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

import { compareDocuments_tool } from './compare_documents.js';
import { smartEdit } from './smart_edit.js';
import { MCP_TOOLS } from '../server.js';
import { testAllure, allureStep, allureJsonAttachment } from '../testing/allure-test.js';
import {
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
  openSession,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-typescript-mcp-server';

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function xmlEscape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function makeCompleteDocx(paragraphs: string[]): Promise<Buffer> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    paragraphs.map((t) => `<w:p><w:r><w:t>${xmlEscape(t)}</w:t></w:r></w:p>`).join('') +
    `</w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', RELS_XML);
  zip.file('word/document.xml', documentXml);
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

async function writeTestDocx(dir: string, name: string, paragraphs: string[]): Promise<string> {
  const buf = await makeCompleteDocx(paragraphs);
  const p = path.join(dir, name);
  await fs.writeFile(p, new Uint8Array(buf));
  return p;
}

describe('compare_documents tool', () => {
  const test = testAllure.epic('Download & Export').withLabels({ feature: TEST_FEATURE });
  registerCleanup();

  // ── Two-file mode ────────────────────────────────────────────────

  test(
    'Two-file mode: compares two DOCX files and writes redline',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const originalPath = await writeTestDocx(dir, 'original.docx', ['Hello world']);
      const revisedPath = await writeTestDocx(dir, 'revised.docx', ['Hello brave new world']);
      const outputPath = path.join(dir, 'redline.docx');

      const result = await allureStep('Call compare_documents (two-file)', () =>
        compareDocuments_tool(mgr, {
          original_file_path: originalPath,
          revised_file_path: revisedPath,
          save_to_local_path: outputPath,
        }),
      );
      assertSuccess(result, 'compare_documents');
      await allureJsonAttachment('result', result);

      await allureStep('Redline file written to disk', async () => {
        const stat = await fs.stat(outputPath);
        expect(stat.isFile()).toBe(true);
        expect(stat.size).toBeGreaterThan(0);
      });

      await allureStep('Response includes stats and file info', () => {
        expect(result.mode).toBe('two_file');
        expect(result.stats).toBeDefined();
        expect(result.saved_to).toBe(outputPath);
        expect(result.size_bytes).toBeGreaterThan(0);
        expect(result.engine_used).toBeDefined();
      });
    },
  );

  // ── Session mode ─────────────────────────────────────────────────

  test(
    'Session mode: compares session edits against original',
    async () => {
      const dir = await createTrackedTempDir();

      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body><w:p><w:r><w:t>Original text here</w:t></w:r></w:p></w:body></w:document>`;
      const { mgr, sessionId, firstParaId } = await openSession([], {
        xml: docXml,
        extraFiles: {
          '[Content_Types].xml': CONTENT_TYPES_XML,
          '_rels/.rels': RELS_XML,
        },
      });

      await allureStep('Make an edit via smart_edit', async () => {
        const editResult = await smartEdit(mgr, {
          session_id: sessionId,
          target_paragraph_id: firstParaId,
          old_string: 'Original text here',
          new_string: 'Modified text here',
          instruction: 'Change original to modified',
        });
        assertSuccess(editResult, 'smart_edit');
      });

      const outputPath = path.join(dir, 'session-redline.docx');
      const result = await allureStep('Call compare_documents (session)', () =>
        compareDocuments_tool(mgr, {
          session_id: sessionId,
          save_to_local_path: outputPath,
        }),
      );
      assertSuccess(result, 'compare_documents');
      await allureJsonAttachment('result', result);

      await allureStep('Redline file written to disk', async () => {
        const stat = await fs.stat(outputPath);
        expect(stat.isFile()).toBe(true);
        expect(stat.size).toBeGreaterThan(0);
      });

      await allureStep('Response indicates session mode', () => {
        expect(result.mode).toBe('session');
        expect(result.stats).toBeDefined();
        expect(result.resolved_session_id).toBe(sessionId);
      });
    },
  );

  // ── Error cases ──────────────────────────────────────────────────

  test(
    'Missing params: no file paths and no session yields error',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();
      const outputPath = path.join(dir, 'output.docx');

      const result = await allureStep('Call compare_documents with no inputs', () =>
        compareDocuments_tool(mgr, {
          save_to_local_path: outputPath,
        }),
      );
      assertFailure(result, 'MISSING_PARAMS', 'compare_documents');
      await allureJsonAttachment('result', result);
    },
  );

  test(
    'Invalid path: non-existent file returns error',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();
      const outputPath = path.join(dir, 'output.docx');

      const result = await allureStep('Call compare_documents with non-existent file', () =>
        compareDocuments_tool(mgr, {
          original_file_path: path.join(dir, 'does-not-exist.docx'),
          revised_file_path: path.join(dir, 'also-missing.docx'),
          save_to_local_path: outputPath,
        }),
      );
      assertFailure(result, 'FILE_NOT_FOUND', 'compare_documents');
      await allureJsonAttachment('result', result);
    },
  );

  test(
    'Invalid engine: rejected with error',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const originalPath = await writeTestDocx(dir, 'original.docx', ['Hello']);
      const revisedPath = await writeTestDocx(dir, 'revised.docx', ['Hello world']);
      const outputPath = path.join(dir, 'output.docx');

      const result = await allureStep('Call compare_documents with wmlcomparer engine', () =>
        compareDocuments_tool(mgr, {
          original_file_path: originalPath,
          revised_file_path: revisedPath,
          save_to_local_path: outputPath,
          engine: 'wmlcomparer',
        }),
      );
      assertFailure(result, 'INVALID_ENGINE', 'compare_documents');
      await allureJsonAttachment('result', result);
    },
  );

  // ── Tool registration ────────────────────────────────────────────

  test(
    'compare_documents tool is registered in MCP_TOOLS',
    async () => {
      const tool = MCP_TOOLS.find((t) => t.name === 'compare_documents');
      expect(tool).toBeTruthy();
      expect(tool!.annotations.readOnlyHint).toBe(true);
      expect(tool!.annotations.destructiveHint).toBe(false);
      expect(tool!.inputSchema.required).toContain('save_to_local_path');
      expect(tool!.inputSchema.properties).toHaveProperty('original_file_path');
      expect(tool!.inputSchema.properties).toHaveProperty('revised_file_path');
      expect(tool!.inputSchema.properties).toHaveProperty('session_id');
      expect(tool!.inputSchema.properties).toHaveProperty('engine');
    },
  );
});
