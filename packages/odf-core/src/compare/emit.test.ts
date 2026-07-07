import { describe, it, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';

import { compareOdf, OdfEmitError } from './index.js';
import { OdfDocument } from '../document.js';
import { ODF_NS } from '../shared/odf/namespaces.js';

/** Wrap paragraphs in a minimal, namespace-complete content.xml (incl. xml: for xml:id). */
function contentXml(paras: string[]): string {
  const body = paras.map((t) => `<text:p>${t}</text:p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:xml="http://www.w3.org/XML/1998/namespace">
  <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`;
}

/**
 * Content.xml whose body is an intro paragraph, a one-cell table, then `trailingParas` — the
 * issue #380 shape (a signature table followed by the document's last paragraph(s)).
 */
function contentXmlWithTable(trailingParas: string[]): string {
  const tail = trailingParas.map((t) => `<text:p>${t}</text:p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:xml="http://www.w3.org/XML/1998/namespace">
  <office:body><office:text><text:p>Intro</text:p><table:table><table:table-row><table:table-cell><text:p>Cell</text:p></table:table-cell></table:table-row></table:table>${tail}</office:text></office:body>
</office:document-content>`;
}

function officeText(xml: string): Element {
  const doc = parseXml(xml);
  return doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'text').item(0) as Element;
}

function trackedRegions(ot: Element): Element[] {
  const tracked = childByName(ot, ODF_NS.TEXT, 'tracked-changes');
  if (!tracked) return [];
  return elementChildren(tracked).filter((e) => e.localName === 'changed-region' && e.namespaceURI === ODF_NS.TEXT);
}

/** Direct body `text:p` children of office:text (excludes the tracked-changes container). */
function bodyParagraphs(ot: Element): Element[] {
  return elementChildren(ot).filter((e) => e.namespaceURI === ODF_NS.TEXT && e.localName === 'p');
}

function elementChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
}

function childByName(el: Element, ns: string, local: string): Element | null {
  return elementChildren(el).find((e) => e.namespaceURI === ns && e.localName === local) ?? null;
}

/** localName of a paragraph's first element child, or null. */
function firstElLocal(p: Element): string | null {
  const first = elementChildren(p)[0];
  return first ? first.localName : null;
}

function lastElLocal(p: Element): string | null {
  const els = elementChildren(p);
  return els.length ? els[els.length - 1]!.localName! : null;
}

/** The stored `text:p` localNames inside a region's text:deletion (after change-info). */
function deletionStored(region: Element): string[] {
  const del = childByName(region, ODF_NS.TEXT, 'deletion');
  if (!del) return [];
  return elementChildren(del)
    .filter((e) => e.localName === 'p' && e.namespaceURI === ODF_NS.TEXT)
    .map((p) => p.textContent ?? '');
}

describe('compareOdf — ODF tracked-changes emission', () => {
  it('[OCMP-02] inserts a paragraph: change-start in the new para, change-end in the following', () => {
    const { contentXml: out, stats } = compareOdf(contentXml(['A', 'C']), contentXml(['A', 'B', 'C']));
    const ot = officeText(out);
    expect(stats).toEqual({ insertions: 1, deletions: 0, modifications: 0 });
    const regions = trackedRegions(ot);
    expect(regions).toHaveLength(1);
    expect(childByName(regions[0]!, ODF_NS.TEXT, 'insertion')).not.toBeNull();
    const [pa, pb, pc] = bodyParagraphs(ot);
    expect(pa!.textContent).toBe('A');
    expect(firstElLocal(pb!)).toBe('change-start'); // inserted "B"
    expect(firstElLocal(pc!)).toBe('change-end'); // following kept "C"
  });

  it('[OCMP-09] inserts at end-of-document: change-start at end of prev, change-end at end of new', () => {
    const out = compareOdf(contentXml(['A', 'B']), contentXml(['A', 'B', 'C'])).contentXml;
    const ps = bodyParagraphs(officeText(out));
    expect(lastElLocal(ps[1]!)).toBe('change-start'); // end of preceding kept "B"
    expect(lastElLocal(ps[2]!)).toBe('change-end'); // end of inserted "C"
  });

  it('[OCMP-03] deletes a middle paragraph: forward anchor + out-of-line content', () => {
    const { contentXml: out, stats } = compareOdf(contentXml(['A', 'B', 'C']), contentXml(['A', 'C']));
    const ot = officeText(out);
    expect(stats).toEqual({ insertions: 0, deletions: 1, modifications: 0 });
    const regions = trackedRegions(ot);
    expect(regions).toHaveLength(1);
    expect(deletionStored(regions[0]!)).toEqual(['B', '']); // deleted content, then empty merge artifact
    const [, pc] = bodyParagraphs(ot);
    expect(firstElLocal(pc!)).toBe('change'); // inline point marker at start of following "C"
  });

  it('[OCMP-04] deletes the last paragraph: backward anchor + empty-artifact-first', () => {
    const out = compareOdf(contentXml(['A', 'B', 'C']), contentXml(['A', 'B'])).contentXml;
    const ot = officeText(out);
    expect(deletionStored(trackedRegions(ot)[0]!)).toEqual(['', 'C']);
    const [, pb] = bodyParagraphs(ot);
    expect(lastElLocal(pb!)).toBe('change'); // marker at end of preceding "B"
  });

  it('[OCMP-07] consecutive deletions coalesce into one region with one marker', () => {
    const out = compareOdf(contentXml(['A', 'B', 'C', 'D']), contentXml(['A', 'D'])).contentXml;
    const ot = officeText(out);
    const regions = trackedRegions(ot);
    expect(regions).toHaveLength(1);
    expect(deletionStored(regions[0]!)).toEqual(['B', 'C', '']);
    const [, pd] = bodyParagraphs(ot);
    expect(firstElLocal(pd!)).toBe('change');
    // exactly one in-body change marker
    expect(out.match(/<text:change /g) ?? []).toHaveLength(1);
  });

  it('[OCMP-08] consecutive deletion run at end: one region, empty artifact first, end anchor', () => {
    const out = compareOdf(contentXml(['A', 'B', 'C', 'D']), contentXml(['A', 'B'])).contentXml;
    const ot = officeText(out);
    const regions = trackedRegions(ot);
    expect(regions).toHaveLength(1);
    expect(deletionStored(regions[0]!)).toEqual(['', 'C', 'D']);
    const [, pb] = bodyParagraphs(ot);
    expect(lastElLocal(pb!)).toBe('change');
  });

  it('[OCMP-10] modified paragraph orders deletion marker before insertion change-start', () => {
    const { contentXml: out, stats } = compareOdf(contentXml(['A', 'B', 'C']), contentXml(['A', 'X', 'C']));
    expect(stats).toEqual({ insertions: 1, deletions: 1, modifications: 0 });
    const ot = officeText(out);
    expect(trackedRegions(ot)).toHaveLength(2); // one deletion + one insertion
    const px = bodyParagraphs(ot)[1]!; // the replacement paragraph "X"
    const firstTwo = elementChildren(px)
      .slice(0, 2)
      .map((e) => e.localName);
    expect(firstTwo).toEqual(['change', 'change-start']); // deletion point BEFORE insertion start
  });

  it('[OCMP-11] replaced LAST paragraph: deletion anchors backward, outside the insertion bracket', () => {
    // Whole-paragraph replacement at end-of-document (issue #367): the insertion bracket is
    // end-anchored, so the deletion marker must move to the end of the preceding kept paragraph
    // (before the change-start) instead of the start of the inserted replacement paragraph.
    const { contentXml: out, stats } = compareOdf(contentXml(['A', 'B']), contentXml(['A', 'X']));
    expect(stats).toEqual({ insertions: 1, deletions: 1, modifications: 0 });
    const ot = officeText(out);
    const regions = trackedRegions(ot);
    expect(regions).toHaveLength(2);
    const delRegion = regions.find((r) => childByName(r, ODF_NS.TEXT, 'deletion'))!;
    expect(deletionStored(delRegion)).toEqual(['', 'B']); // backward merge: empty artifact first
    const [pa, px] = bodyParagraphs(ot);
    // End of kept "A": deletion point marker BEFORE the insertion's change-start.
    const lastTwo = elementChildren(pa!).slice(-2).map((e) => e.localName);
    expect(lastTwo).toEqual(['change', 'change-start']);
    expect(lastElLocal(px!)).toBe('change-end'); // insertion bracket itself is unchanged
    expect(firstElLocal(px!)).not.toBe('change'); // nothing anchored inside the inserted paragraph
  });

  it('[OCMP-05] change ids are unique across regions', () => {
    const out = compareOdf(contentXml(['A', 'B', 'C']), contentXml(['A', 'X', 'C'])).contentXml;
    const ids = [...out.matchAll(/xml:id="(ct\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(2);
  });

  it('[OCMP-06] deleted content does not leak into getParagraphs()', () => {
    const out = compareOdf(contentXml(['A', 'B', 'C']), contentXml(['A', 'C'])).contentXml;
    const paras = OdfDocument.fromContentXml(out).getParagraphs();
    expect(paras.map((p) => p.text)).toEqual(['A', 'C']); // "B" stays out-of-line, no phantom block
  });

  it('preserves unchanged paragraphs and reuses a single tracked-changes container', () => {
    const out = compareOdf(contentXml(['A', 'B', 'C']), contentXml(['A', 'X', 'C'])).contentXml;
    const ot = officeText(out);
    // one container, first child of office:text
    expect(firstElLocal(ot)).toBe('tracked-changes');
    expect(elementChildren(ot).filter((e) => e.localName === 'tracked-changes')).toHaveLength(1);
  });

  it('places a deletion marker inside a table cell', () => {
    const orig = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xml="http://www.w3.org/XML/1998/namespace">
  <office:body><office:text><table:table><table:table-row><table:table-cell><text:p>Cell1</text:p><text:p>Cell2</text:p></table:table-cell></table:table-row></table:table></office:text></office:body>
</office:document-content>`;
    const rev = orig.replace('<text:p>Cell1</text:p>', '');
    const out = compareOdf(orig, rev).contentXml;
    // The kept cell paragraph "Cell2" carries the inline deletion marker at its start.
    expect(out).toMatch(/<table:table-cell><text:p><text:change [^>]*\/>Cell2<\/text:p>/);
    expect(OdfDocument.fromContentXml(out).getParagraphs().map((p) => p.text)).toEqual(['Cell2']);
  });

  it('replaced LAST paragraph after a table: bracket stays inside the inserted run, deletion stores no artifact (issue #380)', () => {
    // The backward anchor would be a table-cell paragraph. A change-start there spans from the
    // cell into the body — a paragraph-break merge LibreOffice cannot perform across the table
    // boundary, so reject-all stranded an empty trailing paragraph.
    const { contentXml: out, stats } = compareOdf(
      contentXmlWithTable(['Old closing words.']),
      contentXmlWithTable(['Fresh unrelated sentence.']),
    );
    expect(stats).toEqual({ insertions: 1, deletions: 1, modifications: 0 });
    const ot = officeText(out);
    const regions = trackedRegions(ot);
    expect(regions).toHaveLength(2);
    const delRegion = regions.find((r) => childByName(r, ODF_NS.TEXT, 'deletion'))!;
    // No merge-artifact paragraph: the residual empty paragraph left by rejecting the
    // content-only insertion bracket is the merge slot the artifact normally provides.
    expect(deletionStored(delRegion)).toEqual(['Old closing words.']);
    // The table-cell paragraph carries no markers.
    expect(out).toContain('<table:table-cell><text:p>Cell</text:p></table:table-cell>');
    // Replacement paragraph: deletion point first (outside the span), then the bracket.
    const ps = bodyParagraphs(ot);
    const lastP = ps[ps.length - 1]!;
    expect(
      elementChildren(lastP)
        .slice(0, 2)
        .map((e) => e.localName),
    ).toEqual(['change', 'change-start']);
    expect(lastElLocal(lastP)).toBe('change-end');
  });

  it('coalesced multi-paragraph replacement after a table also stores no artifact (issue #380)', () => {
    const out = compareOdf(
      contentXmlWithTable(['Old clause one entirely.', 'Old clause two entirely.']),
      contentXmlWithTable(['Fresh unrelated sentence.']),
    ).contentXml;
    const regions = trackedRegions(officeText(out));
    const delRegion = regions.find((r) => childByName(r, ODF_NS.TEXT, 'deletion'))!;
    // Both deleted paragraphs, no artifact: rejecting the insertion leaves ONE residual empty
    // paragraph, and re-inserting two stored paragraphs contributes the one missing break.
    expect(deletionStored(delRegion)).toEqual(['Old clause one entirely.', 'Old clause two entirely.']);
  });

  it('end-of-document insertion after a trailing table brackets only the inserted run (issue #380)', () => {
    const out = compareOdf(contentXmlWithTable([]), contentXmlWithTable(['Appended after the table.'])).contentXml;
    const ot = officeText(out);
    const ps = bodyParagraphs(ot);
    const lastP = ps[ps.length - 1]!;
    expect(firstElLocal(lastP)).toBe('change-start');
    expect(lastElLocal(lastP)).toBe('change-end');
    expect(out).toContain('<table:table-cell><text:p>Cell</text:p></table:table-cell>');
  });

  it('fails closed when every paragraph is deleted (no anchor)', () => {
    expect(() => compareOdf(contentXml(['A', 'B']), contentXml([]))).toThrow(OdfEmitError);
  });

  it('inserts into a previously-empty document by bracketing the whole run', () => {
    const out = compareOdf(contentXml([]), contentXml(['A', 'B'])).contentXml;
    const ps = bodyParagraphs(officeText(out));
    expect(firstElLocal(ps[0]!)).toBe('change-start'); // start of first inserted
    expect(lastElLocal(ps[1]!)).toBe('change-end'); // end of last inserted
  });
});
