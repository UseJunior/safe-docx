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
