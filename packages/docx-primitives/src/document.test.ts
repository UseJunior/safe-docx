import { describe, expect } from 'vitest';
import { itAllure as it } from '../test/helpers/allure-test.js';
import JSZip from 'jszip';
import { DocxDocument } from './document.js';
import { DocxZip } from './zip.js';

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

describe('DocxDocument', () => {
  it('reads paragraphs with offset/limit/nodeIds and supports negative offsets', async () => {
    const buffer = await makeDocxBuffer(
      `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Beta</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Gamma</w:t></w:r></w:p>`
    );
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('mcp_test');

    const all = doc.readParagraphs();
    expect(all.totalParagraphs).toBe(3);
    expect(all.paragraphs.map((p) => p.text)).toEqual(['Alpha', 'Beta', 'Gamma']);

    const byOffset = doc.readParagraphs({ offset: 2, limit: 1 });
    expect(byOffset.paragraphs.map((p) => p.text)).toEqual(['Beta']);

    const byNegativeOffset = doc.readParagraphs({ offset: -1 });
    expect(byNegativeOffset.paragraphs.map((p) => p.text)).toEqual(['Gamma']);

    const ids = all.paragraphs.map((p) => p.id);
    const byNodeId = doc.readParagraphs({ nodeIds: [ids[0]!, ids[2]!] });
    expect(byNodeId.paragraphs.map((p) => p.text)).toEqual(['Alpha', 'Gamma']);
  });

  it('reuses document-view cache and invalidates cache after edits', async () => {
    const buffer = await makeDocxBuffer(`<w:p><w:r><w:t>Alpha Beta</w:t></w:r></w:p>`);
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('mcp_cache');

    const first = doc.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
    const second = doc.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
    expect(second.nodes).toBe(first.nodes);

    const paraId = first.nodes[0]!.id;
    doc.replaceText({
      targetParagraphId: paraId,
      findText: 'Alpha',
      replaceText: 'Omega',
    });

    const third = doc.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
    expect(third.nodes).not.toBe(first.nodes);
    expect(third.nodes[0]!.clean_text).toContain('Omega Beta');
  });

  it('inserts paragraphs BEFORE/AFTER anchor and returns stable IDs', async () => {
    const buffer = await makeDocxBuffer(
      `<w:p><w:r><w:t>First</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Anchor</w:t></w:r></w:p>`
    );
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('mcp_insert');

    const base = doc.buildDocumentView({ includeSemanticTags: false });
    const anchorId = base.nodes.find((n) => n.clean_text === 'Anchor')?.id;
    expect(anchorId).toBeTruthy();

    const after = doc.insertParagraph({
      positionalAnchorNodeId: anchorId!,
      relativePosition: 'AFTER',
      newText: 'After One\n\nAfter Two',
    });
    expect(after.newParagraphIds).toHaveLength(2);
    expect(after.newParagraphIds[0]).toMatch(/^_bk_[0-9a-f]{12}$/);
    expect(after.newParagraphIds[1]).toMatch(/^_bk_[0-9a-f]{12}$/);

    const before = doc.insertParagraph({
      positionalAnchorNodeId: anchorId!,
      relativePosition: 'BEFORE',
      newText: 'Before One',
    });
    expect(before.newParagraphIds).toHaveLength(1);

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

  it('adds comments/replies through DocxDocument wrapper and exposes them', async () => {
    const buffer = await makeDocxBuffer(`<w:p><w:r><w:t>Comment target text</w:t></w:r></w:p>`);
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('mcp_comments');
    const paraId = doc.readParagraphs().paragraphs[0]!.id;

    const root = await doc.addComment({
      paragraphId: paraId,
      start: 0,
      end: 7,
      author: 'Reviewer',
      text: 'Root comment',
    });
    expect(root.commentId).toBeGreaterThanOrEqual(0);

    const reply = await doc.addCommentReply({
      parentCommentId: root.commentId,
      author: 'Reviewer 2',
      text: 'Reply text',
    });
    expect(reply.parentCommentId).toBe(root.commentId);

    const comments = await doc.getComments();
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments.some((c) => c.replies.some((r) => r.id === reply.commentId))).toBe(true);
    const fetchedRoot = await doc.getComment(root.commentId);
    expect(fetchedRoot?.text).toContain('Root comment');
    const fetchedReply = await doc.getComment(reply.commentId);
    expect(fetchedReply?.text).toContain('Reply text');
  });

  it('clean bookmark export removes jr_para markers without mutating session state', async () => {
    const buffer = await makeDocxBuffer(
      `<w:p><w:r><w:t>One</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Two</w:t></w:r></w:p>`
    );
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('mcp_clean');
    const existingId = doc.readParagraphs().paragraphs[0]!.id;

    const cleanOut = await doc.toBuffer({ cleanBookmarks: true });
    expect(cleanOut.bookmarksRemoved).toBeGreaterThan(0);
    // State remains queryable by original paragraph id.
    expect(doc.getParagraphTextById(existingId)).toBe('One');

    const cleanXml = await getDocumentXmlFromBuffer(cleanOut.buffer);
    expect(cleanXml.includes('_bk_')).toBe(false);

    const rawOut = await doc.toBuffer({ cleanBookmarks: false });
    const rawXml = await getDocumentXmlFromBuffer(rawOut.buffer);
    expect(rawXml.includes('_bk_')).toBe(true);
  });

  it('mergeRunsOnly and acceptChanges wrappers update document content', async () => {
    const buffer = await makeDocxBuffer(
      `<w:p>` +
      `<w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo</w:t></w:r>` +
      `<w:ins w:author="A" w:date="2025-01-01T00:00:00Z"><w:r><w:t> New</w:t></w:r></w:ins>` +
      `</w:p>`
    );
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('mcp_norm');

    const merge = doc.mergeRunsOnly();
    expect(merge.runsMerged).toBeGreaterThanOrEqual(1);

    const accepted = doc.acceptChanges();
    expect(accepted.insertionsAccepted).toBeGreaterThanOrEqual(1);

    const text = doc.readParagraphs().paragraphs[0]!.text;
    expect(text).toContain('Hello New');
  });
});
