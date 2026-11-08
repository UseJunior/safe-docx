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

/** Per-tag scopes preserve tolerant crossing-tag handling; extra closes keep the base frame. */
function formattingScope<T>(initial: T) {
  const frames = [initial];
  return {
    current: (): T => frames[frames.length - 1]!,
    push: (value: T): void => { frames.push(value); },
    close: (): void => { if (frames.length > 1) frames.pop(); },
  };
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
  const bold = formattingScope(false);
  const italic = formattingScope(false);
  const underline = formattingScope(false);
  const highlight = formattingScope<string | null>(null);
  const font = formattingScope<Pick<InlineFormats, 'fontColor' | 'fontSizePt' | 'fontFace'>>({
    fontColor: null, fontSizePt: null, fontFace: null,
  });
  let openAnchor: Element | null = null;
  // Count rejected anchors too: a nested safe URL must not escape an unsafe outer scope.
  let anchorDepth = 0;
  // The currently open span and the format key it was created for: consecutive text tokens with
  // an unchanged format set share one span instead of fragmenting into adjacent twins.
  let openSpan: { el: Element; key: string } | null = null;

  const formatKey = (formats: InlineFormats): string =>
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
      const formats: InlineFormats = {
        bold: bold.current(), italic: italic.current(), underline: underline.current(),
        highlight: highlight.current(), ...font.current(),
      };
      const key = formatKey(formats);
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
    if (tag === '<b>') { bold.push(true); openSpan = null; }
    else if (tag === '</b>') { bold.close(); openSpan = null; }
    else if (tag === '<i>') { italic.push(true); openSpan = null; }
    else if (tag === '</i>') { italic.close(); openSpan = null; }
    else if (tag === '<u>') { underline.push(true); openSpan = null; }
    else if (tag === '</u>') { underline.close(); openSpan = null; }
    else if (tag === '<highlight>' || tag.startsWith('<highlight ')) {
      highlight.push(highlightHexFor(tag, lossiness));
      openSpan = null;
    } else if (tag === '</highlight>') { highlight.close(); openSpan = null; }
    else if (tag.startsWith('<a ')) {
      const escapedHref = /href="([^"]*)"/.exec(tag)?.[1] ?? '';
      // The TOON attribute value is escaped by emitFormattingTags; setAttributeNS escapes
      // again on serialize, so assign the DECODED value or `&amp;` doubles.
      const href = unescapeAttributeValue(escapedHref);
      const safe = isSafeHref(href);
      if (!safe) lossiness.add('unsafe-hyperlink-href', href);
      if (anchorDepth > 0) {
        // Flatten nested links into the outer scope, including when its URL was rejected.
        lossiness.add('nested-hyperlink', href);
      } else if (safe) {
        const anchor = doc.createElementNS(ODF_NS.TEXT, 'text:a');
        anchor.setAttributeNS(ODF_NS.XLINK, 'xlink:type', 'simple');
        anchor.setAttributeNS(ODF_NS.XLINK, 'xlink:href', href);
        parent.appendChild(anchor);
        openAnchor = anchor;
      }
      anchorDepth++;
      openSpan = null;
    } else if (tag === '</a>') {
      if (anchorDepth > 0) anchorDepth--;
      if (anchorDepth === 0) openAnchor = null;
      openSpan = null;
    } else if (tag.startsWith('<font ')) {
      // Full-mode font runs: color is the raw w:color hex (no '#'), size is points, face is
      // the font name. Missing attributes inherit; malformed values keep their existing
      // default-color/size/face fallback, scoped until this font closes.
      const next = { ...font.current() };
      const color = attributeValue(tag, 'color');
      if (color !== null) {
        if (/^[0-9A-Fa-f]{6}$/.test(color)) {
          next.fontColor = `#${color.toLowerCase()}`;
        } else {
          lossiness.add('unmappable-font-color', color);
          next.fontColor = null;
        }
      }
      const size = attributeValue(tag, 'size');
      if (size !== null) {
        const sizePt = Number(size);
        next.fontSizePt = Number.isFinite(sizePt) && sizePt > 0 ? sizePt : null;
      }
      const face = attributeValue(tag, 'face');
      if (face !== null) next.fontFace = face.trim() !== '' ? face : null;
      font.push(next);
      openSpan = null;
    } else if (tag === '</font>') {
      font.close();
      openSpan = null;
    }
  }
}
