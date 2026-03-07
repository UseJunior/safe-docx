import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { itAllure, allureStep } from './testing/allure-test.js';
import { parseXml, serializeXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { DocxZip } from './zip.js';
import {
  addComment,
  addCommentReply,
  bootstrapCommentParts,
  deleteComment,
  getComments,
} from './comments.js';

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
      const { doc, zip, root } = await allureStep('Given a document with a single root comment', async () => {
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
        return { doc, zip, root };
      });

      await allureStep('When the root comment is deleted', async () => {
        await deleteComment(doc, zip, { commentId: root.commentId });
      });

      await allureStep('Then no comments remain and body is intact', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toEqual([]);
        const serialized = serializeXml(doc);
        expect(serialized).toContain('<w:body>');
      });
    });

  it
    .openspec('delete root comment cascade-deletes all descendants')
    ('Scenario: delete root comment cascade-deletes all descendants', async () => {
      const { doc, zip, root } = await allureStep('Given a root comment with a child and grandchild reply', async () => {
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
        return { doc, zip, root };
      });

      await allureStep('When the root comment is deleted', async () => {
        await deleteComment(doc, zip, { commentId: root.commentId });
      });

      await allureStep('Then all comments and replies are removed', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toEqual([]);
        const commentsXml = await zip.readText('word/comments.xml');
        expect(commentsXml).not.toContain('Root comment');
        expect(commentsXml).not.toContain('First reply');
        expect(commentsXml).not.toContain('Second reply');
      });
    });

  it
    .openspec('delete a leaf reply comment')
    ('Scenario: delete a leaf reply comment', async () => {
      const { doc, zip, leaf } = await allureStep('Given a root comment with a single leaf reply', async () => {
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
        return { doc, zip, leaf };
      });

      await allureStep('When the leaf reply is deleted', async () => {
        await deleteComment(doc, zip, { commentId: leaf.commentId });
      });

      await allureStep('Then only the root comment remains with no replies', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toHaveLength(1);
        expect(comments[0]!.text).toBe('Root comment');
        expect(comments[0]!.replies).toEqual([]);
      });
    });

  it
    .openspec('delete a non-leaf reply cascades to its descendants')
    ('Scenario: delete a non-leaf reply cascades to its descendants', async () => {
      const { doc, zip, nonLeafReply } = await allureStep('Given a root comment with a two-level reply chain', async () => {
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
        return { doc, zip, nonLeafReply };
      });

      await allureStep('When the non-leaf reply is deleted', async () => {
        await deleteComment(doc, zip, { commentId: nonLeafReply.commentId });
      });

      await allureStep('Then only the root comment remains with no replies', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toHaveLength(1);
        expect(comments[0]!.text).toBe('Root comment');
        expect(comments[0]!.replies).toEqual([]);
      });
    });

  it
    .openspec('comment not found returns error')
    ('Scenario: comment not found returns error', async () => {
      const { doc, zip } = await allureStep('Given a document with one comment', async () => {
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
        return { doc, zip };
      });

      await allureStep('When/Then deleting a non-existent comment ID rejects with not-found', async () => {
        await expect(deleteComment(doc, zip, { commentId: 999 })).rejects.toThrow(/not found/i);
      });
    });
});
