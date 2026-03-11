import { describe, expect } from 'vitest';
import { type AllureBddContext, testAllure } from './helpers/allure-test.js';
import JSZip from 'jszip';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { DocxZip } from '../src/primitives/zip.js';
import { DocxDocument } from '../src/primitives/document.js';
import { bootstrapCommentParts, addComment, addCommentReply, getComments, getComment } from '../src/primitives/comments.js';

const W_NS = OOXML.W_NS;
const W15_NS = OOXML.W15_NS;

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Comments' });

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
    test('creates all required comment parts when none exist', async ({ given, when, then, and }: AllureBddContext) => {
      let zip: DocxZip;
      let result: Awaited<ReturnType<typeof bootstrapCommentParts>>;

      await given('a document with no comment parts', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        zip = await loadZip(buf);
      });

      await when('bootstrapCommentParts is called', async () => {
        expect(zip.hasFile('word/comments.xml')).toBe(false);
        expect(zip.hasFile('word/commentsExtended.xml')).toBe(false);
        expect(zip.hasFile('word/people.xml')).toBe(false);
        result = await bootstrapCommentParts(zip);
      });

      await then('all three comment parts are created', async () => {
        expect(result.partsCreated).toContain('word/comments.xml');
        expect(result.partsCreated).toContain('word/commentsExtended.xml');
        expect(result.partsCreated).toContain('word/people.xml');
      });

      await and('the files exist in the zip', async () => {
        expect(zip.hasFile('word/comments.xml')).toBe(true);
        expect(zip.hasFile('word/commentsExtended.xml')).toBe(true);
        expect(zip.hasFile('word/people.xml')).toBe(true);
      });
    });

    test('is idempotent — does not duplicate parts on second call', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let first: Awaited<ReturnType<typeof bootstrapCommentParts>>;
      let second: Awaited<ReturnType<typeof bootstrapCommentParts>>;

      await given('a document that has already been bootstrapped', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        zip = await loadZip(buf);
        first = await bootstrapCommentParts(zip);
        expect(first.partsCreated.length).toBe(3);
      });

      await when('bootstrapCommentParts is called again', async () => {
        second = await bootstrapCommentParts(zip);
      });

      await then('no parts are created the second time', async () => {
        expect(second.partsCreated.length).toBe(0);
      });
    });

    test('adds correct Content-Type overrides', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;

      await given('a document with no comment parts', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        zip = await loadZip(buf);
      });

      await when('bootstrapCommentParts is called', async () => {
        await bootstrapCommentParts(zip);
      });

      await then('Content_Types.xml includes all comment part overrides', async () => {
        const ctXml = await zip.readText('[Content_Types].xml');
        expect(ctXml).toContain('word/comments.xml');
        expect(ctXml).toContain('word/commentsExtended.xml');
        expect(ctXml).toContain('word/people.xml');
      });
    });

    test('adds correct relationship entries', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;

      await given('a document with no comment parts', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        zip = await loadZip(buf);
      });

      await when('bootstrapCommentParts is called', async () => {
        await bootstrapCommentParts(zip);
      });

      await then('document.xml.rels includes all comment relationships', async () => {
        const relsXml = await zip.readText('word/_rels/document.xml.rels');
        expect(relsXml).toContain('comments.xml');
        expect(relsXml).toContain('commentsExtended.xml');
        expect(relsXml).toContain('people.xml');
      });
    });
  });

  describe('addComment', () => {
    test('inserts commentRangeStart/commentRangeEnd markers', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let serialized: string;

      await given('a bootstrapped document with a paragraph', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        const zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

        await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Test Author',
          text: 'A comment',
        });
      });

      await when('the document is serialized', async () => {
        serialized = serializeXml(doc);
      });

      await then('commentRangeStart and commentRangeEnd markers are present', async () => {
        expect(serialized).toContain('commentRangeStart');
        expect(serialized).toContain('commentRangeEnd');
      });
    });

    test('inserts commentReference run after range end', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let serialized: string;

      await given('a bootstrapped document with a comment added', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        const zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

        await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Test Author',
          text: 'A comment',
        });
      });

      await when('the document is serialized', async () => {
        serialized = serializeXml(doc);
      });

      await then('a commentReference element is present', async () => {
        expect(serialized).toContain('commentReference');
      });
    });

    test('allocates sequential comment IDs', async ({ given, when, then }: AllureBddContext) => {
      let r1: Awaited<ReturnType<typeof addComment>>;
      let r2: Awaited<ReturnType<typeof addComment>>;

      await given('a bootstrapped document with a paragraph', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello World Foo</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        const zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        const doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

        r1 = await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Author A',
          text: 'First',
        });
        r2 = await addComment(doc, zip, {
          paragraphEl: p,
          start: 6,
          end: 11,
          author: 'Author B',
          text: 'Second',
        });
      });

      await when('two comments are added sequentially', async () => {
        // Comments already added in given step
      });

      await then('IDs are allocated sequentially starting from 0', async () => {
        expect(r1.commentId).toBe(0);
        expect(r2.commentId).toBe(1);
      });
    });

    test('comment body includes annotationRef element', async ({ given, when, then }: AllureBddContext) => {
      let commentsXml: string;

      await given('a bootstrapped document with a comment added', async () => {
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

        commentsXml = await zip.readText('word/comments.xml');
      });

      await when('the comments.xml is inspected', async () => {
        // commentsXml already read in given step
      });

      await then('annotationRef and comment text are present', async () => {
        expect(commentsXml).toContain('annotationRef');
        expect(commentsXml).toContain('Note');
      });
    });

    test('adds author to people.xml', async ({ given, when, then }: AllureBddContext) => {
      let peopleXml: string;

      await given('a bootstrapped document with a comment by Jane Doe', async () => {
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

        peopleXml = await zip.readText('word/people.xml');
      });

      await when('people.xml is inspected', async () => {
        // peopleXml already read in given step
      });

      await then('Jane Doe is listed in people.xml', async () => {
        expect(peopleXml).toContain('Jane Doe');
      });
    });
  });

  describe('addCommentReply', () => {
    test('links reply to parent via commentsExtended.xml paraIdParent', async ({ given, when, then }: AllureBddContext) => {
      let reply: Awaited<ReturnType<typeof addCommentReply>>;
      let root: Awaited<ReturnType<typeof addComment>>;
      let extXml: string;

      await given('a document with a root comment', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        const zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        const doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

        root = await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Author',
          text: 'Root',
        });

        reply = await addCommentReply(doc, zip, {
          parentCommentId: root.commentId,
          author: 'Replier',
          text: 'Reply text',
        });

        extXml = await zip.readText('word/commentsExtended.xml');
      });

      await when('the reply is added', async () => {
        // Reply already added in given step
      });

      await then('reply links to parent and paraIdParent is in extended XML', async () => {
        expect(reply.parentCommentId).toBe(root.commentId);
        expect(extXml).toContain('paraIdParent');
      });
    });

    test('reply has no range markers in document body', async ({ given, when, then }: AllureBddContext) => {
      let beforeStartCount: number;
      let beforeEndCount: number;
      let afterStartCount: number;
      let afterEndCount: number;

      await given('a document with a root comment', async () => {
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
        beforeStartCount = (beforeXml.match(/commentRangeStart/g) ?? []).length;
        beforeEndCount = (beforeXml.match(/commentRangeEnd/g) ?? []).length;

        await addCommentReply(doc, zip, {
          parentCommentId: root.commentId,
          author: 'Replier',
          text: 'Reply',
        });

        // Count range markers after reply
        const afterXml = serializeXml(doc);
        afterStartCount = (afterXml.match(/commentRangeStart/g) ?? []).length;
        afterEndCount = (afterXml.match(/commentRangeEnd/g) ?? []).length;
      });

      await when('a reply is added', async () => {
        // Reply already added in given step
      });

      await then('no new range markers are added to the document', async () => {
        expect(afterStartCount).toBe(beforeStartCount);
        expect(afterEndCount).toBe(beforeEndCount);
      });
    });

    test('supports multiple replies to same parent', async ({ given, when, then, and }: AllureBddContext) => {
      let root: Awaited<ReturnType<typeof addComment>>;
      let r1: Awaited<ReturnType<typeof addCommentReply>>;
      let r2: Awaited<ReturnType<typeof addCommentReply>>;
      let commentsXml: string;

      await given('a document with a root comment', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        const zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        const doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;

        root = await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Author',
          text: 'Root',
        });

        r1 = await addCommentReply(doc, zip, {
          parentCommentId: root.commentId,
          author: 'Reply1',
          text: 'First reply',
        });

        r2 = await addCommentReply(doc, zip, {
          parentCommentId: root.commentId,
          author: 'Reply2',
          text: 'Second reply',
        });

        commentsXml = await zip.readText('word/comments.xml');
      });

      await when('two replies are added to the same parent', async () => {
        // Replies already added in given step
      });

      await then('replies have distinct IDs linking to the same parent', async () => {
        expect(r1.commentId).not.toBe(r2.commentId);
        expect(r1.parentCommentId).toBe(root.commentId);
        expect(r2.parentCommentId).toBe(root.commentId);
      });

      await and('both reply texts are in comments.xml', async () => {
        expect(commentsXml).toContain('First reply');
        expect(commentsXml).toContain('Second reply');
      });
    });
  });

  describe('round-trip', () => {
    test('comment survives toBuffer → reload cycle', async ({ given, when, then }: AllureBddContext) => {
      let commentsXml: string;

      await given('a document with a comment saved to buffer', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        const doc = await DocxDocument.load(buf);
        doc.insertParagraphBookmarks('test_attachment');

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
        commentsXml = await reloadedZip.readText('word/comments.xml');
      });

      await when('the buffer is reloaded', async () => {
        // Reload already happened in given step
      });

      await then('the comment text and author are preserved', async () => {
        expect(commentsXml).toContain('Survives reload');
        expect(commentsXml).toContain('Round Trip');
      });
    });
  });

  describe('getComments', () => {
    test('returns empty array when no comments.xml exists', async ({ given, when, then }: AllureBddContext) => {
      let comments: Awaited<ReturnType<typeof getComments>>;

      await given('a document with no comment parts', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        const zip = await loadZip(buf);
        const docXml = await zip.readText('word/document.xml');
        const doc = parseXml(docXml);
        comments = await getComments(zip, doc);
      });

      await when('getComments is called', async () => {
        // Already called in given step
      });

      await then('getComments returns an empty array', async () => {
        expect(comments).toEqual([]);
      });
    });

    test('reads comments written by addComment', async ({ given, when, then, and }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await given('a document with a comment added via addComment', async () => {
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

      await when('reading comments via getComments', async () => {
        comments = await getComments(zip, doc);
      });

      await then('exactly one comment is returned', async () => {
        expect(comments).toHaveLength(1);
      });

      await and('comment ID is 0', async () => {
        expect(comments[0]!.id).toBe(0);
      });

      await and('author is Alice', async () => {
        expect(comments[0]!.author).toBe('Alice');
      });

      await and('text is "Nice intro"', async () => {
        expect(comments[0]!.text).toBe('Nice intro');
      });

      await and('initials is "A"', async () => {
        expect(comments[0]!.initials).toBe('A');
      });

      await and('date is populated', async () => {
        expect(comments[0]!.date).toBeTruthy();
      });

      await and('paragraphId is populated', async () => {
        expect(comments[0]!.paragraphId).toBeTruthy();
      });

      await and('replies array is empty', async () => {
        expect(comments[0]!.replies).toEqual([]);
      });
    });

    test('reads multiple comments', async ({ given, when, then, and }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await given('a document with two comments on different ranges', async () => {
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

      await when('reading comments via getComments', async () => {
        comments = await getComments(zip, doc);
      });

      await then('two comments are returned', async () => {
        expect(comments).toHaveLength(2);
      });

      await and('first comment text is "First comment"', async () => {
        expect(comments[0]!.text).toBe('First comment');
      });

      await and('second comment text is "Second comment"', async () => {
        expect(comments[1]!.text).toBe('Second comment');
      });
    });

    test('builds threaded replies from addCommentReply', async ({ given, when, then, and }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await given('a root comment with two replies', async () => {
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

      await when('reading comments via getComments', async () => {
        comments = await getComments(zip, doc);
      });

      await then('only one root comment is returned at top level', async () => {
        expect(comments).toHaveLength(1);
      });

      await and('root comment text is "Root comment"', async () => {
        expect(comments[0]!.text).toBe('Root comment');
      });

      await and('root comment has two replies', async () => {
        expect(comments[0]!.replies).toHaveLength(2);
      });

      await and('first reply text is "Reply one" by "Replier"', async () => {
        expect(comments[0]!.replies[0]!.text).toBe('Reply one');
        expect(comments[0]!.replies[0]!.author).toBe('Replier');
      });

      await and('second reply text is "Reply two"', async () => {
        expect(comments[0]!.replies[1]!.text).toBe('Reply two');
      });
    });

    test('round-trip: write comments, save, reload, read back', async ({ given, when, then, and }: AllureBddContext) => {
      let buffer: Buffer;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await given('a document with a comment and a reply', async () => {
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

      await when('reloading from buffer and reading comments', async () => {
        const reloaded = await DocxDocument.load(buffer);
        comments = await reloaded.getComments();
      });

      await then('one root comment is returned', async () => {
        expect(comments).toHaveLength(1);
      });

      await and('root comment text matches "Round trip comment"', async () => {
        expect(comments[0]!.text).toBe('Round trip comment');
      });

      await and('root comment author matches "RoundTrip Author"', async () => {
        expect(comments[0]!.author).toBe('RoundTrip Author');
      });

      await and('reply is preserved with correct text', async () => {
        expect(comments[0]!.replies).toHaveLength(1);
        expect(comments[0]!.replies[0]!.text).toBe('Round trip reply');
      });
    });
  });

  describe('getComment', () => {
    test('finds a root comment by ID', async ({ given, when, then, and }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let found: Awaited<ReturnType<typeof getComment>>;

      await given('a document with one comment (ID 0)', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, { paragraphEl: p, start: 0, end: 5, author: 'FindMe', text: 'Target comment' });
      });

      await when('looking up comment by ID 0', async () => {
        found = await getComment(zip, doc, 0);
      });

      await then('the comment is found', async () => {
        expect(found).not.toBeNull();
      });

      await and('text is "Target comment"', async () => {
        expect(found!.text).toBe('Target comment');
      });

      await and('author is "FindMe"', async () => {
        expect(found!.author).toBe('FindMe');
      });
    });

    test('finds a reply comment by ID', async ({ given, when, then, and }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let replyId: number;
      let found: Awaited<ReturnType<typeof getComment>>;

      await given('a root comment with a reply', async () => {
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

      await when('looking up the reply by its ID', async () => {
        found = await getComment(zip, doc, replyId);
      });

      await then('the reply is found', async () => {
        expect(found).not.toBeNull();
      });

      await and('text is "Nested reply"', async () => {
        expect(found!.text).toBe('Nested reply');
      });
    });

    test('returns null for non-existent ID', async ({ given, when, then }: AllureBddContext) => {
      let found: Awaited<ReturnType<typeof getComment>>;

      await given('a document with no comments', async () => {
        const bodyXml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
        const buf = await makeDocxBuffer(bodyXml);
        const zip = await loadZip(buf);
        await bootstrapCommentParts(zip);
        const docXml = await zip.readText('word/document.xml');
        const doc = parseXml(docXml);
        found = await getComment(zip, doc, 999);
      });

      await when('looking up a non-existent comment ID', async () => {
        // Lookup already done in given step
      });

      await then('getComment returns null', async () => {
        expect(found).toBeNull();
      });
    });
  });
});
