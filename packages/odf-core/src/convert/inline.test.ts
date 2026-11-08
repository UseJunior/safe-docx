import { describe, expect, it } from 'vitest';

import { ODF_NS } from '../shared/odf/namespaces.js';
import { appendInlineContent, FontFaceRegistry, TextStyleRegistry } from './inline.js';
import { createContentScaffold } from './package.js';
import { LossinessCollector } from './types.js';

function environment() {
  const { doc, body, automaticStyles, fontFaceDecls } = createContentScaffold();
  const styles = new TextStyleRegistry(doc, automaticStyles, new FontFaceRegistry(doc, fontFaceDecls));
  const lossiness = new LossinessCollector();
  const append = (text: string) => {
    const p = doc.createElementNS(ODF_NS.TEXT, 'text:p');
    body.appendChild(p);
    appendInlineContent(doc, p, text, styles, lossiness);
    return p;
  };
  const properties = (p: Element) => Array.from(p.childNodes).map((node) => {
    const name = node.nodeType === 1
      ? (node as Element).getAttributeNS(ODF_NS.TEXT, 'style-name') : null;
    const style = Array.from(automaticStyles.childNodes).find((el) =>
      el.nodeType === 1 && (el as Element).getAttributeNS(ODF_NS.STYLE, 'name') === name);
    const props = (style as Element | undefined)?.getElementsByTagNameNS(ODF_NS.STYLE, 'text-properties')[0];
    return Object.fromEntries(Array.from(props?.attributes ?? []).map((attr) => [attr.name, attr.value]));
  });
  return { doc, append, properties, lossiness };
}

describe('ODF inline formatting scopes (#1311)', () => {
  it.each([
    ['b', 'fo:font-weight', 'bold'],
    ['i', 'fo:font-style', 'italic'],
    ['u', 'style:text-underline-style', 'solid'],
  ])('restores repeated %s scopes at three levels and resets for siblings', (tag, attr, value) => {
    const { append, properties, lossiness } = environment();
    const p = append(`<${tag}>A<${tag}>B<${tag}>C</${tag}>D</${tag}><${tag}></${tag}>E</${tag}>F<${tag}>G</${tag}>H`);
    expect(p.textContent).toBe('ABCDEFGH');
    expect(properties(p).map((props) => props[attr])).toEqual([value, value, value, value, value, undefined, value, undefined]);
    expect(lossiness.toArray()).toEqual([]);
  });

  it('restores independent mixed scopes and tolerates crossing tags', () => {
    const { append, properties } = environment();
    const p = append('<b>A<i>B<b>C</b>D</i>E</b>F');
    expect(properties(p)).toEqual([
      { 'fo:font-weight': 'bold' },
      { 'fo:font-weight': 'bold', 'fo:font-style': 'italic' },
      { 'fo:font-weight': 'bold', 'fo:font-style': 'italic' },
      { 'fo:font-weight': 'bold', 'fo:font-style': 'italic' },
      { 'fo:font-weight': 'bold' }, {},
    ]);
    expect(properties(append('<b><i>A</b>B</i>C'))).toEqual([
      { 'fo:font-weight': 'bold', 'fo:font-style': 'italic' }, { 'fo:font-style': 'italic' }, {},
    ]);
  });

  it('restores highlight colors after empty and unknown nested highlights', () => {
    const { append, properties, lossiness } = environment();
    const p = append('<highlight color="green">A<highlight color="cyan"></highlight>B' +
      '<highlight color="unknown">C</highlight>D</highlight>E');
    expect(properties(p).map((props) => props['fo:background-color']))
      .toEqual(['#00ff00', '#00ff00', '#ffff00', '#00ff00', undefined]);
    expect(lossiness.toArray()).toEqual([{ construct: 'unknown-highlight-color', count: 1, detail: 'unknown' }]);
  });

  it('inherits omitted font attributes and restores all outer attributes after nested fonts', () => {
    const { append, properties } = environment();
    const p = append('<font color="FF0000" size="14" face="Arial">A<font color="0000FF">B' +
      '<font size="18" face="Georgia">C</font>D</font>E<font size="20"></font>F</font>G');
    const outer = { 'fo:color': '#ff0000', 'fo:font-size': '14pt', 'style:font-name': 'Arial' };
    const inner = { ...outer, 'fo:color': '#0000ff' };
    expect(properties(p)).toEqual([outer, inner,
      { ...inner, 'fo:font-size': '18pt', 'style:font-name': 'Georgia' }, inner, outer, outer, {}]);
  });

  it('retains malformed font fallbacks only inside their scope', () => {
    const { append, properties, lossiness } = environment();
    const p = append('<font color="FF0000" size="14" face="Arial">A' +
      '<font color="nope" size="-1" face=" ">B</font>C</font>D');
    const outer = { 'fo:color': '#ff0000', 'fo:font-size': '14pt', 'style:font-name': 'Arial' };
    expect(properties(p)).toEqual([outer, {}, outer, {}]);
    expect(lossiness.toArray()).toEqual([{ construct: 'unmappable-font-color', count: 1, detail: 'nope' }]);
  });

  it('ignores extra closes without underflow and keeps unclosed scopes local to a paragraph', () => {
    const { append, properties } = environment();
    const closes = '</b></i></u></highlight></font></a>';
    expect(properties(append(`${closes}<b>A</b>${closes}B<b>C`)))
      .toEqual([{ 'fo:font-weight': 'bold' }, {}, { 'fo:font-weight': 'bold' }]);
    expect(properties(append('next'))).toEqual([{}]);
    expect(append('<a href="https://example.com">open').getElementsByTagNameNS(ODF_NS.TEXT, 'a')).toHaveLength(1);
    expect(append('next paragraph').getElementsByTagNameNS(ODF_NS.TEXT, 'a')).toHaveLength(0);
  });

  it.each([
    ['https://example.com/outer', 'https://example.com/inner', 0],
    ['javascript:outer()', 'https://example.com/inner', 1],
    ['https://example.com/outer', 'javascript:inner()', 1],
    ['javascript:outer()', 'javascript:inner()', 2],
  ])('flattens nested hyperlinks (%s, %s) without losing the outer boundary', (outer, inner, unsafeCount) => {
    const { append, lossiness } = environment();
    const p = append(`<a href="${outer}">A<a href="${inner}">B<a href="https://example.com/deeper">C</a>D</a>E</a>` +
      'F<a href="https://example.com/sibling">G</a>H');
    const anchors = Array.from(p.getElementsByTagNameNS(ODF_NS.TEXT, 'a'));
    const outerSafe = outer.startsWith('https:');
    expect(anchors.map((el) => [el.getAttributeNS(ODF_NS.XLINK, 'href'), el.textContent]))
      .toEqual([...(outerSafe ? [[outer, 'ABCDE']] : []), ['https://example.com/sibling', 'G']]);
    expect(p.textContent).toBe('ABCDEFGH');
    for (const anchor of anchors) expect(anchor.getElementsByTagNameNS(ODF_NS.TEXT, 'a')).toHaveLength(0);
    expect(lossiness.toArray().find((entry) => entry.construct === 'nested-hyperlink'))
      .toEqual({ construct: 'nested-hyperlink', count: 2, detail: inner });
    expect(lossiness.toArray().find((entry) => entry.construct === 'unsafe-hyperlink-href')?.count ?? 0).toBe(unsafeCount);
  });

  it('preserves formatting around link boundaries and decodes safe escaped URLs once', () => {
    const { append, properties, lossiness } = environment();
    const p = append('<b>A<a href="https://example.com/?x=1&amp;y=2"><i>B</i>' +
      '<a href="javascript:bad()">C</a>D</a>E</b>F');
    const anchor = p.getElementsByTagNameNS(ODF_NS.TEXT, 'a')[0]!;
    expect(anchor.getAttributeNS(ODF_NS.XLINK, 'href')).toBe('https://example.com/?x=1&y=2');
    expect(anchor.textContent).toBe('BCD');
    expect(properties(p).map((props) => props['fo:font-weight'])).toEqual(['bold', undefined, 'bold', undefined]);
    expect(anchor.getElementsByTagNameNS(ODF_NS.TEXT, 'span')).toHaveLength(3);
    expect(lossiness.toArray().map((entry) => entry.construct)).toEqual(['unsafe-hyperlink-href', 'nested-hyperlink']);
  });

  it.each(['javascript:alert(1)', 'data:text/html,bad', 'file:///tmp/bad', 'java\tscript:bad'])
    ('never activates rejected URL %s or an inner safe URL', (href) => {
      const { append, lossiness } = environment();
      const p = append(`<a href="${href}">A<a href="https://example.com">B</a>C</a>D`);
      expect(p.getElementsByTagNameNS(ODF_NS.TEXT, 'a')).toHaveLength(0);
      expect(p.textContent).toBe('ABCD');
      expect(lossiness.toArray()).toContainEqual({ construct: 'unsafe-hyperlink-href', count: 1, detail: href });
    });

  it.each(['#section', '/relative/path', 'mailto:person@example.com', 'tel:+15555550100'])
    ('preserves allowed outer URL %s', (href) => {
      const { append, lossiness } = environment();
      const p = append(`<a href="${href}">A</a>B`);
      const anchors = Array.from(p.getElementsByTagNameNS(ODF_NS.TEXT, 'a'));
      expect(anchors.map((anchor) => [anchor.getAttributeNS(ODF_NS.XLINK, 'href'), anchor.textContent]))
        .toEqual([[href, 'A']]);
      expect(p.textContent).toBe('AB');
      expect(lossiness.toArray()).toEqual([]);
    });
});
