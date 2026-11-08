import { describe, expect, vi } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { RevisionIdAllocator } from './revision-id-allocator.js';
import { allocateRevisionId, createRevisionIdState, inferStartingRevisionIdState, createRevisionContext, wrapSerializedContentWithDel } from './track-changes-emitter.js';
import { parseXml, serializeXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Revision ID Readiness' });

describe('managed revision ID allocator', () => {
  test('guards pre-ready allocation and shares one pending seed without overwriting subsequent allocations', async () => {
    let release!: (state: ReturnType<typeof createRevisionIdState>) => void;
    const seed = vi.fn(() => new Promise<ReturnType<typeof createRevisionIdState>>(resolve => { release = resolve; }));
    const allocator = new RevisionIdAllocator(seed);
    expect(allocator.status).toBe('unseeded');
    expect(() => allocator.allocate()).toThrow('not ready (unseeded)');
    const first = allocator.ensureReady();
    expect(allocator.status).toBe('seeding');
    expect(() => allocator.allocate()).toThrow('not ready (seeding)');
    expect(allocator.ensureReady()).toBe(first);
    const advanced = first.then(state => allocateRevisionId(state));
    await Promise.resolve();
    release(createRevisionIdState(20));
    expect(await advanced).toBe(20);
    expect(await first).toBe(await allocator.ensureReady());
    expect(allocator.allocate()).toBe(21);
    expect(seed).toHaveBeenCalledTimes(1);
  });

  test('shares synchronous and asynchronous failures and retries without terminal negative caching', async () => {
    const seed = vi.fn<() => Promise<ReturnType<typeof createRevisionIdState>>>()
      .mockImplementationOnce(() => { throw new Error('sync seed failure'); })
      .mockRejectedValueOnce(new Error('async seed failure'))
      .mockResolvedValue(createRevisionIdState(40));
    const allocator = new RevisionIdAllocator(seed);
    for (const message of ['sync seed failure', 'async seed failure']) {
      const pending = allocator.ensureReady();
      expect(allocator.ensureReady()).toBe(pending);
      await expect(pending).rejects.toThrow(message);
      expect(allocator.status).toBe('unseeded');
      expect(allocator.readyState).toBeNull();
    }
    await allocator.ensureReady();
    expect(allocator.allocate()).toBe(40);
    expect(seed).toHaveBeenCalledTimes(3);
  });

  test('forks a pending seed into detached plain state and discards tentative IDs', async () => {
    const seed = vi.fn(async () => createRevisionIdState(50));
    const allocator = new RevisionIdAllocator(seed);
    const pending = allocator.ensureReady();
    const child = allocator.fork();
    const [active, candidate] = await Promise.all([pending, child.ensureReady()]);
    expect(candidate).not.toBe(active);
    expect(structuredClone(candidate)).toEqual(candidate);
    candidate.moveRangeIds.set('move', { sourceRangeId: 50, destRangeId: 51 });
    candidate.nextId = 52;
    expect(active.nextId).toBe(50);
    expect(active.moveRangeIds.size).toBe(0);
    expect(seed).toHaveBeenCalledTimes(1);
    // A fresh successful edit can reuse the unpublished, discarded IDs.
    const successful = allocator.fork();
    await successful.ensureReady();
    expect(successful.allocate()).toBe(50);
    expect(allocator.publish(successful)).toBe(true);
    expect(allocator.allocate()).toBe(51);
  });

  test('publishes ready forks in place and preserves move-range reservations', async () => {
    const active = createRevisionIdState(70);
    active.moveRangeIds.set('original', { sourceRangeId: 60, destRangeId: 61 });
    const allocator = new RevisionIdAllocator(async () => { throw new Error('must not seed'); }, active);
    const child = allocator.fork();
    const state = await child.ensureReady();
    state.moveRangeIds.get('original')!.destRangeId = 62;
    state.moveRangeIds.set('new', { sourceRangeId: child.allocate(), destRangeId: child.allocate() });
    expect(active.moveRangeIds.get('original')!.destRangeId).toBe(61);
    expect(allocator.publish(child)).toBe(true);
    expect(allocator.readyState).toBe(active);
    expect(active.moveRangeIds.get('original')!.destRangeId).toBe(62);
    expect(allocateRevisionId(active)).toBe(72);
  });

  test('refuses a stale fork after a direct allocation or move reservation', async () => {
    for (const mutate of [
      (state: ReturnType<typeof createRevisionIdState>) => { allocateRevisionId(state); },
      (state: ReturnType<typeof createRevisionIdState>) => { state.moveRangeIds.set('direct', { sourceRangeId: 1, destRangeId: 2 }); },
    ]) {
      const active = createRevisionIdState(80);
      const allocator = new RevisionIdAllocator(async () => active, active);
      const child = allocator.fork();
      await child.ensureReady();
      child.allocate();
      mutate(active);
      const before = structuredClone(active);
      expect(allocator.publish(child)).toBe(false);
      expect(active).toEqual(before);
    }
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' })(
    'seeds above grouped sibling fragments without rewriting their logical revision', async () => {
      const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>'
        + '<w:del w:id="7" w:author="Human" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>A</w:delText></w:r></w:del>'
        + '<w:bookmarkStart w:id="9000" w:name="split"/><w:bookmarkEnd w:id="9000"/>'
        + '<w:del w:id="7" w:author="Human" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>B</w:delText></w:r></w:del>'
        + '</w:p></w:body></w:document>';
      const doc = parseXml(xml);
      const before = serializeXml(doc);
      const allocator = new RevisionIdAllocator(async () => inferStartingRevisionIdState(doc));
      const ctx = createRevisionContext({ author: 'Agent', idState: await allocator.ensureReady() });
      expect(wrapSerializedContentWithDel('<w:r><w:t>New</w:t></w:r>', ctx)).toContain('w:id="8"');
      expect(serializeXml(doc)).toBe(before);
      expect(Array.from(doc.getElementsByTagName('w:del')).map(el => el.getAttribute('w:id'))).toEqual(['7', '7']);
    },
  );
});
