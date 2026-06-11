/**
 * List emission for the DOCX → ODT converter: flat auto-numbered/bullet view nodes →
 * nested `text:list` DOM plus synthesized `text:list-style`s.
 *
 * The nesting logic is a DOM port of the HTML serializer's `ListBuilder`: OOXML `ilvl`
 * carries no monotonicity guarantee, so each open list records the item LEVEL that opened
 * it (not just depth) — that keeps consecutive same-level items siblings even after a
 * level jump that skipped intermediate depths.
 */

import type { NumberingModel } from '@usejunior/docx-core';

import { ODF_NS } from '../shared/odf/namespaces.js';

/** OOXML `numFmt` → ODF `style:num-format`. Anything unmapped falls back to decimal. */
const NUM_FORMAT_MAP: Record<string, string> = {
  decimal: '1',
  lowerLetter: 'a',
  upperLetter: 'A',
  lowerRoman: 'i',
  upperRoman: 'I',
};

const MAX_LIST_LEVELS = 10;
const DEFAULT_BULLET_CHAR = '•';

/**
 * Deduped `office:automatic-styles` registry for lists: one `L<n>` list style per source
 * `num_id` (or per fallback kind when the numbering model has no entry), with one
 * `text:list-level-style-*` per level sourced from the OOXML numbering definition.
 */
export class ListStyleRegistry {
  private byKey = new Map<string, string>();

  constructor(
    private readonly doc: Document,
    private readonly container: Element,
    private readonly numbering: NumberingModel | null,
  ) {}

  /** Style name for a list opened by a node with the given `num_id` (bullet hint for model-less docs). */
  styleFor(numId: string | null, bulletHint: boolean): string {
    const abstract = this.abstractFor(numId);
    const key = abstract ? `num:${abstract.abstractNumId}` : bulletHint ? 'fallback:bullet' : 'fallback:number';
    const existing = this.byKey.get(key);
    if (existing) return existing;

    const name = `L${this.byKey.size + 1}`;
    const style = this.doc.createElementNS(ODF_NS.TEXT, 'text:list-style');
    style.setAttributeNS(ODF_NS.STYLE, 'style:name', name);
    for (let level = 0; level < MAX_LIST_LEVELS; level++) {
      const def = abstract?.levels.get(level);
      if (def ? def.numFmt === 'bullet' : bulletHint) {
        style.appendChild(this.bulletLevel(level));
      } else {
        style.appendChild(this.numberLevel(level, def ?? null));
      }
    }
    this.container.appendChild(style);
    this.byKey.set(key, name);
    return name;
  }

  /** True when the level's source `numFmt` is `bullet` (used to pick the fallback hint). */
  isBulletLevel(numId: string | null, ilvl: number | null): boolean {
    const def = this.abstractFor(numId)?.levels.get(ilvl ?? 0);
    return def?.numFmt === 'bullet';
  }

  private abstractFor(numId: string | null) {
    if (!numId || !this.numbering) return null;
    const instance = this.numbering.nums.get(numId);
    if (!instance) return null;
    return this.numbering.abstractNums.get(instance.abstractNumId) ?? null;
  }

  private bulletLevel(level: number): Element {
    const el = this.doc.createElementNS(ODF_NS.TEXT, 'text:list-level-style-bullet');
    el.setAttributeNS(ODF_NS.TEXT, 'text:level', String(level + 1));
    el.setAttributeNS(ODF_NS.TEXT, 'text:bullet-char', DEFAULT_BULLET_CHAR);
    return el;
  }

  private numberLevel(level: number, def: { numFmt: string; lvlText: string; start: number } | null): Element {
    const el = this.doc.createElementNS(ODF_NS.TEXT, 'text:list-level-style-number');
    el.setAttributeNS(ODF_NS.TEXT, 'text:level', String(level + 1));
    el.setAttributeNS(ODF_NS.STYLE, 'style:num-format', NUM_FORMAT_MAP[def?.numFmt ?? 'decimal'] ?? '1');
    // The literal after the last `%N` placeholder (e.g. `%1.` → `.`, `%1)` → `)`).
    const suffix = def ? /%\d+([^%]*)$/.exec(def.lvlText)?.[1] ?? '' : '.';
    if (suffix) el.setAttributeNS(ODF_NS.STYLE, 'style:num-suffix', suffix);
    if (def && def.start !== 1) el.setAttributeNS(ODF_NS.TEXT, 'text:start-value', String(def.start));
    return el;
  }
}

/**
 * Builds one contiguous run of list items as nested `text:list` DOM under `parent`.
 * `item()` returns the `text:p` to fill with the node's inline content.
 */
export class ListDomBuilder {
  private stack: Array<{ list: Element; level: number }> = [];

  constructor(
    private readonly doc: Document,
    private readonly parent: Element,
  ) {}

  item(level: number, styleName: string, paragraphStyleName = 'Standard'): Element {
    const lvl = Math.max(0, level);
    while (this.stack.length > 0 && this.stack[this.stack.length - 1]!.level > lvl) {
      this.stack.pop();
    }
    let top = this.stack[this.stack.length - 1];
    if (!top || top.level !== lvl) {
      // Deeper than the open top (or the first item): open ONE nested list recording the
      // item's actual level, so a >1 jump still nests a single step.
      const list = this.doc.createElementNS(ODF_NS.TEXT, 'text:list');
      list.setAttributeNS(ODF_NS.TEXT, 'text:style-name', styleName);
      if (!top) {
        this.parent.appendChild(list);
      } else {
        // Nested lists live inside a list-item; reuse the last one or create a holder.
        let host = top.list.lastChild as Element | null;
        if (!host || host.localName !== 'list-item') {
          host = this.doc.createElementNS(ODF_NS.TEXT, 'text:list-item');
          top.list.appendChild(host);
        }
        host.appendChild(list);
      }
      this.stack.push({ list, level: lvl });
      top = this.stack[this.stack.length - 1];
    }
    const item = this.doc.createElementNS(ODF_NS.TEXT, 'text:list-item');
    top!.list.appendChild(item);
    const p = this.doc.createElementNS(ODF_NS.TEXT, 'text:p');
    p.setAttributeNS(ODF_NS.TEXT, 'text:style-name', paragraphStyleName);
    item.appendChild(p);
    return p;
  }
}
