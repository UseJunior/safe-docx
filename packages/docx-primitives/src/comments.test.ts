import { describe, expect } from 'vitest';
import { itAllure as it } from '../test/helpers/allure-test.js';
import JSZip from 'jszip';
import { parseXml, serializeXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { DocxZip } from './zip.js';
import { DocxDocument } from './document.js';
import { bootstrapCommentParts, addComment, addCommentReply, getComments, getComment } from './comments.js';

const W_NS = OOXML.W_NS;
const W15_NS = OOXML.W15_NS;
declare const allure: any;

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

describe('comments', () => {
  describe('bootstrapCommentParts', () => {
    it('creates all required comment parts when none exist', async () => {
      const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await loadZip(buf);

      expect(zip.hasFile('word/comments.xml')).toBe(false);
      expect(zip.hasFile('word/commentsExtended.xml')).toBe(false);
      expect(zip.hasFile('word/people.xml')).toBe(false);

      const result = await bootstrapCommentParts(zip);

      expect(result.partsCreated).toContain('word/comments.xml');
      expect(result.partsCreated).toContain('word/commentsExtended.xml');
      expect(result.partsCreated).toContain('word/people.xml');
      expect(zip.hasFile('word/comments.xml')).toBe(true);
      expect(zip.hasFile('word/commentsExtended.xml')).toBe(true);
      expect(zip.hasFile('word/people.xml')).toBe(true);
    });

    it('is idempotent — does not duplicate parts on second call', async () => {
      const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await loadZip(buf);

      const first = await bootstrapCommentParts(zip);
      expect(first.partsCreated.length).toBe(3);

      const second = await bootstrapCommentParts(zip);
      expect(second.partsCreated.length).toBe(0);
    });

    it('adds correct Content-Type overrides', async () => {
      const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await loadZip(buf);

      await bootstrapCommentParts(zip);

      const ctXml = await zip.readText('[Content_Types].xml');
      expect(ctXml).toContain('word/comments.xml');
      expect(ctXml).toContain('word/commentsExtended.xml');
      expect(ctXml).toContain('word/people.xml');
    });

    it('adds correct relationship entries', async () => {
      const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      const zip = await loadZip(buf);

      await bootstrapCommentParts(zip);

      const relsXml = await zip.readText('word/_rels/document.xml.rels');
      expect(relsXml).toContain('comments.xml');
      expect(relsXml).toContain('commentsExtended.xml');
      expect(relsXml).toContain('people.xml');
    });
  });

  describe('addComment', () => {
    it('inserts commentRangeStart/commentRangeEnd markers', async () => {
      const bodyXml = '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>';
      const buf = await makeDocxBuffer(bodyXml);
      const zip = await loadZip(buf);
      await bootstrapCommentParts(zip);

      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Test Author',
        text: 'A comment',
      });

      const serialized = serializeXml(doc);
      expect(serialized).toContain('commentRangeStart');
      expect(serialized).toContain('commentRangeEnd');
    });

    it('inserts commentReference run after range end', async () => {
      const bodyXml = '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>';
      const buf = await makeDocxBuffer(bodyXml);
      const zip = await loadZip(buf);
      await bootstrapCommentParts(zip);

      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Test Author',
        text: 'A comment',
      });

      const serialized = serializeXml(doc);
      expect(serialized).toContain('commentReference');
    });

    it('allocates sequential comment IDs', async () => {
      const bodyXml = '<w:p><w:r><w:t>Hello World Foo</w:t></w:r></w:p>';
      const buf = await makeDocxBuffer(bodyXml);
      const zip = await loadZip(buf);
      await bootstrapCommentParts(zip);

      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      const r1 = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Author A',
        text: 'First',
      });
      const r2 = await addComment(doc, zip, {
        paragraphEl: p,
        start: 6,
        end: 11,
        author: 'Author B',
        text: 'Second',
      });

      expect(r1.commentId).toBe(0);
      expect(r2.commentId).toBe(1);
    });

    it('comment body includes annotationRef element', async () => {
      const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
      const buf = await makeDocxBuffer(bodyXml);
      const zip = await loadZip(buf);
      await bootstrapCommentParts(zip);

      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Test',
        text: 'Note',
      });

      const commentsXml = await zip.readText('word/comments.xml');
      expect(commentsXml).toContain('annotationRef');
      expect(commentsXml).toContain('Note');
    });

    it('adds author to people.xml', async () => {
      const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
      const buf = await makeDocxBuffer(bodyXml);
      const zip = await loadZip(buf);
      await bootstrapCommentParts(zip);

      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Jane Doe',
        text: 'Hi',
      });

      const peopleXml = await zip.readText('word/people.xml');
      expect(peopleXml).toContain('Jane Doe');
    });
  });

  describe('addCommentReply', () => {
    it('links reply to parent via commentsExtended.xml paraIdParent', async () => {
      const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
      const buf = await makeDocxBuffer(bodyXml);
      const zip = await loadZip(buf);
      await bootstrapCommentParts(zip);

      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      // First add a root comment
      const root = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Author',
        text: 'Root',
      });

      // Then add a reply
      const reply = await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Replier',
        text: 'Reply text',
      });

      expect(reply.parentCommentId).toBe(root.commentId);

      const extXml = await zip.readText('word/commentsExtended.xml');
      expect(extXml).toContain('paraIdParent');
    });

    it('reply has no range markers in document body', async () => {
      const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
      const buf = await makeDocxBuffer(bodyXml);
      const zip = await loadZip(buf);
      await bootstrapCommentParts(zip);

      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      const root = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Author',
        text: 'Root',
      });

      // Count range markers before reply
      const beforeXml = serializeXml(doc);
      const beforeStartCount = (beforeXml.match(/commentRangeStart/g) ?? []).length;
      const beforeEndCount = (beforeXml.match(/commentRangeEnd/g) ?? []).length;

      await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Replier',
        text: 'Reply',
      });

      // No new range markers added
      const afterXml = serializeXml(doc);
      const afterStartCount = (afterXml.match(/commentRangeStart/g) ?? []).length;
      const afterEndCount = (afterXml.match(/commentRangeEnd/g) ?? []).length;
      expect(afterStartCount).toBe(beforeStartCount);
      expect(afterEndCount).toBe(beforeEndCount);
    });

    it('supports multiple replies to same parent', async () => {
      const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
      const buf = await makeDocxBuffer(bodyXml);
      const zip = await loadZip(buf);
      await bootstrapCommentParts(zip);

      const docXml = await zip.readText('word/document.xml');
      const doc = parseXml(docXml);
      const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

      const root = await addComment(doc, zip, {
        paragraphEl: p,
        start: 0,
        end: 5,
        author: 'Author',
        text: 'Root',
      });

      const r1 = await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Reply1',
        text: 'First reply',
      });

      const r2 = await addCommentReply(doc, zip, {
        parentCommentId: root.commentId,
        author: 'Reply2',
        text: 'Second reply',
      });

      expect(r1.commentId).not.toBe(r2.commentId);
      expect(r1.parentCommentId).toBe(root.commentId);
      expect(r2.parentCommentId).toBe(root.commentId);

      const commentsXml = await zip.readText('word/comments.xml');
      expect(commentsXml).toContain('First reply');
      expect(commentsXml).toContain('Second reply');
    });
  });

  describe('round-trip', () => {
    it('comment survives toBuffer → reload cycle', async () => {
      const bodyXml = '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>';
      const buf = await makeDocxBuffer(bodyXml);
      const doc = await DocxDocument.load(buf);
      doc.insertParagraphBookmarks('test_attachment');

      // Use readParagraphs to get the bookmark IDs
      const { paragraphs } = doc.readParagraphs();
      expect(paragraphs.length).toBeGreaterThan(0);
      const paraId = paragraphs[0]!.id;
      expect(paraId).toBeTruthy();

      await doc.addComment({
        paragraphId: paraId,
        start: 0,
        end: 5,
        author: 'Round Trip',
        text: 'Survives reload',
      });

      const { buffer } = await doc.toBuffer();

      // Reload and verify
      const reloadedZip = await DocxZip.load(buffer);
      const commentsXml = await reloadedZip.readText('word/comments.xml');
      expect(commentsXml).toContain('Survives reload');
      expect(commentsXml).toContain('Round Trip');
    });
  });

  describe('getComments', () => {
    it('returns empty array when no comments.xml exists', async () => {
      await allure.epic('DOCX Primitives');
      await allure.feature('Comments');
      await allure.story('Read Comments');
      await allure.severity('normal');

      let comments: Awaited<ReturnType<typeof getComments>>;

      await allure.step('Given a document with no comment parts', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        const zip = await loadZip(buf);
        const docXml = await zip.readText('word/document.xml');
        const doc = parseXml(docXml);
        comments = await getComments(zip, doc);
      });

      await allure.step('Then getComments returns an empty array', async () => {
        expect(comments).toEqual([]);
      });
    });

    it('reads comments written by addComment', async () => {
      await allure.epic('DOCX Primitives');
      await allure.feature('Comments');
      await allure.story('Read Comments');
      await allure.severity('critical');

      let zip: DocxZip;
      let doc: Document;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await allure.step('Given a document with a comment added via addComment', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Alice',
          text: 'Nice intro',
          initials: 'A',
        });
      });

      await allure.step('When reading comments via getComments', async () => {
        comments = await getComments(zip, doc);
      });

      await allure.step('Then exactly one comment is returned', async () => {
        expect(comments).toHaveLength(1);
      });

      await allure.step('And comment ID is 0', async () => {
        expect(comments[0]!.id).toBe(0);
      });

      await allure.step('And author is Alice', async () => {
        expect(comments[0]!.author).toBe('Alice');
      });

      await allure.step('And text is "Nice intro"', async () => {
        expect(comments[0]!.text).toBe('Nice intro');
      });

      await allure.step('And initials is "A"', async () => {
        expect(comments[0]!.initials).toBe('A');
      });

      await allure.step('And date is populated', async () => {
        expect(comments[0]!.date).toBeTruthy();
      });

      await allure.step('And paragraphId is populated', async () => {
        expect(comments[0]!.paragraphId).toBeTruthy();
      });

      await allure.step('And replies array is empty', async () => {
        expect(comments[0]!.replies).toEqual([]);
      });
    });

    it('reads multiple comments', async () => {
      await allure.epic('DOCX Primitives');
      await allure.feature('Comments');
      await allure.story('Read Comments');
      await allure.severity('normal');

      let zip: DocxZip;
      let doc: Document;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await allure.step('Given a document with two comments on different ranges', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello World Foo</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, { paragraphEl: p, start: 0, end: 5, author: 'Alice', text: 'First comment' });
        await addComment(doc, zip, { paragraphEl: p, start: 6, end: 11, author: 'Bob', text: 'Second comment' });
      });

      await allure.step('When reading comments via getComments', async () => {
        comments = await getComments(zip, doc);
      });

      await allure.step('Then two comments are returned', async () => {
        expect(comments).toHaveLength(2);
      });

      await allure.step('And first comment text is "First comment"', async () => {
        expect(comments[0]!.text).toBe('First comment');
      });

      await allure.step('And second comment text is "Second comment"', async () => {
        expect(comments[1]!.text).toBe('Second comment');
      });
    });

    it('builds threaded replies from addCommentReply', async () => {
      await allure.epic('DOCX Primitives');
      await allure.feature('Comments');
      await allure.story('Threaded Replies');
      await allure.severity('critical');

      let zip: DocxZip;
      let doc: Document;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await allure.step('Given a root comment with two replies', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const root = await addComment(doc, zip, { paragraphEl: p, start: 0, end: 5, author: 'Author', text: 'Root comment' });
        await addCommentReply(doc, zip, { parentCommentId: root.commentId, author: 'Replier', text: 'Reply one' });
        await addCommentReply(doc, zip, { parentCommentId: root.commentId, author: 'Replier2', text: 'Reply two' });
      });

      await allure.step('When reading comments via getComments', async () => {
        comments = await getComments(zip, doc);
      });

      await allure.step('Then only one root comment is returned at top level', async () => {
        expect(comments).toHaveLength(1);
      });

      await allure.step('And root comment text is "Root comment"', async () => {
        expect(comments[0]!.text).toBe('Root comment');
      });

      await allure.step('And root comment has two replies', async () => {
        expect(comments[0]!.replies).toHaveLength(2);
      });

      await allure.step('And first reply text is "Reply one" by "Replier"', async () => {
        expect(comments[0]!.replies[0]!.text).toBe('Reply one');
        expect(comments[0]!.replies[0]!.author).toBe('Replier');
      });

      await allure.step('And second reply text is "Reply two"', async () => {
        expect(comments[0]!.replies[1]!.text).toBe('Reply two');
      });
    });

    it('round-trip: write comments, save, reload, read back', async () => {
      await allure.epic('DOCX Primitives');
      await allure.feature('Comments');
      await allure.story('Round-Trip Fidelity');
      await allure.severity('critical');

      let buffer: Buffer;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await allure.step('Given a document with a comment and a reply', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        const doc = await DocxDocument.load(buf);
        doc.insertParagraphBookmarks('test_attachment');
        const { paragraphs } = doc.readParagraphs();
        const paraId = paragraphs[0]!.id;
        await doc.addComment({ paragraphId: paraId, start: 0, end: 5, author: 'RoundTrip Author', text: 'Round trip comment' });
        const replyResult = await doc.addCommentReply({ parentCommentId: 0, author: 'Reply Author', text: 'Round trip reply' });
        expect(replyResult.parentCommentId).toBe(0);
        ({ buffer } = await doc.toBuffer());
      });

      await allure.step('When reloading from buffer and reading comments', async () => {
        const reloaded = await DocxDocument.load(buffer);
        comments = await reloaded.getComments();
      });

      await allure.step('Then one root comment is returned', async () => {
        expect(comments).toHaveLength(1);
      });

      await allure.step('And root comment text matches "Round trip comment"', async () => {
        expect(comments[0]!.text).toBe('Round trip comment');
      });

      await allure.step('And root comment author matches "RoundTrip Author"', async () => {
        expect(comments[0]!.author).toBe('RoundTrip Author');
      });

      await allure.step('And reply is preserved with correct text', async () => {
        expect(comments[0]!.replies).toHaveLength(1);
        expect(comments[0]!.replies[0]!.text).toBe('Round trip reply');
      });
    });
  });

  describe('getComment', () => {
    it('finds a root comment by ID', async () => {
      await allure.epic('DOCX Primitives');
      await allure.feature('Comments');
      await allure.story('Single Comment Lookup');
      await allure.severity('normal');

      let zip: DocxZip;
      let doc: Document;
      let found: Awaited<ReturnType<typeof getComment>>;

      await allure.step('Given a document with one comment (ID 0)', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, { paragraphEl: p, start: 0, end: 5, author: 'FindMe', text: 'Target comment' });
      });

      await allure.step('When looking up comment by ID 0', async () => {
        found = await getComment(zip, doc, 0);
      });

      await allure.step('Then the comment is found', async () => {
        expect(found).not.toBeNull();
      });

      await allure.step('And text is "Target comment"', async () => {
        expect(found!.text).toBe('Target comment');
      });

      await allure.step('And author is "FindMe"', async () => {
        expect(found!.author).toBe('FindMe');
      });
    });

    it('finds a reply comment by ID', async () => {
      await allure.epic('DOCX Primitives');
      await allure.feature('Comments');
      await allure.story('Single Comment Lookup');
      await allure.severity('normal');

      let zip: DocxZip;
      let doc: Document;
      let replyId: number;
      let found: Awaited<ReturnType<typeof getComment>>;

      await allure.step('Given a root comment with a reply', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const root = await addComment(doc, zip, { paragraphEl: p, start: 0, end: 5, author: 'Root', text: 'Root' });
        const reply = await addCommentReply(doc, zip, { parentCommentId: root.commentId, author: 'Reply', text: 'Nested reply' });
        replyId = reply.commentId;
      });

      await allure.step('When looking up the reply by its ID', async () => {
        found = await getComment(zip, doc, replyId);
      });

      await allure.step('Then the reply is found', async () => {
        expect(found).not.toBeNull();
      });

      await allure.step('And text is "Nested reply"', async () => {
        expect(found!.text).toBe('Nested reply');
      });
    });

    it('returns null for non-existent ID', async () => {
      await allure.epic('DOCX Primitives');
      await allure.feature('Comments');
      await allure.story('Single Comment Lookup');
      await allure.severity('minor');

      let found: Awaited<ReturnType<typeof getComment>>;

      await allure.step('Given a document with no comments', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        const zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        const doc = parseXml(docXml);
        found = await getComment(zip, doc, 999);
      });

      await allure.step('Then getComment returns null', async () => {
        expect(found).toBeNull();
      });
    });
  });
});
