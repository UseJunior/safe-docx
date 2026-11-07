import { describe, it, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { appendInlineContent, FontFaceRegistry, TextStyleRegistry } from './inline.js';
import { LossinessCollector } from './types.js';
import { ODF_NS } from '../shared/odf/namespaces.js';

function setupEnvironment() {
  const doc = parseXml(
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<office:document-content xmlns:office="${ODF_NS.OFFICE}" xmlns:text="${ODF_NS.TEXT}" xmlns:style="${ODF_NS.STYLE}" xmlns:fo="${ODF_NS.FO}" xmlns:xlink="${ODF_NS.XLINK}">` +
    `<office:automatic-styles/>` +
    `<office:body><office:text><text:p/></office:text></office:body>` +
    `</office:document-content>`,
  );

  const autoStyles = doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'automatic-styles')[0] as Element;
  const p = doc.getElementsByTagNameNS(ODF_NS.TEXT, 'p')[0] as Element;
  const fontFaces = new FontFaceRegistry(doc, autoStyles);
  const styles = new TextStyleRegistry(doc, autoStyles, fontFaces);
  const lossiness = new LossinessCollector();

  return { doc, p, autoStyles, styles, lossiness };
}

function getStylePropsMap(doc: Document): Map<string, Element> {
  const map = new Map<string, Element>();
  for (const style of Array.from(doc.getElementsByTagNameNS(ODF_NS.STYLE, 'style'))) {
    const name = style.getAttributeNS(ODF_NS.STYLE, 'name');
    const props = style.getElementsByTagNameNS(ODF_NS.STYLE, 'text-properties')[0];
    if (name && props) map.set(name, props as Element);
  }
  return map;
}

describe('odf-core — inline formatting frames and nested tags', () => {
  it('restores outer bold when closing an inner repeated bold tag', () => {
    const { doc, p, styles, lossiness } = setupEnvironment();
    appendInlineContent(doc, p, '<b>outer <b>inner</b> outer-again</b>', styles, lossiness);

    const spans = Array.from(p.getElementsByTagNameNS(ODF_NS.TEXT, 'span'));
    const styleMap = getStylePropsMap(doc);

    // Three spans: outer, inner, outer-again — all must be bold
    expect(spans).toHaveLength(3);
    for (const span of spans) {
      const styleName = span.getAttributeNS(ODF_NS.TEXT, 'style-name')!;
      const props = styleMap.get(styleName)!;
      expect(props.getAttributeNS(ODF_NS.FO, 'font-weight')).toBe('bold');
    }
  });

  it('restores outer italic when closing an inner repeated italic tag', () => {
    const { doc, p, styles, lossiness } = setupEnvironment();
    appendInlineContent(doc, p, '<i>out <i>in</i> back</i>', styles, lossiness);

    const spans = Array.from(p.getElementsByTagNameNS(ODF_NS.TEXT, 'span'));
    const styleMap = getStylePropsMap(doc);

    expect(spans).toHaveLength(3);
    for (const span of spans) {
      const styleName = span.getAttributeNS(ODF_NS.TEXT, 'style-name')!;
      const props = styleMap.get(styleName)!;
      expect(props.getAttributeNS(ODF_NS.FO, 'font-style')).toBe('italic');
    }
  });

  it('restores outer underline when closing an inner repeated underline tag', () => {
    const { doc, p, styles, lossiness } = setupEnvironment();
    appendInlineContent(doc, p, '<u>u-out <u>u-in</u> u-back</u>', styles, lossiness);

    const spans = Array.from(p.getElementsByTagNameNS(ODF_NS.TEXT, 'span'));
    const styleMap = getStylePropsMap(doc);

    expect(spans).toHaveLength(3);
    for (const span of spans) {
      const styleName = span.getAttributeNS(ODF_NS.TEXT, 'style-name')!;
      const props = styleMap.get(styleName)!;
      expect(props.getAttributeNS(ODF_NS.STYLE, 'text-underline-style')).toBe('solid');
    }
  });

  it('restores outer highlight color when closing inner nested highlight', () => {
    const { doc, p, styles, lossiness } = setupEnvironment();
    appendInlineContent(
      doc,
      p,
      '<highlight color="yellow">yellow <highlight color="green">green</highlight> yellow-again</highlight>',
      styles,
      lossiness,
    );

    const spans = Array.from(p.getElementsByTagNameNS(ODF_NS.TEXT, 'span'));
    expect(spans).toHaveLength(3);
    const styleMap = getStylePropsMap(doc);

    const s0 = styleMap.get(spans[0]!.getAttributeNS(ODF_NS.TEXT, 'style-name')!)!;
    const s1 = styleMap.get(spans[1]!.getAttributeNS(ODF_NS.TEXT, 'style-name')!)!;
    const s2 = styleMap.get(spans[2]!.getAttributeNS(ODF_NS.TEXT, 'style-name')!)!;

    expect(s0.getAttributeNS(ODF_NS.FO, 'background-color')).toBe('#ffff00');
    expect(s1.getAttributeNS(ODF_NS.FO, 'background-color')).toBe('#00ff00');
    expect(s2.getAttributeNS(ODF_NS.FO, 'background-color')).toBe('#ffff00'); // restored outer yellow
  });

  it('restores outer font color, size, and face across nested font tags with inheritance', () => {
    const { doc, p, styles, lossiness } = setupEnvironment();
    appendInlineContent(
      doc,
      p,
      '<font color="FF0000" size="14" face="Arial">outer ' +
        '<font color="0000FF" size="18">inner</font> ' +
        'outer-again</font>',
      styles,
      lossiness,
    );

    const spans = Array.from(p.getElementsByTagNameNS(ODF_NS.TEXT, 'span'));
    expect(spans).toHaveLength(3);
    const styleMap = getStylePropsMap(doc);

    const s0 = styleMap.get(spans[0]!.getAttributeNS(ODF_NS.TEXT, 'style-name')!)!;
    const s1 = styleMap.get(spans[1]!.getAttributeNS(ODF_NS.TEXT, 'style-name')!)!;
    const s2 = styleMap.get(spans[2]!.getAttributeNS(ODF_NS.TEXT, 'style-name')!)!;

    // Outer 1: #ff0000, 14pt, Arial
    expect(s0.getAttributeNS(ODF_NS.FO, 'color')).toBe('#ff0000');
    expect(s0.getAttributeNS(ODF_NS.FO, 'font-size')).toBe('14pt');
    expect(s0.getAttributeNS(ODF_NS.STYLE, 'font-name')).toBe('Arial');

    // Inner: #0000ff, 18pt, inherited Arial
    expect(s1.getAttributeNS(ODF_NS.FO, 'color')).toBe('#0000ff');
    expect(s1.getAttributeNS(ODF_NS.FO, 'font-size')).toBe('18pt');
    expect(s1.getAttributeNS(ODF_NS.STYLE, 'font-name')).toBe('Arial');

    // Outer 2 (restored): #ff0000, 14pt, Arial
    expect(s2.getAttributeNS(ODF_NS.FO, 'color')).toBe('#ff0000');
    expect(s2.getAttributeNS(ODF_NS.FO, 'font-size')).toBe('14pt');
    expect(s2.getAttributeNS(ODF_NS.STYLE, 'font-name')).toBe('Arial');
  });

  it('degrades nested hyperlinks safely with lossiness reporting and maintains outer anchor', () => {
    const { doc, p, styles, lossiness } = setupEnvironment();
    appendInlineContent(
      doc,
      p,
      '<a href="https://example.com/outer">outer text ' +
        '<a href="https://example.com/inner">nested text</a>' +
        ' still outer</a> after link',
      styles,
      lossiness,
    );

    // Exactly one text:a element should be in paragraph — no nested text:a
    const anchors = Array.from(p.getElementsByTagNameNS(ODF_NS.TEXT, 'a'));
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0]!;
    expect(anchor.getAttributeNS(ODF_NS.XLINK, 'href')).toBe('https://example.com/outer');

    // All text within the outer link boundary is inside the single anchor
    expect(anchor.textContent).toBe('outer text nested text still outer');

    // Lossiness was reported for the nested hyperlink
    const entries = lossiness.toArray();
    const nestedEntry = entries.find((e) => e.construct === 'nested-hyperlink');
    expect(nestedEntry).toBeDefined();
    expect(nestedEntry?.detail).toBe('https://example.com/inner');
  });

  it('preserves URL sanitization for nested unsafe hyperlinks and keeps outer anchor', () => {
    const { doc, p, styles, lossiness } = setupEnvironment();
    appendInlineContent(
      doc,
      p,
      '<a href="https://example.com/safe">safe ' +
        '<a href="javascript:alert(1)">unsafe</a>' +
        ' safe again</a>',
      styles,
      lossiness,
    );

    const anchors = Array.from(p.getElementsByTagNameNS(ODF_NS.TEXT, 'a'));
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.getAttributeNS(ODF_NS.XLINK, 'href')).toBe('https://example.com/safe');
    expect(anchors[0]!.textContent).toBe('safe unsafe safe again');

    const entries = lossiness.toArray();
    const unsafeEntry = entries.find((e) => e.construct === 'unsafe-hyperlink-href');
    expect(unsafeEntry).toBeDefined();
    expect(unsafeEntry?.detail).toBe('javascript:alert(1)');
  });
});
