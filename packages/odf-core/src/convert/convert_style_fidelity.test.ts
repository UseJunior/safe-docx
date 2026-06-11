import { describe, it, expect } from 'vitest';
import { buildDocxFromParts, parseXml } from '@usejunior/docx-core';

import { convertDocxToOdt } from './docx_to_odt.js';
import { OdfArchive } from '../shared/odf/OdfArchive.js';
import { ODF_NS } from '../shared/odf/namespaces.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function r(text: string, runProps = ''): string {
  const rPr = runProps ? `<w:rPr>${runProps}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function stylesXmlWith(stylesBody: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W_NS}">${stylesBody}</w:styles>`;
}

async function contentDocOf(odt: Buffer): Promise<{ contentXml: string; doc: Document }> {
  const contentXml = await (await OdfArchive.load(odt)).getContentXml();
  return { contentXml, doc: parseXml(contentXml) };
}

/** Map text:span content → its automatic style's style:text-properties element. */
function spanProperties(doc: Document): Map<string, Element> {
  const stylesByName = new Map<string, Element>();
  for (const style of Array.from(doc.getElementsByTagNameNS(ODF_NS.STYLE, 'style'))) {
    const name = style.getAttributeNS(ODF_NS.STYLE, 'name');
    const props = style.getElementsByTagNameNS(ODF_NS.STYLE, 'text-properties')[0];
    if (name && props) stylesByName.set(name, props as Element);
  }
  const result = new Map<string, Element>();
  for (const span of Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'span'))) {
    const styleName = span.getAttributeNS(ODF_NS.TEXT, 'style-name');
    const props = styleName ? stylesByName.get(styleName) : undefined;
    if (props) result.set(span.textContent ?? '', props);
  }
  return result;
}

/** Map paragraph visible text → the style:paragraph-properties of its (automatic) style. */
function paragraphProperties(doc: Document): Map<string, { styleName: string; props: Element | null }> {
  const stylesByName = new Map<string, Element>();
  for (const style of Array.from(doc.getElementsByTagNameNS(ODF_NS.STYLE, 'style'))) {
    const name = style.getAttributeNS(ODF_NS.STYLE, 'name');
    const props = style.getElementsByTagNameNS(ODF_NS.STYLE, 'paragraph-properties')[0];
    if (name) stylesByName.set(name, props as Element);
  }
  const result = new Map<string, { styleName: string; props: Element | null }>();
  const blocks = [
    ...Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'p')),
    ...Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'h')),
  ];
  for (const p of blocks) {
    const styleName = p.getAttributeNS(ODF_NS.TEXT, 'style-name') ?? '';
    result.set(p.textContent ?? '', { styleName, props: stylesByName.get(styleName) ?? null });
  }
  return result;
}

describe('convertDocxToOdt — style fidelity (phase 3, #406)', () => {
  it('[CONV-14] font face/size/color runs become automatic text styles with declared font faces', async () => {
    const bodyXml =
      `<w:p>${r('Big Georgia title', '<w:sz w:val="44"/><w:rFonts w:ascii="Georgia"/>')}</w:p>` +
      `<w:p>${r('red ', '<w:color w:val="FF0000"/>')}${r('plain ')}${r('red again', '<w:color w:val="FF0000"/>')}</w:p>`;
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt, lossiness } = await convertDocxToOdt(docx);
    const { doc } = await contentDocOf(odt);

    const spans = spanProperties(doc);
    const title = spans.get('Big Georgia title');
    expect(title).toBeDefined();
    expect(title!.getAttributeNS(ODF_NS.FO, 'font-size')).toBe('22pt'); // w:sz is half-points
    expect(title!.getAttributeNS(ODF_NS.STYLE, 'font-name')).toBe('Georgia');

    const red = spans.get('red ');
    expect(red).toBeDefined();
    expect(red!.getAttributeNS(ODF_NS.FO, 'color')).toBe('#ff0000');

    // Identical font tuples share one deduped automatic style.
    const redSpans = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'span'))
      .filter((s) => s.textContent?.startsWith('red'));
    expect(redSpans).toHaveLength(2);
    expect(redSpans[0]!.getAttributeNS(ODF_NS.TEXT, 'style-name'))
      .toBe(redSpans[1]!.getAttributeNS(ODF_NS.TEXT, 'style-name'));

    // The used face is declared for ODF style:font-name resolution.
    const decls = Array.from(doc.getElementsByTagNameNS(ODF_NS.STYLE, 'font-face'));
    expect(decls.map((d) => d.getAttributeNS(ODF_NS.STYLE, 'name'))).toContain('Georgia');

    expect(lossiness.some((e) => e.construct === 'font-formatting-dropped')).toBe(false);
  });

  it('[CONV-15] paragraph alignment and indents become deduped automatic paragraph styles', async () => {
    const bodyXml =
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${r('Centered')}</w:p>` +
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${r('Centered too')}</w:p>` +
      `<w:p><w:pPr><w:jc w:val="both"/><w:ind w:left="720" w:firstLine="360"/></w:pPr>${r('Justified indented')}</w:p>` +
      `<w:p>${r('Plain')}</w:p>`;
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt } = await convertDocxToOdt(docx);
    const { doc } = await contentDocOf(odt);

    const paras = paragraphProperties(doc);
    const centered = paras.get('Centered')!;
    expect(centered.props).not.toBeNull();
    expect(centered.props!.getAttributeNS(ODF_NS.FO, 'text-align')).toBe('center');
    // Identical deviating formats share one deduped style.
    expect(paras.get('Centered too')!.styleName).toBe(centered.styleName);

    const justified = paras.get('Justified indented')!;
    expect(justified.props!.getAttributeNS(ODF_NS.FO, 'text-align')).toBe('justify');
    expect(justified.props!.getAttributeNS(ODF_NS.FO, 'margin-left')).toBe('36pt'); // 720 twips
    expect(justified.props!.getAttributeNS(ODF_NS.FO, 'text-indent')).toBe('18pt'); // 360 twips

    // Default left-aligned unindented paragraphs keep the plain named style.
    expect(paras.get('Plain')!.styleName).toBe('Standard');
  });

  it('[CONV-16] named styles are seeded from the source document styles', async () => {
    const stylesXml = stylesXmlWith(
      `<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/>` +
        `<w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="22"/></w:rPr></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
        `<w:rPr><w:b w:val="0"/><w:sz w:val="40"/><w:color w:val="2E74B5"/></w:rPr></w:style>`,
    );
    const bodyXml =
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${r('The Heading')}</w:p>` +
      `<w:p>${r('Body text')}</w:p>`;
    const docx = await buildDocxFromParts({ bodyXml, stylesXml });
    const { odt } = await convertDocxToOdt(docx);
    const odtStylesXml = await (await OdfArchive.load(odt)).getFile('styles.xml');
    const stylesDoc = parseXml(odtStylesXml!);

    const byName = new Map<string, Element>();
    for (const style of Array.from(stylesDoc.getElementsByTagNameNS(ODF_NS.STYLE, 'style'))) {
      byName.set(style.getAttributeNS(ODF_NS.STYLE, 'name') ?? '', style);
    }

    const h1Props = byName.get('Heading_20_1')!.getElementsByTagNameNS(ODF_NS.STYLE, 'text-properties')[0] as Element;
    expect(h1Props.getAttributeNS(ODF_NS.FO, 'font-size')).toBe('20pt'); // source 40 half-points, not template 18pt
    expect(h1Props.getAttributeNS(ODF_NS.FO, 'font-weight')).toBe('normal'); // explicit w:b w:val="0"
    expect(h1Props.getAttributeNS(ODF_NS.FO, 'color')).toBe('#2e74b5');

    const standardProps = byName.get('Standard')!.getElementsByTagNameNS(ODF_NS.STYLE, 'text-properties')[0] as Element;
    expect(standardProps.getAttributeNS(ODF_NS.STYLE, 'font-name')).toBe('Georgia');
    expect(standardProps.getAttributeNS(ODF_NS.FO, 'font-size')).toBe('11pt');

    // Unspecified properties keep template defaults: Heading_20_2 still carries its template size.
    const h2Props = byName.get('Heading_20_2')!.getElementsByTagNameNS(ODF_NS.STYLE, 'text-properties')[0] as Element;
    expect(h2Props.getAttributeNS(ODF_NS.FO, 'font-size')).toBe('16pt');
  });

  it('[CONV-17] highlight colors are preserved instead of normalizing to yellow', async () => {
    const bodyXml =
      `<w:p>${r('green bit', '<w:highlight w:val="green"/>')}${r(' and ')}${r('cyan bit', '<w:highlight w:val="cyan"/>')}</w:p>`;
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt, lossiness } = await convertDocxToOdt(docx);
    const { doc } = await contentDocOf(odt);

    const spans = spanProperties(doc);
    expect(spans.get('green bit')!.getAttributeNS(ODF_NS.FO, 'background-color')).toBe('#00ff00');
    expect(spans.get('cyan bit')!.getAttributeNS(ODF_NS.FO, 'background-color')).toBe('#00ffff');
    expect(lossiness.some((e) => e.construct === 'unknown-highlight-color')).toBe(false);
  });

  it('[CONV-18] table borders and column widths follow the source table', async () => {
    const borderlessTable =
      `<w:tbl><w:tblPr><w:tblBorders>` +
      `<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/>` +
      `<w:insideH w:val="none"/><w:insideV w:val="none"/>` +
      `</w:tblBorders></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="1440"/></w:tblGrid>` +
      `<w:tr><w:tc><w:p>${r('L1')}</w:p></w:tc><w:tc><w:p>${r('R1')}</w:p></w:tc></w:tr>` +
      `</w:tbl>`;
    const borderedTable =
      `<w:tbl><w:tblPr><w:tblBorders>` +
      `<w:top w:val="single" w:sz="8" w:color="FF0000"/><w:insideH w:val="single" w:sz="8" w:color="FF0000"/>` +
      `</w:tblBorders></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid>` +
      `<w:tr><w:tc><w:p>${r('A')}</w:p></w:tc><w:tc><w:p>${r('B')}</w:p></w:tc></w:tr>` +
      `</w:tbl>`;
    const docx = await buildDocxFromParts({
      bodyXml: borderlessTable + `<w:p>${r('between')}</w:p>` + borderedTable,
    });
    const { odt } = await convertDocxToOdt(docx);
    const { doc } = await contentDocOf(odt);

    const tables = Array.from(doc.getElementsByTagNameNS(ODF_NS.TABLE, 'table'));
    expect(tables).toHaveLength(2);

    const cellBorderOf = (table: Element): string => {
      const cell = table.getElementsByTagNameNS(ODF_NS.TABLE, 'table-cell')[0] as Element;
      const styleName = cell.getAttributeNS(ODF_NS.TABLE, 'style-name')!;
      const style = Array.from(doc.getElementsByTagNameNS(ODF_NS.STYLE, 'style'))
        .find((s) => s.getAttributeNS(ODF_NS.STYLE, 'name') === styleName)!;
      const props = style.getElementsByTagNameNS(ODF_NS.STYLE, 'table-cell-properties')[0] as Element;
      return props.getAttributeNS(ODF_NS.FO, 'border')!;
    };
    expect(cellBorderOf(tables[0]!)).toBe('none');
    expect(cellBorderOf(tables[1]!)).toBe('1pt solid #ff0000'); // w:sz=8 eighths-of-a-point

    // Column widths follow w:tblGrid (twips → pt): 2880 → 144pt, 1440 → 72pt.
    const columnWidthOf = (column: Element): string => {
      const styleName = column.getAttributeNS(ODF_NS.TABLE, 'style-name')!;
      const style = Array.from(doc.getElementsByTagNameNS(ODF_NS.STYLE, 'style'))
        .find((s) => s.getAttributeNS(ODF_NS.STYLE, 'name') === styleName)!;
      const props = style.getElementsByTagNameNS(ODF_NS.STYLE, 'table-column-properties')[0] as Element;
      return props.getAttributeNS(ODF_NS.STYLE, 'column-width')!;
    };
    const firstTableColumns = Array.from(tables[0]!.getElementsByTagNameNS(ODF_NS.TABLE, 'table-column'));
    expect(firstTableColumns).toHaveLength(2);
    expect(columnWidthOf(firstTableColumns[0]!)).toBe('144pt');
    expect(columnWidthOf(firstTableColumns[1]!)).toBe('72pt');
  });

  it('[CONV-19] text-empty body paragraphs are preserved as spacing at their source positions', async () => {
    const bodyXml =
      `<w:p/>` +
      `<w:p>${r('First')}</w:p>` +
      `<w:p/><w:p/>` +
      `<w:p>${r('Second')}</w:p>` +
      `<w:p/>`;
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt, lossiness } = await convertDocxToOdt(docx);
    const { doc } = await contentDocOf(odt);

    const texts = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'p')).map((p) => p.textContent ?? '');
    expect(texts).toEqual(['', 'First', '', '', 'Second', '']);
    expect(lossiness.some((e) => e.construct === 'unsurfaced-paragraphs-dropped')).toBe(false);
  });
});
