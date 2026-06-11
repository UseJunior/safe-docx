/**
 * Inline content emission for the DOCX → ODT converter: `tagged_text` TOON tokens →
 * `text:span` / `text:a` DOM, backed by a deduped automatic text-style registry.
 *
 * The token grammar is owned by docx-core (`tokenizeToonInline`, the same primitive the
 * markdown/HTML serializers consume) so this module never re-derives it. Supported wraps are
 * bold / italic / underline / highlight; `<font …>` (full-mode color/size/face) is
 * recognized-and-dropped with a lossiness entry — richer style mapping is deferred (#331
 * phase 3). Unsafe hyperlink schemes degrade to plain text via the shared `isSafeHref`.
 */

import { isSafeHref, tokenizeToonInline } from '@usejunior/docx-core';

import { ODF_NS } from '../shared/odf/namespaces.js';
import { appendTextWithWhitespace } from './package.js';
import type { LossinessCollector } from './types.js';

interface InlineFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlight: boolean;
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
  ) {}

  styleFor(formats: InlineFormats): string {
    const key = [
      formats.bold ? 'b' : '',
      formats.italic ? 'i' : '',
      formats.underline ? 'u' : '',
      formats.highlight ? 'h' : '',
    ].join('');
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
    if (formats.highlight) props.setAttributeNS(ODF_NS.FO, 'fo:background-color', '#ffff00');
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
  const formats: InlineFormats = { bold: false, italic: false, underline: false, highlight: false };
  let openAnchor: Element | null = null;
  // The currently open span and the format key it was created for: consecutive text tokens with
  // an unchanged format set share one span instead of fragmenting into adjacent twins.
  let openSpan: { el: Element; key: string } | null = null;

  const formatKey = (): string =>
    `${formats.bold ? 'b' : ''}${formats.italic ? 'i' : ''}${formats.underline ? 'u' : ''}${formats.highlight ? 'h' : ''}`;

  for (const token of tokenizeToonInline(taggedText)) {
    if (token.kind === 'text') {
      const container = openAnchor ?? parent;
      const key = formatKey();
      if (key === '') {
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
    else if (tag === '<highlight>') { formats.highlight = true; openSpan = null; }
    else if (tag === '</highlight>') { formats.highlight = false; openSpan = null; }
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
      lossiness.add('font-formatting-dropped', tag);
    }
    // `</font>` needs no action: the open tag never changed format state.
  }
}
