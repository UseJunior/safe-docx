/**
 * Inline content emission for the DOCX → ODT converter: `tagged_text` TOON tokens →
 * `text:span` / `text:a` DOM, backed by a deduped automatic text-style registry.
 *
 * The token grammar is owned by docx-core (`tokenizeToonInline`, the same primitive the
 * markdown/HTML serializers consume) so this module never re-derives it. Supported wraps are
 * bold / italic / underline / highlight (with its full-mode source color) and the full-mode
 * `<font color size face>` tag, mapped to `fo:color` / `fo:font-size` / `style:font-name`
 * automatic styles (#406 phase 3). Unsafe hyperlink schemes degrade to plain text via the
 * shared `isSafeHref`.
 */

import { isSafeHref, tokenizeToonInline } from '@usejunior/docx-core';

import { ODF_NS } from '../shared/odf/namespaces.js';
import { appendTextWithWhitespace, quoteFontFamily } from './package.js';
import type { LossinessCollector } from './types.js';

/**
 * OOXML `ST_HighlightColor` enum values (`w:highlight`) → the hex Word renders them as.
 * The TOON highlight tag carries the source enum value in full mode; anything unknown
 * degrades to yellow with a lossiness entry rather than dropping the highlight.
 */
const HIGHLIGHT_COLOR_HEX: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#00008b',
  darkCyan: '#008b8b',
  darkGreen: '#006400',
  darkMagenta: '#8b008b',
  darkRed: '#8b0000',
  darkYellow: '#808000',
  darkGray: '#a9a9a9',
  lightGray: '#d3d3d3',
  black: '#000000',
  white: '#ffffff',
};

const DEFAULT_HIGHLIGHT_HEX = HIGHLIGHT_COLOR_HEX['yellow']!;

interface InlineFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** ODF `fo:background-color` hex (e.g. `#00ff00`), or null when unhighlighted. */
  highlight: string | null;
  /** ODF `fo:color` hex (e.g. `#ff0000`), or null for the default color. */
  fontColor: string | null;
  /** Font size in points as carried by the TOON tag (may be fractional), or null. */
  fontSizePt: number | null;
  /** Font face name, or null for the default face. */
  fontFace: string | null;
}

/**
 * Deduped `office:font-face-decls` registry: one `style:font-face` per distinct face name
 * used anywhere in the document (ODF resolves `style:font-name` against declared faces).
 */
export class FontFaceRegistry {
  private declared = new Set<string>();

  constructor(
    private readonly doc: Document,
    private readonly container: Element,
  ) {}

  ensure(face: string): void {
    if (this.declared.has(face)) return;
    this.declared.add(face);
    const decl = this.doc.createElementNS(ODF_NS.STYLE, 'style:font-face');
    decl.setAttributeNS(ODF_NS.STYLE, 'style:name', face);
    decl.setAttributeNS(ODF_NS.SVG, 'svg:font-family', quoteFontFamily(face));
    this.container.appendChild(decl);
  }
}

/**
 * Deduped `office:automatic-styles` registry for run formatting: one `T<n>` text style per
 * distinct format combination, shared across the whole document.
 */
export class TextStyleRegistry {
  private byKey = new Map<string, string>();

  constructor(
    private readonly doc: Document,
    private readonly container: Element,
    private readonly fontFaces: FontFaceRegistry,
  ) {}

  styleFor(formats: InlineFormats): string {
    const key = [
      formats.bold ? 'b' : '',
      formats.italic ? 'i' : '',
      formats.underline ? 'u' : '',
      formats.highlight ?? '',
      formats.fontColor ?? '',
      formats.fontSizePt ?? '',
      formats.fontFace ?? '',
    ].join('|');
    const existing = this.byKey.get(key);
    if (existing) return existing;

    const name = `T${this.byKey.size + 1}`;
    const style = this.doc.createElementNS(ODF_NS.STYLE, 'style:style');
    style.setAttributeNS(ODF_NS.STYLE, 'style:name', name);
    style.setAttributeNS(ODF_NS.STYLE, 'style:family', 'text');
    const props = this.doc.createElementNS(ODF_NS.STYLE, 'style:text-properties');
    if (formats.bold) props.setAttributeNS(ODF_NS.FO, 'fo:font-weight', 'bold');
    if (formats.italic) props.setAttributeNS(ODF_NS.FO, 'fo:font-style', 'italic');
    if (formats.underline) {
      props.setAttributeNS(ODF_NS.STYLE, 'style:text-underline-style', 'solid');
      props.setAttributeNS(ODF_NS.STYLE, 'style:text-underline-width', 'auto');
      props.setAttributeNS(ODF_NS.STYLE, 'style:text-underline-color', 'font-color');
    }
    if (formats.highlight) props.setAttributeNS(ODF_NS.FO, 'fo:background-color', formats.highlight);
    if (formats.fontColor) props.setAttributeNS(ODF_NS.FO, 'fo:color', formats.fontColor);
    if (formats.fontSizePt !== null) props.setAttributeNS(ODF_NS.FO, 'fo:font-size', `${formats.fontSizePt}pt`);
    if (formats.fontFace) {
      this.fontFaces.ensure(formats.fontFace);
      props.setAttributeNS(ODF_NS.STYLE, 'style:font-name', formats.fontFace);
    }
    style.appendChild(props);
    this.container.appendChild(style);
    this.byKey.set(key, name);
    return name;
  }
}

/** Reverse of `formatting_tags.ts`'s `escapeHtmlAttribute` (`&amp;` last so it can't re-expand). */
function unescapeAttributeValue(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

function attributeValue(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? unescapeAttributeValue(match[1]!) : null;
}

/** Map a TOON highlight open tag to its ODF background hex. */
function highlightHexFor(tag: string, lossiness: LossinessCollector): string {
  const val = attributeValue(tag, 'color');
  // Compact mode emits the value-less form; the historical normalization to yellow applies.
  if (val === null) return DEFAULT_HIGHLIGHT_HEX;
  const hex = HIGHLIGHT_COLOR_HEX[val];
  if (hex) return hex;
  lossiness.add('unknown-highlight-color', val);
  return DEFAULT_HIGHLIGHT_HEX;
}

/**
 * Append one `tagged_text` string's content to `parent` (a `text:p`/`text:h` or table-cell
 * paragraph), wrapping formatted runs in `text:span` and hyperlinks in `text:a`.
 */
export function appendInlineContent(
  doc: Document,
  parent: Element,
  taggedText: string,
  styles: TextStyleRegistry,
  lossiness: LossinessCollector,
): void {
  const formats: InlineFormats = {
    bold: false,
    italic: false,
    underline: false,
    highlight: null,
    fontColor: null,
    fontSizePt: null,
    fontFace: null,
  };
  let openAnchor: Element | null = null;
  // The currently open span and the format key it was created for: consecutive text tokens with
  // an unchanged format set share one span instead of fragmenting into adjacent twins.
  let openSpan: { el: Element; key: string } | null = null;

  const formatKey = (): string =>
    [
      formats.bold ? 'b' : '',
      formats.italic ? 'i' : '',
      formats.underline ? 'u' : '',
      formats.highlight ?? '',
      formats.fontColor ?? '',
      formats.fontSizePt ?? '',
      formats.fontFace ?? '',
    ].join('|');

  const EMPTY_KEY = '||||||';

  for (const token of tokenizeToonInline(taggedText)) {
    if (token.kind === 'text') {
      const container = openAnchor ?? parent;
      const key = formatKey();
      if (key === EMPTY_KEY) {
        openSpan = null;
        appendTextWithWhitespace(doc, container, token.value);
        continue;
      }
      if (!openSpan || openSpan.key !== key || openSpan.el.parentNode !== container) {
        const span = doc.createElementNS(ODF_NS.TEXT, 'text:span');
        span.setAttributeNS(ODF_NS.TEXT, 'text:style-name', styles.styleFor(formats));
        container.appendChild(span);
        openSpan = { el: span, key };
      }
      appendTextWithWhitespace(doc, openSpan.el, token.value);
      continue;
    }

    const tag = token.value;
    if (tag === '<b>') { formats.bold = true; openSpan = null; }
    else if (tag === '</b>') { formats.bold = false; openSpan = null; }
    else if (tag === '<i>') { formats.italic = true; openSpan = null; }
    else if (tag === '</i>') { formats.italic = false; openSpan = null; }
    else if (tag === '<u>') { formats.underline = true; openSpan = null; }
    else if (tag === '</u>') { formats.underline = false; openSpan = null; }
    else if (tag === '<highlight>' || tag.startsWith('<highlight ')) {
      formats.highlight = highlightHexFor(tag, lossiness);
      openSpan = null;
    } else if (tag === '</highlight>') { formats.highlight = null; openSpan = null; }
    else if (tag.startsWith('<a ')) {
      const escapedHref = /href="([^"]*)"/.exec(tag)?.[1] ?? '';
      // The TOON attribute value is escaped by emitFormattingTags; setAttributeNS escapes
      // again on serialize, so assign the DECODED value or `&amp;` doubles.
      const href = unescapeAttributeValue(escapedHref);
      if (isSafeHref(href)) {
        const anchor = doc.createElementNS(ODF_NS.TEXT, 'text:a');
        anchor.setAttributeNS(ODF_NS.XLINK, 'xlink:type', 'simple');
        anchor.setAttributeNS(ODF_NS.XLINK, 'xlink:href', href);
        parent.appendChild(anchor);
        openAnchor = anchor;
      } else {
        lossiness.add('unsafe-hyperlink-href', href);
        openAnchor = null;
      }
      openSpan = null;
    } else if (tag === '</a>') {
      openAnchor = null;
      openSpan = null;
    } else if (tag.startsWith('<font ')) {
      // Full-mode font runs: color is the raw w:color hex (no '#'), size is points, face is
      // the font name. A malformed color degrades to the default color, reported.
      const color = attributeValue(tag, 'color');
      if (color !== null) {
        if (/^[0-9A-Fa-f]{6}$/.test(color)) {
          formats.fontColor = `#${color.toLowerCase()}`;
        } else {
          lossiness.add('unmappable-font-color', color);
          formats.fontColor = null;
        }
      } else {
        formats.fontColor = null;
      }
      const size = attributeValue(tag, 'size');
      const sizePt = size !== null ? Number(size) : NaN;
      formats.fontSizePt = Number.isFinite(sizePt) && sizePt > 0 ? sizePt : null;
      const face = attributeValue(tag, 'face');
      formats.fontFace = face !== null && face.trim() !== '' ? face : null;
      openSpan = null;
    } else if (tag === '</font>') {
      formats.fontColor = null;
      formats.fontSizePt = null;
      formats.fontFace = null;
      openSpan = null;
    }
  }
}
