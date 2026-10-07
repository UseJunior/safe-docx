import { OOXML, W } from './namespaces.js';
import { getAttributeSafe, getFirstChild } from './xml-helpers.js';

function getWAttr(el: Element, localName: string): string | null {
  // Preserve legacy truthy fallback for empty strings from namespace-bound reads
  // when attributes were written without a real namespace binding.
  return getAttributeSafe(el, OOXML.W_NS, localName, 'w', { emptyIsMissing: true });
}

function isOnValue(v: string): boolean {
  return v !== '0' && v !== 'false' && v !== 'off';
}

function childElements(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    const el = c as Element;
    if (el.localName === localName && el.namespaceURI === OOXML.W_NS) out.push(el);
  }
  return out;
}

/**
 * The first direct `w:` child named `localName`. Unlike getFirstChild (a
 * descendant search) it never reaches into a nested `w:tblPrChange` /
 * `w:trPrChange` (the previous state) or a nested table.
 */
function ownChild(parent: Element, localName: string): Element | null {
  return childElements(parent, localName)[0] ?? null;
}

export type StyleDef = {
  styleId: string;
  styleType: string | null;
  name: string;
  basedOn: string | null;
  pPr: Element | null;
  rPr: Element | null;
  /**
   * Table styles only: the style's own `w:tblPr` (read for
   * `w:tblStyleRowBandSize` / `w:tblStyleColBandSize`), and the `w:rPr` of
   * each conditional `w:tblStylePr`, keyed by its `w:type`. Optional so
   * hand-built models remain source-compatible.
   */
  tblPr?: Element | null;
  conditionalRPrs?: Map<string, Element>;
};

export type StylesModel = {
  byId: Map<string, StyleDef>;
  /**
   * `w:docDefaults/w:rPrDefault/w:rPr`, when the styles part declares one.
   * {@link extractEffectiveRunFormatting} reads it as the lowest-precedence
   * run-property layer (#753). Optional so callers that build the `{ byId }`
   * shape by hand remain source-compatible; such a model has no document
   * defaults.
   */
  docDefaultsRPr?: Element | null;
  /**
   * The `w:styleId` of the default table style (`w:type="table"` with
   * `w:default="1"`), which applies to a table that names no `w:tblStyle`.
   */
  defaultTableStyleId?: string | null;
  /**
   * Every `w:rPr` carried by a table style, including the conditional
   * `w:tblStylePr/w:rPr` blocks.
   *
   * @deprecated No longer read: {@link extractEffectiveRunFormatting} resolves
   * table styles from the run's table context since #1159. Still populated so
   * existing readers keep compiling.
   */
  tableStyleRPrs?: Element[];
};

export type ThemeModel = {
  fonts: Map<string, string>;
  colors: Map<string, string>;
};

const THEME_COLOR_ELEMENT_BY_REFERENCE: Readonly<Record<string, string>> = {
  dark1: 'dk1',
  light1: 'lt1',
  dark2: 'dk2',
  light2: 'lt2',
  text1: 'dk1',
  background1: 'lt1',
  text2: 'dk2',
  background2: 'lt2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  followedHyperlink: 'folHlink',
};

function drawingChild(parent: Element | null, localName: string): Element | null {
  return parent ? getFirstChild(parent, OOXML.A_NS, localName) : null;
}

function themeColorHex(slot: Element): string | null {
  const srgb = drawingChild(slot, 'srgbClr');
  const srgbValue = srgb?.getAttribute('val');
  if (srgbValue && /^[0-9A-Fa-f]{6}$/u.test(srgbValue)) return srgbValue.toUpperCase();

  const system = drawingChild(slot, 'sysClr');
  const lastColor = system?.getAttribute('lastClr');
  if (lastColor && /^[0-9A-Fa-f]{6}$/u.test(lastColor)) return lastColor.toUpperCase();
  return null;
}

/**
 * Parse the concrete Latin/EA/complex-script fonts and color scheme carried by
 * `word/theme/theme1.xml`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.26
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.6
 * @see https://github.com/UseJunior/safe-docx/issues/738
 */
export function parseThemeXml(themeDoc: Document | null): ThemeModel {
  const fonts = new Map<string, string>();
  const colors = new Map<string, string>();
  if (!themeDoc) return { fonts, colors };

  const fontScheme = themeDoc.getElementsByTagNameNS(OOXML.A_NS, 'fontScheme').item(0);
  for (const family of ['major', 'minor'] as const) {
    const familyElement = drawingChild(fontScheme, `${family}Font`);
    for (const [suffix, elementName] of [
      ['Ascii', 'latin'],
      ['HAnsi', 'latin'],
      ['EastAsia', 'ea'],
      ['Bidi', 'cs'],
    ] as const) {
      const typeface = drawingChild(familyElement, elementName)?.getAttribute('typeface');
      if (typeface) fonts.set(`${family}${suffix}`, typeface);
    }
  }

  const colorScheme = themeDoc.getElementsByTagNameNS(OOXML.A_NS, 'clrScheme').item(0);
  if (colorScheme) {
    for (const [reference, elementName] of Object.entries(THEME_COLOR_ELEMENT_BY_REFERENCE)) {
      const slot = drawingChild(colorScheme, elementName);
      const hex = slot ? themeColorHex(slot) : null;
      if (hex) colors.set(reference, hex);
    }
  }
  return { fonts, colors };
}

export function parseStylesXml(stylesDoc: Document | null): StylesModel {
  const byId = new Map<string, StyleDef>();
  if (!stylesDoc) return { byId, docDefaultsRPr: null, defaultTableStyleId: null, tableStyleRPrs: [] };

  const docDefaults = stylesDoc.getElementsByTagNameNS(OOXML.W_NS, W.docDefaults).item(0);
  const rPrDefault = docDefaults ? getFirstChild(docDefaults, OOXML.W_NS, W.rPrDefault) : null;
  const docDefaultsRPr = rPrDefault ? getFirstChild(rPrDefault, OOXML.W_NS, W.rPr) : null;
  const tableStyleRPrs: Element[] = [];
  let defaultTableStyleId: string | null = null;

  const styles = Array.from(stylesDoc.getElementsByTagNameNS(OOXML.W_NS, W.style));
  for (const st of styles) {
    const id = getWAttr(st, 'styleId');
    if (!id) continue;
    const nameEl = getFirstChild(st, OOXML.W_NS, W.name);
    const basedOnEl = getFirstChild(st, OOXML.W_NS, W.basedOn);
    const styleType = getWAttr(st, 'type');
    // getFirstChild searches descendants. A table style nests further pPr /
    // rPr / tblPr inside each w:tblStylePr, so its own properties must be read
    // from direct children, or a style without its own rPr would take the
    // first conditional's as if it applied to the whole table.
    const styleChild = (localName: string): Element | null =>
      styleType === 'table' ? ownChild(st, localName) : getFirstChild(st, OOXML.W_NS, localName);
    const pPr = styleChild(W.pPr);
    const rPr = styleChild(W.rPr);

    const name = nameEl ? (getWAttr(nameEl, 'val') ?? id) : id;
    const basedOn = basedOnEl ? (getWAttr(basedOnEl, 'val') ?? null) : null;
    const def: StyleDef = {
      styleId: id,
      styleType,
      name,
      basedOn,
      pPr: pPr ?? null,
      rPr: rPr ?? null,
    };
    if (styleType === 'table') {
      if (rPr) tableStyleRPrs.push(rPr);
      const conditionalRPrs = new Map<string, Element>();
      for (const conditional of childElements(st, 'tblStylePr')) {
        const type = getWAttr(conditional, 'type');
        const conditionalRPr = getFirstChild(conditional, OOXML.W_NS, W.rPr);
        if (!conditionalRPr) continue;
        tableStyleRPrs.push(conditionalRPr);
        // The first block of a type wins, matching getFirstChild elsewhere.
        if (type && !conditionalRPrs.has(type)) conditionalRPrs.set(type, conditionalRPr);
      }
      def.tblPr = styleChild(W.tblPr);
      def.conditionalRPrs = conditionalRPrs;
      const isDefault = getWAttr(st, 'default');
      // The last default style of a type wins (§ 17.7.4.17).
      if (isDefault !== null && isOnValue(isDefault)) defaultTableStyleId = id;
    }

    byId.set(id, def);
  }
  return { byId, docDefaultsRPr: docDefaultsRPr ?? null, defaultTableStyleId, tableStyleRPrs };
}

function resolveStyleChain(model: StylesModel, styleId: string | null): StyleDef[] {
  const chain: StyleDef[] = [];
  let cur = styleId;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const st = model.byId.get(cur);
    if (!st) break;
    chain.push(st);
    cur = st.basedOn;
  }
  return chain;
}

export type ParagraphAlignment = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFY';

export type ParagraphFormatting = {
  styleId: string | null;
  styleName: string;
  alignment: ParagraphAlignment;
  leftIndentPt: number;
  firstLineIndentPt: number;
  /** Effective raw OOXML outline value: 0..8 are headings; 9 is body text. */
  outlineLevel: number | null;
};

function twipsToPt(v: number): number {
  return v / 20.0;
}

function parseIndentPt(indEl: Element | null): { leftIndentPt: number; firstLineIndentPt: number } {
  if (!indEl) return { leftIndentPt: 0, firstLineIndentPt: 0 };
  const left = Number.parseInt(getWAttr(indEl, 'left') ?? '0', 10);
  const firstLine = getWAttr(indEl, 'firstLine');
  const hanging = getWAttr(indEl, 'hanging');
  let first = 0;
  if (firstLine != null) first = Number.parseInt(firstLine, 10) || 0;
  else if (hanging != null) first = -(Number.parseInt(hanging, 10) || 0);
  return { leftIndentPt: twipsToPt(left), firstLineIndentPt: twipsToPt(first) };
}

function parseAlignment(jcEl: Element | null): ParagraphAlignment {
  const val = jcEl ? (getWAttr(jcEl, 'val') ?? '') : '';
  switch (val) {
    case 'center':
      return 'CENTER';
    case 'right':
      return 'RIGHT';
    case 'both':
    case 'justify':
      return 'JUSTIFY';
    case 'left':
    default:
      return 'LEFT';
  }
}

function firstNonNull<T>(vals: Array<T | null | undefined>): T | null {
  for (const v of vals) {
    if (v !== null && v !== undefined) return v as T;
  }
  return null;
}

/**
 * Parse the paragraph outline level defined by WordprocessingML. Values 0..8
 * represent heading levels 1..9; value 9 explicitly marks body text.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.20
 */
function parseOutlineLevel(outlineEl: Element | null): number | null {
  if (!outlineEl) return null;
  const raw = (getWAttr(outlineEl, 'val') ?? '').trim();
  if (!/^\+?\d+$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= 9 ? value : null;
}

export function extractParagraphFormatting(
  pPr: Element | null,
  styles: StylesModel,
): ParagraphFormatting {
  const pStyleEl = pPr ? getFirstChild(pPr, OOXML.W_NS, W.pStyle) : null;
  const styleId = pStyleEl ? (getWAttr(pStyleEl, 'val') ?? null) : null;

  const chain = resolveStyleChain(styles, styleId);
  const styleName = (styleId && styles.byId.get(styleId)?.name) || styleId || '';

  // Resolve alignment and indents: direct pPr overrides style chain.
  const directJc = pPr ? getFirstChild(pPr, OOXML.W_NS, W.jc) : null;
  const directInd = pPr ? getFirstChild(pPr, OOXML.W_NS, W.ind) : null;
  const directOutline = pPr ? getFirstChild(pPr, OOXML.W_NS, W.outlineLvl) : null;

  const styleJc = firstNonNull(chain.map((s) => (s.pPr ? getFirstChild(s.pPr, OOXML.W_NS, W.jc) : null)));
  const styleInd = firstNonNull(chain.map((s) => (s.pPr ? getFirstChild(s.pPr, OOXML.W_NS, W.ind) : null)));
  const styleOutlineLevel = firstNonNull(
    chain.map((s) =>
      parseOutlineLevel(s.pPr ? getFirstChild(s.pPr, OOXML.W_NS, W.outlineLvl) : null),
    ),
  );

  const alignment = parseAlignment(directJc ?? styleJc);
  const ind = parseIndentPt(directInd ?? styleInd);

  return {
    styleId,
    styleName,
    alignment,
    leftIndentPt: ind.leftIndentPt,
    firstLineIndentPt: ind.firstLineIndentPt,
    outlineLevel: parseOutlineLevel(directOutline) ?? styleOutlineLevel,
  };
}

/**
 * Effective run formatting. `null` means the resolver could not establish the
 * property, and never stands in for a rendered default. That happens when:
 * - the nearest layer that declares it does so through a theme colour or
 *   theme font reference that cannot be resolved (no theme, or no matching
 *   theme entry, and no explicit fallback value); or
 * - it has no OOXML default (`fontName`, `fontSizePt`) and no consulted layer,
 *   `w:docDefaults` included, declares it.
 *
 * A property declared nowhere in the document resolves to its OOXML default:
 * `false` for toggles and `underline`, `false` for `highlightVal` (no
 * highlight), and `'auto'` for `colorHex`. Explicit "off" declarations
 * (`w:b w:val="0"`, `w:u w:val="none"`, `w:highlight w:val="none"`,
 * `w:color w:val="auto"`) resolve to the same values, and like any other
 * declaration they stop inheritance: `w:color w:val="auto"` on a run hides a
 * character style's red, and `w:highlight w:val="none"` hides its highlight.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/752
 */
export type RunFormatting = {
  bold: boolean | null;
  italic: boolean | null;
  caps: boolean | null;
  smallCaps: boolean | null;
  strike: boolean | null;
  emboss: boolean | null;
  imprint: boolean | null;
  outline: boolean | null;
  shadow: boolean | null;
  vanish: boolean | null;
  underline: boolean | null;
  highlightVal: string | false | null;
  fontName: string | null;
  fontSizePt: number | null;
  colorHex: string | 'auto' | null;
};

/**
 * Tri-state run formatting resolved from a named style's `basedOn` chain: `null` means no
 * chain member specifies the property (distinct from an explicit `w:val="0"` → `false`).
 * Consumers seeding their own style templates (e.g. the DOCX → ODT converter's `styles.xml`)
 * use `null` to fall back to template defaults instead of overriding them.
 */
export type StyleRunFormatting = {
  bold: boolean | null;
  italic: boolean | null;
  fontName: string | null;
  fontSizePt: number | null;
  colorHex: string | null;
};

/** Resolve a named style's effective run formatting through its `basedOn` chain. */
export function extractStyleRunFormatting(
  styles: StylesModel,
  styleId: string | null,
): StyleRunFormatting {
  const rPrs = resolveStyleChain(styles, styleId).map((s) => s.rPr);
  return {
    bold: firstNonNull(rPrs.map((rPr) => parseBoolProp(rPr, W.b))),
    italic: firstNonNull(rPrs.map((rPr) => parseBoolProp(rPr, W.i))),
    fontName: firstNonNull(rPrs.map((rPr) => parseFontName(rPr))),
    fontSizePt: firstNonNull(rPrs.map(parseFontSizePt)),
    colorHex: firstNonNull(rPrs.map((rPr) => parseColorHex(rPr))),
  };
}

function parseBoolProp(parent: Element | null, tagLocal: string): boolean | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, tagLocal);
  if (!el) return null;
  // <w:b/> implies true. <w:b w:val="0"/> implies false. 'off' is the
  // transitional OOXML ST_OnOff spelling; documents produced by older writers
  // still carry it, and reading it as "on" would invert the property.
  const v = getWAttr(el, 'val');
  if (v === '0' || v === 'false' || v === 'off') return false;
  return true;
}

type ToggleStep = {
  /** The layer's `w:rPr`, read for the toggle being resolved. */
  rPr?: Element | null;
  /**
   * A layer whose declaration is already merged from several `w:rPr`
   * containers (the table style with its conditional formatting). Used in
   * place of `rPr` when present.
   */
  declare?: (tagLocal: string) => boolean | null;
  kind: 'default' | 'style' | 'table' | 'direct';
};

/**
 * Evaluate a toggle property in hierarchy order. Document defaults seed the
 * starting value; style-level true values invert the accumulated state while
 * style-level false values preserve it; direct formatting sets an absolute
 * value.
 *
 * Microsoft's ISO/IEC 29500 implementation note for §17.7.3 says Word falls
 * back to the document defaults when a hierarchy level supplies no value and
 * treats the document-default value as the base for subsequent parity.
 * MS-OE376 §2.7.7 documents a separate Word deviation for paragraph styles but
 * does not make `w:docDefaults` another toggling style level. So defaults seed
 * the state rather than invert it.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.3
 * @see https://github.com/UseJunior/safe-docx/issues/737
 * @see https://github.com/UseJunior/safe-docx/issues/753
 * @see https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/f7130225-2368-48f3-acae-a9d278d0fb25
 * @see https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/f936abaf-a9cb-439b-923d-7f688d9202e9
 */
function resolveToggleProperty(steps: ToggleStep[], tagLocal: string): boolean {
  let effective = false;
  for (const { rPr, declare, kind } of steps) {
    const declaration = declare ? declare(tagLocal) : parseBoolProp(rPr ?? null, tagLocal);
    if (declaration === null) continue;
    // A table style resets the toggle to its declared value (Word; see the
    // MS-OI29500 note on § 17.7.6), like the default and direct levels.
    if (kind === 'style') {
      if (declaration) effective = !effective;
    } else {
      effective = declaration;
    }
  }
  return effective;
}

/**
 * Conditional formatting types (ST_TblStyleOverrideType, § 17.18.89) in the
 * order Word applies them; each later type overrides the ones before it.
 * `wholeTable` always applies and sits below all of them.
 *
 * ECMA-376 § 17.7.6 lists whole table, column bands, row bands, first/last
 * row, first/last column, then the corner cells. Microsoft's implementation
 * note for § 17.7.6.6 records that Office instead applies row bands, column
 * bands, first/last column, first/last row, then the corners. This follows
 * Office, the renderer whose output the resolver is meant to report.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.6
 * @see https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/2ac331d4-cf1e-4fa0-8bca-6da74411e284
 */
const CONDITIONAL_ORDER = [
  'band1Horz',
  'band2Horz',
  'band1Vert',
  'band2Vert',
  'firstCol',
  'lastCol',
  'firstRow',
  'lastRow',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
] as const;
type ConditionalType = (typeof CONDITIONAL_ORDER)[number];

/**
 * The table's `w:tblLook` switches. Banding is
 * expressed positively: `hBand` is `!noHBand`.
 */
type TableLook = {
  firstRow: boolean;
  lastRow: boolean;
  firstColumn: boolean;
  lastColumn: boolean;
  hBand: boolean;
  vBand: boolean;
};

const WORD_DEFAULT_TABLE_LOOK = 0x04a0;

function tableLookFromBits(bits: number): TableLook {
  return {
    firstRow: (bits & 0x0020) !== 0,
    lastRow: (bits & 0x0040) !== 0,
    firstColumn: (bits & 0x0080) !== 0,
    lastColumn: (bits & 0x0100) !== 0,
    hBand: (bits & 0x0200) === 0,
    vBand: (bits & 0x0400) === 0,
  };
}

/**
 * Read `w:tblLook`. The explicit attributes win; the transitional `w:val`
 * hex bitmask is read only when none of them is present (0x0020 first row,
 * 0x0040 last row, 0x0080 first column, 0x0100 last column, 0x0200 no
 * horizontal banding, 0x0400 no vertical banding). An absent attribute is
 * off.
 *
 * When the table has no `w:tblLook`, the standard assumes 0x0000 but Word
 * assumes 0x04A0 (first row, first column, no vertical banding); this
 * follows Word, the renderer whose output the resolver reports.
 *
 * @see https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/90f075ce-b16d-422a-b1b0-39c9777a594e
 */
function parseTableLook(el: Element | null): TableLook {
  if (!el) return tableLookFromBits(WORD_DEFAULT_TABLE_LOOK);
  const named = ['firstRow', 'lastRow', 'firstColumn', 'lastColumn', 'noHBand', 'noVBand'].map((a) =>
    getWAttr(el, a),
  );
  if (named.some((v) => v !== null)) {
    const on = (v: string | null): boolean => v !== null && isOnValue(v);
    const [firstRow, lastRow, firstColumn, lastColumn, noHBand, noVBand] = named;
    return {
      firstRow: on(firstRow!),
      lastRow: on(lastRow!),
      firstColumn: on(firstColumn!),
      lastColumn: on(lastColumn!),
      hBand: !on(noHBand!),
      vBand: !on(noVBand!),
    };
  }
  const raw = getWAttr(el, 'val');
  return tableLookFromBits(raw && /^[0-9A-Fa-f]{1,4}$/u.test(raw) ? Number.parseInt(raw, 16) : 0);
}

function nearestAncestor(node: Node, localName: string, stopAt: string | null = null): Element | null {
  for (let cur = node.parentNode; cur; cur = cur.parentNode) {
    if (cur.nodeType !== 1) continue;
    const el = cur as Element;
    if (el.namespaceURI !== OOXML.W_NS) continue;
    if (el.localName === localName) return el;
    if (stopAt && el.localName === stopAt) return null;
  }
  return null;
}

/**
 * Visit the `w:tr` rows of a table (or `w:tc` cells of a row) in document
 * order, or in reverse with `fromEnd`, looking through the content-control
 * and custom-XML wrappers that may enclose them. Stops early when `visit`
 * returns true.
 */
function walkTableChildren(
  parent: Element,
  localName: 'tr' | 'tc',
  visit: (el: Element) => boolean | void,
  fromEnd = false,
): boolean {
  for (let c = fromEnd ? parent.lastChild : parent.firstChild; c; c = fromEnd ? c.previousSibling : c.nextSibling) {
    if (c.nodeType !== 1 || (c as Element).namespaceURI !== OOXML.W_NS) continue;
    const child = c as Element;
    if (child.localName === localName) {
      if (visit(child)) return true;
    } else if (child.localName === 'sdt') {
      const content = ownChild(child, 'sdtContent');
      if (content && walkTableChildren(content, localName, visit, fromEnd)) return true;
    } else if (child.localName === 'customXml') {
      if (walkTableChildren(child, localName, visit, fromEnd)) return true;
    }
  }
  return false;
}

function edgeTableChild(parent: Element, localName: 'tr' | 'tc', fromEnd: boolean): Element | null {
  let found: Element | null = null;
  walkTableChildren(
    parent,
    localName,
    (el) => {
      found = el;
      return true;
    },
    fromEnd,
  );
  return found;
}

function tableChildIndex(parent: Element, localName: 'tr' | 'tc', target: Element): number {
  let index = 0;
  let found = -1;
  walkTableChildren(parent, localName, (el) => {
    if (el === target) {
      found = index;
      return true;
    }
    index++;
    return false;
  });
  return found;
}

function intVal(parent: Element | null, localName: string, fallback: number): number {
  const el = parent ? ownChild(parent, localName) : null;
  const v = el ? Number.parseInt(getWAttr(el, 'val') ?? '', 10) : Number.NaN;
  return Number.isSafeInteger(v) && v >= 0 ? v : fallback;
}

function bandSize(sources: Array<Element | null>, localName: string): number {
  for (const tblPr of sources) {
    const v = intVal(tblPr, localName, 0);
    if (v > 0) return v;
  }
  return 1;
}

/**
 * The cell's span of table grid columns. A row's `w:gridBefore` skips grid
 * columns before its first cell (§ 17.4.15) and each cell covers
 * `w:gridSpan` columns, so the first physical cell is not always the first
 * column. The grid width is the table's `w:tblGrid`, or the row's own extent
 * when the table has none.
 */
function cellGridSpan(tbl: Element, tr: Element, tc: Element): { start: number; end: number; gridCount: number } {
  const trPr = ownChild(tr, W.trPr);
  let col = intVal(trPr, 'gridBefore', 0);
  let start = -1;
  let end = -1;
  walkTableChildren(tr, 'tc', (cell) => {
    const span = Math.max(1, intVal(ownChild(cell, W.tcPr), 'gridSpan', 1));
    if (cell === tc) {
      start = col;
      end = col + span;
    }
    col += span;
  });
  const grid = ownChild(tbl, W.tblGrid);
  const gridCols = grid ? childElements(grid, 'gridCol').length : 0;
  const gridCount = gridCols > 0 ? gridCols : col + intVal(trPr, 'gridAfter', 0);
  return { start, end, gridCount };
}

type CellPosition = {
  isFirstRow: boolean;
  isLastRow: boolean;
  /** Row index for banding; computed only when row banding can apply. */
  rowIndex: () => number;
  /** First grid column the cell covers. */
  colStart: number;
  isLastCol: boolean;
  rowBandSize: number;
  colBandSize: number;
};

/**
 * Which conditional types apply to a cell, given the `w:tblLook` in force
 * for its row. Corner types need both of their edges switched on (MS-OI29500
 * note on § 17.7.6). Banding counts rows (grid columns) after the header row
 * (first column) when that is switched on, in groups of
 * `w:tblStyleRowBandSize` (`w:tblStyleColBandSize`). `rowBandsUsed` skips
 * the row-index walk when the style has no row-band conditional.
 */
function applicableConditionals(
  pos: CellPosition,
  look: TableLook,
  rowBandsUsed: boolean,
): Set<ConditionalType> {
  const out = new Set<ConditionalType>();
  const isFirstCol = pos.colStart === 0;
  if (look.hBand && rowBandsUsed) {
    const idx = pos.rowIndex() - (look.firstRow ? 1 : 0);
    if (idx >= 0) out.add(Math.floor(idx / pos.rowBandSize) % 2 === 0 ? 'band1Horz' : 'band2Horz');
  }
  if (look.vBand) {
    const idx = pos.colStart - (look.firstColumn ? 1 : 0);
    if (idx >= 0) out.add(Math.floor(idx / pos.colBandSize) % 2 === 0 ? 'band1Vert' : 'band2Vert');
  }
  if (look.firstColumn && isFirstCol) out.add('firstCol');
  if (look.lastColumn && pos.isLastCol) out.add('lastCol');
  if (look.firstRow && pos.isFirstRow) out.add('firstRow');
  if (look.lastRow && pos.isLastRow) out.add('lastRow');
  if (look.firstRow && look.firstColumn && pos.isFirstRow && isFirstCol) out.add('nwCell');
  if (look.firstRow && look.lastColumn && pos.isFirstRow && pos.isLastCol) out.add('neCell');
  if (look.lastRow && look.firstColumn && pos.isLastRow && isFirstCol) out.add('swCell');
  if (look.lastRow && look.lastColumn && pos.isLastRow && pos.isLastCol) out.add('seCell');
  return out;
}

/**
 * The table-style `w:rPr` layers for one set of applicable conditionals,
 * highest precedence first: the applied conditional types from last to first
 * in {@link CONDITIONAL_ORDER}, then `wholeTable`, then the style's own
 * `w:rPr`. Within each, the derived style precedes its `basedOn` ancestors.
 */
function tableStyleLayers(chain: StyleDef[], applied: Set<ConditionalType>): Element[] {
  const layers: Element[] = [];
  const types: string[] = [...CONDITIONAL_ORDER].filter((t) => applied.has(t)).reverse();
  types.push('wholeTable');
  for (const type of types) {
    for (const style of chain) {
      const rPr = style.conditionalRPrs?.get(type);
      if (rPr) layers.push(rPr);
    }
  }
  for (const style of chain) if (style.rPr) layers.push(style.rPr);
  return layers;
}

/**
 * The table-style layers for a run, highest precedence first (see
 * {@link tableStyleLayers}); empty when the run is not in a table or the
 * table has no style.
 *
 * The table style is the table's `w:tblStyle`, or the default table style
 * when it names none (or names one that does not exist). The innermost
 * table governs a run in a nested table. Which conditionals apply is
 * computed from the cell's position and the table's `w:tblLook`. The
 * `w:cnfStyle` elements on paragraphs, rows and cells are not consulted: the
 * standard describes them as an optimization that records the outcome, and
 * the position and `w:tblLook` determine it.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.6
 * @see https://github.com/UseJunior/safe-docx/issues/1159
 */
function tableStyleLayersForRun(run: Element, styles: StylesModel): Element[] {
  const tc = nearestAncestor(run, W.tc, W.tbl);
  const tr = tc ? nearestAncestor(tc, W.tr, W.tbl) : null;
  const tbl = tr ? nearestAncestor(tr, W.tbl) : null;
  if (!tc || !tr || !tbl) return [];

  // Direct children only: a nested w:tblPrChange holds the previous state.
  const tblPr = ownChild(tbl, W.tblPr);
  const tblStyleEl = tblPr ? ownChild(tblPr, 'tblStyle') : null;
  const named = tblStyleEl ? getWAttr(tblStyleEl, 'val') : null;
  const styleId =
    named && styles.byId.get(named)?.styleType === 'table' ? named : (styles.defaultTableStyleId ?? null);
  const chain = resolveStyleChain(styles, styleId).filter((st) => st.styleType === 'table');
  if (chain.length === 0) return [];
  if (!chain.some((st) => st.conditionalRPrs && st.conditionalRPrs.size > 0)) {
    return tableStyleLayers(chain, new Set());
  }

  // A row's w:tblPrEx/w:tblLook overrides the table's for that row (§ 17.4.54).
  const tblPrEx = ownChild(tr, 'tblPrEx');
  const lookEl = (tblPrEx ? ownChild(tblPrEx, 'tblLook') : null) ?? (tblPr ? ownChild(tblPr, 'tblLook') : null);
  const bandSources = [tblPr, ...chain.map((st) => st.tblPr ?? null)];
  const { start, end, gridCount } = cellGridSpan(tbl, tr, tc);
  const pos: CellPosition = {
    isFirstRow: edgeTableChild(tbl, 'tr', false) === tr,
    isLastRow: edgeTableChild(tbl, 'tr', true) === tr,
    rowIndex: () => tableChildIndex(tbl, 'tr', tr),
    colStart: start,
    isLastCol: end === gridCount,
    rowBandSize: bandSize(bandSources, 'tblStyleRowBandSize'),
    colBandSize: bandSize(bandSources, 'tblStyleColBandSize'),
  };
  const rowBandsUsed = chain.some((st) => st.conditionalRPrs?.has('band1Horz') || st.conditionalRPrs?.has('band2Horz'));
  return tableStyleLayers(chain, applicableConditionals(pos, parseTableLook(lookEl), rowBandsUsed));
}

function parseUnderline(parent: Element | null): boolean | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.u);
  if (!el) return null;
  const v = getWAttr(el, 'val');
  if (!v) return true;
  return v !== 'none';
}

function parseFontName(parent: Element | null, theme: ThemeModel | null = null): string | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.rFonts);
  if (!el) return null;
  for (const attribute of ['asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme']) {
    const reference = getWAttr(el, attribute);
    const resolved = reference ? theme?.fonts.get(reference) : null;
    if (resolved) return resolved;
  }
  return getWAttr(el, 'ascii') ?? getWAttr(el, 'hAnsi') ?? getWAttr(el, 'cs') ?? getWAttr(el, 'val') ?? null;
}

function parseFontSizePt(parent: Element | null): number | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.sz);
  if (!el) return null;
  const valStr = getWAttr(el, 'val') || el.getAttribute('val');
  if (!valStr) return null;
  const v = Number.parseInt(valStr, 10);
  if (Number.isNaN(v)) return null;
  // OOXML stores half-points.
  return v / 2.0;
}

function applyThemeColorTransform(hex: string, tint: string | null, shade: string | null): string {
  const tintByte = tint && /^[0-9A-Fa-f]{2}$/u.test(tint) ? Number.parseInt(tint, 16) : null;
  const shadeByte = shade && /^[0-9A-Fa-f]{2}$/u.test(shade) ? Number.parseInt(shade, 16) : null;
  const transform = (component: number): number => {
    let value = component;
    if (shadeByte !== null) value = value * (shadeByte / 255);
    if (tintByte !== null) value = 255 - (255 - value) * (tintByte / 255);
    return Math.max(0, Math.min(255, Math.round(value)));
  };
  return [0, 2, 4]
    .map((offset) => transform(Number.parseInt(hex.slice(offset, offset + 2), 16)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function parseColorHex(parent: Element | null, theme: ThemeModel | null = null): string | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.color);
  if (!el) return null;
  const themeReference = getWAttr(el, 'themeColor');
  const themeHex = themeReference ? theme?.colors.get(themeReference) : null;
  if (themeHex) {
    return applyThemeColorTransform(
      themeHex,
      getWAttr(el, 'themeTint'),
      getWAttr(el, 'themeShade'),
    );
  }
  const v = getWAttr(el, 'val') || el.getAttribute('val');
  if (!v || v === 'auto') return null;
  return v;
}

function parseHighlightVal(parent: Element | null): string | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.highlight);
  if (!el) return null;
  const v = getWAttr(el, 'val');
  if (!v || v === 'none') return null;
  return v;
}

/**
 * Marks a layer that *does* declare a property whose value cannot be
 * established — a theme colour or theme font with no theme to resolve it
 * against. Resolution stops at that layer (a lower layer must not show
 * through) and the property is reported as unresolved.
 */
const DECLARED_UNRESOLVED: unique symbol = Symbol('declared-unresolved');
type Declared<T> = T | typeof DECLARED_UNRESOLVED;

/**
 * `'auto'` for a declared automatic colour, the hex otherwise, `null` if
 * undeclared, {@link DECLARED_UNRESOLVED} for a theme colour reference that
 * resolves neither through the theme nor through an explicit hex `w:val`.
 */
function parseEffectiveColorHex(parent: Element | null, theme: ThemeModel | null): Declared<string> | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.color);
  if (!el) return null;
  const hex = parseColorHex(parent, theme);
  if (hex !== null) return hex;
  return getWAttr(el, 'themeColor') ? DECLARED_UNRESOLVED : 'auto';
}

/**
 * The font name, `null` if `w:rFonts` names none, or {@link DECLARED_UNRESOLVED}
 * when it names the Latin font only through a theme reference that does not
 * resolve and carries no explicit `w:ascii` / `w:hAnsi` fallback.
 */
function parseEffectiveFontName(parent: Element | null, theme: ThemeModel | null): Declared<string> | null {
  const name = parseFontName(parent, theme);
  if (name !== null || !parent) return name;
  const el = getFirstChild(parent, OOXML.W_NS, W.rFonts);
  if (!el) return null;
  return getWAttr(el, 'asciiTheme') || getWAttr(el, 'hAnsiTheme') ? DECLARED_UNRESOLVED : null;
}

/** `false` for a declared `none`, the value otherwise, `null` if undeclared. */
function parseEffectiveHighlightVal(parent: Element | null): string | false | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.highlight);
  if (!el) return null;
  return parseHighlightVal(parent) ?? false;
}

/**
 * Resolve the run formatting a reader actually sees, not merely the formatting
 * the run declares. Ordinary properties are taken from the first layer that
 * specifies them: direct `w:rPr` on the run, then the `w:rStyle`
 * character-style `basedOn` chain, then the paragraph mark's `w:rPr` inside
 * `pPr`, then the paragraph style's `basedOn` chain, then — for a run inside
 * a table — the table style, and finally the document defaults
 * (`w:docDefaults/w:rPrDefault/w:rPr`).
 *
 * Each property is resolved independently down the chain — a style that
 * specifies only color does not mask an ancestor's bold.
 *
 * Toggle properties are evaluated in hierarchy order rather than by ordinary
 * nearest-wins inheritance. At style level, an on declaration inverts the
 * accumulated state and an off declaration preserves it. Direct formatting
 * is absolute. This parity rule applies independently to `w:b`, `w:i`,
 * `w:caps`, `w:smallCaps`, `w:strike`, `w:emboss`, `w:imprint`, `w:outline`,
 * `w:shadow`, and `w:vanish`.
 *
 * Document defaults seed toggle evaluation as an absolute base value rather
 * than acting as another parity level (see {@link resolveToggleProperty}).
 *
 * Table styles (#1159): the table context is read from the run's ancestors —
 * the innermost `w:tbl`, its `w:tblStyle` (or the default table style), the
 * `basedOn` chain, `w:tblLook`, and the cell's row and column. The style's
 * `w:rPr` and every conditional `w:tblStylePr/w:rPr` that applies to the
 * cell merge into one layer between the document defaults and the paragraph
 * style (see {@link tableStyleLayers} for the order). For toggles the
 * merged layer's nearest declaration resets the value rather than toggling
 * it: the standard says a table style toggles like any other style, but Word
 * assigns the declared value (MS-OI29500 note on § 17.7.6), and this follows
 * Word.
 *
 * @see https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/14452bbe-be4d-4dbb-90e6-3d23ae9361bc
 *
 * Numbering-level `rPr` formats only the list label (`w:lvlText`), never the
 * paragraph's runs, so it is out of scope.
 *
 * Part of docx-core's public surface (see `src/index.ts`) so external
 * diagnostics — `scripts/check_docx_formatting_loss.mjs` today, the planned
 * formatting-convention detector (#687) — consume this one implementation
 * instead of growing declared-properties re-implementations that drift.
 *
 * @param params.run the `w:r` element (a non-run element yields style/paragraph
 *   contributions only)
 * @param params.paragraphPPr the owning paragraph's `w:pPr`, or null
 * @param params.paragraphStyleId the `w:val` of `pPr/w:pStyle`, or null
 * @param params.styles the model produced by {@link parseStylesXml}
 * @param params.theme the model produced by {@link parseThemeXml}; when
 *   omitted, direct font/color fallbacks retain their previous behavior
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.5.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.6
 * @see https://github.com/UseJunior/safe-docx/issues/737
 * @see https://github.com/UseJunior/safe-docx/issues/752
 * @see https://github.com/UseJunior/safe-docx/issues/753
 * @see https://github.com/UseJunior/safe-docx/issues/1159
 */
export function extractEffectiveRunFormatting(params: {
  run: Element;
  paragraphPPr: Element | null;
  paragraphStyleId: string | null;
  styles: StylesModel;
  theme?: ThemeModel | null;
}): RunFormatting {
  const { run, paragraphPPr, paragraphStyleId, styles, theme = null } = params;
  const isRun = run.localName === W.r || run.localName === 'r';
  const rPr = isRun ? getFirstChild(run, OOXML.W_NS, W.rPr) : null;
  const pRPr = paragraphPPr ? getFirstChild(paragraphPPr, OOXML.W_NS, W.rPr) : null;

  // Resolve w:rStyle character style chain (e.g. "Strong" → bold via style definition).
  const rStyleEl = rPr ? getFirstChild(rPr, OOXML.W_NS, W.rStyle) : null;
  const rStyleId = rStyleEl ? (getWAttr(rStyleEl, 'val') ?? null) : null;
  const rStyleChain = resolveStyleChain(styles, rStyleId);
  const paragraphStyleChain = resolveStyleChain(styles, paragraphStyleId);

  // Priority: direct rPr → rStyle chain rPrs → paragraph mark rPr → paragraph
  // style chain rPrs → table style (when in a table) → document defaults.
  // Each property resolves independently down this list: a chain member that
  // specifies only color must not mask an ancestor's bold, so the sources are
  // the individual rPr containers, never "the first chain member that has an
  // rPr" (peer review on #684; extractStyleRunFormatting above already
  // resolved per property).
  const sourcesAboveDefaults: Array<Element | null> = [
    rPr,
    ...rStyleChain.map((s) => s.rPr),
    pRPr,
    ...paragraphStyleChain.map((s) => s.rPr),
  ];
  const docDefaultsRPr = styles.docDefaultsRPr ?? null;

  const tableLayers = tableStyleLayersForRun(run, styles);

  // Apply from the document defaults through the table style and the least
  // specific paragraph-style ancestor to direct run formatting.
  // Paragraph-mark rPr is direct formatting at its hierarchy level; a
  // character style can still contribute above it before the run's own rPr
  // supplies the final absolute override.
  const toggleSteps: ToggleStep[] = [
    { rPr: docDefaultsRPr, kind: 'default' },
    {
      declare: (tagLocal) => firstNonNull(tableLayers.map((layer) => parseBoolProp(layer, tagLocal))),
      kind: 'table',
    },
    ...[...paragraphStyleChain].reverse().map((style) => ({ rPr: style.rPr, kind: 'style' as const })),
    { rPr: pRPr, kind: 'direct' },
    ...[...rStyleChain].reverse().map((style) => ({ rPr: style.rPr, kind: 'style' as const })),
    { rPr, kind: 'direct' },
  ];
  const toggle = (tagLocal: string): boolean => resolveToggleProperty(toggleSteps, tagLocal);
  const sources = [...sourcesAboveDefaults, ...tableLayers];
  /**
   * Nearest declaration above the document defaults (table style
   * included); otherwise the document default, otherwise `ooxmlDefault`
   * (`null` for a property with no OOXML default).
   */
  const resolveLayered = <T>(
    parse: (el: Element | null) => Declared<T> | null,
    ooxmlDefault: T | null,
  ): T | null => {
    const value = firstNonNull(sources.map(parse)) ?? parse(docDefaultsRPr) ?? ooxmlDefault;
    return value === DECLARED_UNRESOLVED ? null : value;
  };
  return {
    bold: toggle(W.b),
    italic: toggle(W.i),
    caps: toggle(W.caps),
    smallCaps: toggle(W.smallCaps),
    strike: toggle(W.strike),
    emboss: toggle(W.emboss),
    imprint: toggle(W.imprint),
    outline: toggle(W.outline),
    shadow: toggle(W.shadow),
    vanish: toggle(W.vanish),
    underline: resolveLayered(parseUnderline, false),
    highlightVal: resolveLayered<string | false>(parseEffectiveHighlightVal, false),
    // No OOXML default: the rendered font and size are application-defined
    // when nothing declares them, so an undeclared value stays unresolved.
    fontName: resolveLayered((el) => parseEffectiveFontName(el, theme), null),
    fontSizePt: resolveLayered(parseFontSizePt, null),
    colorHex: resolveLayered<string>((el) => parseEffectiveColorHex(el, theme), 'auto'),
  };
}

/**
 * Effective run formatting for annotation bodies (comments, footnotes), whose
 * `tagged_text` is emitted in `full` mode and read back by docx-markdoc.
 * Toggles, underline and highlight resolve through every layer, document
 * defaults included. Colour, size and font are reported only when a layer
 * above `w:docDefaults` declares them, otherwise as not declared (`'auto'` /
 * `null`), so the inherited document font is not tagged as `face` on every run
 * and a direct value that restates the document default is still emitted
 * over a character style that would otherwise show through on import.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/753
 */
export function extractAnnotationRunFormatting(params: {
  run: Element;
  paragraphPPr: Element | null;
  paragraphStyleId: string | null;
  styles: StylesModel;
  theme?: ThemeModel | null;
}): RunFormatting {
  const effective = extractEffectiveRunFormatting(params);
  const declared = extractEffectiveRunFormatting({
    ...params,
    styles: { ...params.styles, docDefaultsRPr: null },
  });
  return {
    ...effective,
    colorHex: declared.colorHex,
    fontSizePt: declared.fontSizePt,
    fontName: declared.fontName,
  };
}
