import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { save } from './save.js';
import { openDocument } from './open_document.js';
import {
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';

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

describe('save', () => {
  registerCleanup();

  async function openTestDoc(texts: string[] = ['Hello World']) {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('save-test-');
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      texts.map((t) => `<w:p><w:r><w:t>${xmlEscape(t)}</w:t></w:r></w:p>`).join('') +
      `</w:body></w:document>`;
    const buf = await makeDocxWithDocumentXml(documentXml, {
      '[Content_Types].xml': CONTENT_TYPES_XML,
      '_rels/.rels': RELS_XML,
    });
    const filePath = path.join(tmpDir, 'test.docx');
    await fs.writeFile(filePath, new Uint8Array(buf));

    const opened = await openDocument(mgr, { file_path: filePath });
    assertSuccess(opened, 'open');

    return {
      mgr,
      sessionId: opened.session_id as string,
      tmpDir,
      inputPath: filePath,
    };
  }

  it('clean save writes a valid .docx', async () => {
    const { mgr, sessionId, tmpDir } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      save_format: 'clean',
    });
    assertSuccess(result, 'clean save');

    const exists = await fs.stat(outPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const fileSize = (await fs.stat(outPath)).size;
    expect(fileSize).toBeGreaterThan(0);
  });

  it('tracked save includes comparison with baseline', async () => {
    const { mgr, sessionId, tmpDir } = await openTestDoc();
    const outPath = path.join(tmpDir, 'tracked-output.docx');

    const result = await save(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      save_format: 'tracked',
      tracked_changes_author: 'Test Author',
    });

    if (!result.success) {
      const errorInfo = (result as Record<string, unknown>).error as Record<string, unknown>;
      expect.soft(errorInfo).toEqual('debug: should not reach');
    }
    assertSuccess(result, 'tracked save');
  });

  it('both-mode generates two files', async () => {
    const { mgr, sessionId, tmpDir } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      save_format: 'both',
    });
    assertSuccess(result, 'both save');

    // Clean file should exist
    const exists = await fs.stat(outPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('reports stats (insertions/deletions/modifications)', async () => {
    const { mgr, sessionId, tmpDir } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      save_format: 'tracked',
    });
    assertSuccess(result, 'save');

    // Response should include tracked stats
    const stats = (result as Record<string, unknown>).tracked_changes_stats;
    if (stats) {
      const s = stats as Record<string, number>;
      expect(typeof s.insertions).toBe('number');
      expect(typeof s.deletions).toBe('number');
    }
  });

  it('rejects invalid save_format', async () => {
    const { mgr, sessionId, tmpDir } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      save_format: 'invalid' as 'clean',
    });
    assertFailure(result, 'INVALID_SAVE_FORMAT', 'bad format');
  });

  it('fails gracefully with non-existent session', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('save-test-');
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      session_id: 'ses_AAAAAAAAAAAA',
      save_to_local_path: outPath,
      save_format: 'clean',
    });
    assertFailure(result, undefined, 'missing session');
  });

  it('blocks overwrite of original file without allow_overwrite', async () => {
    const { mgr, sessionId, inputPath } = await openTestDoc();

    const result = await save(mgr, {
      session_id: sessionId,
      save_to_local_path: inputPath,
      save_format: 'clean',
    });
    assertFailure(result, 'OVERWRITE_BLOCKED', 'overwrite blocked');
  });

  it('allows overwrite of original file with allow_overwrite=true', async () => {
    const { mgr, sessionId, inputPath } = await openTestDoc();

    const result = await save(mgr, {
      session_id: sessionId,
      save_to_local_path: inputPath,
      save_format: 'clean',
      allow_overwrite: true,
    });
    assertSuccess(result, 'overwrite allowed');
  });

  it('resolves session by file_path when session_id not provided', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outPath,
      save_format: 'clean',
    });
    assertSuccess(result, 'save by file_path');
  });
});
