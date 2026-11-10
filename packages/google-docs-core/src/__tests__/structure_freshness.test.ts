import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleApiClient } from '../api-client.js';
import type { DocumentWithTabs, GDocsBatchUpdateResponse, GDocsDocument } from '../google-api-types.js';
import { GoogleDocsDocument } from '../document.js';
import { resolveCredentials } from '../auth.js';

vi.mock('../auth.js', () => ({ resolveCredentials: vi.fn() }));

const anchor = '_bk_0000000000';
const anchorId = `t.0:${anchor}`;
const rawRequests = [{ insertText: { location: { index: 1 }, text: 'prefix\n' } }];

function snapshot(text = 'Alpha Beta', start = 1, anchored = true, revisionId = 'rev-1'): DocumentWithTabs {
  return {
    documentId: 'synthetic', revisionId,
    tabs: [{
      tabProperties: { tabId: 't.0', title: 'Synthetic' },
      documentTab: {
        body: { content: [{
          startIndex: start, endIndex: start + text.length + 1,
          paragraph: { elements: [{ textRun: { content: `${text}\n` } }] },
        }] },
        namedRanges: anchored ? { [anchor]: { namedRanges: [{
          namedRangeId: 'nr-1', name: anchor,
          ranges: [{ startIndex: start, endIndex: start + 1, tabId: 't.0' }],
        }] } } : {},
      },
    }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

async function setup(initial = snapshot()) {
  const getDocument = vi.fn().mockResolvedValue(initial);
  const batchUpdate = vi.fn().mockResolvedValue({ replies: [], writeControl: { requiredRevisionId: 'rev-2' } });
  vi.mocked(resolveCredentials).mockResolvedValue({ getDocument, batchUpdate } as unknown as GoogleApiClient);
  const doc = await GoogleDocsDocument.load('synthetic');
  return { doc, getDocument, batchUpdate };
}

describe('Google structure freshness and serialized planning (#1306)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refreshes after a raw write before resolving replacement indexes', async () => {
    const { doc, getDocument, batchUpdate } = await setup();
    expect(doc.getStructureState()).toBe('current');
    await doc.executeBatchUpdate(rawRequests);
    expect(doc.getStructureState()).toBe('stale_after_write');
    expect(doc.getConfirmedWriteVersion()).toBe(1);
    getDocument.mockResolvedValueOnce(snapshot('Alpha Beta', 8)).mockResolvedValueOnce(snapshot('Alpha Gamma', 8));
    await doc.replaceText(anchorId, 'Beta', 'Gamma');
    expect(batchUpdate.mock.calls[1]![1].requests[0]).toEqual({ deleteContentRange: { range: { startIndex: 14, endIndex: 18, tabId: 't.0' } } });
    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(doc.getStructureState()).toBe('current');
    expect(doc.getParagraphTextById(anchorId)).toBe('Alpha Gamma');
    expect(doc.getEditCount()).toBe(1);
    expect(doc.getConfirmedWriteVersion()).toBe(2);
  });

  it.each(['BEFORE', 'AFTER'] as const)('refreshes stale insertion indexes for %s', async position => {
    const { doc, getDocument, batchUpdate } = await setup();
    await doc.executeBatchUpdate(rawRequests);
    // Keep all paragraphs anchored so this assertion isolates insertion planning.
    getDocument.mockResolvedValue(snapshot('Alpha Beta', 8));
    await doc.insertParagraph(anchorId, position, 'Synthetic');
    expect(batchUpdate.mock.calls[1]![1].requests[0].insertText.location).toEqual({ index: position === 'BEFORE' ? 8 : 18, tabId: 't.0' });
    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(doc.getEditRevision()).toBe(1);
  });

  it('refreshes stale anchor injection indexes without counting maintenance as a user edit', async () => {
    const { doc, getDocument, batchUpdate } = await setup(snapshot('Alpha Beta', 1, false));
    await doc.executeBatchUpdate(rawRequests);
    getDocument.mockResolvedValueOnce(snapshot('Alpha Beta', 8, false)).mockResolvedValueOnce(snapshot('Alpha Beta', 8));
    batchUpdate.mockResolvedValueOnce({ replies: [{ createNamedRange: { namedRangeId: 'nr-1' } }], writeControl: { requiredRevisionId: 'rev-3' } });
    expect(await doc.injectAnchors()).toEqual({ injectedCount: 1 });
    expect(batchUpdate.mock.calls[1]![1].requests[0].createNamedRange.range).toMatchObject({ startIndex: 8, endIndex: 9, tabId: 't.0' });
    expect(doc.getConfirmedWriteVersion()).toBe(1);
    expect(doc.getEditCount()).toBe(0);
    expect(doc.getStructureState()).toBe('current');
  });

  it('keeps insertion and its nested anchor write in one operation with both normal refreshes', async () => {
    const { doc, getDocument, batchUpdate } = await setup();
    const afterInsert = snapshot();
    afterInsert.tabs![0]!.documentTab!.body!.content!.push({
      startIndex: 12, endIndex: 22,
      paragraph: { elements: [{ textRun: { content: 'Synthetic\n' } }] },
    });
    const afterAnchors = structuredClone(afterInsert);
    const newAnchor = '_bk_0000000001';
    afterAnchors.tabs![0]!.documentTab!.namedRanges![newAnchor] = { namedRanges: [{
      namedRangeId: 'nr-2', name: newAnchor, ranges: [{ startIndex: 12, endIndex: 13, tabId: 't.0' }],
    }] };
    getDocument.mockResolvedValueOnce(afterInsert).mockResolvedValueOnce(afterAnchors);
    batchUpdate.mockResolvedValueOnce({ writeControl: { requiredRevisionId: 'rev-2' } })
      .mockResolvedValueOnce({ replies: [{ createNamedRange: { namedRangeId: 'nr-2' } }], writeControl: { requiredRevisionId: 'rev-3' } });
    expect(await doc.insertParagraph(anchorId, 'AFTER', 'Synthetic')).toEqual({ newAnchorId: `t.0:${newAnchor}` });
    expect(batchUpdate).toHaveBeenCalledTimes(2);
    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(doc.getConfirmedWriteVersion()).toBe(1);
    expect(doc.getEditCount()).toBe(1);
    expect(doc.isStructureStale()).toBe(false);
  });

  it('retains acknowledgement and edit counters after refresh failure; refuses stale planning until recovery', async () => {
    const { doc, getDocument, batchUpdate } = await setup();
    getDocument.mockRejectedValueOnce(new Error('post-write read failed'));
    await expect(doc.replaceText(anchorId, 'Alpha', 'Longer Alpha')).rejects.toThrow('post-write read failed');
    expect(doc.getConfirmedWriteVersion()).toBe(1);
    expect(doc.getEditCount()).toBe(1);
    expect(doc.getEditRevision()).toBe(1);
    expect(doc.getRevisionId()).toBe('rev-2');
    expect(doc.isStructureStale()).toBe(true);
    getDocument.mockRejectedValueOnce(new Error('pre-write read failed'));
    await expect(doc.replaceText(anchorId, 'Beta', 'Gamma')).rejects.toThrow('pre-write read failed');
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(doc.isStructureStale()).toBe(true);
    getDocument.mockResolvedValueOnce(snapshot('Longer Alpha Beta', 1, true, 'rev-2')).mockResolvedValueOnce(snapshot('Longer Alpha Gamma'));
    await doc.replaceText(anchorId, 'Beta', 'Gamma');
    expect(batchUpdate.mock.calls[1]![1]).toMatchObject({ requests: [{ deleteContentRange: { range: { startIndex: 14, endIndex: 18 } } }, {}], writeControl: { requiredRevisionId: 'rev-2' } });
    expect(doc.getConfirmedWriteVersion()).toBe(2);
    expect(doc.getEditCount()).toBe(2);
    expect(doc.isStructureStale()).toBe(false);
  });

  it('serializes concurrent normal edits through post-edit refresh and preserves refresh counts', async () => {
    const { doc, getDocument, batchUpdate } = await setup();
    const entered = deferred<void>();
    const ack = deferred<GDocsBatchUpdateResponse>();
    batchUpdate.mockImplementationOnce(() => { entered.resolve(); return ack.promise; });
    getDocument.mockResolvedValueOnce(snapshot('Longer Alpha Beta', 1, true, 'rev-2')).mockResolvedValueOnce(snapshot('Longer Alpha Gamma', 1, true, 'rev-3'));
    const first = doc.replaceText(anchorId, 'Alpha', 'Longer Alpha');
    await entered.promise;
    const second = doc.replaceText(anchorId, 'Beta', 'Gamma');
    await Promise.resolve();
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    ack.resolve({ writeControl: { requiredRevisionId: 'rev-2' } });
    await Promise.all([first, second]);
    expect(batchUpdate.mock.calls[1]![1].requests[0].deleteContentRange.range.startIndex).toBe(14);
    expect(batchUpdate.mock.calls[1]![1].writeControl.requiredRevisionId).toBe('rev-2');
    expect(getDocument).toHaveBeenCalledTimes(3); // load + one normal refresh per edit
    expect(doc.getEditCount()).toBe(2);
  });

  it('serializes an explicit in-flight refresh before a raw write, so its old snapshot cannot clear stale state', async () => {
    const { doc, getDocument, batchUpdate } = await setup();
    const entered = deferred<void>();
    const read = deferred<GDocsDocument>();
    getDocument.mockImplementationOnce(() => { entered.resolve(); return read.promise; });
    const refresh = doc.fetchDocument();
    await entered.promise;
    const write = doc.executeBatchUpdate(rawRequests);
    await Promise.resolve();
    expect(batchUpdate).not.toHaveBeenCalled();
    read.resolve(snapshot());
    await Promise.all([refresh, write]);
    expect(doc.isStructureStale()).toBe(true);
    expect(doc.getRevisionId()).toBe('rev-2');
  });

  it('plans inside the queue after a preceding raw write and skips planning on refresh failure', async () => {
    const { doc, getDocument, batchUpdate } = await setup();
    const raw = doc.executeBatchUpdate(rawRequests);
    getDocument.mockResolvedValueOnce(snapshot('Alpha Beta', 8));
    const plan = vi.fn(() => [{ insertText: { location: { index: doc.getParagraphByAnchorId(anchorId)!.startIndex }, text: 'Synthetic' } }]);
    await Promise.all([raw, doc.executePlannedBatchUpdate(plan)]);
    expect(batchUpdate.mock.calls[1]![1].requests[0].insertText.location.index).toBe(8);
    expect(plan).toHaveBeenCalledTimes(1);
    getDocument.mockRejectedValueOnce(new Error('refresh unavailable'));
    await expect(doc.executePlannedBatchUpdate(plan)).rejects.toThrow('refresh unavailable');
    expect(plan).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(2);
    expect(doc.isStructureStale()).toBe(true);
  });

  it('releases the queue after remote rejection or planning failure without counting either as a write', async () => {
    const { doc, getDocument, batchUpdate } = await setup();
    batchUpdate.mockRejectedValueOnce(new Error('write refused'));
    await expect(doc.replaceText(anchorId, 'Alpha', 'Longer')).rejects.toThrow('write refused');
    await expect(doc.executePlannedBatchUpdate(() => { throw new Error('invalid plan'); })).rejects.toThrow('invalid plan');
    await doc.executePlannedBatchUpdate(() => []);
    await doc.replaceText(anchorId, 'Alpha', 'Alpha');
    expect(doc.getConfirmedWriteVersion()).toBe(0);
    expect(doc.getEditCount()).toBe(0);
    expect(doc.getStructureState()).toBe('current');
    expect(getDocument).toHaveBeenCalledTimes(1);
    await doc.replaceText(anchorId, 'Alpha', 'Longer');
    expect(doc.getEditCount()).toBe(1);
    expect(getDocument).toHaveBeenCalledTimes(2);
  });
});
