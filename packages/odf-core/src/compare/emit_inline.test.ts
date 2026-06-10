import { describe, it, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';

import { compareOdf } from './index.js';
import { OdfDocument } from '../document.js';
import { ODF_NS } from '../shared/odf/namespaces.js';
import { buildSegments } from '../shared/odf/text_segments.js';

/** Wrap raw block XML (text:p / text:h) in a minimal, namespace-complete content.xml. */
function contentXmlRaw(blocks: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:xml="http://www.w3.org/XML/1998/namespace">
  <office:body><office:text>${blocks.join('')}</office:text></office:body>
</office:document-content>`;
}

function contentXml(paras: string[]): string {
  return contentXmlRaw(paras.map((t) => `<text:p text:style-name="Standard">${t}</text:p>`));
}

function officeText(xml: string): Element {
  const doc = parseXml(xml);
  return doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'text').item(0) as Element;
}

function elementChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
}

function childByName(el: Element, ns: string, local: string): Element | null {
  return elementChildren(el).find((e) => e.namespaceURI === ns && e.localName === local) ?? null;
}

function trackedRegions(ot: Element): Element[] {
  const tracked = childByName(ot, ODF_NS.TEXT, 'tracked-changes');
  if (!tracked) return [];
  return elementChildren(tracked).filter((e) => e.localName === 'changed-region' && e.namespaceURI === ODF_NS.TEXT);
}

/** Direct body blocks (text:p/text:h) of office:text (excludes the tracked-changes container). */
function bodyBlocks(ot: Element): Element[] {
  return elementChildren(ot).filter(
    (e) => e.namespaceURI === ODF_NS.TEXT && (e.localName === 'p' || e.localName === 'h'),
  );
}

/** The region's change kind ('insertion' | 'deletion') and its stored blocks. */
function regionInfo(region: Element): { kind: string; stored: Element[] } {
  const child = elementChildren(region)[0]!;
  return {
    kind: child.localName!,
    stored: elementChildren(child).filter((e) => e.localName === 'p' || e.localName === 'h'),
  };
}

function regionById(ot: Element, id: string): Element {
  const r = trackedRegions(ot).find((x) => x.getAttributeNS(ODF_NS.TEXT, 'id') === id);
  expect(r, `changed-region ${id}`).toBeDefined();
  return r!;
}

/** Flat document-order event stream of a block: text chunks and change markers. */
type FlowEvent = { kind: 'text'; text: string } | { kind: 'marker'; type: string; id: string };
function flatten(block: Element): FlowEvent[] {
  const events: FlowEvent[] = [];
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        events.push({ kind: 'text', text: (child as unknown as { data: string }).data });
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== ODF_NS.TEXT) {
        walk(el);
        continue;
      }
      if (el.localName === 'change' || el.localName === 'change-start' || el.localName === 'change-end') {
        events.push({
          kind: 'marker',
          type: el.localName,
          id: el.getAttributeNS(ODF_NS.TEXT, 'change-id') ?? el.getAttribute('text:change-id') ?? '',
        });
        continue;
      }
      if (el.localName === 's') {
        const c = el.getAttributeNS(ODF_NS.TEXT, 'c') ?? el.getAttribute('text:c');
        events.push({ kind: 'text', text: ' '.repeat(Math.max(1, Number.parseInt(c ?? '1', 10) || 1)) });
        continue;
      }
      if (el.localName === 'tab') {
        events.push({ kind: 'text', text: '\t' });
        continue;
      }
      if (el.localName === 'line-break') {
        events.push({ kind: 'text', text: '\n' });
        continue;
      }
      walk(el);
    }
  };
  walk(block);
  return events;
}

/**
 * Reject-projection of a modified paragraph: drop bracketed insertions, splice each deletion
 * marker's stored content back in. Accept-projection is simply the visible text. Together these
 * are the structural round-trip invariant.
 */
function rejectText(block: Element, ot: Element): string {
  const events = flatten(block);
  let out = '';
  let skipDepth = 0;
  for (const ev of events) {
    if (ev.kind === 'marker') {
      if (ev.type === 'change-start') skipDepth++;
      else if (ev.type === 'change-end') skipDepth--;
      else if (skipDepth === 0) {
        const { stored } = regionInfo(regionById(ot, ev.id));
        out += stored.map((b) => buildSegments(b).visible).join('');
      }
      continue;
    }
    if (skipDepth === 0) out += ev.text;
  }
  return out;
}

const OPTS = { author: 'Tester', date: new Date('2026-06-10T12:00:00Z') };

describe('compareOdf — intra-paragraph modify pairs', () => {
  it('[OCMPI-03] an inserted word is bracketed inline in the kept paragraph', () => {
    const original = contentXml(['Alpha bravo charlie delta.', 'Stable.']);
    const revised = contentXml(['Alpha bravo inserted charlie delta.', 'Stable.']);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    expect(stats).toEqual({ insertions: 1, deletions: 0, modifications: 1 });
    const regions = trackedRegions(ot);
    expect(regions).toHaveLength(1);
    expect(regionInfo(regions[0]!).kind).toBe('insertion');

    const para = bodyBlocks(ot)[0]!;
    const events = flatten(para);
    expect(events).toEqual([
      { kind: 'text', text: 'Alpha bravo ' },
      { kind: 'marker', type: 'change-start', id: expect.any(String) },
      { kind: 'text', text: 'inserted ' },
      { kind: 'marker', type: 'change-end', id: expect.any(String) },
      { kind: 'text', text: 'charlie delta.' },
    ]);
  });

  it('[OCMPI-04] a deleted word leaves a point marker; storage is one styled block, no artifact', () => {
    const original = contentXml(['Alpha bravo charlie delta.', 'Stable.']);
    const revised = contentXml(['Alpha charlie delta.', 'Stable.']);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    expect(stats).toEqual({ insertions: 0, deletions: 1, modifications: 1 });
    const regions = trackedRegions(ot);
    expect(regions).toHaveLength(1);
    const info = regionInfo(regions[0]!);
    expect(info.kind).toBe('deletion');
    // Exactly one stored block (no merge artifact) carrying the deleted span and the host style.
    expect(info.stored).toHaveLength(1);
    expect(buildSegments(info.stored[0]!).visible).toBe('bravo ');
    expect(info.stored[0]!.getAttributeNS(ODF_NS.TEXT, 'style-name')).toBe('Standard');

    const para = bodyBlocks(ot)[0]!;
    expect(flatten(para)).toEqual([
      { kind: 'text', text: 'Alpha ' },
      { kind: 'marker', type: 'change', id: expect.any(String) },
      { kind: 'text', text: 'charlie delta.' },
    ]);
  });

  it('[OCMPI-05] a replaced word orders the insertion bracket before the deletion marker (O3 shape)', () => {
    const original = contentXml(['Alpha bravo charlie delta.']);
    const revised = contentXml(['Alpha bravo charlie echo.']);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    expect(stats).toEqual({ insertions: 1, deletions: 1, modifications: 1 });
    const para = bodyBlocks(ot)[0]!;
    const events = flatten(para);
    expect(events).toEqual([
      { kind: 'text', text: 'Alpha bravo charlie ' },
      { kind: 'marker', type: 'change-start', id: expect.any(String) },
      { kind: 'text', text: 'echo.' },
      { kind: 'marker', type: 'change-end', id: expect.any(String) },
      { kind: 'marker', type: 'change', id: expect.any(String) },
    ]);
  });

  it('[OCMPI-06] deleted spans do not leak into the paragraph stream', () => {
    const original = contentXml(['Alpha bravo charlie delta.', 'Stable.']);
    const revised = contentXml(['Alpha charlie delta.', 'Stable.']);
    const { contentXml: out } = compareOdf(original, revised, OPTS);
    const paras = OdfDocument.fromContentXml(out).getParagraphs();
    expect(paras.map((p) => p.text)).toEqual(['Alpha charlie delta.', 'Stable.']);
  });

  it('[OCMPI-07] a whole-paragraph deletion marker precedes intra markers at a shared start', () => {
    const original = contentXml(['Doomed paragraph.', 'Alpha bravo charlie delta.']);
    const revised = contentXml(['bravo charlie delta.']);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    // One whole-paragraph deletion + one inline deletion ("Alpha ") on the modify pair.
    expect(stats).toEqual({ insertions: 0, deletions: 2, modifications: 1 });
    const para = bodyBlocks(ot)[0]!;
    const events = flatten(para);
    expect(events[0]!.kind).toBe('marker');
    expect(events[1]!.kind).toBe('marker');
    const first = regionInfo(regionById(ot, (events[0] as { id: string }).id));
    const second = regionInfo(regionById(ot, (events[1] as { id: string }).id));
    // First marker: the whole-paragraph deletion (stores the doomed paragraph + artifact).
    expect(first.kind).toBe('deletion');
    expect(first.stored.length).toBe(2);
    expect(buildSegments(first.stored[0]!).visible).toBe('Doomed paragraph.');
    // Second marker: the inline deletion (single stored block, no artifact).
    expect(second.kind).toBe('deletion');
    expect(second.stored.length).toBe(1);
    expect(buildSegments(second.stored[0]!).visible).toBe('Alpha ');
  });

  it('[OCMPI-09] stats count changed-regions (2 inline deletes + 1 inline insert + 1 paragraph insert)', () => {
    const original = contentXml(['aa bb cc dd ee']);
    const revised = contentXml(['aa cc ff ee', 'Brand new unrelated paragraph wording.']);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    expect(stats).toEqual({ insertions: 2, deletions: 2, modifications: 1 });
    // One region per counted unit: 2 deletions + 1 insertion inline, 1 whole-paragraph insertion.
    const kinds = trackedRegions(ot).map((r) => regionInfo(r).kind).sort();
    expect(kinds).toEqual(['deletion', 'deletion', 'insertion', 'insertion']);
  });

  it('[OCMPI-10] whitespace-run edits map onto text:s (O6 shape)', () => {
    const original = contentXmlRaw(['<text:p>Word<text:s text:c="5"/>tail</text:p>']);
    const revised = contentXmlRaw(['<text:p>Word<text:s text:c="3"/>tail</text:p>']);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    expect(stats.modifications).toBe(1);
    const para = bodyBlocks(ot)[0]!;
    expect(buildSegments(para).visible).toBe('Word   tail');
    // The deleted five-space run is stored as a text:s carrying its count.
    const deletion = trackedRegions(ot)
      .map((r) => regionInfo(r))
      .find((i) => i.kind === 'deletion')!;
    expect(buildSegments(deletion.stored[0]!).visible).toBe('     ');
  });

  it('[OCMPI-11] formatting structure is preserved in stored deletion content (O9 shape)', () => {
    const original = contentXmlRaw([
      '<text:p text:style-name="Standard">Lead <text:span text:style-name="T1">boldword</text:span> tail stays here.</text:p>',
    ]);
    const revised = contentXml(['Lead tail stays here.']);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    expect(stats).toEqual({ insertions: 0, deletions: 1, modifications: 1 });
    const deletion = trackedRegions(ot).map((r) => regionInfo(r))[0]!;
    const storedSpan = childByName(deletion.stored[0]!, ODF_NS.TEXT, 'span');
    expect(storedSpan).not.toBeNull();
    expect(storedSpan!.getAttributeNS(ODF_NS.TEXT, 'style-name')).toBe('T1');
    expect(buildSegments(deletion.stored[0]!).visible).toBe('boldword ');
  });

  it('[OCMPI-12] heading modify pairs store a mirrored text:h (O10 shape)', () => {
    const original = contentXmlRaw([
      '<text:h text:style-name="Heading_20_1" text:outline-level="1">Heading text here</text:h>',
    ]);
    const revised = contentXmlRaw([
      '<text:h text:style-name="Heading_20_1" text:outline-level="1">Heading here</text:h>',
    ]);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    expect(stats).toEqual({ insertions: 0, deletions: 1, modifications: 1 });
    const deletion = trackedRegions(ot).map((r) => regionInfo(r))[0]!;
    expect(deletion.kind).toBe('deletion');
    const stored = deletion.stored[0]!;
    expect(stored.localName).toBe('h');
    expect(stored.getAttributeNS(ODF_NS.TEXT, 'style-name')).toBe('Heading_20_1');
    expect(stored.getAttributeNS(ODF_NS.TEXT, 'outline-level')).toBe('1');
    expect(buildSegments(stored).visible).toBe('text ');
    // The kept heading carries the marker inline.
    const heading = bodyBlocks(ot)[0]!;
    expect(heading.localName).toBe('h');
    expect(flatten(heading).some((e) => e.kind === 'marker' && e.type === 'change')).toBe(true);
  });

  it('change ids are unique across whole-paragraph and inline regions, and every marker resolves', () => {
    const original = contentXml(['Doomed.', 'aa bb cc dd ee', 'Stable.']);
    const revised = contentXml(['aa bb ff dd ee', 'Stable.', 'Appended paragraph at the end.']);
    const { contentXml: out } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    const ids = trackedRegions(ot).map((r) => r.getAttributeNS(ODF_NS.TEXT, 'id'));
    expect(new Set(ids).size).toBe(ids.length);
    for (const block of bodyBlocks(ot)) {
      for (const ev of flatten(block)) {
        if (ev.kind === 'marker') expect(ids).toContain(ev.id);
      }
    }
  });

  it('structural round-trip: accept-projection is the revised text, reject-projection the original', () => {
    const original = contentXmlRaw([
      '<text:p text:style-name="Standard">The quick brown fox jumps over the lazy dog.</text:p>',
      '<text:p text:style-name="Standard">Second paragraph with <text:span text:style-name="T1">formatting</text:span> inside.</text:p>',
      '<text:p text:style-name="Standard">Word<text:s text:c="5"/>tail</text:p>',
    ]);
    const revised = contentXmlRaw([
      '<text:p text:style-name="Standard">The quick red fox leaps over the lazy dog.</text:p>',
      '<text:p text:style-name="Standard">Second paragraph with <text:span text:style-name="T1">formatting</text:span> kept inside.</text:p>',
      '<text:p text:style-name="Standard">Word<text:s text:c="2"/>tail extended</text:p>',
    ]);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    expect(stats.modifications).toBe(3);
    const originalTexts = ['The quick brown fox jumps over the lazy dog.', 'Second paragraph with formatting inside.', 'Word     tail'];
    const revisedTexts = ['The quick red fox leaps over the lazy dog.', 'Second paragraph with formatting kept inside.', 'Word  tail extended'];
    const blocks = bodyBlocks(ot);
    expect(blocks.map((b) => buildSegments(b).visible)).toEqual(revisedTexts);
    expect(blocks.map((b) => rejectText(b, ot))).toEqual(originalTexts);
  });

  it('below-threshold replacements keep the Slice-1 whole-paragraph shape', () => {
    const original = contentXml(['Entirely different sentence about apples.']);
    const revised = contentXml(['Nothing shared here whatsoever, zebras graze.']);
    const { contentXml: out, stats } = compareOdf(original, revised, OPTS);
    const ot = officeText(out);

    expect(stats).toEqual({ insertions: 1, deletions: 1, modifications: 0 });
    // Whole-paragraph deletion region stores the deleted paragraph plus the merge artifact.
    const deletion = trackedRegions(ot).map((r) => regionInfo(r)).find((i) => i.kind === 'deletion')!;
    expect(deletion.stored.length).toBe(2);
  });
});
