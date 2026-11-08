import { afterEach, describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRevisionContext, createRevisionIdState, allocateRevisionId, OOXML } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { SessionManager, getRevisionContextForSession } from './manager.js';
import { replaceText } from '../tools/replace_text.js';
import { ok, err } from '../tools/types.js';

const TEST_FEATURE = 'encapsulate-revision-id-readiness';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const managers: SessionManager[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(managers.splice(0).map(manager => manager.clearAllSessions()));
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function setup(parts: Record<string, string> = {}, section = '') {
  const manager = new SessionManager({ defaultAiAuthor: 'Agent' });
  managers.push(manager);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'revision-readiness-'));
  dirs.push(dir);
  const file = path.join(dir, 'input.docx');
  const buffer = await makeDocxWithDocumentXml(
    `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>First</w:t></w:r></w:p>${section}</w:body></w:document>`, parts,
  );
  await fs.writeFile(file, buffer);
  const session = await manager.createSession(buffer, 'input.docx', file);
  const id = session.doc.buildDocumentView({ includeSemanticTags: false }).nodes[0]!.id;
  const edit = (oldText = 'First', newText = 'Next') => replaceText(manager, {
    file_path: file, target_paragraph_id: id, old_string: oldText, new_string: newText, instruction: 'Synthetic test',
  });
  return { manager, session, file, id, edit };
}

describe('managed session revision readiness', () => {
  test.openspec('Shared first seed and retry')('concurrent direct callers share the seed and advanced data identity', async () => {
    const { session } = await setup();
    const entered = barrier();
    const resume = barrier();
    const original = session.doc.getRevisionSeedDocuments.bind(session.doc);
    const scan = vi.spyOn(session.doc, 'getRevisionSeedDocuments').mockImplementation(async () => {
      entered.release();
      await resume.promise;
      return original();
    });
    const first = getRevisionContextForSession(session).then(ctx => {
      expect(allocateRevisionId(ctx!.idState)).toBe(1);
      return ctx!;
    });
    const second = getRevisionContextForSession(session);
    const third = getRevisionContextForSession(session);
    await entered.promise;
    expect(session.revisionIdState).toBeNull();
    resume.release();
    const contexts = await Promise.all([first, second, third]);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(contexts.every(ctx => ctx!.idState === session.revisionIdState)).toBe(true);
    expect(allocateRevisionId(contexts[2]!.idState)).toBe(2);
  });

  test.openspec('Shared first seed and retry')('seed failure leaves session unseeded and concurrent retry succeeds', async () => {
    const { session } = await setup();
    const original = session.doc.getRevisionSeedDocuments.bind(session.doc);
    const scan = vi.spyOn(session.doc, 'getRevisionSeedDocuments')
      .mockRejectedValueOnce(new Error('transient seed read'))
      .mockImplementation(original);
    await expect(getRevisionContextForSession(session)).rejects.toThrow('transient seed read');
    expect(session.revisionIdState).toBeNull();
    const [a, b] = await Promise.all([getRevisionContextForSession(session), getRevisionContextForSession(session)]);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(a!.idState).toBe(b!.idState);
    expect(allocateRevisionId(a!.idState)).toBe(1);
  });

  for (const seedBefore of [false, true]) {
    test.openspec('Candidate allocation publication')(`failure after tentative allocations preserves active counter (seed before mutation: ${seedBefore})`, async () => {
      const { manager, session, id, edit } = await setup();
      const direct = seedBefore ? await getRevisionContextForSession(session) : undefined;
      const identity = session.revisionIdState;
      const before = await session.doc.getMutationSnapshot();
      const response = await manager.mutateSession(session, async candidate => {
        const ctx = await getRevisionContextForSession(candidate);
        candidate.doc.insertParagraph({ positionalAnchorNodeId: id, relativePosition: 'AFTER', newText: 'Discarded' }, ctx);
        expect(ctx!.idState.nextId).toBeGreaterThan(1);
        return err('INJECTED', 'after allocation');
      });
      expect(response.success).toBe(false);
      expect(session.revisionIdState).toBe(identity);
      expect(identity?.nextId ?? 1).toBe(1);
      expect(await session.doc.getMutationSnapshot()).toEqual(before);
      expect((await edit()).success).toBe(true);
      const ids = Array.from(session.doc.getDocumentXmlClone().getElementsByTagNameNS(OOXML.W_NS, 'ins')).map(el => Number(el.getAttribute('w:id')));
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every(value => value >= 1 && value < session.revisionIdState!.nextId)).toBe(true);
      if (direct) {
        expect(session.revisionIdState).toBe(direct.idState);
        expect(allocateRevisionId(direct.idState)).toBeGreaterThan(Math.max(...ids));
      }
    });
  }

  test('failed candidate seed retries on the next mutation without publishing state', async () => {
    const { session, edit } = await setup();
    const scan = vi.spyOn(session.doc, 'getRevisionSeedDocuments').mockRejectedValueOnce(new Error('seed failure'));
    expect((await edit()).success).toBe(false);
    expect(session.revisionIdState).toBeNull();
    expect(session.editRevision).toBe(0);
    expect((await edit()).success).toBe(true);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(session.revisionIdState!.nextId).toBeGreaterThan(1);
  });

  test('a no-op candidate preserves null or ready active allocator identity', async () => {
    const { session, edit } = await setup();
    for (const seedBefore of [false, true]) {
      if (seedBefore) await getRevisionContextForSession(session);
      const identity = session.revisionIdState;
      expect((await edit('First', 'First')).success).toBe(true);
      expect(session.revisionIdState).toBe(identity);
      expect(session.editRevision).toBe(0);
    }
  });

  test('a retired candidate finishing its seed cannot publish into a reopened session', async () => {
    const { manager, session, file, id } = await setup();
    const entered = barrier();
    const resume = barrier();
    const original = session.doc.getRevisionSeedDocuments.bind(session.doc);
    vi.spyOn(session.doc, 'getRevisionSeedDocuments').mockImplementation(async () => {
      entered.release();
      await resume.promise;
      return original();
    });
    const pending = manager.mutateSession(session, async candidate => {
      const ctx = await getRevisionContextForSession(candidate);
      candidate.doc.insertParagraph({ positionalAnchorNodeId: id, relativePosition: 'AFTER', newText: 'Retired' }, ctx);
      return ok();
    });
    await entered.promise;
    await manager.clearSessionByPath(file);
    const replacement = await manager.createSession(session.originalBuffer, 'input.docx', file);
    const current = await getRevisionContextForSession(replacement);
    const allocated = allocateRevisionId(current!.idState);
    resume.release();
    expect(await pending).toMatchObject({ success: false, error: { code: 'SESSION_CLOSED' } });
    expect(session.revisionIdState).toBeNull();
    expect(replacement.revisionIdState).toBe(current!.idState);
    expect(allocateRevisionId(current!.idState)).toBe(allocated + 1);
    expect(replacement.editCount).toBe(0);
  });

  test('overlapping direct allocation refuses a stale candidate and later edits remain collision-free', async () => {
    const { manager, session, id, edit } = await setup();
    const response = await manager.mutateSession(session, async candidate => {
      const ctx = await getRevisionContextForSession(candidate);
      candidate.doc.insertParagraph({ positionalAnchorNodeId: id, relativePosition: 'AFTER', newText: 'Conflict' }, ctx);
      const direct = await getRevisionContextForSession(session);
      expect(allocateRevisionId(direct!.idState)).toBe(1);
      return ok();
    });
    expect(response).toMatchObject({ success: false, error: { code: 'REVISION_ID_CONFLICT' } });
    expect(session.doc.getParagraphTextById(id)).toBe('First');
    expect(session.revisionIdState!.nextId).toBe(2);
    expect((await edit()).success).toBe(true);
    const xml = session.doc.getDocumentXmlClone();
    const wrappers = [...Array.from(xml.getElementsByTagNameNS(OOXML.W_NS, 'ins')), ...Array.from(xml.getElementsByTagNameNS(OOXML.W_NS, 'del'))];
    expect(wrappers.length).toBeGreaterThan(0);
    expect(wrappers.every(el => Number(el.getAttribute('w:id')) > 1)).toBe(true);
  });

  for (const [part, root, container] of [
    ['word/footnotes.xml', 'footnotes', 'footnote'],
    ['word/endnotes.xml', 'endnotes', 'endnote'],
    ['word/comments.xml', 'comments', 'comment'],
    ['word/glossary/document.xml', 'glossaryDocument', 'docPartBody'],
    ['word/letterhead.xml', 'hdr', ''],
    ['word/legal-footer.xml', 'ftr', ''],
  ] as const) {
    test.openspec('Supported story maxima')(`first tracked edit seeds above ${part} revisions and ignores unrelated IDs`, async () => {
      const kind = root === 'hdr' ? 'header' : root === 'ftr' ? 'footer' : null;
      const section = kind ? `<w:sectPr><w:${kind}Reference w:type="default" r:id="rStory"/></w:sectPr>` : '';
      const paragraph = '<w:p><w:ins w:id="500" w:author="Human"><w:r><w:t>Side</w:t></w:r></w:ins></w:p>';
      const content = root === 'glossaryDocument'
        ? `<w:docParts><w:docPart><w:docPartPr><w:name w:val="Synthetic"/></w:docPartPr><w:docPartBody>${paragraph}</w:docPartBody></w:docPart></w:docParts>`
        : container ? `<w:${container} w:id="9999">${paragraph}</w:${container}>` : paragraph;
      const parts: Record<string, string> = { [part]: `<w:${root} xmlns:w="${OOXML.W_NS}">${content}</w:${root}>` };
      if (kind) parts['word/_rels/document.xml.rels'] = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStory" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${path.basename(part)}"/></Relationships>`;
      const { session, edit } = await setup(parts, section);
      expect((await edit()).success).toBe(true);
      const xml = session.doc.getDocumentXmlClone();
      const wrappers = [...Array.from(xml.getElementsByTagNameNS(OOXML.W_NS, 'ins')), ...Array.from(xml.getElementsByTagNameNS(OOXML.W_NS, 'del'))];
      expect(wrappers.length).toBeGreaterThan(0);
      expect(wrappers.every(el => Number(el.getAttribute('w:id')) > 500 && Number(el.getAttribute('w:id')) < 9999)).toBe(true);
    });
  }

  test('seeds current side-story edits instead of the original input buffer', async () => {
    const { session, id } = await setup();
    const custom = createRevisionContext({ author: 'Earlier', idState: createRevisionIdState(700) });
    await session.doc.addFootnote({ paragraphId: id, afterText: 'First', text: 'Existing tracked note' }, custom);
    const before = custom.idState.nextId;
    const ctx = await getRevisionContextForSession(session);
    expect(ctx!.idState.nextId).toBe(before);
  });
});
