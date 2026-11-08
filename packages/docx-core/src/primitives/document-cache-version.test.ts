import { describe, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml, buildDocxWithAncillaryParts, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { buildSyntheticDocx } from '../integration/synthetic-docx-fixture.js';
import { DocxDocument } from './document.js';
import { getParagraphBookmarkId } from './bookmarks.js';
import { OOXML } from './namespaces.js';
import { parseXml } from './xml.js';
import { DocxZip, readZipText } from './zip.js';

const TEST_FEATURE = 'version-document-view-cache';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

describe('document mutation versions', () => {
  test.openspec('Reads preserve mutation history and valid cache identity')('reading cached views never resets the mutation version', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('before')));
    doc.insertParagraphBookmarks('cache-version');
    const version = doc.getMutationVersion();
    const first = doc.buildDocumentView();
    expect(doc.buildDocumentView().nodes).toBe(first.nodes);
    expect(doc.getMutationVersion()).toBe(version);
    const id = doc.readParagraphs().paragraphs[0]!.id;
    doc.replaceText({ targetParagraphId: id, findText: 'before', replaceText: 'after' });
    expect(doc.getMutationVersion()).toBeGreaterThan(version);
    expect(doc.buildDocumentView().nodes).not.toBe(first.nodes);
    const changed = doc.getMutationVersion();
    doc.buildDocumentView({ showFormatting: true });
    expect(doc.getMutationVersion()).toBe(changed);
  });

  test.openspec('Built-in and notified edits invalidate older views')('official notification invalidates a view after exposed DOM mutation', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('before')));
    doc.insertParagraphBookmarks('cache-notification');
    const first = doc.buildDocumentView();
    const paragraph = doc.getParagraphElementById(doc.readParagraphs().paragraphs[0]!.id)!;
    paragraph.getElementsByTagName('w:t')[0]!.textContent = 'after';
    doc.markMutated();
    const next = doc.buildDocumentView();
    expect(next.nodes).not.toBe(first.nodes);
    expect(next.nodes[0]!.clean_text).toBe('after');
  });

  test('all view options participate in cache validity without changing history', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('text')));
    const version = doc.getMutationVersion();
    for (const options of [
      {}, { includeSemanticTags: false }, { showFormatting: true },
      { showFormatting: true, formattingMode: 'full' as const },
    ]) {
      const previous = doc.buildDocumentView();
      const next = doc.buildDocumentView(options);
      if (Object.keys(options).length) expect(next.nodes).not.toBe(previous.nodes);
      expect(doc.buildDocumentView(options).nodes).toBe(next.nodes);
      expect(doc.getMutationVersion()).toBe(version);
    }
  });

  for (const method of ['acceptChanges', 'rejectChanges'] as const) {
    test(`${method} records a body edit before a later side-part read failure`, async () => {
      const doc = await DocxDocument.load(await buildDocxFromBodyXml(
        '<w:p><w:ins w:id="1" w:author="AI"><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>',
      ));
      doc.insertParagraphBookmarks('resolution-failure');
      const first = doc.buildDocumentView();
      const before = doc.getMutationVersion();
      const read = vi.spyOn(DocxZip.prototype, 'readTextOrNull').mockRejectedValueOnce(new Error('injected part failure'));
      try {
        await expect(doc[method]()).rejects.toThrow('injected part failure');
      } finally {
        read.mockRestore();
      }
      expect(doc.getMutationVersion()).toBeGreaterThan(before);
      expect(doc.buildDocumentView().nodes).not.toBe(first.nodes);
      expect(doc.getDocumentXmlClone().getElementsByTagNameNS(OOXML.W_NS, 'ins').length).toBe(0);
    });
  }

  for (const method of ['acceptAIEdits', 'rejectAIEdits'] as const) {
    test(`${method} advances versions while preserving unselected revisions`, async () => {
      const doc = await DocxDocument.load(await buildDocxFromBodyXml(
        '<w:p><w:ins w:id="1" w:author="AI"><w:r><w:t>chosen</w:t></w:r></w:ins>' +
        '<w:ins w:id="2" w:author="Human"><w:r><w:t>foreign</w:t></w:r></w:ins></w:p>',
      ));
      doc.insertParagraphBookmarks('selective');
      const first = doc.buildDocumentView();
      const before = doc.getMutationVersion();
      await doc[method]({ revisionIds: ['1'] });
      expect(doc.getMutationVersion()).toBeGreaterThan(before);
      expect(doc.buildDocumentView().nodes).not.toBe(first.nodes);
      const revisions = doc.getDocumentXmlClone().getElementsByTagNameNS(OOXML.W_NS, 'ins');
      expect(revisions.length).toBe(1);
      expect(revisions[0]!.getAttributeNS(OOXML.W_NS, 'author')).toBe('Human');
      const after = doc.getMutationVersion();
      await doc[method]({ revisionIds: ['1'] });
      expect(doc.getMutationVersion()).toBe(after);
    });
  }

  for (const method of ['normalize', 'mergeRunsOnly'] as const) {
    for (const [name, xml] of [
      ['proofing markers', '<w:p><w:proofErr w:type="spellStart"/><w:r><w:t>text</w:t></w:r><w:proofErr w:type="spellEnd"/></w:p>'],
      ['single-run rsid', '<w:p><w:r w:rsidR="12345678"><w:t>text</w:t></w:r></w:p>'],
    ] as const) {
      test(`${method} versions removal of ${name} even without run merging`, async () => {
        const doc = await DocxDocument.load(await buildDocxFromBodyXml(xml));
        const first = doc.buildDocumentView();
        const before = doc.getMutationVersion();
        expect(doc[method]().runsMerged).toBe(0);
        expect(doc.getMutationVersion()).toBeGreaterThan(before);
        expect(doc.buildDocumentView().nodes).not.toBe(first.nodes);
        const after = doc.getMutationVersion();
        doc[method]();
        expect(doc.getMutationVersion()).toBe(after);
      });
    }
  }

  test.openspec('Temporary story contexts restore body state without rewinding history')('temporary reads isolate their view and restore the body cache on success and failure', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('body')));
    doc.insertParagraphBookmarks('body');
    const storyDoc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('story')));
    storyDoc.insertParagraphBookmarks('story');
    const story = storyDoc.getDocumentXmlClone();
    const first = doc.buildDocumentView();
    const before = doc.getMutationVersion();
    // Exercise the synchronous seam with a read callback, including its finally path.
    for (const fails of [false, true]) {
      const read = (): void => doc['withTemporaryDocumentXml'](story, () => {
        expect(doc.buildDocumentView().nodes[0]!.clean_text).toBe('story');
        expect(doc.getMutationVersion()).toBe(before);
        if (fails) throw new Error('injected read failure');
      });
      if (fails) expect(read).toThrow('injected read failure');
      else read();
      expect(doc.buildDocumentView().nodes).toBe(first.nodes);
      expect(doc.getMutationVersion()).toBe(before);
    }
  });

  test('temporary mutation followed by failure never decreases observable history', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('body')));
    doc.insertParagraphBookmarks('body');
    const first = doc.buildDocumentView();
    let observed = doc.getMutationVersion();
    expect(() => doc['withTemporaryDocumentXml'](doc.getDocumentXmlClone(), () => {
      doc.markMutated();
      observed = doc.getMutationVersion();
      doc.buildDocumentView();
      throw new Error('injected mutation failure');
    })).toThrow('injected mutation failure');
    expect(doc.getMutationVersion()).toBe(observed);
    expect(doc.buildDocumentView().nodes).not.toBe(first.nodes);
    expect(doc.buildDocumentView().nodes[0]!.clean_text).toBe('body');
  });

  test('selected story writes advance history and reads preserve the body cache', async () => {
    const partPath = 'word/header1.xml';
    const doc = await DocxDocument.load(await buildDocxWithAncillaryParts({
      bodyXml: paragraphWithText('body'),
      sectPrXml: '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>',
      relationships: [{ id: 'rIdHeader', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', target: 'header1.xml' }],
      parts: [{ path: partPath, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml', xml: `<w:hdr xmlns:w="${OOXML.W_NS}">${paragraphWithText('header')}</w:hdr>` }],
    }));
    doc.insertParagraphBookmarks('body');
    let before = doc.getMutationVersion();
    await doc.insertStoryParagraphBookmarks(partPath, 'story-cache');
    expect(doc.getMutationVersion()).toBeGreaterThan(before);
    const xml = await readZipText((await doc.toBuffer()).buffer, partPath);
    const paragraph = parseXml(xml!).getElementsByTagNameNS(OOXML.W_NS, 'p')[0]!;
    const id = getParagraphBookmarkId(paragraph)!;
    const steps = [
      () => doc.replaceStoryText({ partPath, targetParagraphId: id, findText: 'header', replaceText: 'changed' }),
      () => doc.replaceStoryTextAtRange({ partPath, targetParagraphId: id, start: 0, end: 7, replaceText: 'ranged' }),
      () => doc.formatStoryTextAtRange({ partPath, targetParagraphId: id, start: 0, end: 6, format: { underline: 'single' } }),
      () => doc.insertStoryParagraph({ partPath, positionalAnchorNodeId: id, relativePosition: 'AFTER', newText: 'inserted' }),
      () => doc.deleteStoryParagraph(partPath, id),
    ];
    for (const mutate of steps) {
      const first = doc.buildDocumentView();
      before = doc.getMutationVersion();
      await doc.getStoryParagraphById(partPath, id);
      await doc.validateStoryParagraphTableCell(partPath, id);
      expect(doc.getMutationVersion()).toBe(before);
      expect(doc.buildDocumentView().nodes).toBe(first.nodes);
      await mutate();
      expect(doc.getMutationVersion()).toBeGreaterThan(before);
      expect(doc.buildDocumentView().nodes).not.toBe(first.nodes);
      expect(doc.buildDocumentView().nodes[0]!.clean_text).toBe('body');
    }
    const saved = (await doc.toBuffer()).buffer;
    expect(await readZipText(saved, partPath)).toContain('inserted');
    expect(await readZipText(saved, partPath)).not.toContain('ranged');
  });

  test('package-only footnote and comment writes advance the document version', async () => {
    const doc = await DocxDocument.load(await buildSyntheticDocx({
      paragraphs: ['body'], footnoteOnParagraph: 0, footnoteText: 'note',
      commentOnParagraph: 0, commentText: 'comment',
    }));
    const note = (await doc.getFootnotes())[0]!;
    const comment = (await doc.getComments())[0]!;
    for (const mutate of [
      () => doc.updateFootnoteText({ noteId: note.id, newText: 'changed note' }),
      () => doc.updateCommentBody({ commentId: comment.id, text: 'changed comment' }),
    ]) {
      const first = doc.buildDocumentView();
      const before = doc.getMutationVersion();
      await mutate();
      expect(doc.getMutationVersion()).toBeGreaterThan(before);
      expect(doc.buildDocumentView().nodes).not.toBe(first.nodes);
    }
    expect((await doc.getFootnotes())[0]!.text).toContain('changed note');
    expect((await doc.getComments())[0]!.text).toBe('changed comment');
  });

  test.openspec('Serialization failure preserves mutation history and baseline')('failed serialization preserves cache, version, and the minimal-reserialization baseline', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(
      '<w:p><w:proofErr w:type="spellStart"/><w:r><w:t>untouched</w:t></w:r></w:p>' + paragraphWithText('before'),
    ));
    doc.normalize();
    doc.insertParagraphBookmarks('baseline');
    const id = doc.readParagraphs().paragraphs[1]!.id;
    doc.replaceText({ targetParagraphId: id, findText: 'before', replaceText: 'after' });
    const first = doc.buildDocumentView();
    const version = doc.getMutationVersion();
    const generate = vi.spyOn(JSZip.prototype, 'generateAsync').mockRejectedValueOnce(new Error('injected save failure'));
    try {
      await expect(doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true })).rejects.toThrow('injected save failure');
    } finally {
      generate.mockRestore();
    }
    const saved = await doc.toBuffer({ cleanBookmarks: true, minimalReserialization: true });
    expect(saved.blocksRestored).toBeGreaterThan(0);
    expect(await readZipText(saved.buffer, 'word/document.xml')).toContain('proofErr');
    expect(await readZipText(saved.buffer, 'word/document.xml')).toContain('after');
    expect(doc.getMutationVersion()).toBe(version);
    expect(doc.buildDocumentView().nodes).toBe(first.nodes);
  });
});
