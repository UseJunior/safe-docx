import { describe, it, expect } from 'vitest';
import { parseXml, serializeXml } from '@usejunior/docx-core';

import { OdfMapError, resolveOffset, extractVisibleRange } from './inline_map.js';
import { buildSegments } from '../shared/odf/text_segments.js';
import { ODF_NS } from '../shared/odf/namespaces.js';

/** Wrap paragraph-content XML in a minimal namespace-complete document and return the block. */
function blockOf(paraInnerXml: string): { doc: Document; block: Element } {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:text><text:p>${paraInnerXml}</text:p></office:text></office:body>
</office:document-content>`;
  const doc = parseXml(xml);
  const block = doc.getElementsByTagNameNS(ODF_NS.TEXT, 'p').item(0) as Element;
  return { doc, block };
}

/** Serialize just the paragraph element for shape assertions. */
function paraXml(block: Element): string {
  return serializeXml(block.ownerDocument as Document)
    .replace(/^[\s\S]*?(<text:p[\s\S]*?<\/text:p>|<text:p[^>]*\/>)[\s\S]*$/, '$1');
}

/** Insert a text:change marker at a DomPoint (mirrors what the emitter does). */
function insertMarker(block: Element, vis: number): void {
  const point = resolveOffset(block, vis);
  const doc = block.ownerDocument as Document;
  const marker = doc.createElementNS(ODF_NS.TEXT, 'text:change');
  marker.setAttributeNS(ODF_NS.TEXT, 'text:change-id', 'ct1');
  point.parent.insertBefore(marker, point.before);
}

describe('resolveOffset', () => {
  it('[OCMPI-10] splits a #text node mid-word and serializes the marker between the halves', () => {
    const { block } = blockOf('HelloWorld');
    insertMarker(block, 5);
    expect(paraXml(block)).toBe('<text:p>Hello<text:change text:change-id="ct1"/>World</text:p>');
  });

  it('[OCMPI-10] offsets 0 and length resolve to block-level prepend/append', () => {
    const { block } = blockOf('Alpha');
    insertMarker(block, 0);
    expect(paraXml(block)).toBe('<text:p><text:change text:change-id="ct1"/>Alpha</text:p>');

    const { block: block2 } = blockOf('Alpha');
    insertMarker(block2, 5);
    expect(paraXml(block2)).toBe('<text:p>Alpha<text:change text:change-id="ct1"/></text:p>');
  });

  it('[OCMPI-10] an offset inside a text:span splits at the natural depth (inside the span)', () => {
    const { block } = blockOf('Lead <text:span text:style-name="T1">boldword</text:span> tail.');
    insertMarker(block, 9); // "Lead bold|word"
    expect(paraXml(block)).toBe(
      '<text:p>Lead <text:span text:style-name="T1">bold<text:change text:change-id="ct1"/>word</text:span> tail.</text:p>',
    );
  });

  it('[OCMPI-10] a boundary between segments inserts before the following node without splitting', () => {
    const { block } = blockOf('Lead <text:span text:style-name="T1">bold</text:span> tail.');
    insertMarker(block, 5); // boundary before the span's inner text
    expect(paraXml(block)).toBe(
      '<text:p>Lead <text:span text:style-name="T1"><text:change text:change-id="ct1"/>bold</text:span> tail.</text:p>',
    );
  });

  it('[OCMPI-10] splits a text:s run rebalancing text:c (and omits text:c at count 1)', () => {
    const { block } = blockOf('Word<text:s text:c="5"/>tail');
    insertMarker(block, 6); // 2 spaces kept left, 3 right
    expect(paraXml(block)).toBe(
      '<text:p>Word<text:s text:c="2"/><text:change text:change-id="ct1"/><text:s text:c="3"/>tail</text:p>',
    );

    const { block: block2 } = blockOf('Word<text:s text:c="2"/>tail');
    insertMarker(block2, 5); // 1 and 1: both sides omit text:c
    expect(paraXml(block2)).toBe(
      '<text:p>Word<text:s/><text:change text:change-id="ct1"/><text:s/>tail</text:p>',
    );
    expect(buildSegments(block2).visible).toBe('Word  tail');
  });

  it('[OCMPI-10] out-of-range offsets throw OdfMapError', () => {
    const { block } = blockOf('abc');
    expect(() => resolveOffset(block, -1)).toThrow(OdfMapError);
    expect(() => resolveOffset(block, 4)).toThrow(OdfMapError);
  });

  it('splitting preserves the visible text exactly', () => {
    const { block } = blockOf('Word<text:s text:c="5"/>middle<text:tab/>end');
    const before = buildSegments(block).visible;
    insertMarker(block, 7);
    insertMarker(block, 11);
    expect(buildSegments(block).visible).toBe(before);
  });
});

describe('extractVisibleRange', () => {
  const targetDoc = (): Document => blockOf('').doc;

  /** Append extracted nodes to an empty text:p in a fresh target doc and serialize it. */
  function extractedXml(srcInner: string, start: number, end: number): string {
    const { block } = blockOf(srcInner);
    const { doc: tdoc, block: holder } = blockOf('');
    const nodes = extractVisibleRange(block, start, end, tdoc);
    for (const n of nodes) holder.appendChild(n);
    return paraXml(holder);
  }

  it('[OCMPI-11] a mid-text range extracts trimmed plain text', () => {
    expect(extractedXml('Alpha bravo charlie delta.', 6, 12)).toBe('<text:p>bravo </text:p>');
  });

  it('[OCMPI-11] a range crossing a span boundary preserves the span structure (O5 shape)', () => {
    expect(extractedXml('Lead <text:span text:style-name="T1">boldword</text:span> tail.', 3, 9)).toBe(
      '<text:p>d <text:span text:style-name="T1">bold</text:span></text:p>',
    );
  });

  it('[OCMPI-11] a whole formatted word extracts the full span (O9 shape)', () => {
    expect(extractedXml('Lead <text:span text:style-name="T1">boldword</text:span> tail.', 5, 13)).toBe(
      '<text:p><text:span text:style-name="T1">boldword</text:span></text:p>',
    );
  });

  it('[OCMPI-10] a partially covered text:s is rebalanced to the covered count (O6 shape)', () => {
    expect(extractedXml('Word<text:s text:c="5"/>tail', 5, 7)).toBe('<text:p><text:s text:c="2"/></text:p>');
    expect(extractedXml('Word<text:s text:c="5"/>tail', 4, 5)).toBe('<text:p><text:s/></text:p>');
  });

  it('[OCMPI-10] tab and line-break are copied whole (O7 shape)', () => {
    expect(extractedXml('Left<text:tab/>Right', 3, 6)).toBe('<text:p>t<text:tab/>R</text:p>');
    expect(extractedXml('Up<text:line-break/>Down', 1, 4)).toBe('<text:p>p<text:line-break/>D</text:p>');
  });

  it('extraction is pure with respect to the source block', () => {
    const { block } = blockOf('Lead <text:span text:style-name="T1">boldword</text:span> tail.');
    const before = paraXml(block);
    extractVisibleRange(block, 3, 9, targetDoc());
    expect(paraXml(block)).toBe(before);
  });

  it('empty or out-of-range spans throw OdfMapError', () => {
    const { block } = blockOf('abc');
    const tdoc = targetDoc();
    expect(() => extractVisibleRange(block, 1, 1, tdoc)).toThrow(OdfMapError);
    expect(() => extractVisibleRange(block, 2, 5, tdoc)).toThrow(OdfMapError);
    expect(() => extractVisibleRange(block, -1, 2, tdoc)).toThrow(OdfMapError);
  });
});
