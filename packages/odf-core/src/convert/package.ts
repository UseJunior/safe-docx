/**
 * Fresh-package scaffolding for the DOCX → ODT converter: XML part templates and the
 * whitespace writer that is the emit-side mirror of `shared/odf/text_segments.ts`.
 *
 * The `office:version="1.3"` attribute on every document root is required — LibreOffice
 * tolerates its absence, but strict ODF validators reject the package without it.
 */

import { parseXml } from '@usejunior/docx-core';

import { ODF_NS } from '../shared/odf/namespaces.js';

/** Heading font sizes (pt) for `Heading_20_1` … `Heading_20_6`. */
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
  '  office:version="1.3">',
  '  <office:automatic-styles/>',
  '  <office:body><office:text/></office:body>',
  '</office:document-content>',
].join('\n');

/** The skeleton `content.xml` DOM plus the two insertion points the converter fills. */
export interface ContentScaffold {
  doc: Document;
  automaticStyles: Element;
  body: Element;
}

/** Parse the empty content.xml skeleton and hand back its insertion points. */
export function createContentScaffold(): ContentScaffold {
  const doc = parseXml(CONTENT_SKELETON);
  const automaticStyles = doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'automatic-styles')[0] as Element;
  const body = doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'text')[0] as Element;
  return { doc, automaticStyles, body };
}

/**
 * Seed `styles.xml`: `Standard`, a bold `Heading` base, `Heading_20_1..6` (descending sizes,
 * `style:default-outline-level`), and `Text_20_body`. Run-level formatting lives in content.xml
 * automatic styles instead — richer named-style mapping is deferred (issue #331 phase 3).
 */
export function buildStylesXml(): string {
  const headingStyles = HEADING_SIZES_PT.map((size, i) => {
    const level = i + 1;
    return [
      `    <style:style style:name="Heading_20_${level}" style:display-name="Heading ${level}"`,
      `      style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body"`,
      `      style:default-outline-level="${level}" style:class="text">`,
      `      <style:text-properties fo:font-size="${size}pt"/>`,
      '    </style:style>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-styles',
    `  xmlns:office="${ODF_NS.OFFICE}"`,
    `  xmlns:style="${ODF_NS.STYLE}"`,
    `  xmlns:fo="${ODF_NS.FO}"`,
    '  office:version="1.3">',
    '  <office:styles>',
    '    <style:style style:name="Standard" style:family="paragraph" style:class="text"/>',
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
