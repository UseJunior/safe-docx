import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
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

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Comments' });

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
    test('is idempotent when comment parts already exist', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let first: Awaited<ReturnType<typeof bootstrapCommentParts>>;
      let second: Awaited<ReturnType<typeof bootstrapCommentParts>>;

      await given('a loaded zip with no existing comment parts', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        zip = await loadZip(buf);
      });

      await when('bootstrapCommentParts is called twice', async () => {
        first = await bootstrapCommentParts(zip);
        second = await bootstrapCommentParts(zip);
      });

      await then('first call creates 3 parts and second creates none', () => {
        expect(first.partsCreated).toHaveLength(3);
        expect(second.partsCreated).toHaveLength(0);
      });
    });

    test('creates parts and updates Content_Types and rels', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;

      await given('a loaded zip with no existing comment parts', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        zip = await loadZip(buf);
      });

      await when('bootstrapCommentParts is called', async () => {
        await bootstrapCommentParts(zip);
      });

      await then('the comment files and their entries are created', async () => {
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
  });

  describe('allocateNextCommentId (indirect)', () => {
    test('handles gaps in comment IDs — uses high-watermark', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;
      let result: Awaited<ReturnType<typeof addComment>>;

      await given('a zip with comments having IDs 0 and 5 (gap at 1-4)', async () => {
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
        zip = await loadZip(buf);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
        p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
      });

      await when('a new comment is added', async () => {
        result = await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Test',
          text: 'New comment',
        });
      });

      await then('the new comment ID is max(0, 5) + 1 = 6', () => {
        // Should use max(0, 5) + 1 = 6
        expect(result.commentId).toBe(6);
      });
    });

    test('starts at 0 when no comments exist', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;
      let result: Awaited<ReturnType<typeof addComment>>;

      await given('a zip with bootstrapped but empty comment parts', async () => {
        ({ zip, doc, p } = await setupWithComment());
      });

      await when('a comment is added', async () => {
        result = await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Test',
          text: 'First comment',
        });
      });

      await then('the comment ID is 0', () => {
        expect(result.commentId).toBe(0);
      });
    });
  });

  describe('addComment', () => {
    test('handles comment on empty paragraph (no runs)', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;
      let result: Awaited<ReturnType<typeof addComment>>;

      await given('a document with an empty paragraph', async () => {
        ({ zip, doc } = await setupWithComment('<w:p></w:p>'));
        p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
      });

      await when('a comment is added to the empty paragraph', async () => {
        result = await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 0,
          author: 'Test',
          text: 'Comment on empty',
        });
      });

      await then('the comment is added with ID 0 and range markers', () => {
        expect(result.commentId).toBe(0);
        const serialized = serializeXml(doc);
        expect(serialized).toContain('commentRangeStart');
        expect(serialized).toContain('commentRangeEnd');
      });
    });

    test('uses first letter of author as initials when not provided', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;

      await given('a document with a paragraph', async () => {
        ({ zip, doc, p } = await setupWithComment());
      });

      await when('a comment is added without explicit initials', async () => {
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'John',
          text: 'Test',
        });
      });

      await then('the first letter of the author is used as initials', async () => {
        const commentsXml = await zip.readText('word/comments.xml');
        expect(commentsXml).toContain('w:initials="J"');
      });
    });

    test('uses custom initials when provided', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;

      await given('a document with a paragraph', async () => {
        ({ zip, doc, p } = await setupWithComment());
      });

      await when('a comment is added with custom initials', async () => {
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'John Doe',
          text: 'Test',
          initials: 'JD',
        });
      });

      await then('the custom initials are used', async () => {
        const commentsXml = await zip.readText('word/comments.xml');
        expect(commentsXml).toContain('w:initials="JD"');
      });
    });

    test('sets xml:space=preserve for text with leading/trailing spaces', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;

      await given('a document with a paragraph', async () => {
        ({ zip, doc, p } = await setupWithComment());
      });

      await when('a comment is added with leading/trailing spaces in text', async () => {
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Test',
          text: ' spaced text ',
        });
      });

      await then('xml:space=preserve is set on the text element', async () => {
        const commentsXml = await zip.readText('word/comments.xml');
        expect(commentsXml).toContain('xml:space="preserve"');
      });
    });

    test('defaults to full paragraph when start and end are omitted', async ({ given, when, then, and }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let result: Awaited<ReturnType<typeof addComment>>;

      await given('a document with a multi-run paragraph', async () => {
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>World</w:t></w:r></w:p>',
        ));
      });

      await when('addComment is called without start and end', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        result = await addComment(doc, zip, {
          paragraphEl: p,
          author: 'Test Author',
          text: 'Whole paragraph comment',
        });
      });

      await then('a comment ID is allocated', () => {
        expect(result.commentId).toBeGreaterThanOrEqual(0);
      });

      await and('range markers and reference span the entire paragraph', () => {
        const serialized = serializeXml(doc);
        expect(serialized).toContain('commentRangeStart');
        expect(serialized).toContain('commentRangeEnd');
        expect(serialized).toContain('commentReference');
      });
    });

    test('handles empty paragraph when start and end are omitted', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let result: Awaited<ReturnType<typeof addComment>>;

      await given('a document with an empty paragraph containing pPr', async () => {
        ({ zip, doc } = await setupWithComment('<w:p><w:pPr/></w:p>'));
      });

      await when('addComment is called without start and end', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        result = await addComment(doc, zip, {
          paragraphEl: p,
          author: 'Test',
          text: 'Comment on empty paragraph',
        });
      });

      await then('comment is created and pPr stays first with markers appended after', () => {
        expect(result.commentId).toBeGreaterThanOrEqual(0);
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const children = Array.from(p.childNodes).filter(
          (n) => n.nodeType === 1,
        ) as Element[];
        expect(children[0]!.localName).toBe('pPr');
        expect(children[1]!.localName).toBe('commentRangeStart');
        expect(children[2]!.localName).toBe('commentRangeEnd');
        // commentReference is inside a w:r
        expect(children[3]!.localName).toBe('r');
      });
    });

    test('handles paragraph with field result when start and end are omitted', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let result: Awaited<ReturnType<typeof addComment>>;

      const fieldParaXml = [
        '<w:p>',
        '<w:r><w:t>Before </w:t></w:r>',
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
        '<w:r><w:instrText> PAGEREF _bk1 </w:instrText></w:r>',
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
        '<w:r><w:t>42</w:t></w:r>',
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
        '<w:r><w:t> After</w:t></w:r>',
        '</w:p>',
      ].join('');

      await given('a document with a paragraph containing a field result', async () => {
        ({ zip, doc } = await setupWithComment(fieldParaXml));
      });

      await when('addComment is called without start and end', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        result = await addComment(doc, zip, {
          paragraphEl: p,
          author: 'Test',
          text: 'Comment on field paragraph',
        });
      });

      await then('comment is created with markers present', () => {
        expect(result.commentId).toBeGreaterThanOrEqual(0);
        const serialized = serializeXml(doc);
        expect(serialized).toContain('commentRangeStart');
        expect(serialized).toContain('commentRangeEnd');
        expect(serialized).toContain('commentReference');
      });
    });

    test('throws when start > end', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;

      await given('a document with a paragraph', async () => {
        ({ zip, doc, p } = await setupWithComment());
      });

      await when('addComment is called with start > end', async () => {
        // no-op, assertion is in then
      });

      await then('an error is thrown', async () => {
        await expect(
          addComment(doc, zip, {
            paragraphEl: p,
            start: 5,
            end: 2,
            author: 'Test',
            text: 'Invalid range',
          }),
        ).rejects.toThrow('Invalid comment range');
      });
    });

    test('splits a single run when anchor offsets fall mid-run', async ({ given, when, then, and }: AllureBddContext) => {
      // Issue #151 reproducer: paragraph stores its visible text as one big <w:r>.
      // The fix splits the run at exact offsets so markers wrap only the anchor span.
      let zip: DocxZip;
      let doc: Document;

      await given('a document whose paragraph has one run with full visible text', async () => {
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:r><w:t>The terms below are incorporated into and form part of this agreement.</w:t></w:r></w:p>',
        ));
      });

      await when('addComment is called with offsets that bracket "incorporated"', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const fullText = 'The terms below are incorporated into and form part of this agreement.';
        const start = fullText.indexOf('incorporated');
        const end = start + 'incorporated'.length;
        await addComment(doc, zip, {
          paragraphEl: p,
          start,
          end,
          author: 'Test',
          text: 'Range comment on "incorporated"',
        });
      });

      await then('the original run is split into pre / span / post runs', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const children = Array.from(p.childNodes).filter((n) => n.nodeType === 1) as Element[];
        // Expect: [pre-run, commentRangeStart, span-run, commentRangeEnd, commentReference-run, post-run]
        // (commentReference is inserted between rangeEnd and the post-run, matching existing behavior.)
        expect(children.map((c) => c.localName)).toEqual([
          'r',
          'commentRangeStart',
          'r',
          'commentRangeEnd',
          'r',
          'r',
        ]);
        expect(children[0]!.textContent).toBe('The terms below are ');
        expect(children[2]!.textContent).toBe('incorporated');
        expect(children[5]!.textContent).toBe(' into and form part of this agreement.');
      });

      await and('no empty <w:r> elements survived the split', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const runs = Array.from(p.getElementsByTagNameNS(W_NS, W.r));
        for (const r of runs) {
          // An empty run has no <w:t>, <w:tab>, <w:br>, or <w:commentReference> children.
          const meaningful = Array.from(r.childNodes).filter((c) => {
            if (c.nodeType !== 1) return false;
            const local = (c as Element).localName;
            return local !== 'rPr';
          });
          expect(meaningful.length).toBeGreaterThan(0);
        }
      });

      await and('getComments reports range metadata bracketing the span only', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toHaveLength(1);
        // <w:r> indices in document order: 0=pre, 1=span (markers around it), 2=commentRef, 3=post.
        // The range markers bracket run 1; getComments returns 0-based run indices.
        expect(comments[0]!.startRunIndex).toBe(1);
        expect(comments[0]!.startCharOffset).toBe(0);
        expect(comments[0]!.endRunIndex).toBe(1);
        expect(comments[0]!.endCharOffset).toBe('incorporated'.length);
      });
    });

    test('splits boundary runs when anchor crosses multiple runs', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a document with three runs', async () => {
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>brave new </w:t></w:r><w:r><w:t>World!</w:t></w:r></w:p>',
        ));
      });

      await when('addComment is called with offsets that span runs 0..2 mid-text', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        // Concat: "Hello brave new World!" — anchor "lo brave new Wor"
        const start = 'Hel'.length;
        const end = 'Hello brave new Wor'.length;
        await addComment(doc, zip, {
          paragraphEl: p,
          start,
          end,
          author: 'Test',
          text: 'Cross-run anchor',
        });
      });

      await then('start run and end run are split, middle run is untouched', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const runs = Array.from(p.getElementsByTagNameNS(W_NS, W.r));
        const texts = runs
          .map((r) => r.getElementsByTagNameNS(W_NS, W.t).item(0))
          .map((t) => (t ? t.textContent : ''));
        // After split: [Hel, lo<spc>, brave<spc>new<spc>, Wor, commentRef, ld!]
        // commentReference run is inserted between rangeEnd and the post-run.
        expect(texts).toEqual(['Hel', 'lo ', 'brave new ', 'Wor', '', 'ld!']);

        const comments = await getComments(zip, doc);
        expect(comments).toHaveLength(1);
        expect(comments[0]!.startRunIndex).toBe(1);
        expect(comments[0]!.startCharOffset).toBe(0);
        expect(comments[0]!.endRunIndex).toBe(3);
        expect(comments[0]!.endCharOffset).toBe('Wor'.length);
      });
    });

    test('does not split when anchor exactly equals the only run text', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a document with one run', async () => {
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>',
        ));
      });

      await when('addComment is called with offsets covering the whole run', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 'Hello World'.length,
          author: 'Test',
          text: 'Whole run',
        });
      });

      await then('the run is not split (just one visible run + the commentReference run)', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const runs = Array.from(p.getElementsByTagNameNS(W_NS, W.r));
        // Original run + commentReference run = 2.
        expect(runs).toHaveLength(2);
        expect(runs[0]!.getElementsByTagNameNS(W_NS, W.t).item(0)!.textContent).toBe('Hello World');
      });
    });

    test('preserves run formatting (rPr) on both halves of a split', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a document with a single bold+italic run', async () => {
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Hello World</w:t></w:r></w:p>',
        ));
      });

      await when('addComment is called with mid-run offsets', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 'Hello '.length,
          end: 'Hello World'.length,
          author: 'Test',
          text: 'Bold split',
        });
      });

      await then('both pre-run and span-run carry bold+italic', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const visibleRuns = Array.from(p.getElementsByTagNameNS(W_NS, W.r)).filter(
          (r) => r.getElementsByTagNameNS(W_NS, W.t).length > 0,
        );
        expect(visibleRuns).toHaveLength(2);
        for (const r of visibleRuns) {
          const rPr = r.getElementsByTagNameNS(W_NS, W.rPr).item(0)!;
          expect(rPr.getElementsByTagNameNS(W_NS, W.b).length).toBe(1);
          expect(rPr.getElementsByTagNameNS(W_NS, W.i).length).toBe(1);
        }
      });
    });

    test('keeps markers inside w:hyperlink when anchor falls inside the wrapper', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a paragraph whose only visible text is inside a w:hyperlink', async () => {
        // w:anchor avoids needing the r:id namespace; semantically still a hyperlink wrapper for our test.
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:hyperlink w:anchor="bk1"><w:r><w:t>Visit our website now</w:t></w:r></w:hyperlink></w:p>',
        ));
      });

      await when('addComment is called with offsets that bracket "website"', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const start = 'Visit our '.length;
        const end = start + 'website'.length;
        await addComment(doc, zip, {
          paragraphEl: p,
          start,
          end,
          author: 'Test',
          text: 'Hyperlink-internal anchor',
        });
      });

      await then('the hyperlink wrapper still contains the split runs and the markers', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const hyperlink = p.getElementsByTagNameNS(W_NS, 'hyperlink').item(0) as Element;
        expect(hyperlink).toBeTruthy();
        const childLocalNames = Array.from(hyperlink.childNodes)
          .filter((c) => c.nodeType === 1)
          .map((c) => (c as Element).localName);
        // [pre-run, commentRangeStart, span-run, commentRangeEnd, post-run, commentReference-run]
        // [pre-run, commentRangeStart, span-run, commentRangeEnd, commentReference-run, post-run]
        expect(childLocalNames).toEqual([
          'r',
          'commentRangeStart',
          'r',
          'commentRangeEnd',
          'r',
          'r',
        ]);
      });
    });

    test('keeps markers inside w:ins (tracked-change wrapper) when anchor falls inside it', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a paragraph whose only visible text is inside a w:ins', async () => {
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:ins w:id="1" w:author="A" w:date="2025-01-01T00:00:00Z"><w:r><w:t>inserted clause text</w:t></w:r></w:ins></w:p>',
        ));
      });

      await when('addComment is called with offsets bracketing "clause"', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const start = 'inserted '.length;
        const end = start + 'clause'.length;
        await addComment(doc, zip, {
          paragraphEl: p,
          start,
          end,
          author: 'Test',
          text: 'Ins-internal anchor',
        });
      });

      await then('the w:ins wrapper still contains the split runs and the markers', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const ins = p.getElementsByTagNameNS(W_NS, 'ins').item(0) as Element;
        expect(ins).toBeTruthy();
        const childLocalNames = Array.from(ins.childNodes)
          .filter((c) => c.nodeType === 1)
          .map((c) => (c as Element).localName);
        // [pre-run, commentRangeStart, span-run, commentRangeEnd, commentReference-run, post-run]
        expect(childLocalNames).toEqual([
          'r',
          'commentRangeStart',
          'r',
          'commentRangeEnd',
          'r',
          'r',
        ]);
      });
    });

    test('moves a w:tab to the span when the anchor starts exactly on it', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a paragraph with text-tab-text in one run', async () => {
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:r><w:t>foo</w:t><w:tab/><w:t>bar</w:t></w:r></w:p>',
        ));
      });

      await when('addComment anchors from the tab through the trailing text', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        // Visible text = "foo\tbar" (length 7). Anchor "\tbar" → start 3, end 7.
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 3,
          end: 7,
          author: 'Test',
          text: 'Tab-spanning anchor',
        });
      });

      await then('the tab lands in the span run, not the pre run', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const visibleRuns = Array.from(p.getElementsByTagNameNS(W_NS, W.r)).filter((r) => {
          return Array.from(r.childNodes).some((c) => {
            if (c.nodeType !== 1) return false;
            const local = (c as Element).localName;
            return local === 't' || local === 'tab' || local === 'br';
          });
        });
        // Pre run has "foo" only; span run has tab+"bar"; commentReference run has nothing visible (filtered out).
        expect(visibleRuns).toHaveLength(2);
        const preChildren = Array.from(visibleRuns[0]!.childNodes)
          .filter((c) => c.nodeType === 1)
          .map((c) => (c as Element).localName);
        expect(preChildren).toContain('t');
        expect(preChildren).not.toContain('tab');
        const spanChildren = Array.from(visibleRuns[1]!.childNodes)
          .filter((c) => c.nodeType === 1)
          .map((c) => (c as Element).localName);
        expect(spanChildren).toContain('tab');
        expect(spanChildren).toContain('t');
      });
    });

    test('falls back to whole-paragraph wrap when offsets are out of range', async ({ given, when, then }: AllureBddContext) => {
      // Defense-in-depth for direct callers of the docx-core primitive that pass
      // offsets findOffsetInRuns cannot map (e.g., > visible length).
      let zip: DocxZip;
      let doc: Document;

      await given('a document with a short paragraph', async () => {
        ({ zip, doc } = await setupWithComment('<w:p><w:r><w:t>Short</w:t></w:r></w:p>'));
      });

      await when('addComment is called with offsets beyond the paragraph length', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 100,
          end: 200,
          author: 'Test',
          text: 'Out-of-range fallback',
        });
      });

      await then('markers are inserted at run boundaries without throwing', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const childLocalNames = Array.from(p.childNodes)
          .filter((c) => c.nodeType === 1)
          .map((c) => (c as Element).localName);
        expect(childLocalNames).toContain('commentRangeStart');
        expect(childLocalNames).toContain('commentRangeEnd');
        expect(childLocalNames).toContain('r');
      });
    });
  });

  describe('addCommentReply', () => {
    test('throws when parent comment ID does not exist', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a document with no comments', async () => {
        ({ zip, doc } = await setupWithComment());
      });

      await when('a reply is added to a non-existent parent', () => {});

      await then('an error is thrown mentioning the missing ID', async () => {
        await expect(
          addCommentReply(doc, zip, {
            parentCommentId: 999,
            author: 'Reply',
            text: 'Orphaned reply',
          }),
        ).rejects.toThrow(/999 not found/);
      });
    });
  });

  describe('getComments', () => {
    test('returns empty array when comments.xml is absent', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await given('a zip without comments.xml', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        zip = await loadZip(buf);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
      });

      await when('getComments is called', async () => {
        comments = await getComments(zip, doc);
      });

      await then('an empty array is returned', () => {
        expect(comments).toEqual([]);
      });
    });

    test('returns empty array when comments.xml exists but has no comments', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await given('a bootstrapped zip with no comments added', async () => {
        ({ zip, doc } = await setupWithComment());
      });

      await when('getComments is called', async () => {
        comments = await getComments(zip, doc);
      });

      await then('an empty array is returned', () => {
        expect(comments).toEqual([]);
      });
    });

    test('reconstructs threaded replies in nested structure', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;
      let comments: Awaited<ReturnType<typeof getComments>>;

      await given('a document with a root comment and two replies', async () => {
        ({ zip, doc, p } = await setupWithComment());
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
      });

      await when('getComments is called', async () => {
        comments = await getComments(zip, doc);
      });

      await then('the threaded structure is reconstructed', () => {
        expect(comments).toHaveLength(1);
        expect(comments[0]!.replies).toHaveLength(2);
        expect(comments[0]!.replies[0]!.text).toBe('First reply');
        expect(comments[0]!.replies[1]!.text).toBe('Second reply');
      });
    });
  });

  describe('getComment', () => {
    test('finds a nested reply by ID', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;
      let replyId: number;
      let found: Awaited<ReturnType<typeof getComment>>;

      await given('a document with a root comment and a reply', async () => {
        ({ zip, doc, p } = await setupWithComment());
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
        replyId = reply.commentId;
      });

      await when('getComment is called for the reply ID', async () => {
        found = await getComment(zip, doc, replyId);
      });

      await then('the reply comment is returned', () => {
        expect(found).not.toBeNull();
        expect(found!.text).toBe('Found me');
      });
    });

    test('returns null for non-existent ID', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let found: Awaited<ReturnType<typeof getComment>>;

      await given('a document with no comments', async () => {
        ({ zip, doc } = await setupWithComment());
      });

      await when('getComment is called for a non-existent ID', async () => {
        found = await getComment(zip, doc, 999);
      });

      await then('null is returned', () => {
        expect(found).toBeNull();
      });
    });
  });

  describe('deleteComment', () => {
    test('cascade-deletes all transitive descendants', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;
      let rootId: number;

      await given('a document with a root comment, child, and grandchild', async () => {
        ({ zip, doc, p } = await setupWithComment());
        const root = await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Root',
          text: 'Root',
        });
        rootId = root.commentId;
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
      });

      await when('the root comment is deleted', async () => {
        await deleteComment(doc, zip, { commentId: rootId });
      });

      await then('all comments and their text are removed', async () => {
        const comments = await getComments(zip, doc);
        expect(comments).toEqual([]);

        const commentsXml = await zip.readText('word/comments.xml');
        expect(commentsXml).not.toContain('Root');
        expect(commentsXml).not.toContain('Child');
        expect(commentsXml).not.toContain('Grandchild');
      });
    });

    test('removes comment from comments.xml on delete', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;

      await given('a document with one comment', async () => {
        ({ zip, doc, p } = await setupWithComment());
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 5,
          author: 'Test',
          text: 'Removable',
        });
      });

      await when('the comment is deleted', async () => {
        const beforeComments = await zip.readText('word/comments.xml');
        expect(beforeComments).toContain('Removable');
        await deleteComment(doc, zip, { commentId: 0 });
      });

      await then('the comment text is removed from comments.xml', async () => {
        const afterComments = await zip.readText('word/comments.xml');
        expect(afterComments).not.toContain('Removable');
      });
    });

    test('throws when comment ID not found', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a bootstrapped zip with no comments', async () => {
        ({ zip, doc } = await setupWithComment());
        await bootstrapCommentParts(zip);
      });

      await when('delete is called for a non-existent ID', () => {});

      await then('an error is thrown', async () => {
        await expect(deleteComment(doc, zip, { commentId: 999 })).rejects.toThrow(/not found/);
      });
    });

    test('throws when comments.xml is absent', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a zip without comments.xml', async () => {
        const buf = await makeDocxBuffer('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
        zip = await loadZip(buf);
        const docXml = await zip.readText('word/document.xml');
        doc = parseXml(docXml);
      });

      await when('delete is called', () => {});

      await then('an error is thrown', async () => {
        await expect(deleteComment(doc, zip, { commentId: 0 })).rejects.toThrow(/not found/);
      });
    });
  });
});
