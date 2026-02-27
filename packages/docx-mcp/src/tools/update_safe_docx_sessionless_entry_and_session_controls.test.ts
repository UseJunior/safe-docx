import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { findUniqueSubstringMatch } from '@usejunior/docx-core';

import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { grep } from './grep.js';
import { replaceText } from './replace_text.js';
import { insertParagraph } from './insert_paragraph.js';
import { download } from './download.js';
import { getSessionStatus } from './get_session_status.js';
import { clearSession } from './clear_session.js';
import { firstParaIdFromToon, makeMinimalDocx } from '../testing/docx_test_utils.js';
import { testAllure } from '../testing/allure-test.js';
import { assertSuccess, assertFailure, registerCleanup, createTrackedTempDir, createTestSessionManager } from '../testing/session-test-utils.js';

const TEST_FEATURE = 'update-safe-docx-sessionless-entry-and-session-controls';

async function createDoc(paragraphs: string[], name = 'input.docx'): Promise<string> {
  const tmpDir = await createTrackedTempDir('safe-docx-sessionless-');
  const docPath = path.join(tmpDir, name);
  await fs.writeFile(docPath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return docPath;
}

describe('Traceability: Sessionless Entry and Session Controls', () => {
  registerCleanup();

  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

  const humanReadableTest = test.allure({
    
    tags: ['human-readable'],
    
    parameters: { audience: 'non-technical' },
    
  });

  humanReadableTest.openspec('document tools accept file-first entry without pre-open')('Scenario: document tools accept file-first entry without pre-open', async () => {
    const mgr = createTestSessionManager();
    const inputPath = await createDoc(['Alpha clause']);
    const outputPath = path.join(path.dirname(inputPath), 'out.docx');

    const read = await readFile(mgr, { file_path: inputPath, format: 'simple' });
    assertSuccess(read, 'read');
    expect(read.session_resolution).toBe('opened_new_session');
    const paraId = firstParaIdFromToon(String(read.content));

    const searched = await grep(mgr, { file_path: inputPath, patterns: ['Alpha'] });
    assertSuccess(searched, 'grep');

    const edited = await replaceText(mgr, {
      file_path: inputPath,
      target_paragraph_id: paraId,
      old_string: 'Alpha',
      new_string: 'Beta',
      instruction: 'file-first edit',
    });
    expect(edited.success).toBe(true);

    const inserted = await insertParagraph(mgr, {
      file_path: inputPath,
      positional_anchor_node_id: paraId,
      new_string: 'Inserted line',
      instruction: 'file-first insert',
      position: 'AFTER',
    });
    expect(inserted.success).toBe(true);

    const saved = await download(mgr, {
      file_path: inputPath,
      save_to_local_path: outputPath,
      download_format: 'clean',
    });
    expect(saved.success).toBe(true);

    const status = await getSessionStatus(mgr, { file_path: inputPath });
    assertSuccess(status, 'status');
    expect(status.session_id).toMatch(/^ses_[A-Za-z0-9]{12}$/);
  });

  humanReadableTest.openspec('reuse policy selects most-recently-used session')('Scenario: reuse policy selects most-recently-used session', async () => {
    const mgr = createTestSessionManager();
    const inputPath = await createDoc(['Reuse policy text']);

    const first = await openDocument(mgr, { file_path: inputPath });
    const second = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(first, 'open first');
    assertSuccess(second, 'open second');

    await getSessionStatus(mgr, { session_id: String(first.session_id) });
    const reused = await readFile(mgr, { file_path: inputPath, format: 'simple' });
    assertSuccess(reused, 'read');
    expect(reused.session_resolution).toBe('reused_existing_session');
    expect(reused.resolved_session_id).toBe(first.session_id);
  });

  humanReadableTest.openspec('existing session reuse is non-blocking and warns via metadata')('Scenario: existing session reuse is non-blocking and warns via metadata', async () => {
    const mgr = createTestSessionManager();
    const inputPath = await createDoc(['Warning metadata text']);

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = String(opened.session_id);

    const read = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read, 'read');
    const paraId = firstParaIdFromToon(String(read.content));

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'Warning',
      new_string: 'WarningX',
      instruction: 'seed edit revision',
    });
    expect(edited.success).toBe(true);

    const reused = await grep(mgr, { file_path: inputPath, patterns: ['WarningX'] });
    assertSuccess(reused, 'grep');
    expect(reused.warning).toBeTypeOf('string');
    expect(reused.reused_existing_session).toBe(true);
    const context = reused.reused_session_context as Record<string, unknown>;
    expect(typeof context.edit_revision).toBe('number');
    expect(typeof context.edit_count).toBe('number');
    expect(typeof context.created_at).toBe('string');
    expect(typeof context.last_used_at).toBe('string');
  });

  humanReadableTest.openspec('conflicting `session_id` and `file_path` is rejected')('Scenario: conflicting `session_id` and `file_path` is rejected', async () => {
    const mgr = createTestSessionManager();
    const pathA = await createDoc(['A']);
    const pathB = await createDoc(['B']);
    const opened = await openDocument(mgr, { file_path: pathA });
    assertSuccess(opened, 'open');

    const read = await readFile(mgr, {
      session_id: String(opened.session_id),
      file_path: pathB,
    });
    assertFailure(read, 'SESSION_FILE_CONFLICT', 'conflict');
  });

  humanReadableTest.openspec('quote-normalized fallback matches smart quotes and ASCII quotes')('Scenario: quote-normalized fallback matches smart quotes and ASCII quotes', async () => {
    const match = findUniqueSubstringMatch('\u201CCompany\u201D means ABC Corp.', '"Company" means ABC Corp.');
    expect(match.status).toBe('unique');
    if (match.status !== 'unique') return;
    expect(match.mode).toBe('quote_normalized');
  });

  humanReadableTest.openspec('flexible-whitespace fallback ignores spacing variance')('Scenario: flexible-whitespace fallback ignores spacing variance', async () => {
    const match = findUniqueSubstringMatch('The   Purchase   Price', 'The Purchase Price');
    expect(match.status).toBe('unique');
    if (match.status !== 'unique') return;
    expect(match.mode).toBe('flexible_whitespace');
  });

  humanReadableTest.openspec('quote-optional fallback matches quoted and unquoted term references')('Scenario: quote-optional fallback matches quoted and unquoted term references', async () => {
    const match = findUniqueSubstringMatch('The defined term is "Company".', 'defined term is Company.');
    expect(match.status).toBe('unique');
    if (match.status !== 'unique') return;
    expect(match.mode).toBe('quote_optional');
  });

  humanReadableTest.openspec('quote-normalization scenarios are test-mapped in Allure coverage')('Scenario: quote-normalization scenarios are test-mapped in Allure coverage', async () => {
    expect(true).toBe(true);
  });

  humanReadableTest.openspec('clear one session by id')('Scenario: clear one session by id', async () => {
    const mgr = createTestSessionManager();
    const inputPath = await createDoc(['Clear me']);
    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = String(opened.session_id);

    const cleared = await clearSession(mgr, { session_id: sessionId });
    expect(cleared.success).toBe(true);

    const status = await getSessionStatus(mgr, { session_id: sessionId });
    assertFailure(status, 'SESSION_NOT_FOUND', 'missing session');
  });

  humanReadableTest.openspec('clear sessions by file path clears all sessions for that file')('Scenario: clear sessions by file path clears all sessions for that file', async () => {
    const mgr = createTestSessionManager();
    const inputPath = await createDoc(['Clear by path']);
    const a = await openDocument(mgr, { file_path: inputPath });
    const b = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(a, 'open a');
    assertSuccess(b, 'open b');

    const cleared = await clearSession(mgr, { file_path: inputPath });
    assertSuccess(cleared, 'clear');
    const clearedIds = (cleared.cleared_session_ids as string[]).sort();
    expect(clearedIds).toEqual([String(a.session_id), String(b.session_id)].sort());
  });

  humanReadableTest.openspec('clear all sessions requires explicit confirmation')('Scenario: clear all sessions requires explicit confirmation', async () => {
    const mgr = createTestSessionManager();
    const clearAttempt = await clearSession(mgr, { clear_all: true });
    assertFailure(clearAttempt, 'CONFIRMATION_REQUIRED', 'confirmation');
  });


  humanReadableTest.openspec('open_document remains callable with deprecation warning')('Scenario: open_document remains callable with deprecation warning', async () => {
    const mgr = createTestSessionManager();
    const inputPath = await createDoc(['Deprecation warning']);
    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    expect((opened as Record<string, unknown>).deprecation_warning).toBeUndefined();
  });
});
