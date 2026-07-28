import { OOXML, W } from './namespaces.js';
import { getAttributeSafe, getFirstChild } from './xml-helpers.js';

function getWAttr(el: Element, localName: string): string | null {
  // Preserve legacy truthy fallback for empty strings from namespace-bound reads
  // when attributes were written without a real namespace binding.
  return getAttributeSafe(el, OOXML.W_NS, localName, 'w', { emptyIsMissing: true });
}

export type StyleDef = {
  styleId: string;
  name: string;
  basedOn: string | null;
  pPr: Element | null;
  rPr: Element | null;
};

export type StylesModel = {
  byId: Map<string, StyleDef>;
};

export function parseStylesXml(stylesDoc: Document | null): StylesModel {
  const byId = new Map<string, StyleDef>();
  if (!stylesDoc) return { byId };

  const styles = Array.from(stylesDoc.getElementsByTagNameNS(OOXML.W_NS, W.style));
  for (const st of styles) {
    const id = getWAttr(st, 'styleId');
    if (!id) continue;
    const nameEl = getFirstChild(st, OOXML.W_NS, W.name);
    const basedOnEl = getFirstChild(st, OOXML.W_NS, W.basedOn);
    const pPr = getFirstChild(st, OOXML.W_NS, W.pPr);
    const rPr = getFirstChild(st, OOXML.W_NS, W.rPr);

    const name = nameEl ? (getWAttr(nameEl, 'val') ?? id) : id;
    const basedOn = basedOnEl ? (getWAttr(basedOnEl, 'val') ?? null) : null;

    byId.set(id, {
      styleId: id,
      name,
      basedOn,
      pPr: pPr ?? null,
      rPr: rPr ?? null,
    });
  }
  return { byId };
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

export type RunFormatting = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlightVal: string | null;
  fontName: string;
  fontSizePt: number;
  colorHex: string | null;
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
    fontName: firstNonNull(rPrs.map(parseFontName)),
    fontSizePt: firstNonNull(rPrs.map(parseFontSizePt)),
    colorHex: firstNonNull(rPrs.map(parseColorHex)),
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

function parseUnderline(parent: Element | null): boolean | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.u);
  if (!el) return null;
  const v = getWAttr(el, 'val');
  if (!v) return true;
  return v !== 'none';
}

function parseFontName(parent: Element | null): string | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.rFonts);
  if (!el) return null;
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

function parseColorHex(parent: Element | null): string | null {
  if (!parent) return null;
  const el = getFirstChild(parent, OOXML.W_NS, W.color);
  if (!el) return null;
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
 * Resolve the run formatting a reader actually sees, not merely the formatting
 * the run declares. Each property is taken from the first layer that specifies
 * it: direct `w:rPr` on the run, then the `w:rStyle` character-style `basedOn`
 * chain, then the paragraph mark's `w:rPr` inside `pPr`, then the paragraph
 * style's `basedOn` chain. A property specified nowhere resolves to the
 * neutral value (`false`, `''`, `0`, or `null`).
 *
 * Each property is resolved independently down the chain — a style that
 * specifies only color does not mask an ancestor's bold.
 *
 * OOXML toggle properties (`w:b`, `w:i`) are resolved as a
 * nearest-declaration cascade: the first tier that specifies the property
 * wins, and an explicit off (`w:val` of `0`/`false`/`off`) at a nearer tier
 * defeats a more distant on. This is deliberately simpler than full OOXML
 * toggle-property evaluation, in which a style-level true XORs against the
 * accumulated state and a style-level false leaves it unchanged — repeated
 * toggle declarations across style levels can therefore resolve differently
 * here than in Word. The previous container-level resolver applied the same
 * nearest-value rule, so this is a stated limit, not a regression.
 *
 * Not resolved: `w:docDefaults`, table-style run properties, numbering-level
 * `rPr`, and theme font references (`w:asciiTheme` etc., which would need
 * `theme1.xml`). A formatting change confined to one of those layers is
 * invisible to this resolver.
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
 */
export function extractEffectiveRunFormatting(params: {
  run: Element;
  paragraphPPr: Element | null;
  paragraphStyleId: string | null;
  styles: StylesModel;
}): RunFormatting {
  const { run, paragraphPPr, paragraphStyleId, styles } = params;
  const isRun = run.localName === W.r || run.localName === 'r';
  const rPr = isRun ? getFirstChild(run, OOXML.W_NS, W.rPr) : null;
  const pRPr = paragraphPPr ? getFirstChild(paragraphPPr, OOXML.W_NS, W.rPr) : null;

  // Resolve w:rStyle character style chain (e.g. "Strong" → bold via style definition).
  const rStyleEl = rPr ? getFirstChild(rPr, OOXML.W_NS, W.rStyle) : null;
  const rStyleId = rStyleEl ? (getWAttr(rStyleEl, 'val') ?? null) : null;

  // Priority: direct rPr → rStyle chain rPrs → paragraph mark rPr → paragraph
  // style chain rPrs. Each property resolves independently down this list: a
  // chain member that specifies only color must not mask an ancestor's bold,
  // so the sources are the individual rPr containers, never "the first chain
  // member that has an rPr" (peer review on #684; extractStyleRunFormatting
  // above already resolved per property).
  const sources: Array<Element | null> = [
    rPr,
    ...resolveStyleChain(styles, rStyleId).map((s) => s.rPr),
    pRPr,
    ...resolveStyleChain(styles, paragraphStyleId).map((s) => s.rPr),
  ];
  const resolve = <T>(parse: (el: Element | null) => T | null): T | null =>
    firstNonNull(sources.map(parse));

  return {
    bold: resolve((el) => parseBoolProp(el, W.b)) ?? false,
    italic: resolve((el) => parseBoolProp(el, W.i)) ?? false,
    underline: resolve(parseUnderline) ?? false,
    highlightVal: resolve(parseHighlightVal),
    fontName: resolve(parseFontName) ?? '',
    fontSizePt: resolve(parseFontSizePt) ?? 0,
    colorHex: resolve(parseColorHex),
  };
}
