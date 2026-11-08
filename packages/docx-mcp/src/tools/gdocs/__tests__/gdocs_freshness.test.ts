import { afterEach, expect, vi } from 'vitest';
import { testAllure } from '../../../testing/allure-test.js';
import { SessionManager } from '../../../session/manager.js';
import { gdocsFormatLayout } from '../format_layout.js';
import { gdocsInsertParagraph } from '../insert_paragraph.js';
import { gdocsReplaceText } from '../replace_text.js';
import { GoogleDocsDocument } from '../../../../../google-docs-core/src/document.js';
import { resolveCredentials } from '../../../../../google-docs-core/src/auth.js';
import type { GoogleApiClient } from '../../../../../google-docs-core/src/api-client.js';

vi.mock('../../../../../google-docs-core/src/auth.js', () => ({ resolveCredentials: vi.fn() }));

const TEST_FEATURE = 'track-google-structure-freshness';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

const anchor = '_bk_0000000000';
const anchorId = `t.0:${anchor}`;
const managers: SessionManager[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.clearAllSessions();
  vi.clearAllMocks();
});

function snapshot(start: number, text = 'Alpha Beta', present = true) {
  return {
    documentId: 'synthetic', revisionId: `rev-${start}`,
    tabs: [{ tabProperties: { tabId: 't.0', title: 'Synthetic' }, documentTab: {
      body: { content: present ? [{ startIndex: start, endIndex: start + text.length + 1, paragraph: { elements: [{ textRun: { content: `${text}\n` } }] } }] : [] },
      namedRanges: { [anchor]: { namedRanges: [{ namedRangeId: 'nr-1', name: anchor, ranges: [{ startIndex: start, endIndex: start + 1, tabId: 't.0' }] }] } },
    } }],
  };
}

async function setup(present = true) {
  const getDocument = vi.fn().mockResolvedValue(snapshot(1, 'Alpha Beta', present));
  const batchUpdate = vi.fn().mockResolvedValue({ writeControl: { requiredRevisionId: 'rev-remote' } });
  vi.mocked(resolveCredentials).mockResolvedValue({ getDocument, batchUpdate } as unknown as GoogleApiClient);
  const doc = await GoogleDocsDocument.load('synthetic');
  const manager = new SessionManager();
  managers.push(manager);
  const session = manager.createGDocsSession('synthetic', doc);
  return { doc, manager, session, getDocument, batchUpdate };
}

test.openspec('Raw write precedes cached-index planning')('Google layout plans ranges only after queued raw write and refresh', async () => {
  const { doc, manager, session, getDocument, batchUpdate } = await setup();
  let release!: () => void;
  const ack = new Promise<void>(resolve => { release = resolve; });
  batchUpdate.mockImplementationOnce(async () => { await ack; return { writeControl: { requiredRevisionId: 'rev-raw' } }; });
  const raw = doc.executeBatchUpdate([{ insertText: { location: { index: 1 }, text: 'prefix\n' } }]);
  getDocument.mockResolvedValueOnce(snapshot(8));
  const layout = gdocsFormatLayout(manager, session, { paragraph_spacing: { paragraph_ids: [anchorId], before_twips: 120 } }, { source: 'synthetic' });
  release();
  await raw;
  expect(await layout).toMatchObject({ success: true, affected_paragraphs: 1, source: 'synthetic' });
  expect(batchUpdate.mock.calls[1]![1]).toMatchObject({ requests: [{ updateParagraphStyle: { range: { startIndex: 8, endIndex: 19, tabId: 't.0' } } }], writeControl: { requiredRevisionId: 'rev-8' } });
  expect(getDocument).toHaveBeenCalledTimes(2);
  expect(doc.isStructureStale()).toBe(true); // layout retains the raw-batch refresh policy
  expect(session.editRevision).toBe(1);
});

test.openspec('Raw write precedes cached-index planning')('insertion precheck discovers an anchor absent from the stale snapshot', async () => {
  const { doc, manager, session, getDocument, batchUpdate } = await setup(false);
  await doc.executeBatchUpdate([{ insertText: { location: { index: 1 }, text: 'Alpha Beta\n' } }]);
  getDocument.mockResolvedValue(snapshot(8));
  expect(await gdocsInsertParagraph(manager, session, { positional_anchor_node_id: anchorId, new_string: 'Synthetic', instruction: 'test', position: 'BEFORE' }, {})).toMatchObject({ success: true, anchor_paragraph_id: anchorId, position: 'BEFORE' });
  expect(batchUpdate.mock.calls[1]![1].requests[0].insertText.location.index).toBe(8);
  expect(getDocument).toHaveBeenCalledTimes(3);
  expect(session.editCount).toBe(1);
});

test.openspec('Raw write precedes cached-index planning')('replacement previews use refreshed text while preserving response fields', async () => {
  const { doc, manager, session, getDocument } = await setup();
  await doc.executeBatchUpdate([{ insertText: { location: { index: 1 }, text: 'prefix ' } }]);
  getDocument.mockResolvedValueOnce(snapshot(1, 'prefix Alpha Beta')).mockResolvedValueOnce(snapshot(1, 'prefix Alpha Gamma'));
  expect(await gdocsReplaceText(manager, session, { target_paragraph_id: anchorId, old_string: 'Beta', new_string: 'Gamma', instruction: 'test' }, {})).toMatchObject({ success: true, before_text: 'prefix Alpha Beta', after_text: 'prefix Alpha Gamma', replacements_made: 1 });
  expect(session.editCount).toBe(1);
});

test.openspec('Refresh fails after remote success')('failed refresh preserves actual cloud acknowledgement and blocks later stale layout writes', async () => {
  const { doc, manager, session, getDocument, batchUpdate } = await setup();
  getDocument.mockRejectedValueOnce(new Error('post-edit refresh failed'));
  expect(await gdocsReplaceText(manager, session, { target_paragraph_id: anchorId, old_string: 'Beta', new_string: 'Gamma', instruction: 'test' }, {})).toMatchObject({ success: false, error: { code: 'EDIT_ERROR' } });
  expect(doc.getConfirmedWriteVersion()).toBe(1);
  expect(doc.getRevisionId()).toBe('rev-remote');
  expect(doc.isStructureStale()).toBe(true);
  expect(session.editCount).toBe(1);
  getDocument.mockRejectedValueOnce(new Error('pre-layout refresh failed'));
  const params = { paragraph_spacing: { paragraph_ids: [anchorId], before_twips: 120 } };
  expect(await gdocsFormatLayout(manager, session, params, {})).toMatchObject({ success: false, error: { code: 'FORMAT_LAYOUT_ERROR' } });
  expect(batchUpdate).toHaveBeenCalledTimes(1);
  expect(session.editCount).toBe(1);
  getDocument.mockResolvedValueOnce(snapshot(8, 'Alpha Gamma'));
  expect((await gdocsFormatLayout(manager, session, params, {})).success).toBe(true);
  expect(batchUpdate.mock.calls[1]![1].requests[0].updateParagraphStyle.range.startIndex).toBe(8);
  expect(session.editCount).toBe(2);
});

test.openspec('Concurrent writes and refreshes')('missing layout selectors after refresh never send partial requests and leave queue recoverable', async () => {
  const { doc, manager, session, getDocument, batchUpdate } = await setup();
  await doc.executeBatchUpdate([{ insertText: { location: { index: 1 }, text: 'prefix\n' } }]);
  getDocument.mockResolvedValueOnce(snapshot(8));
  const params = { paragraph_spacing: { paragraph_ids: [anchorId, 'missing'], before_twips: 120 } };
  expect(await gdocsFormatLayout(manager, session, params, {})).toMatchObject({ success: false, error: { code: 'INVALID_SELECTOR' } });
  expect(batchUpdate).toHaveBeenCalledTimes(1);
  expect(session.editCount).toBe(0);
  expect((await gdocsFormatLayout(manager, session, { paragraph_spacing: { ...params.paragraph_spacing, paragraph_ids: [anchorId] } }, {})).success).toBe(true);
  expect(batchUpdate).toHaveBeenCalledTimes(2);
  expect(getDocument).toHaveBeenCalledTimes(2);
});
