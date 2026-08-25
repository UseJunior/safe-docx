import { OOXML, W } from './namespaces.js';
import { getAttributeSafe, getFirstChild } from './xml-helpers.js';

function getWAttr(el: Element, localName: string): string | null {
  // Preserve legacy truthy fallback for empty strings from namespace-bound reads
  // when attributes were written without a real namespace binding.
  return getAttributeSafe(el, OOXML.W_NS, localName, 'w', { emptyIsMissing: true });
}

export type StyleDef = {
  styleId: string;
  styleType: string | null;
  name: string;
  basedOn: string | null;
  pPr: Element | null;
  rPr: Element | null;
};

export type StylesModel = {
  byId: Map<string, StyleDef>;
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
      styleType: getWAttr(st, 'type'),
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
  caps: boolean;
  smallCaps: boolean;
  strike: boolean;
  emboss: boolean;
  imprint: boolean;
  outline: boolean;
  shadow: boolean;
  vanish: boolean;
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
  rPr: Element | null;
  kind: 'style' | 'direct';
};

/**
 * Evaluate a toggle property in hierarchy order. Style-level true values
 * invert the accumulated state while style-level false values preserve it;
 * direct formatting sets an absolute value.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.3
 * @see https://github.com/UseJunior/safe-docx/issues/737
 */
function resolveToggleProperty(steps: ToggleStep[], tagLocal: string): boolean {
  let effective = false;
  for (const { rPr, kind } of steps) {
    const declaration = parseBoolProp(rPr, tagLocal);
    if (declaration === null) continue;
    if (kind === 'direct') {
      effective = declaration;
    } else if (declaration) {
      effective = !effective;
    }
  }
  return effective;
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
 * Resolve the run formatting a reader actually sees, not merely the formatting
 * the run declares. Ordinary properties are taken from the first layer that
 * specifies them: direct `w:rPr` on the run, then the `w:rStyle`
 * character-style `basedOn` chain, then the paragraph mark's `w:rPr` inside
 * `pPr`, then the paragraph style's `basedOn` chain. A property specified
 * nowhere resolves to the neutral value (`false`, `''`, `0`, or `null`).
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
 * Not resolved: `w:docDefaults`, table-style run properties, and
 * numbering-level `rPr`. A formatting change confined to one of those layers
 * is invisible to this resolver.
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
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.3
 * @see https://github.com/UseJunior/safe-docx/issues/737
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
  // style chain rPrs. Each property resolves independently down this list: a
  // chain member that specifies only color must not mask an ancestor's bold,
  // so the sources are the individual rPr containers, never "the first chain
  // member that has an rPr" (peer review on #684; extractStyleRunFormatting
  // above already resolved per property).
  const sources: Array<Element | null> = [
    rPr,
    ...rStyleChain.map((s) => s.rPr),
    pRPr,
    ...paragraphStyleChain.map((s) => s.rPr),
  ];
  const resolve = <T>(parse: (el: Element | null) => T | null): T | null =>
    firstNonNull(sources.map(parse));

  // Apply from the least specific style ancestor to direct run formatting.
  // Paragraph-mark rPr is direct formatting at its hierarchy level; a
  // character style can still contribute above it before the run's own rPr
  // supplies the final absolute override.
  const toggleSteps: ToggleStep[] = [
    ...[...paragraphStyleChain].reverse().map((style) => ({ rPr: style.rPr, kind: 'style' as const })),
    { rPr: pRPr, kind: 'direct' },
    ...[...rStyleChain].reverse().map((style) => ({ rPr: style.rPr, kind: 'style' as const })),
    { rPr, kind: 'direct' },
  ];

  return {
    bold: resolveToggleProperty(toggleSteps, W.b),
    italic: resolveToggleProperty(toggleSteps, W.i),
    caps: resolveToggleProperty(toggleSteps, W.caps),
    smallCaps: resolveToggleProperty(toggleSteps, W.smallCaps),
    strike: resolveToggleProperty(toggleSteps, W.strike),
    emboss: resolveToggleProperty(toggleSteps, W.emboss),
    imprint: resolveToggleProperty(toggleSteps, W.imprint),
    outline: resolveToggleProperty(toggleSteps, W.outline),
    shadow: resolveToggleProperty(toggleSteps, W.shadow),
    vanish: resolveToggleProperty(toggleSteps, W.vanish),
    underline: resolve(parseUnderline) ?? false,
    highlightVal: resolve(parseHighlightVal),
    fontName: resolve((el) => parseFontName(el, theme)) ?? '',
    fontSizePt: resolve(parseFontSizePt) ?? 0,
    colorHex: resolve((el) => parseColorHex(el, theme)),
  };
}
