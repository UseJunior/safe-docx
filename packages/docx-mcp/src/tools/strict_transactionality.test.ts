import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import { DocxZip, parseXml, serializeXml } from '@usejunior/docx-core';

import { download } from './download.js';
import { formatLayout } from './format_layout.js';
import { getSessionStatus } from './get_session_status.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

function canonicalizeXml(xml: string): string {
  return serializeXml(parseXml(xml));
}

async function readDocumentXml(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const zip = await DocxZip.load(buffer as Buffer);
  return zip.readText('word/document.xml');
}

describe('format_layout: strict failure transactionality', () => {
  registerCleanup();

  test('strict selector failure does not mutate session state or document XML', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>` +
      `<w:tbl>` +
      `<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>` +
      `</w:body>` +
      `</w:document>`;

    const opened = await openSession([], {
      xml,
      prefix: 'safe-docx-transactional-',
    });

    const baselinePath = `${opened.tmpDir}/baseline-clean.docx`;
    const baselineDownload = await download(opened.mgr, {
      session_id: opened.sessionId,
      save_to_local_path: baselinePath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(baselineDownload, 'baseline download');

    const statusBefore = await getSessionStatus(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(statusBefore, 'status before');
    expect(statusBefore.edit_count).toBe(0);
    expect(statusBefore.edit_revision).toBe(0);

    const failed = await formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      strict: true,
      row_height: {
        table_indexes: [0],
        row_indexes: [99],
        value_twips: 420,
        rule: 'exact',
      },
    });
    assertFailure(failed, 'INVALID_SELECTOR', 'format_layout strict failure');

    const statusAfter = await getSessionStatus(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(statusAfter, 'status after');
    expect(statusAfter.edit_count).toBe(0);
    expect(statusAfter.edit_revision).toBe(0);

    const afterPath = `${opened.tmpDir}/after-failure-clean.docx`;
    const afterDownload = await download(opened.mgr, {
      session_id: opened.sessionId,
      save_to_local_path: afterPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(afterDownload, 'after download');

    const baselineXml = await readDocumentXml(baselinePath);
    const afterXml = await readDocumentXml(afterPath);
    expect(canonicalizeXml(afterXml)).toBe(canonicalizeXml(baselineXml));
  });
});
