import { describe, it, expect } from 'vitest';

import { OdfDocument } from './document.js';

/** Wrap a content fragment in a minimal, namespace-complete content.xml. */
function contentXml(bodyInner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
  <office:body><office:text>${bodyInner}</office:text></office:body>
</office:document-content>`;
}

describe('OdfDocument — view', () => {
  it('[ODV-01] enumerates text:p and text:h in document order with IDs', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:h>Title</text:h><text:p>First</text:p><text:p>Second</text:p>'),
    );
    const paras = doc.getParagraphs();
    expect(paras.map((p) => p.text)).toEqual(['Title', 'First', 'Second']);
    expect(paras.map((p) => p.id)).toEqual(['p0', 'p1', 'p2']);
  });

  it('[ODV-02] includes table-cell paragraphs in document order', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml(
        '<text:p>Before</text:p>' +
          '<table:table><table:table-row>' +
          '<table:table-cell><text:p>CellA</text:p></table:table-cell>' +
          '<table:table-cell><text:p>CellB</text:p></table:table-cell>' +
          '</table:table-row></table:table>' +
          '<text:p>After</text:p>',
      ),
    );
    expect(doc.getParagraphs().map((p) => p.text)).toEqual(['Before', 'CellA', 'CellB', 'After']);
  });

  it('[ODV-03] IDs are deterministic across reparse of identical content', () => {
    const xml = contentXml('<text:p>Alpha</text:p><text:p>Beta</text:p>');
    const a = OdfDocument.fromContentXml(xml).getParagraphs();
    const b = OdfDocument.fromContentXml(xml).getParagraphs();
    expect(a).toEqual(b);
  });

  it('[ODV-04] reads paragraph text by ID; unknown ID is null', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p>Only</text:p>'));
    expect(doc.getParagraphTextById('p0')).toBe('Only');
    expect(doc.getParagraphTextById('p9')).toBeNull();
  });

  it('expands text:s and text:tab in visible text', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p>A<text:s text:c="3"/>B<text:tab/>C</text:p>'),
    );
    expect(doc.getParagraphTextById('p0')).toBe('A   B\tC');
  });
});

describe('OdfDocument — replaceTextById', () => {
  it('[OTR-01] replaces text within a single text node and serializes the change', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p>The quick brown fox</text:p>'));
    const res = doc.replaceTextById('p0', 'quick', 'slow');
    expect(res.ok).toBe(true);
    expect(doc.getParagraphTextById('p0')).toBe('The slow brown fox');
    expect(doc.toXml()).toContain('The slow brown fox');
  });

  it('[OTR-02] replaces text in a table cell paragraph', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml(
        '<table:table><table:table-row><table:table-cell>' +
          '<text:p>Acme Manufacturing</text:p>' +
          '</table:table-cell></table:table-row></table:table>',
      ),
    );
    const res = doc.replaceTextById('p0', 'Acme', 'Northeast');
    expect(res.ok).toBe(true);
    expect(doc.getParagraphTextById('p0')).toBe('Northeast Manufacturing');
  });

  it('[OTR-03] reports TEXT_NOT_FOUND and leaves the document unchanged', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p>Hello world</text:p>'));
    const res = doc.replaceTextById('p0', 'absent', 'x');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('TEXT_NOT_FOUND');
    expect(doc.getParagraphTextById('p0')).toBe('Hello world');
  });

  it('reports ANCHOR_NOT_FOUND for an unknown paragraph ID', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p>Hello</text:p>'));
    const res = doc.replaceTextById('p7', 'Hello', 'Hi');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('ANCHOR_NOT_FOUND');
  });

  it('[OTR-04] rejects a span-crossing match without mutating the document', () => {
    // "Hello world" split across a span boundary: "Hello " + <span>world</span>.
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p>Hello <text:span>world</text:span></text:p>'),
    );
    const res = doc.replaceTextById('p0', 'Hello world', 'Goodbye');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('MATCH_SPANS_MULTIPLE_NODES');
    expect(doc.getParagraphTextById('p0')).toBe('Hello world');
  });

  it('[OTR-04] rejects a match that includes an expanded text:s', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p>A<text:s text:c="2"/>B</text:p>'),
    );
    // "A  B" — the match spans the virtual space segment.
    const res = doc.replaceTextById('p0', 'A  B', 'X');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('MATCH_SPANS_MULTIPLE_NODES');
  });

  it('replaces a match contained in one span (single text node)', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p>Hello <text:span>world today</text:span></text:p>'),
    );
    const res = doc.replaceTextById('p0', 'world', 'planet');
    expect(res.ok).toBe(true);
    expect(doc.getParagraphTextById('p0')).toBe('Hello planet today');
  });
});

describe('OdfDocument — insertParagraph', () => {
  it('[OINS-01] inserts a body paragraph AFTER the anchor, inheriting its style with monotonic ID', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p text:style-name="Standard">First</text:p><text:p>Second</text:p>'),
    );
    const res = doc.insertParagraph('p0', 'Inserted', 'AFTER');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.newIds).toEqual(['p2']);
    expect(doc.getParagraphs().map((p) => `${p.id}:${p.text}`)).toEqual([
      'p0:First',
      'p2:Inserted',
      'p1:Second',
    ]);
    // Inherited the anchor's body-paragraph style.
    expect(doc.toXml()).toContain('text:style-name="Standard">Inserted');
  });

  it('inserts BEFORE the anchor with monotonic ID and preserves existing IDs', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p>Only</text:p>'));
    const res = doc.insertParagraph('p0', 'New first', 'BEFORE');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.newIds).toEqual(['p1']);
    expect(doc.getParagraphs().map((p) => `${p.id}:${p.text}`)).toEqual(['p1:New first', 'p0:Only']);
  });

  it('[OINS-02] does NOT propagate heading style when the anchor is a text:h', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:h text:style-name="Heading_2">Title</text:h>'),
    );
    const res = doc.insertParagraph('p0', 'Body text', 'AFTER');
    expect(res.ok).toBe(true);
    const xml = doc.toXml();
    // The inserted body paragraph must not carry the heading style.
    expect(xml).toContain('<text:p>Body text</text:p>');
    expect(xml).not.toContain('text:style-name="Heading_2">Body text');
  });

  it('[OINS-03] splits blank lines into multiple paragraphs; single newline is a line break', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p>Anchor</text:p>'));
    const res = doc.insertParagraph('p0', 'Para one\n\nPara two\nstill two', 'AFTER');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.newIds).toEqual(['p1', 'p2']);
    const texts = doc.getParagraphs().map((p) => p.text);
    expect(texts[0]).toBe('Anchor');
    expect(texts[1]).toBe('Para one');
    expect(texts[2]).toBe('Para two\nstill two'); // line-break preserved as \n in visible text
    expect(doc.toXml()).toContain('<text:line-break/>');
  });

  it('[OINS-04] returns ANCHOR_NOT_FOUND for an unknown id without throwing', () => {
    const doc = OdfDocument.fromContentXml(contentXml('<text:p>Only</text:p>'));
    const res = doc.insertParagraph('p9', 'X', 'AFTER');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('ANCHOR_NOT_FOUND');
    expect(doc.getParagraphs()).toHaveLength(1);
  });

  it('[OINS-05] preserves initial p0..pN identities, allocates new IDs monotonically, and renumbers on reopen', () => {
    const doc = OdfDocument.fromContentXml(
      contentXml('<text:p>A</text:p><text:p>B</text:p><text:p>C</text:p>'),
    );
    // Initial: p0:A, p1:B, p2:C. Next monotonic ID is p3.
    // Insert after p0: order changes without retargeting existing IDs; NEW1 gets p3.
    const res1 = doc.insertParagraph('p0', 'NEW1', 'AFTER');
    expect(res1.ok).toBe(true);
    if (res1.ok) expect(res1.newIds).toEqual(['p3']);

    expect(doc.getParagraphs().map((p) => `${p.id}:${p.text}`)).toEqual([
      'p0:A',
      'p3:NEW1',
      'p1:B',
      'p2:C',
    ]);

    // Insert another paragraph after p1 (B): NEW2 gets p4.
    const res2 = doc.insertParagraph('p1', 'NEW2', 'AFTER');
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2.newIds).toEqual(['p4']);

    expect(doc.getParagraphs().map((p) => `${p.id}:${p.text}`)).toEqual([
      'p0:A',
      'p3:NEW1',
      'p1:B',
      'p4:NEW2',
      'p2:C',
    ]);

    // Bidirectional map: can query text by all IDs (initial and allocated)
    expect(doc.getParagraphTextById('p0')).toBe('A');
    expect(doc.getParagraphTextById('p1')).toBe('B');
    expect(doc.getParagraphTextById('p2')).toBe('C');
    expect(doc.getParagraphTextById('p3')).toBe('NEW1');
    expect(doc.getParagraphTextById('p4')).toBe('NEW2');

    // Reopen deterministically renumbers stored document order to p0..pN-1
    const reopened = OdfDocument.fromContentXml(doc.toXml());
    expect(reopened.getParagraphs().map((p) => `${p.id}:${p.text}`)).toEqual([
      'p0:A',
      'p1:NEW1',
      'p2:B',
      'p3:NEW2',
      'p4:C',
    ]);
  });
});
