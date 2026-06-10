import { describe, it, expect, vi } from 'vitest';
import { parseXml } from '@usejunior/docx-core';

import { ODF_NS } from '../shared/odf/namespaces.js';
import { buildSegments } from '../shared/odf/text_segments.js';

// The degrade valve guards mapping failures that valid `compareOdf` inputs cannot produce today
// (diffInline offsets are always consistent with the segments they were computed from), so the
// valve is exercised by forcing `extractVisibleRange` to fail — the real failure channel.
vi.mock('./inline_map.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./inline_map.js')>();
  return {
    ...actual,
    extractVisibleRange: vi.fn(() => {
      throw new actual.OdfMapError('forced mapping failure (test)');
    }),
  };
});

const { compareOdf } = await import('./index.js');

function contentXml(paras: string[]): string {
  const body = paras.map((t) => `<text:p text:style-name="Standard">${t}</text:p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:xml="http://www.w3.org/XML/1998/namespace">
  <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`;
}

describe('compareOdf — degrade valve', () => {
  it('[OCMPI-08] an unmappable modify pair degrades to the Slice-1 whole-paragraph shape', () => {
    const original = contentXml(['Alpha bravo charlie delta.', 'Stable.']);
    const revised = contentXml(['Alpha charlie delta.', 'Stable.']);
    const { contentXml: out, stats } = compareOdf(original, revised, {
      author: 'Tester',
      date: new Date('2026-06-10T12:00:00Z'),
    });

    // Degraded: one whole-paragraph deletion + one whole-paragraph insertion, no modification.
    expect(stats).toEqual({ insertions: 1, deletions: 1, modifications: 0 });

    const doc = parseXml(out);
    const ot = doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'text').item(0) as Element;
    const tracked = Array.from({ length: ot.childNodes.length }, (_, i) => ot.childNodes.item(i))
      .filter((n): n is Element => n!.nodeType === 1)
      .map((n) => n as Element)
      .find((e) => e.localName === 'tracked-changes');
    expect(tracked).toBeDefined();
    const regions = Array.from({ length: tracked!.childNodes.length }, (_, i) => tracked!.childNodes.item(i)).filter(
      (n): n is Element => n!.nodeType === 1,
    );
    expect(regions).toHaveLength(2);
    const kinds = regions.map((r) => (r.firstChild as Element).localName).sort();
    expect(kinds).toEqual(['deletion', 'insertion']);

    // The deletion region stores the full original paragraph plus the merge artifact — no
    // partial inline markup survives a degraded pair.
    const deletion = regions.map((r) => r.firstChild as Element).find((e) => e.localName === 'deletion')!;
    const stored = [];
    for (let c = deletion.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && (c as Element).localName === 'p') stored.push(c as Element);
    }
    expect(stored).toHaveLength(2);
    expect(buildSegments(stored[0]!).visible).toBe('Alpha bravo charlie delta.');

    // Slice-1 replacement shape: the deletion marker precedes the insertion's change-start at
    // the replacement paragraph's start, and the bracket wraps the WHOLE paragraph (the
    // change-end sits at the following paragraph's start) — no mid-paragraph markers.
    const paras = Array.from({ length: ot.childNodes.length }, (_, i) => ot.childNodes.item(i))
      .filter((n): n is Element => n!.nodeType === 1)
      .map((n) => n as Element)
      .filter((e) => e.localName === 'p');
    const first = paras[0]!;
    expect((first.childNodes.item(0) as Element).localName).toBe('change');
    expect((first.childNodes.item(1) as Element).localName).toBe('change-start');
    expect((paras[1]!.childNodes.item(0) as Element).localName).toBe('change-end');
  });
});
