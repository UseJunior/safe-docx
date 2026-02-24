import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { itAllure } from './helpers/allure-test.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { DocxZip } from '../src/primitives/zip.js';
import {
  addComment,
  addCommentReply,
  bootstrapCommentParts,
  deleteComment,
  getComments,
} from '../src/primitives/comments.js';

const TEST_FEATURE = 'add-comment-delete-tool';
const it = itAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });
const W_NS = OOXML.W_NS;

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:w14="${OOXML.W14_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

async function makeDocxBuffer(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', makeDocXml(bodyXml));
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

async function loadZip(buffer: Buffer): Promise<DocxZip> {
  return DocxZip.load(buffer);
}

describe('deleteComment OpenSpec traceability', () => {
  it
    .openspec('delete root comment with no replies')
    ('Scenario: delete root comment with no replies', async () => {
      const zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
      await bootstrapCommentParts(zip);

      const doc = parseXml(await zip.readText('word/document.xml'));
      const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      const root = await addComment(doc, zip, {
        paragraphEl: paragraph,
        start: 0,
        end: 5,
        author: 'Author',
        text: 'Root comment',
      });

      await deleteComment(doc, zip, { commentId: root.commentId });

      const comments = await getComments(zip, doc);
      expect(comments).toEqual([]);

      const serialized = serializeXml(doc);
      expect(serialized).toContain('<w:body>');
    });

  it
    .openspec('delete root comment cascade-deletes all descendants')
    ('Scenario: delete root comment cascade-deletes all descendants', async () => {
      const zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
      await bootstrapCommentParts(zip);

      const doc = parseXml(await zip.readText('word/document.xml'));
      const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      const root = await addComment(doc, zip, {
        paragraphEl: paragraph,
        start: 0,
        end: 5,
        author: 'Author',
        text: 'Root comment',
      });
      const child = await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Child',
        text: 'First reply',
      });
      await addCommentReply(doc, zip, {
        parentCommentId: child.commentId,
        author: 'Grandchild',
        text: 'Second reply',
      });

      await deleteComment(doc, zip, { commentId: root.commentId });

      const comments = await getComments(zip, doc);
      expect(comments).toEqual([]);

      const commentsXml = await zip.readText('word/comments.xml');
      expect(commentsXml).not.toContain('Root comment');
      expect(commentsXml).not.toContain('First reply');
      expect(commentsXml).not.toContain('Second reply');
    });

  it
    .openspec('delete a leaf reply comment')
    ('Scenario: delete a leaf reply comment', async () => {
      const zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
      await bootstrapCommentParts(zip);

      const doc = parseXml(await zip.readText('word/document.xml'));
      const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      const root = await addComment(doc, zip, {
        paragraphEl: paragraph,
        start: 0,
        end: 5,
        author: 'Author',
        text: 'Root comment',
      });
      const leaf = await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Leaf',
        text: 'Leaf reply',
      });

      await deleteComment(doc, zip, { commentId: leaf.commentId });

      const comments = await getComments(zip, doc);
      expect(comments).toHaveLength(1);
      expect(comments[0]!.text).toBe('Root comment');
      expect(comments[0]!.replies).toEqual([]);
    });

  it
    .openspec('delete a non-leaf reply cascades to its descendants')
    ('Scenario: delete a non-leaf reply cascades to its descendants', async () => {
      const zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
      await bootstrapCommentParts(zip);

      const doc = parseXml(await zip.readText('word/document.xml'));
      const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      const root = await addComment(doc, zip, {
        paragraphEl: paragraph,
        start: 0,
        end: 5,
        author: 'Author',
        text: 'Root comment',
      });
      const nonLeafReply = await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Reply',
        text: 'Reply level 1',
      });
      await addCommentReply(doc, zip, {
        parentCommentId: nonLeafReply.commentId,
        author: 'Reply',
        text: 'Reply level 2',
      });

      await deleteComment(doc, zip, { commentId: nonLeafReply.commentId });

      const comments = await getComments(zip, doc);
      expect(comments).toHaveLength(1);
      expect(comments[0]!.text).toBe('Root comment');
      expect(comments[0]!.replies).toEqual([]);
    });

  it
    .openspec('comment not found returns error')
    ('Scenario: comment not found returns error', async () => {
      const zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
      await bootstrapCommentParts(zip);

      const doc = parseXml(await zip.readText('word/document.xml'));
      const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
      await addComment(doc, zip, {
        paragraphEl: paragraph,
        start: 0,
        end: 5,
        author: 'Author',
        text: 'Root comment',
      });

      await expect(deleteComment(doc, zip, { commentId: 999 })).rejects.toThrow(/not found/i);
    });
});
