import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
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

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Delete Comment' });
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
  test.openspec('delete root comment with no replies')
    ('Scenario: delete root comment with no replies', async ({ given, when, then }: AllureBddContext) => {
      let zip!: DocxZip;
      let doc!: Document;
      let root!: Awaited<ReturnType<typeof addComment>>;

      await given('a bootstrapped docx zip with one paragraph', async () => {
        zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
        await bootstrapCommentParts(zip);
        doc = parseXml(await zip.readText('word/document.xml'));
      });

      await given('a root comment added to the paragraph', async () => {
        const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        root = await addComment(doc, zip, {
          paragraphEl: paragraph,
          start: 0,
          end: 5,
          author: 'Author',
          text: 'Root comment',
        });
      });

      await when('the root comment is deleted', async () => {
        await deleteComment(doc, zip, { commentId: root.commentId });
      });

      await then('no comments remain and the document body is still intact', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toEqual([]);

        const serialized = serializeXml(doc);
        expect(serialized).toContain('<w:body>');
      });
    });

  test.openspec('delete root comment cascade-deletes all descendants')
    ('Scenario: delete root comment cascade-deletes all descendants', async ({ given, when, then }: AllureBddContext) => {
      let zip!: DocxZip;
      let doc!: Document;
      let root!: Awaited<ReturnType<typeof addComment>>;

      await given('a bootstrapped docx zip with root, child, and grandchild comments', async () => {
        zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
        await bootstrapCommentParts(zip);
        doc = parseXml(await zip.readText('word/document.xml'));
        const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

        root = await addComment(doc, zip, {
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
      });

      await when('the root comment is deleted', async () => {
        await deleteComment(doc, zip, { commentId: root.commentId });
      });

      await then('all comments are removed including all descendants', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toEqual([]);

        const commentsXml = await zip.readText('word/comments.xml');
        expect(commentsXml).not.toContain('Root comment');
        expect(commentsXml).not.toContain('First reply');
        expect(commentsXml).not.toContain('Second reply');
      });
    });

  test.openspec('delete a leaf reply comment')
    ('Scenario: delete a leaf reply comment', async ({ given, when, then }: AllureBddContext) => {
      let zip!: DocxZip;
      let doc!: Document;
      let root!: Awaited<ReturnType<typeof addComment>>;
      let leaf!: Awaited<ReturnType<typeof addCommentReply>>;

      await given('a bootstrapped docx zip with a root comment and a leaf reply', async () => {
        zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
        await bootstrapCommentParts(zip);
        doc = parseXml(await zip.readText('word/document.xml'));
        const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

        root = await addComment(doc, zip, {
          paragraphEl: paragraph,
          start: 0,
          end: 5,
          author: 'Author',
          text: 'Root comment',
        });
        leaf = await addCommentReply(doc, zip, {
          parentCommentId: root.commentId,
          author: 'Leaf',
          text: 'Leaf reply',
        });
      });

      await when('the leaf reply is deleted', async () => {
        await deleteComment(doc, zip, { commentId: leaf.commentId });
      });

      await then('only the root comment remains with no replies', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toHaveLength(1);
        expect(comments[0]!.text).toBe('Root comment');
        expect(comments[0]!.replies).toEqual([]);
      });
    });

  test.openspec('delete a non-leaf reply cascades to its descendants')
    ('Scenario: delete a non-leaf reply cascades to its descendants', async ({ given, when, then }: AllureBddContext) => {
      let zip!: DocxZip;
      let doc!: Document;
      let root!: Awaited<ReturnType<typeof addComment>>;
      let nonLeafReply!: Awaited<ReturnType<typeof addCommentReply>>;

      await given('a bootstrapped docx zip with root, non-leaf reply, and grandchild reply', async () => {
        zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
        await bootstrapCommentParts(zip);
        doc = parseXml(await zip.readText('word/document.xml'));
        const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

        root = await addComment(doc, zip, {
          paragraphEl: paragraph,
          start: 0,
          end: 5,
          author: 'Author',
          text: 'Root comment',
        });
        nonLeafReply = await addCommentReply(doc, zip, {
          parentCommentId: root.commentId,
          author: 'Reply',
          text: 'Reply level 1',
        });
        await addCommentReply(doc, zip, {
          parentCommentId: nonLeafReply.commentId,
          author: 'Reply',
          text: 'Reply level 2',
        });
      });

      await when('the non-leaf reply is deleted', async () => {
        await deleteComment(doc, zip, { commentId: nonLeafReply.commentId });
      });

      await then('only the root comment remains with no replies', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toHaveLength(1);
        expect(comments[0]!.text).toBe('Root comment');
        expect(comments[0]!.replies).toEqual([]);
      });
    });

  test.openspec('comment not found returns error')
    ('Scenario: comment not found returns error', async ({ given, when, then }: AllureBddContext) => {
      let zip!: DocxZip;
      let doc!: Document;

      await given('a bootstrapped docx zip with one root comment', async () => {
        zip = await loadZip(await makeDocxBuffer('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'));
        await bootstrapCommentParts(zip);
        doc = parseXml(await zip.readText('word/document.xml'));
        const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, {
          paragraphEl: paragraph,
          start: 0,
          end: 5,
          author: 'Author',
          text: 'Root comment',
        });
      });

      await then('deleteComment with a non-existent ID rejects with "not found"', async () => {
        await expect(deleteComment(doc, zip, { commentId: 999 })).rejects.toThrow(/not found/i);
      });
    });
});
