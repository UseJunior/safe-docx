import { describe, expect, vi } from 'vitest';
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
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';

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

async function withDeterministicMetadata<T>(
  randomValues: number[],
  run: () => Promise<T> | T,
): Promise<T> {
  const RealDate = Date;
  const fixedTime = new RealDate('2026-05-03T14:15:16Z').valueOf();

  class FixedDate extends RealDate {
    constructor(value?: string | number | Date) {
      super(value ?? fixedTime);
    }

    static now(): number {
      return fixedTime;
    }
  }

  let index = 0;
  vi.stubGlobal('Date', FixedDate);
  const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
    const explicit = randomValues[index];
    index += 1;
    if (explicit != null) return explicit;
    return ((index % 900) + 1) / 1000;
  });

  try {
    return await run();
  } finally {
    randomSpy.mockRestore();
    vi.unstubAllGlobals();
  }
}

function directChildElementNames(element: Element): string[] {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === 1)
    .map((node) => (node as Element).localName);
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

    test('throws when offsets exceed paragraph visible length', async ({ given, when, then }: AllureBddContext) => {
      // Anchoring on unrelated text would be worse than a clear error, so
      // out-of-range offsets must fail loudly. Direct callers of the docx-core
      // primitive should validate offsets against getParagraphText() themselves.
      let zip: DocxZip;
      let doc: Document;
      let p: Element;

      await given('a document with a short paragraph', async () => {
        ({ zip, doc, p } = await setupWithComment('<w:p><w:r><w:t>Short</w:t></w:r></w:p>'));
      });

      await when('addComment is called with offsets beyond the paragraph length', async () => {
        // assertion in then
      });

      await then('an error is thrown', async () => {
        await expect(
          addComment(doc, zip, {
            paragraphEl: p,
            start: 100,
            end: 200,
            author: 'Test',
            text: 'Out-of-range',
          }),
        ).rejects.toThrow(/outside paragraph visible text/);
      });
    });

    test('throws when start is negative', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;

      await given('a document with a paragraph', async () => {
        ({ zip, doc, p } = await setupWithComment());
      });

      await when('addComment is called with a negative start', async () => {
        // assertion in then
      });

      await then('an error is thrown', async () => {
        await expect(
          addComment(doc, zip, {
            paragraphEl: p,
            start: -1,
            end: 5,
            author: 'Test',
            text: 'Negative start',
          }),
        ).rejects.toThrow(/outside paragraph visible text/);
      });
    });

    test('handles a collapsed range (start === end) in the middle of a run', async ({ given, when, then, and }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a document with one run', async () => {
        ({ zip, doc } = await setupWithComment('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>'));
      });

      await when('addComment is called with a zero-width range mid-run', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 5,
          end: 5,
          author: 'Test',
          text: 'Insertion-point comment',
        });
      });

      await then('the run is split once and the markers sit between the two halves', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const children = Array.from(p.childNodes).filter((n) => n.nodeType === 1) as Element[];
        // Layout: [pre-run "Hello", commentRangeStart, commentRangeEnd, commentReference-run, post-run " World"]
        expect(children.map((c) => c.localName)).toEqual([
          'r',
          'commentRangeStart',
          'commentRangeEnd',
          'r',
          'r',
        ]);
        expect(children[0]!.textContent).toBe('Hello');
        expect(children[4]!.textContent).toBe(' World');
      });

      await and('no empty <w:r> survived the split', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const visibleRuns = Array.from(p.getElementsByTagNameNS(W_NS, W.r)).filter((r) => {
          return Array.from(r.childNodes).some((c) => {
            if (c.nodeType !== 1) return false;
            const local = (c as Element).localName;
            return local === 't' || local === 'tab' || local === 'br' || local === 'commentReference';
          });
        });
        // Pre-run, post-run, and commentReference run all have meaningful content; no empty <w:r>.
        expect(visibleRuns).toHaveLength(3);
      });
    });

    test('handles a collapsed range at the very start of a paragraph', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a document with one run', async () => {
        ({ zip, doc } = await setupWithComment('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>'));
      });

      await when('addComment is called with start === end === 0', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 0,
          end: 0,
          author: 'Test',
          text: 'At paragraph start',
        });
      });

      await then('markers go before the run, no split occurs', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const children = Array.from(p.childNodes).filter((n) => n.nodeType === 1) as Element[];
        expect(children.map((c) => c.localName)).toEqual([
          'commentRangeStart',
          'commentRangeEnd',
          'r',
          'r',
        ]);
        // commentReference run is at index 2; original run with full text is at index 3.
        expect(children[3]!.textContent).toBe('Hello World');
      });
    });

    test('handles a collapsed range at an existing run boundary', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;

      await given('a document with two runs', async () => {
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>World</w:t></w:r></w:p>',
        ));
      });

      await when('addComment is called with start === end at the boundary between them', async () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        // Visible "Hello " is 6 chars; boundary at offset 6 sits between the two runs.
        await addComment(doc, zip, {
          paragraphEl: p,
          start: 6,
          end: 6,
          author: 'Test',
          text: 'At run boundary',
        });
      });

      await then('markers go between the two existing runs, no split occurs', () => {
        const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        const children = Array.from(p.childNodes).filter((n) => n.nodeType === 1) as Element[];
        // Layout: ["Hello ", commentRangeStart, commentRangeEnd, commentReference-run, "World"]
        expect(children.map((c) => c.localName)).toEqual([
          'r',
          'commentRangeStart',
          'commentRangeEnd',
          'r',
          'r',
        ]);
        expect(children[0]!.textContent).toBe('Hello ');
        expect(children[4]!.textContent).toBe('World');
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

  describe('tracked-change emission', () => {
    test('addComment wraps the commentReference run in w:ins and leaves side-part writes byte-identical', async ({ given, when, then }: AllureBddContext) => {
      let trackedZip: DocxZip;
      let trackedDoc: Document;
      let trackedParagraph: Element;
      let controlZip: DocxZip;
      let controlDoc: Document;
      let controlParagraph: Element;
      let trackedCommentsXml: string;
      let trackedPeopleXml: string;
      let controlCommentsXml: string;
      let controlPeopleXml: string;

      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      });

      await given('two identical bootstrapped documents and a tracked revision context', async () => {
        ({ zip: trackedZip, doc: trackedDoc, p: trackedParagraph } = await setupWithComment());
        ({ zip: controlZip, doc: controlDoc, p: controlParagraph } = await setupWithComment());
      });

      await when('the same root comment is added with and without revision context under deterministic metadata', async () => {
        await withDeterministicMetadata([0.111111111], async () => {
          await addComment(controlDoc, controlZip, {
            paragraphEl: controlParagraph,
            start: 0,
            end: 5,
            author: 'Reviewer',
            text: 'Tracked root comment',
          });
        });

        await withDeterministicMetadata([0.111111111], async () => {
          await addComment(trackedDoc, trackedZip, {
            paragraphEl: trackedParagraph,
            start: 0,
            end: 5,
            author: 'Reviewer',
            text: 'Tracked root comment',
          }, ctx);
        });

        trackedCommentsXml = await trackedZip.readText('word/comments.xml');
        trackedPeopleXml = await trackedZip.readText('word/people.xml');
        controlCommentsXml = await controlZip.readText('word/comments.xml');
        controlPeopleXml = await controlZip.readText('word/people.xml');
      });

      await then('only the reference run is wrapped in w:ins while comments.xml and people.xml stay identical', () => {
        expect(directChildElementNames(trackedParagraph)).toEqual([
          'commentRangeStart',
          'r',
          'commentRangeEnd',
          'ins',
          'r',
        ]);

        const insertion = trackedParagraph.getElementsByTagNameNS(W_NS, 'ins').item(0) as Element;
        expect(insertion).toBeTruthy();
        expect(insertion.parentNode).toBe(trackedParagraph);
        expect(insertion.getAttribute('w:id')).toBe('1');
        expect(insertion.getAttribute('w:author')).toBe('SafeDocX AI');
        expect(insertion.getAttribute('w:date')).toBe('2026-05-03T14:15:16Z');
        expect(insertion.getElementsByTagNameNS(W_NS, W.r)).toHaveLength(1);
        expect(insertion.getElementsByTagNameNS(W_NS, W.commentReference)).toHaveLength(1);

        const rangeStart = trackedParagraph.getElementsByTagNameNS(W_NS, W.commentRangeStart).item(0) as Element;
        const rangeEnd = trackedParagraph.getElementsByTagNameNS(W_NS, W.commentRangeEnd).item(0) as Element;
        expect(rangeStart.parentNode).toBe(trackedParagraph);
        expect(rangeEnd.parentNode).toBe(trackedParagraph);
        expect(insertion.contains(rangeStart)).toBe(false);
        expect(insertion.contains(rangeEnd)).toBe(false);

        expect(trackedCommentsXml).toBe(controlCommentsXml);
        expect(trackedPeopleXml).toBe(controlPeopleXml);
      });
    });

    test('deleteComment wraps the removed commentReference run in w:del while range markers are still removed', async ({ given, when, then }: AllureBddContext) => {
      let trackedZip: DocxZip;
      let trackedDoc: Document;
      let trackedParagraph: Element;
      let controlZip: DocxZip;
      let controlDoc: Document;
      let controlParagraph: Element;
      let trackedCommentsXml: string;
      let trackedCommentsExtendedXml: string;
      let trackedPeopleXml: string;
      let controlCommentsXml: string;
      let controlCommentsExtendedXml: string;
      let controlPeopleXml: string;

      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      });

      await given('two identical documents with the same root comment already inserted', async () => {
        ({ zip: trackedZip, doc: trackedDoc, p: trackedParagraph } = await setupWithComment());
        ({ zip: controlZip, doc: controlDoc, p: controlParagraph } = await setupWithComment());

        await withDeterministicMetadata([0.222222222], async () => {
          await addComment(controlDoc, controlZip, {
            paragraphEl: controlParagraph,
            start: 0,
            end: 5,
            author: 'Reviewer',
            text: 'Delete me',
          });
        });

        await withDeterministicMetadata([0.222222222], async () => {
          await addComment(trackedDoc, trackedZip, {
            paragraphEl: trackedParagraph,
            start: 0,
            end: 5,
            author: 'Reviewer',
            text: 'Delete me',
          });
        });
      });

      await when('the comment is deleted with and without tracked-change context', async () => {
        await deleteComment(controlDoc, controlZip, { commentId: 0 });
        await deleteComment(trackedDoc, trackedZip, { commentId: 0 }, ctx);

        trackedCommentsXml = await trackedZip.readText('word/comments.xml');
        trackedCommentsExtendedXml = await trackedZip.readText('word/commentsExtended.xml');
        trackedPeopleXml = await trackedZip.readText('word/people.xml');
        controlCommentsXml = await controlZip.readText('word/comments.xml');
        controlCommentsExtendedXml = await controlZip.readText('word/commentsExtended.xml');
        controlPeopleXml = await controlZip.readText('word/people.xml');
      });

      await then('the tracked body keeps the reference run under w:del and the side-part writes match the legacy path', () => {
        expect(trackedParagraph.getElementsByTagNameNS(W_NS, W.commentRangeStart)).toHaveLength(0);
        expect(trackedParagraph.getElementsByTagNameNS(W_NS, W.commentRangeEnd)).toHaveLength(0);
        expect(directChildElementNames(trackedParagraph)).toEqual(['r', 'del', 'r']);

        const deletion = trackedParagraph.getElementsByTagNameNS(W_NS, 'del').item(0) as Element;
        expect(deletion).toBeTruthy();
        expect(deletion.parentNode).toBe(trackedParagraph);
        expect(deletion.getAttribute('w:id')).toBe('1');
        expect(deletion.getAttribute('w:author')).toBe('SafeDocX AI');
        expect(deletion.getAttribute('w:date')).toBe('2026-05-03T14:15:16Z');
        expect(deletion.getElementsByTagNameNS(W_NS, W.r)).toHaveLength(1);
        expect(deletion.getElementsByTagNameNS(W_NS, W.commentReference)).toHaveLength(1);
        expect(deletion.getElementsByTagNameNS(W_NS, 'delText')).toHaveLength(0);

        expect(trackedCommentsXml).toBe(controlCommentsXml);
        expect(trackedCommentsExtendedXml).toBe(controlCommentsExtendedXml);
        expect(trackedPeopleXml).toBe(controlPeopleXml);
      });
    });

    test('addCommentReply accepts ctx but leaves the document body untouched while side-part writes stay identical', async ({ given, when, then }: AllureBddContext) => {
      let trackedZip: DocxZip;
      let trackedDoc: Document;
      let trackedParagraph: Element;
      let controlZip: DocxZip;
      let controlDoc: Document;
      let controlParagraph: Element;
      let trackedBodyBeforeReply: string;
      let trackedBodyAfterReply: string;
      let controlBodyAfterReply: string;
      let trackedCommentsXml: string;
      let trackedCommentsExtendedXml: string;
      let trackedPeopleXml: string;
      let controlCommentsXml: string;
      let controlCommentsExtendedXml: string;
      let controlPeopleXml: string;

      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      });

      await given('two identical documents with the same root comment already added', async () => {
        ({ zip: trackedZip, doc: trackedDoc, p: trackedParagraph } = await setupWithComment());
        ({ zip: controlZip, doc: controlDoc, p: controlParagraph } = await setupWithComment());

        await withDeterministicMetadata([0.333333333], async () => {
          await addComment(controlDoc, controlZip, {
            paragraphEl: controlParagraph,
            start: 0,
            end: 5,
            author: 'Root',
            text: 'Root comment',
          });
        });

        await withDeterministicMetadata([0.333333333], async () => {
          await addComment(trackedDoc, trackedZip, {
            paragraphEl: trackedParagraph,
            start: 0,
            end: 5,
            author: 'Root',
            text: 'Root comment',
          });
        });

        trackedBodyBeforeReply = serializeXml(trackedDoc);
      });

      await when('a threaded reply is added with and without ctx under deterministic metadata', async () => {
        await withDeterministicMetadata([0.444444444], async () => {
          await addCommentReply(controlDoc, controlZip, {
            parentCommentId: 0,
            author: 'Replier',
            text: 'Reply body',
          });
        });

        await withDeterministicMetadata([0.444444444], async () => {
          await addCommentReply(trackedDoc, trackedZip, {
            parentCommentId: 0,
            author: 'Replier',
            text: 'Reply body',
          }, ctx);
        });

        trackedBodyAfterReply = serializeXml(trackedDoc);
        controlBodyAfterReply = serializeXml(controlDoc);
        trackedCommentsXml = await trackedZip.readText('word/comments.xml');
        trackedCommentsExtendedXml = await trackedZip.readText('word/commentsExtended.xml');
        trackedPeopleXml = await trackedZip.readText('word/people.xml');
        controlCommentsXml = await controlZip.readText('word/comments.xml');
        controlCommentsExtendedXml = await controlZip.readText('word/commentsExtended.xml');
        controlPeopleXml = await controlZip.readText('word/people.xml');
      });

      await then('the body remains unchanged with no insertion or deletion wrappers, and side-part writes match', () => {
        expect(trackedBodyAfterReply).toBe(trackedBodyBeforeReply);
        expect(trackedBodyAfterReply).toBe(controlBodyAfterReply);
        expect(trackedDoc.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(0);
        expect(trackedDoc.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(0);

        expect(trackedCommentsXml).toBe(controlCommentsXml);
        expect(trackedCommentsExtendedXml).toBe(controlCommentsExtendedXml);
        expect(trackedPeopleXml).toBe(controlPeopleXml);
      });
    });

    test('preserves the legacy untracked body behavior when ctx is omitted for addComment, addCommentReply, and deleteComment', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let paragraph: Element;
      let bodyAfterAdd: string;
      let bodyAfterReply: string;
      let commentId: number;

      await given('a bootstrapped document with a single paragraph', async () => {
        ({ zip, doc, p: paragraph } = await setupWithComment());
      });

      await when('the comment lifecycle runs without a revision context', async () => {
        await withDeterministicMetadata([0.555555555], async () => {
          const result = await addComment(doc, zip, {
            paragraphEl: paragraph,
            start: 0,
            end: 5,
            author: 'Reviewer',
            text: 'Legacy root comment',
          });
          commentId = result.commentId;
        });

        bodyAfterAdd = serializeXml(doc);

        await withDeterministicMetadata([0.666666666], async () => {
          await addCommentReply(doc, zip, {
            parentCommentId: commentId,
            author: 'Replier',
            text: 'Legacy reply',
          });
        });

        bodyAfterReply = serializeXml(doc);
        await deleteComment(doc, zip, { commentId });
      });

      await then('the body follows the historical untracked path with no w:ins or w:del markup', () => {
        expect(bodyAfterAdd).toContain('<w:commentRangeStart');
        expect(bodyAfterAdd).toContain('<w:commentRangeEnd');
        expect(bodyAfterAdd).toContain('<w:commentReference');
        expect(bodyAfterAdd).not.toContain('<w:ins');
        expect(bodyAfterAdd).not.toContain('<w:del');
        expect(bodyAfterReply).toBe(bodyAfterAdd);
        expect(directChildElementNames(paragraph)).toEqual(['r', 'r']);
        expect(paragraph.getElementsByTagNameNS(W_NS, W.commentRangeStart)).toHaveLength(0);
        expect(paragraph.getElementsByTagNameNS(W_NS, W.commentRangeEnd)).toHaveLength(0);
        expect(paragraph.getElementsByTagNameNS(W_NS, W.commentReference)).toHaveLength(0);
        const remainingRuns = Array.from(paragraph.childNodes).filter((node) => node.nodeType === 1) as Element[];
        expect(remainingRuns.map((run) => run.textContent)).toEqual(['Hello', ' World']);
        expect(doc.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(0);
        expect(doc.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(0);
      });
    });

    test('allocates distinct revision IDs across tracked addComment and deleteComment operations sharing one context', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let firstParagraph: Element;
      let secondParagraph: Element;
      let emittedIds: number[];

      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      });

      await given('a two-paragraph document with one existing untracked comment', async () => {
        ({ zip, doc } = await setupWithComment(
          '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Beta</w:t></w:r></w:p>',
        ));
        firstParagraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
        secondParagraph = doc.getElementsByTagNameNS(W_NS, W.p).item(1) as Element;

        await withDeterministicMetadata([0.777777777], async () => {
          await addComment(doc, zip, {
            paragraphEl: firstParagraph,
            start: 0,
            end: 5,
            author: 'Root',
            text: 'Delete this one',
          });
        });
      });

      await when('a tracked add and tracked delete share the same revision context', async () => {
        await withDeterministicMetadata([0.888888888], async () => {
          await addComment(doc, zip, {
            paragraphEl: secondParagraph,
            start: 0,
            end: 4,
            author: 'Reviewer',
            text: 'Keep this tracked comment',
          }, ctx);
        });

        await deleteComment(doc, zip, { commentId: 0 }, ctx);

        emittedIds = [
          ...Array.from(doc.getElementsByTagNameNS(W_NS, 'ins')),
          ...Array.from(doc.getElementsByTagNameNS(W_NS, 'del')),
        ].map((element) => Number((element as Element).getAttribute('w:id')));
      });

      await then('the insertion and deletion wrappers use distinct revision IDs from the shared allocator', () => {
        expect(emittedIds.slice().sort((left, right) => left - right)).toEqual([1, 2]);
        expect(new Set(emittedIds).size).toBe(2);
      });
    });

    test('tracked deleteComment of a tracked addComment yields nested w:ins > w:del around the reference run', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;
      let nestedDeletion: Element;

      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      });

      await given('a bootstrapped document with a tracked-added comment whose reference is wrapped in w:ins', async () => {
        ({ zip, doc, p } = await setupWithComment());

        await withDeterministicMetadata([0.222222222], async () => {
          await addComment(doc, zip, {
            paragraphEl: p,
            start: 0,
            end: 5,
            author: 'Reviewer',
            text: 'Comment that will be deleted',
          }, ctx);
        });

        // Confirm precondition: reference run is currently inside <w:ins>
        const insertion = p.getElementsByTagNameNS(W_NS, 'ins').item(0) as Element | null;
        expect(insertion).toBeTruthy();
        expect(insertion!.getElementsByTagNameNS(W_NS, W.commentReference)).toHaveLength(1);
      });

      await when('the comment is deleted under the same tracked revision context', async () => {
        await deleteComment(doc, zip, { commentId: 0 }, ctx);

        const deletions = p.getElementsByTagNameNS(W_NS, 'del');
        expect(deletions).toHaveLength(1);
        nestedDeletion = deletions.item(0) as Element;
      });

      await then('the deletion wrapper sits inside the original insertion wrapper', () => {
        const parentIns = nestedDeletion.parentNode as Element;
        expect(parentIns).toBeTruthy();
        expect(parentIns.namespaceURI).toBe(W_NS);
        expect(parentIns.localName).toBe('ins');

        // The reference run is preserved inside <w:del> (not removed).
        const runs = nestedDeletion.getElementsByTagNameNS(W_NS, W.r);
        expect(runs).toHaveLength(1);
        expect(runs.item(0)!.getElementsByTagNameNS(W_NS, W.commentReference)).toHaveLength(1);

        // commentRangeStart / commentRangeEnd are still removed entirely.
        expect(p.getElementsByTagNameNS(W_NS, W.commentRangeStart)).toHaveLength(0);
        expect(p.getElementsByTagNameNS(W_NS, W.commentRangeEnd)).toHaveLength(0);
      });
    });

    test('addComment with ctx wraps the reference run on an empty paragraph (no-runs branch)', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;

      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      });

      await given('a bootstrapped document whose paragraph has no runs', async () => {
        ({ zip, doc, p } = await setupWithComment('<w:p></w:p>'));
      });

      await when('addComment is called with ctx on the empty paragraph', async () => {
        await withDeterministicMetadata([0.333333333], async () => {
          await addComment(doc, zip, {
            paragraphEl: p,
            author: 'Reviewer',
            text: 'Empty paragraph comment',
          }, ctx);
        });
      });

      await then('the reference run is wrapped in w:ins; rangeStart/End are bare children of the paragraph', () => {
        expect(directChildElementNames(p)).toEqual([
          'commentRangeStart',
          'commentRangeEnd',
          'ins',
        ]);
        const insertion = p.getElementsByTagNameNS(W_NS, 'ins').item(0) as Element;
        expect(insertion.getAttribute('w:author')).toBe('SafeDocX AI');
        expect(insertion.getElementsByTagNameNS(W_NS, W.commentReference)).toHaveLength(1);
      });
    });

    test('addComment with ctx wraps the reference run in the collapsed-range branch (start === end)', async ({ given, when, then }: AllureBddContext) => {
      let zip: DocxZip;
      let doc: Document;
      let p: Element;

      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      });

      await given('a bootstrapped document with a single-run paragraph', async () => {
        ({ zip, doc, p } = await setupWithComment());
      });

      await when('addComment is called with a collapsed range (caret) and ctx', async () => {
        await withDeterministicMetadata([0.444444444], async () => {
          await addComment(doc, zip, {
            paragraphEl: p,
            start: 5,
            end: 5,
            author: 'Reviewer',
            text: 'Collapsed-range comment',
          }, ctx);
        });
      });

      await then('the reference run sits inside w:ins between the collapsed rangeStart/End markers', () => {
        const insertion = p.getElementsByTagNameNS(W_NS, 'ins').item(0) as Element;
        expect(insertion).toBeTruthy();
        expect(insertion.getAttribute('w:author')).toBe('SafeDocX AI');
        expect(insertion.getElementsByTagNameNS(W_NS, W.r)).toHaveLength(1);
        expect(insertion.getElementsByTagNameNS(W_NS, W.commentReference)).toHaveLength(1);

        const rangeStart = p.getElementsByTagNameNS(W_NS, W.commentRangeStart).item(0) as Element;
        const rangeEnd = p.getElementsByTagNameNS(W_NS, W.commentRangeEnd).item(0) as Element;
        expect(rangeStart).toBeTruthy();
        expect(rangeEnd).toBeTruthy();
        // rangeStart/End are NOT inside the insertion wrapper (markers stay metadata).
        expect(insertion.contains(rangeStart)).toBe(false);
        expect(insertion.contains(rangeEnd)).toBe(false);
      });
    });
  });
});
