/**
 * Fresh-package scaffolding for the DOCX → ODT converter: XML part templates and the
 * whitespace writer that is the emit-side mirror of `shared/odf/text_segments.ts`.
 *
 * The `office:version="1.3"` attribute on every document root is required — LibreOffice
 * tolerates its absence, but strict ODF validators reject the package without it.
 */

import { parseXml, extractStyleRunFormatting, type StyleRunFormatting, type StylesModel } from '@usejunior/docx-core';

import { ODF_NS } from '../shared/odf/namespaces.js';

/** Quote a font family for `svg:font-family` when it contains non-name characters (spaces). */
export function quoteFontFamily(face: string): string {
  return /^[A-Za-z0-9-]+$/.test(face) ? face : `'${face.replaceAll("'", '')}'`;
}

/** Template heading font sizes (pt) for `Heading_20_1` … `Heading_20_6` (source may override). */
const HEADING_SIZES_PT = [18, 16, 14, 13, 12, 11] as const;

const CONTENT_SKELETON = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<office:document-content',
  `  xmlns:office="${ODF_NS.OFFICE}"`,
  `  xmlns:text="${ODF_NS.TEXT}"`,
  `  xmlns:table="${ODF_NS.TABLE}"`,
  `  xmlns:style="${ODF_NS.STYLE}"`,
  `  xmlns:fo="${ODF_NS.FO}"`,
  `  xmlns:xlink="${ODF_NS.XLINK}"`,
  `  xmlns:svg="${ODF_NS.SVG}"`,
  '  office:version="1.3">',
  '  <office:font-face-decls/>',
  '  <office:automatic-styles/>',
  '  <office:body><office:text/></office:body>',
  '</office:document-content>',
].join('\n');

/** The skeleton `content.xml` DOM plus the insertion points the converter fills. */
export interface ContentScaffold {
  doc: Document;
  fontFaceDecls: Element;
  automaticStyles: Element;
  body: Element;
}

/** Parse the empty content.xml skeleton and hand back its insertion points. */
export function createContentScaffold(): ContentScaffold {
  const doc = parseXml(CONTENT_SKELETON);
  const fontFaceDecls = doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'font-face-decls')[0] as Element;
  const automaticStyles = doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'automatic-styles')[0] as Element;
  const body = doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'text')[0] as Element;
  return { doc, fontFaceDecls, automaticStyles, body };
}

/** Source-derived named-style formatting feeding {@link buildStylesXml}. */
export interface SourceNamedStyles {
  /** Resolved run formatting per heading level 1..6 (absent levels keep template defaults). */
  headings: Map<number, StyleRunFormatting>;
  /** Resolved run formatting of the source `Normal` style, or null when undefined. */
  normal: StyleRunFormatting | null;
}

/**
 * Resolve the source styles the converted `styles.xml` is seeded from: `Heading1..6` (matched
 * by styleId or by the canonical `heading N` style name) and `Normal`. Properties a chain
 * never specifies stay `null` so the template defaults survive.
 */
export function deriveSourceNamedStyles(styles: StylesModel): SourceNamedStyles {
  const headingIdByLevel = new Map<number, string>();
  let normalId: string | null = null;
  for (const [id, def] of styles.byId) {
    const byId = /^Heading([1-6])$/.exec(id);
    const byName = /^heading ([1-6])$/i.exec(def.name);
    const level = byId ? Number(byId[1]) : byName ? Number(byName[1]) : null;
    if (level !== null && !headingIdByLevel.has(level)) headingIdByLevel.set(level, id);
    if (normalId === null && (id === 'Normal' || /^normal$/i.test(def.name))) normalId = id;
  }
  const headings = new Map<number, StyleRunFormatting>();
  for (const [level, id] of headingIdByLevel) {
    headings.set(level, extractStyleRunFormatting(styles, id));
  }
  return { headings, normal: normalId ? extractStyleRunFormatting(styles, normalId) : null };
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `style:text-properties` attributes for a source-derived named style. Only properties the
 * source chain specifies are emitted; `null` lets the template's own defaults (or the parent
 * style) win. `collectFace` records faces needing a `style:font-face` declaration.
 */
function textPropertiesAttrs(fmt: StyleRunFormatting | null, collectFace: (face: string) => void): string[] {
  if (!fmt) return [];
  const attrs: string[] = [];
  if (fmt.fontSizePt !== null && fmt.fontSizePt > 0) attrs.push(`fo:font-size="${fmt.fontSizePt}pt"`);
  if (fmt.bold !== null) attrs.push(`fo:font-weight="${fmt.bold ? 'bold' : 'normal'}"`);
  if (fmt.italic !== null) attrs.push(`fo:font-style="${fmt.italic ? 'italic' : 'normal'}"`);
  if (fmt.colorHex !== null && /^[0-9A-Fa-f]{6}$/.test(fmt.colorHex)) {
    attrs.push(`fo:color="#${fmt.colorHex.toLowerCase()}"`);
  }
  if (fmt.fontName !== null && fmt.fontName.trim() !== '') {
    collectFace(fmt.fontName);
    attrs.push(`style:font-name="${escapeXmlAttr(fmt.fontName)}"`);
  }
  return attrs;
}

/**
 * Seed `styles.xml`: `Standard`, a bold `Heading` base, `Heading_20_1..6` (descending sizes,
 * `style:default-outline-level`), and `Text_20_body`. When `source` carries the document's
 * resolved style-chain formatting, heading sizes/weights/colors/fonts and the `Standard` body
 * font come from the source instead of the fixed template (#406 phase 3); properties the
 * source never specifies keep the template defaults.
 */
export function buildStylesXml(source?: SourceNamedStyles): string {
  const faces = new Set<string>();
  const collectFace = (face: string): void => { faces.add(face); };

  const headingStyles = HEADING_SIZES_PT.map((templateSize, i) => {
    const level = i + 1;
    const sourceAttrs = textPropertiesAttrs(source?.headings.get(level) ?? null, collectFace);
    const attrs = sourceAttrs.some((a) => a.startsWith('fo:font-size='))
      ? sourceAttrs
      : [`fo:font-size="${templateSize}pt"`, ...sourceAttrs];
    return [
      `    <style:style style:name="Heading_20_${level}" style:display-name="Heading ${level}"`,
      `      style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body"`,
      `      style:default-outline-level="${level}" style:class="text">`,
      `      <style:text-properties ${attrs.join(' ')}/>`,
      '    </style:style>',
    ].join('\n');
  });

  const standardAttrs = textPropertiesAttrs(source?.normal ?? null, collectFace);
  const standardStyle = standardAttrs.length > 0
    ? [
        '    <style:style style:name="Standard" style:family="paragraph" style:class="text">',
        `      <style:text-properties ${standardAttrs.join(' ')}/>`,
        '    </style:style>',
      ].join('\n')
    : '    <style:style style:name="Standard" style:family="paragraph" style:class="text"/>';

  const fontFaceDecls = faces.size > 0
    ? [
        '  <office:font-face-decls>',
        ...Array.from(faces, (face) =>
          `    <style:font-face style:name="${escapeXmlAttr(face)}" svg:font-family="${escapeXmlAttr(quoteFontFamily(face))}"/>`),
        '  </office:font-face-decls>',
      ]
    : [];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-styles',
    `  xmlns:office="${ODF_NS.OFFICE}"`,
    `  xmlns:style="${ODF_NS.STYLE}"`,
    `  xmlns:fo="${ODF_NS.FO}"`,
    `  xmlns:svg="${ODF_NS.SVG}"`,
    '  office:version="1.3">',
    ...fontFaceDecls,
    '  <office:styles>',
    standardStyle,
    '    <style:style style:name="Text_20_body" style:display-name="Text body"',
    '      style:family="paragraph" style:parent-style-name="Standard" style:class="text"/>',
    '    <style:style style:name="Heading" style:family="paragraph"',
    '      style:parent-style-name="Standard" style:next-style-name="Text_20_body" style:class="text">',
    '      <style:text-properties fo:font-weight="bold"/>',
    '    </style:style>',
    ...headingStyles,
    '  </office:styles>',
    '</office:document-styles>',
    '',
  ].join('\n');
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Build `meta.xml` carrying the generator string and optional title. */
export function buildMetaXml(metadata?: { title?: string; generator?: string }): string {
  const generator = metadata?.generator ?? '@usejunior/odf-core convertDocxToOdt';
  const title = metadata?.title;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-meta',
    `  xmlns:office="${ODF_NS.OFFICE}"`,
    `  xmlns:meta="${ODF_NS.META}"`,
    `  xmlns:dc="${ODF_NS.DC}"`,
    '  office:version="1.3">',
    '  <office:meta>',
    `    <meta:generator>${escapeXmlText(generator)}</meta:generator>`,
    ...(title ? [`    <dc:title>${escapeXmlText(title)}</dc:title>`] : []),
    '  </office:meta>',
    '</office:document-meta>',
    '',
  ].join('\n');
}

/**
 * Append visible text to `parent`, encoding whitespace the way ODF readers decode it
 * (the writer mirror of `buildSegments`): a run of N≥2 spaces becomes one literal space +
 * `<text:s text:c="N-1"/>`, tabs become `text:tab`, newlines become `text:line-break`.
 * A leading space is encoded as `text:s` outright — ODF processors collapse literal
 * leading whitespace.
 */
export function appendTextWithWhitespace(doc: Document, parent: Element, text: string): void {
  if (text.length === 0) return;
  const isAtBlockStart = parent.firstChild === null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\t') {
      parent.appendChild(doc.createElementNS(ODF_NS.TEXT, 'text:tab'));
      i += 1;
      continue;
    }
    if (ch === '\n') {
      parent.appendChild(doc.createElementNS(ODF_NS.TEXT, 'text:line-break'));
      i += 1;
      continue;
    }
    if (ch === ' ') {
      let n = 1;
      while (text[i + n] === ' ') n += 1;
      const leading = isAtBlockStart && i === 0 && parent.firstChild === null;
      if (leading) {
        const s = doc.createElementNS(ODF_NS.TEXT, 'text:s');
        if (n > 1) s.setAttributeNS(ODF_NS.TEXT, 'text:c', String(n));
        parent.appendChild(s);
      } else {
        parent.appendChild(doc.createTextNode(' '));
        if (n > 1) {
          const s = doc.createElementNS(ODF_NS.TEXT, 'text:s');
          if (n > 2) s.setAttributeNS(ODF_NS.TEXT, 'text:c', String(n - 1));
          parent.appendChild(s);
        }
      }
      i += n;
      continue;
    }
    let end = i;
    while (end < text.length && text[end] !== ' ' && text[end] !== '\t' && text[end] !== '\n') end += 1;
    parent.appendChild(doc.createTextNode(text.slice(i, end)));
    i = end;
  }
}
