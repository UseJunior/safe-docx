import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import JSZip from 'jszip';
import { parseXml, serializeXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { DocxZip } from './zip.js';
import {
  bootstrapCommentParts,
  addComment,
  addCommentReply,
  getComments,
  getComment,
  deleteComment,
} from './comments.js';

const W_NS = OOXML.W_NS;

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:w14="${OOXML.W14_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

async function makeDocxBuffer(bodyXml: string, extraFiles?: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', makeDocXml(bodyXml));
  if (extraFiles) {
    for (const [name, text] of Object.entries(extraFiles)) zip.file(name, text);
  }
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

async function loadZip(buffer: Buffer): Promise<DocxZip> {
  return DocxZip.load(buffer);
}

async function setupWithComment(bodyXml: string = '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>') {
  const buf = await makeDocxBuffer(bodyXml);
  const zip = await loadZip(buf);
  await bootstrapCommentParts(zip);
  const docXml = await zip.readText('word/document.xml');
  const doc = parseXml(docXml);
  const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
  return { zip, doc, p };
}

describe('comments — edge cases and branch coverage', () => {
  describe('bootstrapCommentParts', () => {
    it('is idempotent when comment parts already exist', async () => {
      const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await loadZip(buf);

      const first = await bootstrapCommentParts(zip);
      expect(first.partsCreated).toHaveLength(3);

      const second = await bootstrapCommentParts(zip);
      expect(second.partsCreated).toHaveLength(0);
    });

    it('creates parts and updates Content_Types and rels', async () => {
      const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await loadZip(buf);

      await bootstrapCommentParts(zip);

      expect(zip.hasFile('word/comments.xml')).toBe(true);
      expect(zip.hasFile('word/commentsExtended.xml')).toBe(true);
      expect(zip.hasFile('word/people.xml')).toBe(true);

      const ctXml = await zip.readText('[Content_Types].xml');
      expect(ctXml).toContain('/word/comments.xml');
      expect(ctXml).toContain('/word/commentsExtended.xml');
      expect(ctXml).toContain('/word/people.xml');

      const relsXml = await zip.readText('word/_rels/document.xml.rels');
      expect(relsXml).toContain('comments.xml');
    });
  });

  describe('allocateNextCommentId (indirect)', () => {
    it('handles gaps in comment IDs — uses high-watermark', async () => {
      // Pre-populate comments.xml with IDs 0 and 5 (gap at 1-4)
      const commentsXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:comments xmlns:w="${W_NS}" xmlns:w14="${OOXML.W14_NS}">` +
        `<w:comment w:id="0" w:author="A" w:date="2024-01-01T00:00:00Z" w:initials="A">` +
        `<w:p w14:paraId="00000001"><w:r><w:t>First</w:t></w:r></w:p></w:comment>` +
        `<w:comment w:id="5" w:author="B" w:date="2024-01-01T00:00:00Z" w:initials="B">` +
        `<w:p w14:paraId="00000002"><w:r><w:t>Fifth</w:t></w:r></w:p></w:comment>` +
        `</w:comments>`;

      const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>', {
        'word/comments.xml': commentsXml,
        'word/commentsExtended.xml':
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>`,
        'word/people.xml':
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>`,
      });
      const zip = await loadZip(buf);
      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      const result = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Test',
        text: 'New comment',
      });

      // Should use max(0, 5) + 1 = 6
      expect(result.commentId).toBe(6);
    });

    it('starts at 0 when no comments exist', async () => {
      const { zip, doc, p } = await setupWithComment();

      const result = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Test',
        text: 'First comment',
      });

      expect(result.commentId).toBe(0);
    });
  });

  describe('addComment', () => {
    it('handles comment on empty paragraph (no runs)', async () => {
      const { zip, doc } = await setupWithComment('<w:p></w:p>');
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      const result = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 0,
        author: 'Test',
        text: 'Comment on empty',
      });

      expect(result.commentId).toBe(0);
      const serialized = serializeXml(doc);
      expect(serialized).toContain('commentRangeStart');
      expect(serialized).toContain('commentRangeEnd');
    });

    it('uses first letter of author as initials when not provided', async () => {
      const { zip, doc, p } = await setupWithComment();

      await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'John',
        text: 'Test',
      });

      const commentsXml = await zip.readText('word/comments.xml');
      expect(commentsXml).toContain('w:initials="J"');
    });

    it('uses custom initials when provided', async () => {
      const { zip, doc, p } = await setupWithComment();

      await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'John Doe',
        text: 'Test',
        initials: 'JD',
      });

      const commentsXml = await zip.readText('word/comments.xml');
      expect(commentsXml).toContain('w:initials="JD"');
    });

    it('sets xml:space=preserve for text with leading/trailing spaces', async () => {
      const { zip, doc, p } = await setupWithComment();

      await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Test',
        text: ' spaced text ',
      });

      const commentsXml = await zip.readText('word/comments.xml');
      expect(commentsXml).toContain('xml:space="preserve"');
    });
  });

  describe('addCommentReply', () => {
    it('throws when parent comment ID does not exist', async () => {
      const { zip, doc } = await setupWithComment();

      await expect(
        addCommentReply(doc, zip, {
          parentCommentId: 999,
          author: 'Reply',
          text: 'Orphaned reply',
        }),
      ).rejects.toThrow(/999 not found/);
    });
  });

  describe('getComments', () => {
    it('returns empty array when comments.xml is absent', async () => {
      const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await loadZip(buf);
      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);

      const comments = await getComments(zip, doc);
      expect(comments).toEqual([]);
    });

    it('returns empty array when comments.xml exists but has no comments', async () => {
      const { zip, doc } = await setupWithComment();
      const comments = await getComments(zip, doc);
      expect(comments).toEqual([]);
    });

    it('reconstructs threaded replies in nested structure', async () => {
      const { zip, doc, p } = await setupWithComment();
      const root = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Root',
        text: 'Root comment',
      });
      await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Reply1',
        text: 'First reply',
      });
      await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Reply2',
        text: 'Second reply',
      });

      const comments = await getComments(zip, doc);
      expect(comments).toHaveLength(1);
      expect(comments[0]!.replies).toHaveLength(2);
      expect(comments[0]!.replies[0]!.text).toBe('First reply');
      expect(comments[0]!.replies[1]!.text).toBe('Second reply');
    });
  });

  describe('getComment', () => {
    it('finds a nested reply by ID', async () => {
      const { zip, doc, p } = await setupWithComment();
      const root = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Root',
        text: 'Root',
      });
      const reply = await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Replier',
        text: 'Found me',
      });

      const found = await getComment(zip, doc, reply.commentId);
      expect(found).not.toBeNull();
      expect(found!.text).toBe('Found me');
    });

    it('returns null for non-existent ID', async () => {
      const { zip, doc } = await setupWithComment();
      const found = await getComment(zip, doc, 999);
      expect(found).toBeNull();
    });
  });

  describe('deleteComment', () => {
    it('cascade-deletes all transitive descendants', async () => {
      const { zip, doc, p } = await setupWithComment();
      const root = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Root',
        text: 'Root',
      });
      const child = await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Child',
        text: 'Child',
      });
      await addCommentReply(doc, zip, {
        parentCommentId: child.commentId,
        author: 'Grandchild',
        text: 'Grandchild',
      });

      await deleteComment(doc, zip, { commentId: root.commentId });

      const comments = await getComments(zip, doc);
      expect(comments).toEqual([]);

      const commentsXml = await zip.readText('word/comments.xml');
      expect(commentsXml).not.toContain('Root');
      expect(commentsXml).not.toContain('Child');
      expect(commentsXml).not.toContain('Grandchild');
    });

    it('removes comment from comments.xml on delete', async () => {
      const { zip, doc, p } = await setupWithComment();
      await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Test',
        text: 'Removable',
      });

      const beforeComments = await zip.readText('word/comments.xml');
      expect(beforeComments).toContain('Removable');

      await deleteComment(doc, zip, { commentId: 0 });

      const afterComments = await zip.readText('word/comments.xml');
      expect(afterComments).not.toContain('Removable');
    });

    it('throws when comment ID not found', async () => {
      const { zip, doc } = await setupWithComment();
      await bootstrapCommentParts(zip);

      await expect(deleteComment(doc, zip, { commentId: 999 })).rejects.toThrow(/not found/);
    });

    it('throws when comments.xml is absent', async () => {
      const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await loadZip(buf);
      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);

      await expect(deleteComment(doc, zip, { commentId: 0 })).rejects.toThrow(/not found/);
    });
  });
});
