import { describe, it, expect } from 'vitest';

import { OdfDocument } from './document.js';

/** Wrap a content fragment in a minimal, namespace-complete content.xml (incl. dc). */
function contentXml(bodyInner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <office:body><office:text>${bodyInner}</office:text></office:body>
</office:document-content>`;
}

describe('OdfDocument — comments (office:annotation)', () => {
  it('[OANN-01] addComment brackets a substring range with annotation + annotation-end', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p>The quick brown fox</text:p>'));
    const res = doc.addComment({ paragraphId: 'p0', start: 4, end: 9, author: 'A', text: 'on quick' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.commentId).toBe(1);
    const xml = doc.toXml();
    // Annotation opens before "quick" and the paired end closes after it.
    expect(xml).toMatch(/The <office:annotation office:name="__Annot__1">.*<\/office:annotation>quick<office:annotation-end office:name="__Annot__1"\/> brown fox/);
    // Visible text is unchanged.
    expect(doc.getParagraphs().map((p) => p.text)).toEqual(['The quick brown fox']);
  });

  it('[OANN-02] getComments reads dc:creator, dc:date, body, and anchor paragraph id', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p>First</text:p><text:p>Second</text:p>'),
    );
    doc.addComment({ paragraphId: 'p1', author: 'Jane Doe', text: 'Comment body' });
    const comments = doc.getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0]!.author).toBe('Jane Doe');
    expect(comments[0]!.text).toBe('Comment body');
    expect(comments[0]!.anchoredParagraphId).toBe('p1');
    expect(comments[0]!.initials).toBe('');
    // dc:date is an ISO-8601-ish string with no fractional seconds.
    expect(comments[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('[OANN-03] whole-paragraph anchoring survives spans and spaces (structural path)', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p>Hello <text:span>brave</text:span><text:s/>world</text:p>'),
    );
    const res = doc.addComment({ paragraphId: 'p0', author: 'A', text: 'whole' });
    expect(res.ok).toBe(true); // no MATCH_SPANS_MULTIPLE_NODES on the structural path
    const xml = doc.toXml();
    // Annotation is the first inline child; the end is the last child of the paragraph.
    expect(xml).toMatch(/<text:p><office:annotation /);
    expect(xml).toMatch(/<office:annotation-end office:name="__Annot__1"\/><\/text:p>/);
    expect(doc.getParagraphs().map((p) => p.text)).toEqual(['Hello brave world']);
  });

  it('[OANN-04] a cross-node ranged match returns MATCH_SPANS_MULTIPLE_NODES (no throw)', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p>Hello <text:span>brave</text:span> world</text:p>'),
    );
    // visible "Hello brave world"; [4,8) = "o br" crosses into the span.
    const res = doc.addComment({ paragraphId: 'p0', start: 4, end: 8, author: 'A', text: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('MATCH_SPANS_MULTIPLE_NODES');
  });

  it('[OANN-05] annotation body does not leak into getParagraphs visible text or block ordinals', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p>Hello world</text:p><text:p>Second</text:p>'),
    );
    doc.addComment({ paragraphId: 'p0', author: 'Reviewer', text: 'a long comment body here' });
    // Re-parse from the serialized form to prove the markup itself is inert to the view.
    const reparsed = OdfDocument.fromContentXml(doc.toXml());
    expect(reparsed.getParagraphs()).toEqual([
      { id: 'p0', text: 'Hello world' },
      { id: 'p1', text: 'Second' },
    ]);
  });

  it('inserts a point annotation (no end) on an empty paragraph', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p/>'));
    const res = doc.addComment({ paragraphId: 'p0', author: 'A', text: 'on empty' });
    expect(res.ok).toBe(true);
    const xml = doc.toXml();
    expect(xml).toContain('<office:annotation office:name="__Annot__1">');
    expect(xml).not.toContain('office:annotation-end');
  });

  it('allocates office:name past an existing __Annot__ id', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml(
        '<text:p>x<office:annotation office:name="__Annot__5"><dc:creator>Z</dc:creator>' +
          '<text:p>old</text:p></office:annotation>' +
          '<office:annotation-end office:name="__Annot__5"/></text:p>',
      ),
    );
    const res = doc.addComment({ paragraphId: 'p0', author: 'A', text: 'new' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.commentId).toBe(6);
    // Both comments read back, the pre-existing one keeping its parsed id.
    expect(doc.getComments().map((c) => c.id).sort((a, b) => a - b)).toEqual([5, 6]);
  });

  it('returns ANCHOR_NOT_FOUND for an unknown paragraph id (no throw)', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p>Only</text:p>'));
    const res = doc.addComment({ paragraphId: 'p9', author: 'A', text: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('ANCHOR_NOT_FOUND');
  });
});
