#!/usr/bin/env node
/**
 * Structural formatting-loss detectors for a before/after .docx pair (issue #682).
 *
 * The comparison failure taxonomy classified failures as a throw, phantom
 * markup, silent content loss, or a degraded-but-valid redline. None of those
 * cover the class where *formatting* is destroyed while the text survives, and
 * that class is invisible to every check the diagnostic procedure routinely
 * runs: extracted text comes back byte-identical, round-trip reports success,
 * and the document opens cleanly in Word. Two observed shapes:
 *
 *   D1 run-formatting flattening — a replacement whose span crosses a run
 *      boundary collapses the boundary and drops bold/italic from the affected
 *      span. Detected per paragraph by projecting each character of the
 *      paragraph onto its *effective* formatting tuple (the supported toggle
 *      properties, underline, highlight, font, size, color), resolved through
 *      word/styles.xml by docx-core's extractEffectiveRunFormatting: if the
 *      text is unchanged but that projection changed, formatting was lost.
 *
 *      Issue #682 sketched D1 as a multiset of runs keyed on
 *      (text, bold, italic, underline). That formulation fires on any run
 *      boundary move, including moves that preserve every character's emphasis
 *      — which this codebase produces routinely, via atomizer token splitting
 *      and rsid churn (#677). The character projection is invariant to boundary
 *      churn and fires only on actual loss, so it is what shipped.
 *
 *   D2 emptied-but-retained paragraphs — replacing a block leaves paragraph
 *      shells behind. An empty body paragraph renders as a blank line; an empty
 *      list paragraph that keeps its w:numPr renders an orphan numbered label,
 *      which a reader sees and a text diff does not. Both are reported only as
 *      transitions: a paragraph that was already empty before is not a loss
 *      this comparison caused.
 *
 * Paragraphs are matched on w14:paraId rather than on document order because
 * order shifts whenever a comparison inserts or deletes a paragraph, which is
 * exactly the run this check has to survive.
 *
 * That match key is also this tool's sharpest edge, so it is enforced rather
 * than assumed. `reconstructionMode: 'rebuild'` emits output carrying no
 * w14:paraId at all, which matches nothing, finds nothing, and reads as a clean
 * pass. Coverage below --min-coverage is therefore reported as INCONCLUSIVE and
 * exits 2. A detector that cannot see the document must not be able to bless it.
 *
 * Scope of D1. It compares formatting *resolved* through word/styles.xml, not
 * merely the properties a run declares: each character's tuple is
 * docx-core's `extractEffectiveRunFormatting` — direct w:rPr, then the
 * w:rStyle chain, then the paragraph mark's rPr, then the paragraph style's
 * basedOn chain (issue #684). Three consequences, all deliberate:
 *
 *   - Editing a style *definition* while every reference stays put is caught,
 *     because the resolved formatting changes even though no run changed.
 *   - Emphasis arriving through paragraph-style inheritance is visible, so
 *     dropping the w:pStyle that carried it is caught.
 *   - Replacing a style reference with equivalent direct properties resolves
 *     identically and is NOT reported — that is a representation difference,
 *     not a loss a reader can see.
 *   - Toggle properties use style-level parity and absolute direct-formatting
 *     semantics, matching the Word differential pinned for issue #737.
 *
 * What the resolver does not reach, this check does not reach: table-style run
 * properties and numbering-level rPr. Document defaults, theme fonts, and
 * colors are resolved, including tint/shade transforms.
 * Because the resolver reduces w:u to on/off, an underline
 * style-to-style change (single to dotted) is no longer reported; the old
 * declared-properties projection caught it, and trading that corner for one
 * shared implementation instead of two that drift is the point of #684.
 *
 * D1 also requires the two paragraphs to carry identical text. Formatting loss
 * that co-occurs with a text edit in the same paragraph is out of its reach.
 *
 * Build order: this script consumes the *built* @usejunior/docx-core workspace
 * package. Run `npm run build` (or `npm run build -w @usejunior/docx-core`)
 * first; an unbuilt tree fails loudly at import rather than resolving stale
 * behavior.
 *
 * Output discipline: this runs over confidential documents. Detector reports
 * emit only counts, w14:paraId values, and element names, and the projection
 * keeps a digest of each paragraph's text rather than the text itself, so even
 * a dump of the intermediate state carries no recoverable prose. Usage and IO
 * errors do echo the paths you passed in.
 *
 * Usage:
 *   node scripts/check_docx_formatting_loss.mjs <before.docx> <after.docx>
 *   node scripts/check_docx_formatting_loss.mjs --self-test
 *   node scripts/check_docx_formatting_loss.mjs --json <before.docx> <after.docx>
 *   node scripts/check_docx_formatting_loss.mjs --min-coverage 0.9 <a.docx> <b.docx>
 *
 * --self-test first proves the detectors fire on a known-bad pair and stay
 * silent on a known-good one. A detector that has never been shown to fire is
 * indistinguishable from no detector, and "no findings" from such a run is not
 * evidence of anything.
 *
 * Exit status: 0 when no detector fires, 1 when any does, 2 on usage or IO
 * error or when coverage is too low for the result to mean anything.
 */

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

// Loaded dynamically so an unbuilt workspace produces this actionable message
// instead of a bare ERR_MODULE_NOT_FOUND pointing at a dist/ path.
let parseStylesXml;
let parseThemeXml;
let extractEffectiveRunFormatting;
try {
  ({ parseStylesXml, parseThemeXml, extractEffectiveRunFormatting } = await import('@usejunior/docx-core'));
} catch (error) {
  throw new Error(
    `check_docx_formatting_loss: @usejunior/docx-core failed to load (${error.message}). ` +
      `This script consumes the built workspace package so formatting resolution cannot drift ` +
      `from the library — run \`npm run build\` (or \`npm run build -w @usejunior/docx-core\`) first.`,
  );
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** Maximum paraIds listed per detector line before the tail is summarized. */
const MAX_LISTED_IDS = 20;

/**
 * Fraction of the larger side's paragraphs that must be matched by paraId
 * before a finding count is worth believing. Real documents fall a little short
 * of 1 because duplicate paraIds occur; rebuild output falls to 0.
 */
const DEFAULT_MIN_COVERAGE = 0.95;

/**
 * Run children that put marks on the page without contributing w:t text. A
 * paragraph holding only one of these is not empty, and reporting it as
 * emptied would flag every image-only paragraph in the document.
 */
const RENDERABLE_RUN_CONTENT = new Set([
  'drawing', 'object', 'pict', 'tab', 'br', 'sym', 'ptab', 'softHyphen', 'noBreakHyphen', 'fldChar', 'instrText',
]);

/** Presence of any of these means the document is a redline, not clean output. */
const REVISION_MARKERS = ['ins', 'del', 'rPrChange', 'pPrChange', 'moveFrom', 'moveTo'];

function elementsByTag(node, localName) {
  return Array.from(node.getElementsByTagNameNS(W_NS, localName));
}

function directChild(element, localName) {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && child.namespaceURI === W_NS && child.localName === localName) {
      return child;
    }
  }
  return undefined;
}

/**
 * The nearest ancestor-or-self w:p. A w:p can nest inside another w:p via a
 * text box (w:txbxContent) or a table cell, so descendant queries have to be
 * filtered by ownership or the outer paragraph absorbs the inner one's runs.
 */
function owningParagraph(node) {
  for (let current = node; current; current = current.parentNode) {
    if (current.nodeType === 1 && current.namespaceURI === W_NS && current.localName === 'p') {
      return current;
    }
  }
  return undefined;
}

function attributeValue(element, namespaceUri, localName) {
  const value = element.getAttributeNS(namespaceUri, localName);
  return value === null || value === '' ? undefined : value;
}

function runText(run, paragraph) {
  let text = '';
  for (const node of elementsByTag(run, 't')) {
    if (owningParagraph(node) === paragraph) text += node.textContent ?? '';
  }
  return text;
}

function runHasRenderableContent(run, paragraph) {
  for (const localName of RENDERABLE_RUN_CONTENT) {
    for (const node of elementsByTag(run, localName)) {
      if (owningParagraph(node) === paragraph) return true;
    }
  }
  return false;
}

/**
 * The tuple D1 projects each character onto: every field of docx-core's
 * effective run formatting, resolved through styles.xml. Two runs whose
 * declarations differ but resolve identically produce the same tuple, and a
 * style-definition edit changes the tuple with no change to the run at all.
 * Nullable fields are pinned to sentinel strings so tuple positions compare
 * by value. Color hex is compared case-insensitively — ff0000 and FF0000 are
 * the same ink, and the raw casing is a property of the writer, not the page.
 */
function runEmphasis(run, paragraphPPr, paragraphStyleId, styles, theme) {
  const formatting = extractEffectiveRunFormatting({ run, paragraphPPr, paragraphStyleId, styles, theme });
  return [
    formatting.bold,
    formatting.italic,
    formatting.caps,
    formatting.smallCaps,
    formatting.strike,
    formatting.emboss,
    formatting.imprint,
    formatting.outline,
    formatting.shadow,
    formatting.vanish,
    formatting.underline,
    formatting.highlightVal ?? 'none',
    formatting.fontName,
    formatting.fontSizePt,
    formatting.colorHex === null ? 'auto' : formatting.colorHex.toUpperCase(),
  ];
}

/**
 * Append `length` characters of `emphasis` to a run-length-encoded projection,
 * merging into the previous span when the emphasis matches. Merging is what
 * makes the encoding canonical, and therefore what makes a plain array
 * comparison equivalent to comparing the two per-character projections.
 */
function appendEmphasisSpan(spans, length, emphasis) {
  if (length === 0) return;
  const previous = spans[spans.length - 1];
  if (previous && emphasis.every((value, index) => previous[index + 1] === value)) {
    previous[0] += length;
    return;
  }
  spans.push([length, ...emphasis]);
}

function sameEmphasisProjection(before, after) {
  if (before.length !== after.length) return false;
  return before.every((span, index) => span.every((value, position) => value === after[index][position]));
}

function parseDocumentPart(documentXml) {
  const errors = [];
  let document;
  try {
    document = new DOMParser({
      onError: (level, message) => {
        if (level === 'error' || level === 'fatalError') errors.push(String(message));
      },
    }).parseFromString(documentXml, 'application/xml');
  } catch (error) {
    throw new Error(`word/document.xml did not parse: ${error.message}`);
  }
  if (errors.length > 0) throw new Error(`word/document.xml did not parse: ${errors[0]}`);

  // A well-formed but structurally wrong part would otherwise project zero
  // paragraphs, and zero paragraphs reads exactly like a clean pass.
  const root = document.documentElement;
  if (!root || root.namespaceURI !== W_NS || root.localName !== 'document') {
    throw new Error('word/document.xml is not a WordprocessingML w:document part');
  }
  if (!directChild(root, 'body')) {
    throw new Error('word/document.xml has no w:body');
  }
  return document;
}

/**
 * Parse word/styles.xml into docx-core's StylesModel. A missing part yields an
 * empty model — resolution degrades to direct properties only — but a part
 * that is present and does not parse fails loudly: silently resolving nothing
 * would make every style-carried loss invisible while reading as a clean pass.
 */
export function parseStylesPart(stylesXml) {
  if (stylesXml === null || stylesXml === undefined) return parseStylesXml(null);
  const errors = [];
  let document;
  try {
    document = new DOMParser({
      onError: (level, message) => {
        if (level === 'error' || level === 'fatalError') errors.push(String(message));
      },
    }).parseFromString(stylesXml, 'application/xml');
  } catch (error) {
    throw new Error(`word/styles.xml did not parse: ${error.message}`);
  }
  if (errors.length > 0) throw new Error(`word/styles.xml did not parse: ${errors[0]}`);
  // A well-formed part with the wrong root would parse to zero styles, and an
  // empty model makes every style-carried loss invisible while reading clean.
  const root = document.documentElement;
  if (!root || root.namespaceURI !== W_NS || root.localName !== 'styles') {
    throw new Error('word/styles.xml is not a WordprocessingML w:styles part');
  }
  return parseStylesXml(document);
}

/** Parse and validate word/theme/theme1.xml for effective font/color resolution. */
export function parseThemePart(themeXml) {
  if (themeXml === null || themeXml === undefined) return parseThemeXml(null);
  const errors = [];
  let document;
  try {
    document = new DOMParser({
      onError: (level, message) => {
        if (level === 'error' || level === 'fatalError') errors.push(String(message));
      },
    }).parseFromString(themeXml, 'application/xml');
  } catch (error) {
    throw new Error(`word/theme/theme1.xml did not parse: ${error.message}`);
  }
  if (errors.length > 0) throw new Error(`word/theme/theme1.xml did not parse: ${errors[0]}`);
  const root = document.documentElement;
  if (!root || root.namespaceURI !== 'http://schemas.openxmlformats.org/drawingml/2006/main' || root.localName !== 'theme') {
    throw new Error('word/theme/theme1.xml is not a DrawingML a:theme part');
  }
  return parseThemeXml(document);
}

/** Revision markup means this is a redline, where "empty" means something else. */
export function findRevisionMarkers(documentXml) {
  const document = parseDocumentPart(documentXml);
  return REVISION_MARKERS.filter((localName) => elementsByTag(document, localName).length > 0);
}

/**
 * Project word/document.xml into the per-paragraph shape both detectors read.
 *
 * Duplicate paraIds are dropped from the match set rather than last-write-wins:
 * two paragraphs sharing an id cannot be told apart, and silently keeping one
 * would report a comparison the tool did not actually make.
 *
 * @param {string} documentXml raw word/document.xml
 * @param {string | null} [stylesXml] raw word/styles.xml; omitted or null
 *   resolves formatting from direct properties only
 * @param {string | null} [themeXml] raw word/theme/theme1.xml; omitted or null
 *   leaves unresolved theme references on their direct fallbacks
 */
export function projectParagraphs(documentXml, stylesXml = null, themeXml = null) {
  const document = parseDocumentPart(documentXml);
  const styles = parseStylesPart(stylesXml);
  const theme = parseThemePart(themeXml);

  const byParaId = new Map();
  const duplicateParaIds = new Set();
  let duplicateParagraphs = 0;
  let unkeyedParagraphs = 0;
  let totalParagraphs = 0;

  for (const paragraph of elementsByTag(document, 'p')) {
    totalParagraphs += 1;
    const paraId = attributeValue(paragraph, W14_NS, 'paraId');
    if (paraId === undefined) {
      unkeyedParagraphs += 1;
      continue;
    }
    if (byParaId.has(paraId) || duplicateParaIds.has(paraId)) {
      if (byParaId.delete(paraId)) duplicateParagraphs += 1;
      duplicateParaIds.add(paraId);
      duplicateParagraphs += 1;
      continue;
    }

    const paragraphProperties = directChild(paragraph, 'pPr');
    const paragraphStyle = paragraphProperties ? directChild(paragraphProperties, 'pStyle') : undefined;
    const paragraphStyleId = paragraphStyle ? (attributeValue(paragraphStyle, W_NS, 'val') ?? null) : null;

    const emphasisSpans = [];
    let text = '';
    let hasRenderableContent = false;
    for (const run of elementsByTag(paragraph, 'r')) {
      if (owningParagraph(run) !== paragraph) continue;
      const ownText = runText(run, paragraph);
      text += ownText;
      // Empty runs (bookmarks, field characters, breaks) span no characters, so
      // they carry no emphasis that could be lost.
      appendEmphasisSpan(
        emphasisSpans,
        ownText.length,
        runEmphasis(run, paragraphProperties ?? null, paragraphStyleId, styles, theme),
      );
      if (!hasRenderableContent && runHasRenderableContent(run, paragraph)) hasRenderableContent = true;
    }

    byParaId.set(paraId, {
      emphasisSpans,
      textDigest: createHash('sha256').update(text).digest('hex'),
      isEmpty: text.trim() === '' && !hasRenderableContent,
      hasNumbering: paragraphProperties ? directChild(paragraphProperties, 'numPr') !== undefined : false,
    });
  }

  return {
    byParaId,
    duplicateParaIds: [...duplicateParaIds].sort(),
    duplicateParagraphs,
    unkeyedParagraphs,
    totalParagraphs,
  };
}

/**
 * Run D1 and D2 over two projections.
 *
 * @param {ReturnType<typeof projectParagraphs>} before
 * @param {ReturnType<typeof projectParagraphs>} after
 * @param {{ minCoverage?: number }} [options]
 */
export function detectFormattingLoss(before, after, options = {}) {
  const minCoverage = options.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const flattenedParagraphIds = [];
  const emptiedParagraphIds = [];
  const orphanNumberingParagraphIds = [];
  let preExistingEmptyNumbered = 0;
  let matchedParagraphs = 0;

  for (const [paraId, beforeParagraph] of before.byParaId) {
    const afterParagraph = after.byParaId.get(paraId);
    if (!afterParagraph) continue;
    matchedParagraphs += 1;

    // D1 — same characters, different emphasis.
    if (
      beforeParagraph.textDigest === afterParagraph.textDigest &&
      !sameEmphasisProjection(beforeParagraph.emphasisSpans, afterParagraph.emphasisSpans)
    ) {
      flattenedParagraphIds.push(paraId);
    }

    // D2 — carried content before, carries none after. Both halves are
    // transitions: a paragraph already empty on the before side is a property
    // of the input, not damage this comparison did.
    if (!beforeParagraph.isEmpty && afterParagraph.isEmpty) {
      emptiedParagraphIds.push(paraId);
      if (afterParagraph.hasNumbering) orphanNumberingParagraphIds.push(paraId);
    } else if (afterParagraph.isEmpty && afterParagraph.hasNumbering) {
      preExistingEmptyNumbered += 1;
    }
  }

  const comparableParagraphs = Math.max(before.totalParagraphs, after.totalParagraphs);
  const coverageRatio = comparableParagraphs === 0 ? 1 : matchedParagraphs / comparableParagraphs;

  return {
    flattenedParagraphIds: flattenedParagraphIds.sort(),
    emptiedParagraphIds: emptiedParagraphIds.sort(),
    orphanNumberingParagraphIds: orphanNumberingParagraphIds.sort(),
    matchedParagraphs,
    preExistingEmptyNumbered,
    coverageRatio,
    minCoverage,
    inconclusive: coverageRatio < minCoverage,
    coverage: {
      beforeTotal: before.totalParagraphs,
      afterTotal: after.totalParagraphs,
      beforeUnkeyed: before.unkeyedParagraphs,
      afterUnkeyed: after.unkeyedParagraphs,
      beforeDuplicateParagraphs: before.duplicateParagraphs,
      afterDuplicateParagraphs: after.duplicateParagraphs,
    },
  };
}

export function hasFindings(result) {
  return (
    result.flattenedParagraphIds.length > 0 ||
    result.emptiedParagraphIds.length > 0 ||
    result.orphanNumberingParagraphIds.length > 0
  );
}

function formatIdList(ids) {
  const listed = ids.slice(0, MAX_LISTED_IDS).join(' ');
  const remaining = ids.length - MAX_LISTED_IDS;
  return remaining > 0 ? `[${listed} (+${remaining} more)]` : `[${listed}]`;
}

/**
 * Render the result as text. Every count is printed even when zero — a detector
 * that reports nothing when it found nothing is indistinguishable from a
 * detector that did not run.
 */
export function formatReport(result) {
  const { coverage } = result;
  const percent = (result.coverageRatio * 100).toFixed(1);
  const lines = [
    `D1 run-formatting flattened paragraphs: ${result.flattenedParagraphIds.length} ${formatIdList(result.flattenedParagraphIds)}`,
    `D2 emptied-but-retained paragraphs: ${result.emptiedParagraphIds.length} ${formatIdList(result.emptiedParagraphIds)}`,
    `D2 empty paragraphs retaining w:numPr: ${result.orphanNumberingParagraphIds.length} ${formatIdList(result.orphanNumberingParagraphIds)}`,
    `coverage: ${result.matchedParagraphs} of ${Math.max(coverage.beforeTotal, coverage.afterTotal)} paragraphs matched by w14:paraId (${percent}%) ` +
      `(before ${coverage.beforeTotal} paragraphs, ${coverage.beforeUnkeyed} unkeyed, ${coverage.beforeDuplicateParagraphs} sharing a duplicate id; ` +
      `after ${coverage.afterTotal} paragraphs, ${coverage.afterUnkeyed} unkeyed, ${coverage.afterDuplicateParagraphs} sharing a duplicate id)`,
  ];

  if (result.preExistingEmptyNumbered > 0) {
    lines.push(
      `note: ${result.preExistingEmptyNumbered} numbered paragraphs were already empty before the change — ` +
        `document hygiene, not loss this comparison caused`,
    );
  }

  if (result.inconclusive) {
    lines.push(
      `INCONCLUSIVE: coverage ${percent}% is below the ${(result.minCoverage * 100).toFixed(1)}% floor, ` +
        `so the counts above describe only a fragment of the document and must not be read as a pass. ` +
        `reconstructionMode 'rebuild' emits no w14:paraId at all; compare an 'inplace' output, ` +
        `or lower the floor with --min-coverage once you have decided what the gap means`,
    );
  }

  return lines;
}

/**
 * Read the parts the projection needs. `stylesXml` is null when the package
 * carries no word/styles.xml — the caller decides whether that degradation is
 * worth telling the user about.
 */
export async function readDocxParts(docxPath) {
  let archive;
  try {
    archive = await JSZip.loadAsync(readFileSync(docxPath));
  } catch (error) {
    throw new Error(`${docxPath} is not a readable .docx package: ${error.message}`);
  }
  const documentEntry = archive.file('word/document.xml');
  if (!documentEntry) throw new Error(`${docxPath} has no word/document.xml`);
  const stylesEntry = archive.file('word/styles.xml');
  const themeEntry = archive.file('word/theme/theme1.xml');
  return {
    documentXml: await documentEntry.async('string'),
    stylesXml: stylesEntry ? await stylesEntry.async('string') : null,
    themeXml: themeEntry ? await themeEntry.async('string') : null,
  };
}

/** Minimal OOXML package used by --self-test and the unit tests. */
export async function buildMinimalDocx(bodyXml, stylesXml = null, themeXml = null) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      (stylesXml === null
        ? ''
        : `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`) +
      (themeXml === null
        ? ''
        : `<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`) +
      `</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );
  zip.file('word/document.xml', wrapBodyXml(bodyXml));
  if (stylesXml !== null) zip.file('word/styles.xml', stylesXml);
  if (themeXml !== null) zip.file('word/theme/theme1.xml', themeXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

export function wrapBodyXml(bodyXml) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:w14="${W14_NS}" mc:Ignorable="w14" ` +
    `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
    `<w:body>${bodyXml}</w:body></w:document>`
  );
}

/** Wrap style definitions into a minimal word/styles.xml part for tests. */
export function wrapStylesXml(styleDefinitionsXml) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${W_NS}">${styleDefinitionsXml}</w:styles>`
  );
}

export function wrapThemeXml(themeElementsXml) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test Theme">` +
    `<a:themeElements>${themeElementsXml}<a:fmtScheme name="Test"/></a:themeElements></a:theme>`
  );
}

/**
 * Known-good and known-bad fixtures for the self-test. The bad side is the
 * shapes this check exists for: a defined term whose cross-run bold was
 * flattened into a single plain run (11111111), a numbered paragraph emptied
 * but kept (22222222), and a heading whose bold arrives only through its
 * paragraph style, lost by editing the style *definition* while the document
 * part stays byte-identical (33333333) — the case a declared-properties
 * projection cannot see. Paragraph 44444444 swaps a character-style reference
 * for equivalent direct bold; it resolves identically on both sides and MUST
 * NOT be reported, proving the detector distinguishes representation
 * differences from losses.
 */
export const SELF_TEST_BEFORE_STYLES = wrapStylesXml(
  `<w:style w:type="paragraph" w:styleId="EmphaticHeading">` +
    `<w:name w:val="Emphatic Heading"/><w:rPr><w:b/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="character" w:styleId="Strong">` +
    `<w:name w:val="Strong"/><w:rPr><w:b/></w:rPr>` +
    `</w:style>`,
);

/** Identical except the paragraph style's bold is gone from the definition. */
export const SELF_TEST_AFTER_STYLES = wrapStylesXml(
  `<w:style w:type="paragraph" w:styleId="EmphaticHeading">` +
    `<w:name w:val="Emphatic Heading"/>` +
    `</w:style>` +
    `<w:style w:type="character" w:styleId="Strong">` +
    `<w:name w:val="Strong"/><w:rPr><w:b/></w:rPr>` +
    `</w:style>`,
);

export const SELF_TEST_BEFORE_BODY =
  `<w:p w14:paraId="11111111">` +
  `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Term</w:t></w:r>` +
  `<w:r><w:t xml:space="preserve"> means the defined thing.</w:t></w:r>` +
  `</w:p>` +
  `<w:p w14:paraId="22222222">` +
  `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>` +
  `<w:r><w:t>A numbered obligation.</w:t></w:r>` +
  `</w:p>` +
  `<w:p w14:paraId="33333333">` +
  `<w:pPr><w:pStyle w:val="EmphaticHeading"/></w:pPr>` +
  `<w:r><w:t>Article heading.</w:t></w:r>` +
  `</w:p>` +
  `<w:p w14:paraId="44444444">` +
  `<w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>Notwithstanding</w:t></w:r>` +
  `</w:p>`;

export const SELF_TEST_AFTER_BODY =
  `<w:p w14:paraId="11111111">` +
  `<w:r><w:t xml:space="preserve">Term means the defined thing.</w:t></w:r>` +
  `</w:p>` +
  `<w:p w14:paraId="22222222">` +
  `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>` +
  `</w:p>` +
  `<w:p w14:paraId="33333333">` +
  `<w:pPr><w:pStyle w:val="EmphaticHeading"/></w:pPr>` +
  `<w:r><w:t>Article heading.</w:t></w:r>` +
  `</w:p>` +
  `<w:p w14:paraId="44444444">` +
  `<w:r><w:rPr><w:b/></w:rPr><w:t>Notwithstanding</w:t></w:r>` +
  `</w:p>`;

async function runSelfTest() {
  const before = projectParagraphs(wrapBodyXml(SELF_TEST_BEFORE_BODY), SELF_TEST_BEFORE_STYLES);
  const after = projectParagraphs(wrapBodyXml(SELF_TEST_AFTER_BODY), SELF_TEST_AFTER_STYLES);

  const unchanged = detectFormattingLoss(
    before,
    projectParagraphs(wrapBodyXml(SELF_TEST_BEFORE_BODY), SELF_TEST_BEFORE_STYLES),
  );
  const damaged = detectFormattingLoss(before, after);

  const failures = [];
  if (hasFindings(unchanged)) {
    failures.push('known-good pair reported findings — the detectors have false positives');
  }
  if (unchanged.inconclusive || damaged.inconclusive) {
    failures.push('self-test fixtures did not reach full coverage — the harness itself is broken');
  }
  const expectedFlattened = ['11111111', '33333333'];
  if (JSON.stringify(damaged.flattenedParagraphIds) !== JSON.stringify(expectedFlattened)) {
    failures.push(
      `D1 misfired on the known-bad pair (got [${damaged.flattenedParagraphIds.join(' ')}], ` +
        `expected [${expectedFlattened.join(' ')}]: direct flattening plus a style-definition edit, ` +
        `and never the equivalent style-to-direct representation swap)`,
    );
  }
  if (damaged.emptiedParagraphIds.length !== 1) {
    failures.push(`D2 emptied did not fire on the known-bad pair (got ${damaged.emptiedParagraphIds.length}, expected 1)`);
  }
  if (damaged.orphanNumberingParagraphIds.length !== 1) {
    failures.push(
      `D2 orphan-numbering did not fire on the known-bad pair (got ${damaged.orphanNumberingParagraphIds.length}, expected 1)`,
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check_docx_formatting_loss: self-test FAILED — ${failure}`);
    return 1;
  }

  console.log(
    'self-test: known-good pair clean, known-bad pair caught by D1 (direct and style-resolved) and both D2 checks, ' +
      'style-vs-direct representation swap correctly not reported',
  );
  for (const line of formatReport(damaged)) console.log(`self-test known-bad ${line}`);
  return 0;
}

const KNOWN_FLAGS = new Set(['--json', '--self-test', '--min-coverage']);

function usage() {
  console.error('usage: check_docx_formatting_loss.mjs [--json] [--min-coverage <0..1>] <before.docx> <after.docx>');
  console.error('       check_docx_formatting_loss.mjs --self-test');
  return 2;
}

export async function main(argv) {
  const positional = [];
  let useJson = false;
  let minCoverage = DEFAULT_MIN_COVERAGE;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--self-test') return runSelfTest();
    if (argument === '--json') {
      useJson = true;
    } else if (argument === '--min-coverage') {
      minCoverage = Number(argv[index + 1]);
      index += 1;
      if (!Number.isFinite(minCoverage) || minCoverage < 0 || minCoverage > 1) {
        console.error('check_docx_formatting_loss: --min-coverage takes a fraction between 0 and 1');
        return 2;
      }
    } else if (argument.startsWith('--') && !KNOWN_FLAGS.has(argument)) {
      // Silently ignoring an unknown flag lets a typo'd threshold read as a pass.
      console.error(`check_docx_formatting_loss: unknown option ${argument}`);
      return usage();
    } else {
      positional.push(argument);
    }
  }

  if (positional.length !== 2) return usage();

  let result;
  try {
    const [beforeParts, afterParts] = await Promise.all(positional.map(readDocxParts));
    for (const [path, parts] of [[positional[0], beforeParts], [positional[1], afterParts]]) {
      const markers = findRevisionMarkers(parts.documentXml);
      if (markers.length > 0) {
        throw new Error(
          `${path} carries revision markup (${markers.map((name) => `w:${name}`).join(', ')}). ` +
            `These detectors read clean output — in a redline, deleted text is still present ` +
            `and "empty" does not mean what D2 assumes. Accept or reject the revisions first.`,
        );
      }
      if (parts.stylesXml === null) {
        // Degraded, not fatal: without styles.xml every style resolves to
        // nothing, so a loss carried by a style definition cannot be seen.
        console.error(
          `check_docx_formatting_loss: note — ${path} has no word/styles.xml; ` +
            `formatting is resolved from direct properties only for that side`,
        );
      }
    }
    result = detectFormattingLoss(
      projectParagraphs(beforeParts.documentXml, beforeParts.stylesXml, beforeParts.themeXml),
      projectParagraphs(afterParts.documentXml, afterParts.stylesXml, afterParts.themeXml),
      { minCoverage },
    );
  } catch (error) {
    console.error(`check_docx_formatting_loss: ${error.message}`);
    return 2;
  }

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const line of formatReport(result)) console.log(line);
  }

  if (result.inconclusive) return 2;
  return hasFindings(result) ? 1 : 0;
}

function invokedDirectly() {
  // A node_modules/.bin symlink makes import.meta.url and argv[1] differ, so
  // both sides are resolved through realpath before comparison.
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = await main(process.argv.slice(2));
}
