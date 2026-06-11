/**
 * Paragraph-level automatic styles for the DOCX → ODT converter: the view's
 * `paragraph_alignment` + `paragraph_indents_pt` → deduped `P<n>` styles carrying
 * `fo:text-align` / `fo:margin-left` / `fo:text-indent` (#406 phase 3).
 *
 * Styles are only created when something deviates from the named parent's defaults
 * (non-LEFT alignment or a non-zero indent); plain paragraphs keep the parent name directly.
 * List items request alignment only — `text:list` nesting already supplies indentation, and
 * re-applying `fo:margin-left` would double-indent.
 */

import type { DocumentViewNode } from '@usejunior/docx-core';

import { ODF_NS } from '../shared/odf/namespaces.js';

/** OOXML `ParagraphAlignment` → ODF `fo:text-align`. LEFT is the default and emits nothing. */
const TEXT_ALIGN_MAP: Record<string, string> = {
  CENTER: 'center',
  RIGHT: 'end',
  JUSTIFY: 'justify',
};

/** Format points for style attributes: round to 2 decimals, trim trailing zeros. */
function fmtPt(v: number): string {
  return `${Number(v.toFixed(2))}pt`;
}

export class ParagraphStyleRegistry {
  private byKey = new Map<string, string>();

  constructor(
    private readonly doc: Document,
    private readonly container: Element,
  ) {}

  /**
   * Style name for a paragraph with `parentStyle` and the node's alignment/indents.
   * Returns `parentStyle` itself when nothing deviates.
   */
  styleFor(parentStyle: string, node: DocumentViewNode, opts?: { indents?: boolean }): string {
    const includeIndents = opts?.indents ?? true;
    const align = TEXT_ALIGN_MAP[node.paragraph_alignment] ?? null;
    const left = includeIndents ? node.paragraph_indents_pt.left : 0;
    const firstLine = includeIndents ? node.paragraph_indents_pt.first_line : 0;
    if (align === null && left === 0 && firstLine === 0) return parentStyle;

    const key = `${parentStyle}|${align ?? ''}|${left}|${firstLine}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;

    const name = `P${this.byKey.size + 1}`;
    const style = this.doc.createElementNS(ODF_NS.STYLE, 'style:style');
    style.setAttributeNS(ODF_NS.STYLE, 'style:name', name);
    style.setAttributeNS(ODF_NS.STYLE, 'style:family', 'paragraph');
    style.setAttributeNS(ODF_NS.STYLE, 'style:parent-style-name', parentStyle);
    const props = this.doc.createElementNS(ODF_NS.STYLE, 'style:paragraph-properties');
    if (align !== null) props.setAttributeNS(ODF_NS.FO, 'fo:text-align', align);
    if (left !== 0) props.setAttributeNS(ODF_NS.FO, 'fo:margin-left', fmtPt(left));
    if (firstLine !== 0) props.setAttributeNS(ODF_NS.FO, 'fo:text-indent', fmtPt(firstLine));
    style.appendChild(props);
    this.container.appendChild(style);
    this.byKey.set(key, name);
    return name;
  }
}
