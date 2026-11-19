import { describe, expect, vi } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { RevisionIdAllocator } from './revision-id-allocator.js';
import { allocateRevisionId, createRevisionIdState, inferStartingRevisionIdState, createRevisionContext, wrapSerializedContentWithDel } from './track-changes-emitter.js';
import { parseXml, serializeXml } from './xml.js';
import { DocxDocument } from './document.js';
import { DocxZip } from './zip.js';
import { getSidePartRevisionSeedDocs } from './revision-parts.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { OOXML } from './namespaces.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Revision ID Readiness' });

describe('managed revision ID allocator', () => {
  test('current story snapshots include unflushed header bindings and every fixed story without publishing archive changes', async () => {
    const zip = await DocxZip.load(await buildDocxFromBodyXml('<w:p><w:r><w:t>Body</w:t></w:r></w:p>', [], {
      namespaces: { r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' },
    }));
    for (const [part, root, container, id] of [
      ['word/comments.xml', 'comments', 'comment', 600],
      ['word/footnotes.xml', 'footnotes', 'footnote', 500],
      ['word/endnotes.xml', 'endnotes', 'endnote', 700],
    ] as const) {
      zip.writeText(part, `<w:${root} xmlns:w="${OOXML.W_NS}"><w:${container} w:id="99000"><w:p><w:ins w:id="${id}" w:author="Human"><w:r><w:t>Side</w:t></w:r></w:ins></w:p></w:${container}></w:${root}>`);
    }
    zip.writeText('word/glossary/document.xml', `<w:glossaryDocument xmlns:w="${OOXML.W_NS}"><w:docParts><w:docPart><w:docPartBody><w:p><w:ins w:id="800" w:author="Human"><w:r><w:t>Glossary</w:t></w:r></w:ins></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`);
    zip.writeText('word/letterhead.xml', `<w:hdr xmlns:w="${OOXML.W_NS}"><w:p><w:ins w:id="900" w:author="Human"><w:r><w:t>Selected</w:t></w:r></w:ins></w:p></w:hdr>`);
    zip.writeText('word/header99.xml', `<w:hdr xmlns:w="${OOXML.W_NS}"><w:p><w:ins w:id="99999" w:author="Human"><w:r><w:t>Orphan</w:t></w:r></w:ins></w:p></w:hdr>`);
    zip.writeText('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStory" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="letterhead.xml"/></Relationships>');
    const document = await DocxDocument.load(await zip.toBuffer());
    document.insertParagraphBookmarks('seed-story');
    const paragraph = document.getParagraphElementById(document.buildDocumentView().nodes[0]!.id)!;
    const dom = paragraph.ownerDocument!;
    const reference = dom.createElementNS(OOXML.W_NS, 'w:headerReference');
    reference.setAttributeNS(OOXML.W_NS, 'w:type', 'default');
    reference.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r:id', 'rStory');
    dom.getElementsByTagNameNS(OOXML.W_NS, 'sectPr')[0]!.appendChild(reference);
    const before = await document.getMutationSnapshot();
    const stories = await document.getRevisionSeedDocuments();
    expect(stories).toHaveLength(6);
    expect(inferStartingRevisionIdState(...stories).nextId).toBe(901);
    expect(await document.getMutationSnapshot()).toEqual(before);
  });

  test('optional side-story read and parse failures remain isolated and a later read can recover', async () => {
    expect(await getSidePartRevisionSeedDocs(Buffer.from('not an archive'))).toEqual([]);
    const zip = await DocxZip.load(await buildDocxFromBodyXml('<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));
    zip.writeText('word/footnotes.xml', `<w:footnotes xmlns:w="${OOXML.W_NS}"><w:footnote w:id="1"><w:p><w:ins w:id="700" w:author="Human"><w:r><w:t>Note</w:t></w:r></w:ins></w:p></w:footnote></w:footnotes>`);
    zip.writeText('word/comments.xml', `<w:comments xmlns:w="${OOXML.W_NS}"><w:comment`);
    zip.writeText('word/endnotes.xml', '');
    zip.writeText('word/glossary/document.xml', `<w:glossaryDocument xmlns:w="${OOXML.W_NS}"><w:docParts><w:docPart><w:docPartBody><w:p><w:ins w:id="5" w:author="Human"><w:r><w:t>Available</w:t></w:r></w:ins></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`);
    const read = zip.readTextOrNull.bind(zip);
    const fault = vi.spyOn(zip, 'readTextOrNull').mockImplementation(async part => {
      if (part === 'word/footnotes.xml') throw new Error('transient optional-story read');
      return read(part);
    });
    try {
      const partial = await getSidePartRevisionSeedDocs(zip);
      expect(partial).toHaveLength(1);
      expect(inferStartingRevisionIdState(...partial).nextId).toBe(6);
    } finally {
      fault.mockRestore();
    }
    const recovered = await getSidePartRevisionSeedDocs(await zip.toBuffer());
    expect(recovered).toHaveLength(2);
    expect(inferStartingRevisionIdState(...recovered).nextId).toBe(701);
  });

  test('foreign namespace and malformed revision IDs do not reserve managed IDs', async () => {
    const doc = parseXml(`<root xmlns:w="${OOXML.W_NS}" xmlns:other="urn:other"><other:ins w:id="9000"/><w:ins w:id="invalid"/><w:del w:id="-2"/><w:bookmarkStart w:id="8000"/><w:ins w:id="7"/></root>`);
    expect(inferStartingRevisionIdState(doc).nextId).toBe(8);
    expect(inferStartingRevisionIdState(parseXml('<root/>')).nextId).toBe(1);
  });

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
