import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import JSZip from 'jszip';
import { DocxDocument } from '../src/primitives/document.js';
import { DocxZip } from '../src/primitives/zip.js';
import { createRevisionContext, createRevisionIdState } from '../src/primitives/track-changes-emitter.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Document' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

async function makeDocxBuffer(bodyXml: string, extraFiles?: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', makeDocXml(bodyXml));
  if (extraFiles) {
    for (const [name, text] of Object.entries(extraFiles)) {
      zip.file(name, text);
    }
  }
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

async function getDocumentXmlFromBuffer(buffer: Buffer): Promise<string> {
  const zip = await DocxZip.load(buffer);
  return zip.readText('word/document.xml');
}

async function getPartXmlFromBuffer(buffer: Buffer, partPath: string): Promise<string> {
  const zip = await DocxZip.load(buffer);
  return zip.readText(partPath);
}

describe('DocxDocument', () => {
  test('reads paragraphs with offset/limit/nodeIds and supports negative offsets', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: DocxDocument;
    let all!: ReturnType<DocxDocument['readParagraphs']>;

    await given('a document with three paragraphs Alpha, Beta, Gamma', async () => {
      const buffer = await makeDocxBuffer(
        `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Beta</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Gamma</w:t></w:r></w:p>`
      );
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_test');
    });

    await when('readParagraphs is called without options', () => {
      all = doc.readParagraphs();
    });

    await then('all three paragraphs are returned in order', () => {
      expect(all.totalParagraphs).toBe(3);
      expect(all.paragraphs.map((p) => p.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    await and('offset/limit returns the correct slice', () => {
      const byOffset = doc.readParagraphs({ offset: 2, limit: 1 });
      expect(byOffset.paragraphs.map((p) => p.text)).toEqual(['Beta']);
    });

    await and('negative offset returns the last paragraph', () => {
      const byNegativeOffset = doc.readParagraphs({ offset: -1 });
      expect(byNegativeOffset.paragraphs.map((p) => p.text)).toEqual(['Gamma']);
    });

    await and('nodeIds filter returns only the requested paragraphs', () => {
      const ids = all.paragraphs.map((p) => p.id);
      const byNodeId = doc.readParagraphs({ nodeIds: [ids[0]!, ids[2]!] });
      expect(byNodeId.paragraphs.map((p) => p.text)).toEqual(['Alpha', 'Gamma']);
    });
  });

  test('reuses document-view cache and invalidates cache after edits', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: DocxDocument;
    let first!: ReturnType<DocxDocument['buildDocumentView']>;
    let paraId!: string;

    await given('a document with one paragraph and bookmarks inserted', async () => {
      const buffer = await makeDocxBuffer(`<w:p><w:r><w:t>Alpha Beta</w:t></w:r></w:p>`);
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_cache');
    });

    await when('buildDocumentView is called twice with the same options', () => {
      first = doc.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
      const second = doc.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
      expect(second.nodes).toBe(first.nodes);
    });

    await then('cache is invalidated after replaceText', () => {
      paraId = first.nodes[0]!.id;
      doc.replaceText({
        targetParagraphId: paraId,
        findText: 'Alpha',
        replaceText: 'Omega',
      });

      const third = doc.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
      expect(third.nodes).not.toBe(first.nodes);
      expect(third.nodes[0]!.clean_text).toContain('Omega Beta');
    });
  });

  test('inserts paragraphs BEFORE/AFTER anchor and returns stable IDs', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: DocxDocument;
    let anchorId!: string;
    let after!: ReturnType<DocxDocument['insertParagraph']>;
    let before!: ReturnType<DocxDocument['insertParagraph']>;

    await given('a document with First and Anchor paragraphs', async () => {
      const buffer = await makeDocxBuffer(
        `<w:p><w:r><w:t>First</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Anchor</w:t></w:r></w:p>`
      );
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_insert');

      const base = doc.buildDocumentView({ includeSemanticTags: false });
      anchorId = base.nodes.find((n) => n.clean_text === 'Anchor')?.id!;
      expect(anchorId).toBeTruthy();
    });

    await when('insertParagraph AFTER anchor with two new paragraphs', () => {
      after = doc.insertParagraph({
        positionalAnchorNodeId: anchorId,
        relativePosition: 'AFTER',
        newText: 'After One\n\nAfter Two',
      });
    });

    await then('two new paragraph IDs with correct bookmark format are returned', () => {
      expect(after.newParagraphIds).toHaveLength(2);
      expect(after.newParagraphIds[0]).toMatch(/^_bk_[0-9a-f]{12}$/);
      expect(after.newParagraphIds[1]).toMatch(/^_bk_[0-9a-f]{12}$/);
    });

    await when('insertParagraph BEFORE anchor with one new paragraph', () => {
      before = doc.insertParagraph({
        positionalAnchorNodeId: anchorId,
        relativePosition: 'BEFORE',
        newText: 'Before One',
      });
    });

    await then('one new paragraph ID is returned', () => {
      expect(before.newParagraphIds).toHaveLength(1);
    });

    await and('document order is Before → Anchor → After One → After Two', () => {
      const view = doc.buildDocumentView({ includeSemanticTags: false });
      const ordered = view.nodes.map((n) => n.clean_text);
      const idxBefore = ordered.indexOf('Before One');
      const idxAnchor = ordered.indexOf('Anchor');
      const idxAfterOne = ordered.indexOf('After One');
      const idxAfterTwo = ordered.indexOf('After Two');
      expect(idxBefore).toBeGreaterThanOrEqual(0);
      expect(idxAnchor).toBeGreaterThan(idxBefore);
      expect(idxAfterOne).toBeGreaterThan(idxAnchor);
      expect(idxAfterTwo).toBeGreaterThan(idxAfterOne);
    });
  });

  test('adds comments/replies through DocxDocument wrapper and exposes them', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: DocxDocument;
    let paraId!: string;
    let root!: Awaited<ReturnType<DocxDocument['addComment']>>;
    let reply!: Awaited<ReturnType<DocxDocument['addCommentReply']>>;

    await given('a document with one paragraph and bookmarks inserted', async () => {
      const buffer = await makeDocxBuffer(`<w:p><w:r><w:t>Comment target text</w:t></w:r></w:p>`);
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_comments');
      paraId = doc.readParagraphs().paragraphs[0]!.id;
    });

    await when('a root comment is added', async () => {
      root = await doc.addComment({
        paragraphId: paraId,
        start: 0,
        end: 7,
        author: 'Reviewer',
        text: 'Root comment',
      });
    });

    await then('a valid comment ID is returned', () => {
      expect(root.commentId).toBeGreaterThanOrEqual(0);
    });

    await when('a reply is added to the root comment', async () => {
      reply = await doc.addCommentReply({
        parentCommentId: root.commentId,
        author: 'Reviewer 2',
        text: 'Reply text',
      });
    });

    await then('reply is linked to the root comment', () => {
      expect(reply.parentCommentId).toBe(root.commentId);
    });

    await and('getComments returns the thread with the reply nested under root', async () => {
      const comments = await doc.getComments();
      expect(comments.length).toBeGreaterThanOrEqual(1);
      expect(comments.some((c) => c.replies.some((r) => r.id === reply.commentId))).toBe(true);
      const fetchedRoot = await doc.getComment(root.commentId);
      expect(fetchedRoot?.text).toContain('Root comment');
      const fetchedReply = await doc.getComment(reply.commentId);
      expect(fetchedReply?.text).toContain('Reply text');
    });
  });

  test('clean bookmark export removes jr_para markers without mutating session state', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: DocxDocument;
    let existingId!: string;
    let cleanOut!: Awaited<ReturnType<DocxDocument['toBuffer']>>;

    await given('a document with two paragraphs and bookmarks inserted', async () => {
      const buffer = await makeDocxBuffer(
        `<w:p><w:r><w:t>One</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Two</w:t></w:r></w:p>`
      );
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_clean');
      existingId = doc.readParagraphs().paragraphs[0]!.id;
    });

    await when('toBuffer is called with cleanBookmarks: true', async () => {
      cleanOut = await doc.toBuffer({ cleanBookmarks: true });
    });

    await then('bookmarks are removed from the exported XML', async () => {
      expect(cleanOut.bookmarksRemoved).toBeGreaterThan(0);
      const cleanXml = await getDocumentXmlFromBuffer(cleanOut.buffer);
      expect(cleanXml.includes('_bk_')).toBe(false);
    });

    await and('in-memory session state is not mutated and paragraph is still addressable', () => {
      expect(doc.getParagraphTextById(existingId)).toBe('One');
    });

    await and('toBuffer with cleanBookmarks: false retains bookmark markers', async () => {
      const rawOut = await doc.toBuffer({ cleanBookmarks: false });
      const rawXml = await getDocumentXmlFromBuffer(rawOut.buffer);
      expect(rawXml.includes('_bk_')).toBe(true);
    });
  });

  test('mergeRunsOnly and acceptChanges wrappers update document content', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: DocxDocument;

    await given('a document with split runs and a tracked insertion', async () => {
      const buffer = await makeDocxBuffer(
        `<w:p>` +
        `<w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo</w:t></w:r>` +
        `<w:ins w:author="A" w:date="2025-01-01T00:00:00Z"><w:r><w:t> New</w:t></w:r></w:ins>` +
        `</w:p>`
      );
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_norm');
    });

    await when('mergeRunsOnly is called', () => {
      const merge = doc.mergeRunsOnly();
      expect(merge.runsMerged).toBeGreaterThanOrEqual(1);
    });

    await when('acceptChanges is called', async () => {
      const accepted = await doc.acceptChanges();
      expect(accepted.insertionsAccepted).toBeGreaterThanOrEqual(1);
    });

    await then('document text contains the accepted insertion', () => {
      const text = doc.readParagraphs().paragraphs[0]!.text;
      expect(text).toContain('Hello New');
    });
  });

  test('acceptChanges cleans tracked insertions from document.xml and footnotes.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let doc!: DocxDocument;
    let result!: Awaited<ReturnType<DocxDocument['acceptChanges']>>;
    let documentXml!: string;
    let footnotesXml!: string;

    await given('a document with an AI-authored tracked footnote insertion', async () => {
      const buffer = await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_accept_footnote');
      const paragraphId = doc.readParagraphs().paragraphs[0]!.id;
      await doc.addFootnote(
        { paragraphId, text: 'Tracked footnote' },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await when('acceptChanges is called', async () => {
      result = await doc.acceptChanges();
      const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
      documentXml = await getPartXmlFromBuffer(buffer, 'word/document.xml');
      footnotesXml = await getPartXmlFromBuffer(buffer, 'word/footnotes.xml');
    });

    await then('both the body story and footnote story are clean', () => {
      expect(result.insertionsAccepted).toBeGreaterThanOrEqual(2);
      expect(documentXml).not.toContain('<w:ins');
      expect(documentXml).not.toContain('<w:del');
      expect(footnotesXml).not.toContain('<w:ins');
      expect(footnotesXml).not.toContain('<w:del');
      expect(footnotesXml).toContain('Tracked footnote');
    });
  });

  test('rejectChanges restores tracked footnote text replacements in footnotes.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let doc!: DocxDocument;
    let result!: Awaited<ReturnType<DocxDocument['rejectChanges']>>;
    let footnotesXml!: string;

    await given('a document with an existing footnote updated under tracked changes', async () => {
      const buffer = await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_reject_footnote');
      const paragraphId = doc.readParagraphs().paragraphs[0]!.id;
      const added = await doc.addFootnote({ paragraphId, text: 'Original footnote' });
      await doc.updateFootnoteText(
        { noteId: added.noteId, newText: 'Replacement footnote' },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await when('rejectChanges is called', async () => {
      result = await doc.rejectChanges();
      const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
      footnotesXml = await getPartXmlFromBuffer(buffer, 'word/footnotes.xml');
    });

    await then('the footnote story is clean and contains the original note text', () => {
      expect(result.insertionsRemoved).toBeGreaterThanOrEqual(1);
      expect(result.deletionsRestored).toBeGreaterThanOrEqual(1);
      expect(footnotesXml).not.toContain('<w:ins');
      expect(footnotesXml).not.toContain('<w:del');
      expect(footnotesXml).not.toContain('<w:delText');
      expect(footnotesXml).toContain('Original footnote');
      expect(footnotesXml).not.toContain('Replacement footnote');
    });
  });

  test('rejectChanges prunes the orphan footnote entry when an inserted footnote is rejected', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let doc!: DocxDocument;
    let documentXml!: string;
    let footnotesXml!: string;
    let noteId!: number;

    await given('a document with a tracked-inserted footnote', async () => {
      const buffer = await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_reject_added_footnote');
      const paragraphId = doc.readParagraphs().paragraphs[0]!.id;
      const added = await doc.addFootnote(
        { paragraphId, text: 'Tracked footnote' },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
      noteId = added.noteId;
    });

    await when('rejectChanges is called', async () => {
      await doc.rejectChanges();
      const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
      documentXml = await getPartXmlFromBuffer(buffer, 'word/document.xml');
      footnotesXml = await getPartXmlFromBuffer(buffer, 'word/footnotes.xml');
    });

    await then('the body reference and the orphan footnote entry are both gone', () => {
      expect(documentXml).not.toContain('<w:footnoteReference');
      expect(documentXml).not.toContain('<w:ins');
      expect(footnotesXml).not.toContain(`w:id="${noteId}"`);
      expect(footnotesXml).not.toContain('Tracked footnote');
      // Reserved entries (separator / continuationSeparator) survive.
      expect(footnotesXml).toContain('w:type="separator"');
      expect(footnotesXml).toContain('w:type="continuationSeparator"');
    });
  });

  test('acceptChanges prunes the footnote entry when a tracked-deleted footnote is accepted', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let doc!: DocxDocument;
    let documentXml!: string;
    let footnotesXml!: string;
    let noteId!: number;

    await given('a document with an existing footnote marked for deletion under tracked changes', async () => {
      const buffer = await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_accept_deleted_footnote');
      const paragraphId = doc.readParagraphs().paragraphs[0]!.id;
      const added = await doc.addFootnote({ paragraphId, text: 'Doomed footnote' });
      noteId = added.noteId;
      await doc.deleteFootnote(
        { noteId },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await when('acceptChanges is called', async () => {
      await doc.acceptChanges();
      const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
      documentXml = await getPartXmlFromBuffer(buffer, 'word/document.xml');
      footnotesXml = await getPartXmlFromBuffer(buffer, 'word/footnotes.xml');
    });

    await then('the body reference and the now-orphaned footnote entry are both gone', () => {
      expect(documentXml).not.toContain('<w:footnoteReference');
      expect(documentXml).not.toContain('<w:del');
      expect(footnotesXml).not.toContain(`w:id="${noteId}"`);
      expect(footnotesXml).not.toContain('Doomed footnote');
      expect(footnotesXml).toContain('w:type="separator"');
      expect(footnotesXml).toContain('w:type="continuationSeparator"');
    });
  });

  test('rejectChanges restores a tracked-deleted footnote and its body reference', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let doc!: DocxDocument;
    let documentXml!: string;
    let footnotesXml!: string;
    let noteId!: number;

    await given('a document with an existing footnote marked for deletion under tracked changes', async () => {
      const buffer = await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_reject_deleted_footnote');
      const paragraphId = doc.readParagraphs().paragraphs[0]!.id;
      const added = await doc.addFootnote({ paragraphId, text: 'Surviving footnote' });
      noteId = added.noteId;
      await doc.deleteFootnote(
        { noteId },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await when('rejectChanges is called', async () => {
      await doc.rejectChanges();
      const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
      documentXml = await getPartXmlFromBuffer(buffer, 'word/document.xml');
      footnotesXml = await getPartXmlFromBuffer(buffer, 'word/footnotes.xml');
    });

    await then('the body reference and the original footnote text are restored', () => {
      expect(documentXml).toContain(`<w:footnoteReference w:id="${noteId}"`);
      expect(documentXml).not.toContain('<w:del');
      expect(footnotesXml).toContain(`w:id="${noteId}"`);
      expect(footnotesXml).toContain('Surviving footnote');
      expect(footnotesXml).not.toContain('<w:del');
      expect(footnotesXml).not.toContain('<w:delText');
    });
  });

  test('acceptChanges accepts a tracked footnote text replacement and leaves clean text', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let doc!: DocxDocument;
    let footnotesXml!: string;
    let noteId!: number;

    await given('a document with a footnote whose text has been replaced under tracked changes', async () => {
      const buffer = await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      doc = await DocxDocument.load(buffer);
      doc.insertParagraphBookmarks('mcp_accept_updated_footnote');
      const paragraphId = doc.readParagraphs().paragraphs[0]!.id;
      const added = await doc.addFootnote({ paragraphId, text: 'Original footnote' });
      noteId = added.noteId;
      await doc.updateFootnoteText(
        { noteId, newText: 'Replacement footnote' },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await when('acceptChanges is called', async () => {
      await doc.acceptChanges();
      const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
      footnotesXml = await getPartXmlFromBuffer(buffer, 'word/footnotes.xml');
    });

    await then('the replacement text wins and no revision markup remains', () => {
      expect(footnotesXml).toContain(`w:id="${noteId}"`);
      expect(footnotesXml).toContain('Replacement footnote');
      expect(footnotesXml).not.toContain('Original footnote');
      expect(footnotesXml).not.toContain('<w:ins');
      expect(footnotesXml).not.toContain('<w:del');
      expect(footnotesXml).not.toContain('<w:delText');
    });
  });
});
