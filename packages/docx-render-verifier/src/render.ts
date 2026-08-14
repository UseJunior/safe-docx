import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import type { AdjacentRevisionBoundary, PaginationProfile, PixelMeasurement, RenderRequest, RendererTools, RenderVerdict, TextBindingEvidence, ToolResult } from './types.js';

const execFileAsync = promisify(execFile);
const BLUE = [0, 0, 255] as const;
const RED = [255, 0, 0] as const;
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL_PREFIX = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function tokenizeRenderedText(value: string): string[] {
  // PDF extraction is a content oracle, not a pagination oracle. Line
  // wrapping, page breaks, form feeds, and indentation legitimately vary by
  // renderer, so bind whitespace-delimited tokens while layout remains the
  // separate image-review domain.
  return value.split(/\s+/u).filter((token) => token.length > 0);
}

function countTokens(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

const PAGE_FIELD_INSTRUCTION = /\b(?:PAGE|NUMPAGES|SECTIONPAGES|PAGEREF)\b/u;
const NUMERIC_TOKEN = /^[0-9]+$/u;
const BINDING_SAMPLE_LIMIT = 8;

export function emptyPaginationProfile(pageCount: number): PaginationProfile {
  return { pageCount, headerFooterTokenCounts: new Map(), headerFooterPageFieldCount: 0, bodyPageFieldCount: 0, pageNumberUpperBound: pageCount };
}

function isReservablePageNumber(token: string, pagination: PaginationProfile): boolean {
  if (!NUMERIC_TOKEN.test(token)) return false;
  const value = Number.parseInt(token, 10);
  return value >= 1 && value <= pagination.pageNumberUpperBound;
}

/**
 * Story-scoped text binding: per-page maximal reservation of pagination
 * artifacts, then multiset containment of the caller's logical projection.
 *
 * Invariant:
 * 1. Pagination-first reservation — the extracted PDF text is split into
 *    rendered pages (form feeds). On each page, pagination-owned material is
 *    reserved FIRST and MAXIMALLY: each referenced header/footer story token
 *    up to its occurrence count in those stories, and numeric page-number
 *    renderings (integer value within the rendered page-number range) up to
 *    the header/footer PAGE-family field count per page plus a
 *    whole-document budget for body-story PAGE-family fields.
 * 2. Completeness lower bound — every whitespace-delimited token of the
 *    caller's logical projection must be covered by the tokens REMAINING
 *    after reservation. Because reservation is maximal, repeated header or
 *    footer vocabulary can never substitute for genuinely missing logical
 *    content: dropping any logical token still fails.
 * 3. Zero residue — every remaining token beyond the projection is
 *    unexplained and fails, so duplicated or hallucinated rendered content
 *    also fails.
 *
 * Accepted limitations, all in the strict (fail-not-pass) direction or
 * covered by a separate check:
 * - Reading order is not checked by this automated verdict; LibreOffice emits
 *   text in renderer-created page and float positions that a logical DOCX
 *   projection cannot predict. The emitted review PNGs support optional human
 *   placement review; no automated placement comparison happens here.
 * - Header/footer story text is pagination-owned and reserved, not itself
 *   bound; revision visibility inside headers is covered by the pixel and
 *   revision-markup path.
 * - A bare integer in body text that falls within the rendered page-number
 *   range may be attributed to pagination, which can only cause a failure,
 *   never a false pass.
 *
 * The pagination profile is derived from the rendered artifact and the
 * rendered DOCX package only — never from the caller's projection or from any
 * Safe DOCX generator — so the binding stays an independent oracle.
 *
 * Adjacent-revision whitespace tolerance: LibreOffice and `pdftotext` do not
 * expose a stable whitespace-delimited token boundary between neighbouring
 * deletion and insertion spans, so the extracted PDF may render `OldNew`
 * where the projection has `Old New` (or vice versa). After the strict
 * multiset pass, each OOXML-declared adjacent revision junction may explain
 * AT MOST ONE merge (rendered `leftToken+rightToken` standing for the
 * projection's separate `leftToken` and `rightToken`) or ONE split (the
 * reverse). The tolerance never removes whitespace globally, never absorbs
 * missing or duplicated lexical content — the substitution must balance the
 * exact junction tokens on both sides — and applies only at junctions the
 * emitted tracked OOXML proves lie between adjacent visible revision spans.
 */
export function bindLogicalMarkupText(expectedMarkupText: string, pdfText: string, pagination: PaginationProfile, revisionBoundaries: readonly AdjacentRevisionBoundary[] = []): TextBindingEvidence {
  const expectedCounts = countTokens(tokenizeRenderedText(expectedMarkupText));
  const bodyAvailable = new Map<string, number>();
  let bodyFieldBudget = pagination.bodyPageFieldCount;
  const pageNumberStart = pagination.pageNumberUpperBound - pagination.pageCount + 1;
  for (const [pageIndex, page] of pdfText.split('\f').entries()) {
    const remaining = new Map<string, number>();
    for (const [token, count] of countTokens(tokenizeRenderedText(page))) {
      const afterStories = count - Math.min(count, pagination.headerFooterTokenCounts.get(token) ?? 0);
      if (afterStories > 0) remaining.set(token, afterStories);
    }
    let pageNumericBudget = pagination.headerFooterPageFieldCount;
    const reserveNumeric = (token: string): void => {
      let available = remaining.get(token) ?? 0;
      while (available > 0 && (pageNumericBudget > 0 || bodyFieldBudget > 0)) {
        if (pageNumericBudget > 0) pageNumericBudget--;
        else bodyFieldBudget--;
        available--;
      }
      remaining.set(token, available);
    };
    // Attribute the page's own PAGE rendering and the NUMPAGES total before
    // any other in-range numeral, so a bare body integer is not attributed to
    // pagination while the actual page number goes unaccounted.
    for (const preferred of new Set([String(pageNumberStart + pageIndex), String(pagination.pageNumberUpperBound)])) {
      if (isReservablePageNumber(preferred, pagination)) reserveNumeric(preferred);
    }
    for (const token of [...remaining.keys()]) {
      if (isReservablePageNumber(token, pagination)) reserveNumeric(token);
    }
    for (const [token, count] of remaining) {
      if (count > 0) bodyAvailable.set(token, (bodyAvailable.get(token) ?? 0) + count);
    }
  }
  const deficits = new Map<string, number>();
  for (const [token, expected] of expectedCounts) {
    const shortfall = expected - (bodyAvailable.get(token) ?? 0);
    if (shortfall > 0) deficits.set(token, shortfall);
  }
  const surpluses = new Map<string, number>();
  for (const [token, available] of bodyAvailable) {
    const excess = available - (expectedCounts.get(token) ?? 0);
    if (excess > 0) surpluses.set(token, excess);
  }
  let revisionBoundaryNormalizationCount = 0;
  for (const { leftToken, rightToken } of revisionBoundaries) {
    if (leftToken.length === 0 || rightToken.length === 0) continue;
    const joined = `${leftToken}${rightToken}`;
    // Renderer concatenated the junction (projection separated), or the
    // reverse. Each declared junction may explain at most one such swap, and
    // the swap must balance the exact junction tokens on both sides — a
    // dropped or duplicated token elsewhere still surfaces as residue.
    if (applyBoundaryNormalization(deficits, [leftToken, rightToken], surpluses, [joined])
      || applyBoundaryNormalization(deficits, [joined], surpluses, [leftToken, rightToken])) {
      revisionBoundaryNormalizationCount++;
    }
  }
  const missingTokens = [...deficits.keys()];
  const unexplainedTokens = [...surpluses.keys()];
  return {
    matched: missingTokens.length === 0 && unexplainedTokens.length === 0,
    pageCount: pagination.pageCount,
    missingTokenSample: missingTokens.slice(0, BINDING_SAMPLE_LIMIT),
    unexplainedTokenSample: unexplainedTokens.slice(0, BINDING_SAMPLE_LIMIT),
    declaredRevisionBoundaryCount: revisionBoundaries.length,
    revisionBoundaryNormalizationCount,
  };
}

function hasTokenCounts(counts: ReadonlyMap<string, number>, tokens: readonly string[]): boolean {
  const needed = countTokens(tokens);
  for (const [token, count] of needed) {
    if ((counts.get(token) ?? 0) < count) return false;
  }
  return true;
}

function consumeTokenCounts(counts: Map<string, number>, tokens: readonly string[]): void {
  for (const token of tokens) {
    const remaining = (counts.get(token) ?? 0) - 1;
    if (remaining <= 0) counts.delete(token);
    else counts.set(token, remaining);
  }
}

/**
 * Atomically consume one whitespace swap at a declared adjacent revision
 * junction: the deficit side and the surplus side must BOTH hold the exact
 * junction tokens, otherwise nothing is consumed and the mismatch stays a
 * binding failure.
 */
function applyBoundaryNormalization(deficits: Map<string, number>, deficitTokens: readonly string[], surpluses: Map<string, number>, surplusTokens: readonly string[]): boolean {
  if (!hasTokenCounts(deficits, deficitTokens) || !hasTokenCounts(surpluses, surplusTokens)) return false;
  consumeTokenCounts(deficits, deficitTokens);
  consumeTokenCounts(surpluses, surplusTokens);
  return true;
}

function profileXml(mode: 'configured' | 'by-author'): string {
  // Writer reads redline display preferences from this user-profile subtree.
  // -1 asks Writer for its normal per-author color, giving us a same-input
  // negative control. Values are configuration, never DOCX run properties.
  const insertColor = mode === 'configured' ? '255' : '-1'; // #0000ff
  const deleteColor = mode === 'configured' ? '16711680' : '-1'; // #ff0000
  return `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema">
 <item oor:path="/org.openoffice.Office.Writer/Revision/TextDisplay/Insert"><prop oor:name="Attribute" oor:op="fuse"><value>3</value></prop><prop oor:name="Color" oor:op="fuse"><value>${insertColor}</value></prop></item>
 <item oor:path="/org.openoffice.Office.Writer/Revision/TextDisplay/Delete"><prop oor:name="Attribute" oor:op="fuse"><value>3</value></prop><prop oor:name="Color" oor:op="fuse"><value>${deleteColor}</value></prop></item>
</oor:items>`;
}

export function defaultRendererTools(): RendererTools {
  const candidates: Record<'soffice' | 'pdftotext' | 'pdftoppm' | 'magick', string[]> = {
    soffice: [process.env.SAFE_DOCX_SOFFICE_BIN ?? '', '/opt/homebrew/bin/soffice', '/usr/bin/soffice', '/usr/local/bin/soffice'],
    pdftotext: ['/opt/homebrew/bin/pdftotext', '/usr/bin/pdftotext', '/usr/local/bin/pdftotext'],
    pdftoppm: ['/opt/homebrew/bin/pdftoppm', '/usr/bin/pdftoppm', '/usr/local/bin/pdftoppm'],
    magick: ['/opt/homebrew/bin/magick', '/usr/bin/magick', '/usr/local/bin/magick'],
  };
  return {
    resolve(name) { return candidates[name].find((candidate) => candidate.length > 0 && existsSync(candidate)) ?? null; },
    async run(command, args, cwd) {
      try {
        const result = await execFileAsync(command, args, { cwd, timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
        return { code: 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
      } catch (error) {
        const failure = error as { code?: number; stdout?: unknown; stderr?: unknown; message?: string };
        return { code: typeof failure.code === 'number' ? failure.code : 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? failure.message ?? '') };
      }
    },
  };
}

function inColourBand(actual: readonly number[], expected: readonly number[]): boolean {
  // PDF antialiasing over a white page makes a blue glyph e.g. #a7a7ff rather
  // than #0000ff. Measure a saturated hue band instead of exact RGB points.
  if (expected === BLUE) return actual[2]! - Math.max(actual[0]!, actual[1]!) >= 40;
  return actual[0]! - Math.max(actual[1]!, actual[2]!) >= 40;
}

/** Parse ImageMagick txt:- output after bounded downsampling. */
export function measurePixelBands(pixelListing: string): PixelMeasurement {
  let sampledPixels = 0;
  let bluePixels = 0;
  let redPixels = 0;
  for (const line of pixelListing.split('\n')) {
    const match = /#([0-9a-fA-F]{6})\b/u.exec(line);
    if (!match?.[1]) continue;
    sampledPixels++;
    const hex = match[1];
    const rgb = [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
    if (inColourBand(rgb, BLUE)) bluePixels++;
    if (inColourBand(rgb, RED)) redPixels++;
  }
  return { sampledPixels, bluePixels, redPixels };
}

function configuredContrast(configured: PixelMeasurement, control: PixelMeasurement, floor: number): boolean {
  const blueFloor = Math.max(floor, Math.ceil(control.bluePixels * 1.5));
  const redFloor = Math.max(floor, Math.ceil(control.redPixels * 1.5));
  return configured.bluePixels >= blueFloor && configured.redPixels >= redFloor;
}

function revisionVisibility(configured: PixelMeasurement, control: PixelMeasurement, floor: number): NonNullable<RenderVerdict['revisionVisibility']> {
  const blueFloor = Math.max(floor, Math.ceil(control.bluePixels * 1.5));
  const redFloor = Math.max(floor, Math.ceil(control.redPixels * 1.5));
  if (configured.bluePixels >= blueFloor && configured.redPixels < redFloor) return 'hidden-deletions';
  if (configured.bluePixels >= blueFloor && configured.redPixels >= redFloor) return 'visible';
  return 'insufficient-contrast';
}

type RenderedStory = { name: string; kind: 'document' | 'header' | 'footer' | 'footnotes' | 'endnotes' };

type RenderedPackageEvidence = {
  revisionMarkup: { insertions: boolean; deletions: boolean };
  pagination: PaginationProfile;
  revisionBoundaries: AdjacentRevisionBoundary[];
};

const WHITESPACE_CHAR = /\s/u;

function revisionSpanFamily(element: XmlElement): 'deletion' | 'insertion' | undefined {
  if (element.namespaceURI !== W_NS) return undefined;
  if (element.localName === 'del' || element.localName === 'moveFrom') return 'deletion';
  if (element.localName === 'ins' || element.localName === 'moveTo') return 'insertion';
  return undefined;
}

/**
 * Placeholder for content that may render a glyph this projection cannot
 * model as text: footnote and endnote reference marks, inline drawings, VML
 * pictures, embedded objects, symbol runs, resultless fields, foreign markup,
 * and any element not on the explicit non-rendering allowlist. The
 * placeholder is non-whitespace, so such content between two revision spans
 * blocks junction declaration (the OOXML cannot prove the spans render
 * adjacently), and such content at a junction edge produces fragments no PDF
 * token can match — both strictly in the fail-not-pass direction.
 */
const VISIBLE_GLYPH_PLACEHOLDER = '￼';

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/**
 * Elements the OOXML wordprocessing vocabulary defines as pure range
 * markers, properties, or field plumbing that never render glyphs of their
 * own. Only members of this allowlist may sit between two revision spans
 * without blocking junction declaration; everything unrecognized fails closed
 * as a possible glyph.
 */
const NON_RENDERING_ELEMENTS = new Set([
  'p', 'pPr', 'rPr', 'sectPr', 'instrText', 'delInstrText', 'proofErr',
  'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference',
  'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd',
  'customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart', 'customXmlDelRangeEnd',
  'permStart', 'permEnd', 'lastRenderedPageBreak', 'softHyphen', 'sdtPr', 'sdtEndPr',
]);

/** Containers whose rendered content is exactly the rendered content of their children. */
const CONTENT_CONTAINER_ELEMENTS = new Set([
  'r', 'ins', 'del', 'moveFrom', 'moveTo', 'hyperlink', 'smartTag', 'sdt', 'sdtContent',
  'customXml', 'ruby', 'rubyBase', 'rt', 'bdo', 'dir',
]);

/**
 * Visible rendering of one element as Writer displays it with tracked changes
 * shown: `w:t`/`w:delText` text, whitespace for tab and break glyphs, and a
 * fail-closed placeholder for anything that may render a non-text glyph.
 * Content of a nested paragraph (for example inside a text box) belongs to
 * that paragraph's own stream, and drawings and pictures contribute a single
 * placeholder rather than their embedded text.
 */
function elementVisibleContribution(element: XmlElement): string {
  if (element.namespaceURI !== W_NS) {
    // Markup-compatibility wrappers pass through (both branches contribute,
    // which can only over-block); all other foreign markup fails closed.
    return element.namespaceURI === MC_NS ? visibleCharacterStream(element) : VISIBLE_GLYPH_PLACEHOLDER;
  }
  switch (element.localName) {
    case 't':
    case 'delText':
      return element.textContent ?? '';
    case 'tab':
    case 'br':
    case 'cr':
    case 'ptab':
      return ' ';
    case 'fldSimple': {
      // A field renders its computed result. A cached result approximates it;
      // a resultless field still renders something, so it fails closed.
      const cached = visibleCharacterStream(element);
      return cached.length > 0 ? cached : VISIBLE_GLYPH_PLACEHOLDER;
    }
    default:
      if (NON_RENDERING_ELEMENTS.has(element.localName ?? '')) return '';
      if (CONTENT_CONTAINER_ELEMENTS.has(element.localName ?? '')) return visibleCharacterStream(element);
      return VISIBLE_GLYPH_PLACEHOLDER;
  }
}

/** Concatenated visible contributions of an element's child elements. */
function visibleCharacterStream(element: XmlElement): string {
  let stream = '';
  for (let child = element.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    stream += elementVisibleContribution(child as XmlElement);
  }
  return stream;
}

/**
 * Junctions where the emitted tracked OOXML proves a visible deletion-family
 * span and a visible insertion-family span are adjacent without intervening
 * whitespace or visible content. Only these positions are eligible for the
 * optional-whitespace tolerance in `bindLogicalMarkupText`; ordinary run
 * splits, same-family adjacency, and junctions that already carry whitespace
 * declare nothing.
 */
function collectAdjacentRevisionBoundaries(document: NonNullable<ReturnType<typeof parseStoryXml>>): AdjacentRevisionBoundary[] {
  const boundaries: AdjacentRevisionBoundary[] = [];
  for (const paragraph of Array.from(document.getElementsByTagNameNS(W_NS, 'p'))) {
    const segments: Array<{ family: 'deletion' | 'insertion' | undefined; start: number; end: number }> = [];
    let stream = '';
    for (let child = paragraph.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const childElement = child as XmlElement;
      const text = elementVisibleContribution(childElement);
      segments.push({ family: revisionSpanFamily(childElement), start: stream.length, end: stream.length + text.length });
      stream += text;
    }
    for (let index = 0; index < segments.length; index++) {
      const left = segments[index]!;
      if (left.family === undefined || left.end === left.start) continue;
      // Skip siblings that render nothing (bookmarks, proofing marks, empty
      // runs); the next segment with visible payload is the rendered
      // neighbour.
      let nextIndex = index + 1;
      while (nextIndex < segments.length && segments[nextIndex]!.end === segments[nextIndex]!.start) nextIndex++;
      if (nextIndex >= segments.length) break;
      const right = segments[nextIndex]!;
      if (right.family === undefined || right.family === left.family) continue;
      const junction = left.end;
      if (WHITESPACE_CHAR.test(stream.charAt(junction - 1)) || WHITESPACE_CHAR.test(stream.charAt(junction))) continue;
      let leftStart = junction;
      while (leftStart > 0 && !WHITESPACE_CHAR.test(stream.charAt(leftStart - 1))) leftStart--;
      let rightEnd = junction;
      while (rightEnd < stream.length && !WHITESPACE_CHAR.test(stream.charAt(rightEnd))) rightEnd++;
      boundaries.push({ leftToken: stream.slice(leftStart, junction), rightToken: stream.slice(junction, rightEnd) });
    }
  }
  return boundaries;
}

async function analyzeRenderedPackage(bytes: Buffer, pageCount: number): Promise<RenderedPackageEvidence> {
  const fallback: RenderedPackageEvidence = { revisionMarkup: { insertions: false, deletions: false }, pagination: emptyPaginationProfile(pageCount), revisionBoundaries: [] };
  try {
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (documentXml === undefined) return fallback;
    const renderedStories = await referencedRenderedStories(zip, documentXml);
    let insertions = false;
    let deletions = false;
    const headerFooterTokenCounts = new Map<string, number>();
    const revisionBoundaries: AdjacentRevisionBoundary[] = [];
    let headerFooterPageFieldCount = 0;
    let bodyPageFieldCount = 0;
    let pageNumberStart = 1;
    for (const story of renderedStories) {
      const xml = await zip.file(story.name)?.async('string');
      if (xml === undefined) continue;
      insertions ||= hasVisibleRevisionInStory(xml, ['ins', 'moveTo']);
      deletions ||= hasVisibleRevisionInStory(xml, ['del', 'moveFrom']);
      const document = parseStoryXml(xml);
      if (document === null) continue;
      const isPaginationStory = story.kind === 'header' || story.kind === 'footer';
      if (isPaginationStory) headerFooterPageFieldCount += pageFieldInstructionCount(document);
      else bodyPageFieldCount += pageFieldInstructionCount(document);
      // Header/footer story text is pagination-owned and reserved wholesale,
      // so only body-layer stories can declare whitespace-optional junctions.
      if (!isPaginationStory) revisionBoundaries.push(...collectAdjacentRevisionBoundaries(document));
      if (story.kind === 'document') {
        for (const numbering of Array.from(document.getElementsByTagNameNS(W_NS, 'pgNumType'))) {
          const start = Number.parseInt(numbering.getAttributeNS(W_NS, 'start') ?? '', 10);
          if (Number.isInteger(start) && start > pageNumberStart) pageNumberStart = start;
        }
      }
      if (!isPaginationStory) continue;
      for (const localName of ['t', 'delText'] as const) {
        for (const text of Array.from(document.getElementsByTagNameNS(W_NS, localName))) {
          // A cached field result (e.g. the stored "1" of a PAGE fldSimple) is
          // not literal story text: at render time the field value replaces
          // it. Counting it would double-reserve alongside the numeric
          // page-field budget and could eat a legitimate body token.
          if (hasFieldResultAncestor(text)) continue;
          for (const token of tokenizeRenderedText(text.textContent ?? '')) {
            headerFooterTokenCounts.set(token, (headerFooterTokenCounts.get(token) ?? 0) + 1);
          }
        }
      }
    }
    return {
      revisionMarkup: { insertions, deletions },
      pagination: {
        pageCount,
        headerFooterTokenCounts,
        headerFooterPageFieldCount,
        bodyPageFieldCount,
        pageNumberUpperBound: pageCount + pageNumberStart - 1,
      },
      revisionBoundaries,
    };
  } catch {
    return fallback;
  }
}

function parseStoryXml(xml: string): ReturnType<DOMParser['parseFromString']> | null {
  try {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    return document.getElementsByTagName('parsererror').length > 0 ? null : document;
  } catch {
    return null;
  }
}

function hasFieldResultAncestor(node: XmlElement): boolean {
  for (let ancestor = node.parentNode; ancestor !== null; ancestor = ancestor.parentNode) {
    if (ancestor.nodeType === 1 && (ancestor as XmlElement).namespaceURI === W_NS && (ancestor as XmlElement).localName === 'fldSimple') return true;
  }
  return false;
}

function pageFieldInstructionCount(document: NonNullable<ReturnType<typeof parseStoryXml>>): number {
  let count = 0;
  for (const instruction of Array.from(document.getElementsByTagNameNS(W_NS, 'instrText'))) {
    if (PAGE_FIELD_INSTRUCTION.test(instruction.textContent ?? '')) count++;
  }
  for (const field of Array.from(document.getElementsByTagNameNS(W_NS, 'fldSimple'))) {
    if (PAGE_FIELD_INSTRUCTION.test(field.getAttributeNS(W_NS, 'instr') ?? '')) count++;
  }
  return count;
}

async function referencedRenderedStories(zip: JSZip, documentXml: string): Promise<RenderedStory[]> {
  const stories: RenderedStory[] = [{ name: 'word/document.xml', kind: 'document' }];
  const document = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) return stories;
  const referencedIds = new Set<string>();
  for (const localName of ['headerReference', 'footerReference'] as const) {
    for (const reference of Array.from(document.getElementsByTagNameNS(W_NS, localName))) {
      const id = reference.getAttributeNS(R_NS, 'id');
      if (id) referencedIds.add(id);
    }
  }
  const hasFootnotes = document.getElementsByTagNameNS(W_NS, 'footnoteReference').length > 0;
  const hasEndnotes = document.getElementsByTagNameNS(W_NS, 'endnoteReference').length > 0;
  const relationshipsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
  if (relationshipsXml === undefined) return stories;
  const relationships = new DOMParser().parseFromString(relationshipsXml, 'application/xml');
  if (relationships.getElementsByTagName('parsererror').length > 0) return stories;
  for (const relationship of Array.from(relationships.getElementsByTagNameNS(PKG_REL_NS, 'Relationship'))) {
    if (relationship.getAttribute('TargetMode') === 'External') continue;
    const id = relationship.getAttribute('Id');
    const type = relationship.getAttribute('Type');
    const target = relationship.getAttribute('Target');
    if (!id || !type || !target) continue;
    const kind = type.startsWith(OFFICE_REL_PREFIX) ? type.slice(OFFICE_REL_PREFIX.length) : '';
    if (kind !== 'header' && kind !== 'footer' && kind !== 'footnotes' && kind !== 'endnotes') continue;
    const referenced = (kind === 'header' || kind === 'footer') ? referencedIds.has(id)
      : kind === 'footnotes' ? hasFootnotes : hasEndnotes;
    if (!referenced) continue;
    const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('word', target));
    if (zip.file(resolved) && !stories.some((story) => story.name === resolved)) stories.push({ name: resolved, kind });
  }
  return stories;
}

function hasVisibleRevisionInStory(xml: string, wrapperNames: readonly string[]): boolean {
  try {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length > 0) return false;
    const wrappers = wrapperNames.flatMap((localName) => Array.from(document.getElementsByTagNameNS(W_NS, localName)));
    return wrappers.some((wrapper) => hasVisibleRevisionPayload(wrapper));
  } catch {
    return false;
  }
}

function hasVisibleRevisionPayload(wrapper: XmlElement): boolean {
  for (const localName of ['t', 'delText'] as const) {
    for (const text of Array.from(wrapper.getElementsByTagNameNS(W_NS, localName))) {
      const value = text.textContent ?? '';
      const preserve = text.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space') === 'preserve';
      if ((preserve ? value : value.replace(/^[\u0009\u000a\u000d\u0020]+|[\u0009\u000a\u000d\u0020]+$/gu, '')) !== '') return true;
    }
  }
  return ['tab', 'br', 'cr'].some((localName) => wrapper.getElementsByTagNameNS(W_NS, localName).length > 0);
}

async function configureProfile(profile: string, mode: 'configured' | 'by-author'): Promise<void> {
  const user = path.join(profile, 'user');
  await mkdir(user, { recursive: true });
  await writeFile(path.join(user, 'registrymodifications.xcu'), profileXml(mode));
}

async function renderPdf(tools: RendererTools, soffice: string, profile: string, docx: string, output: string): Promise<ToolResult> {
  await mkdir(output, { recursive: true });
  return tools.run(soffice, ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(profile).href}`, '--convert-to', 'pdf:writer_pdf_Export', '--outdir', output, docx]);
}

async function renderOne(
  tools: RendererTools,
  soffice: string,
  docx: string,
  workspace: string,
  mode: 'configured' | 'by-author',
): Promise<{ pdfPath: string; profile: string }> {
  const profile = path.join(workspace, `${mode}-profile`);
  const output = path.join(workspace, `${mode}-pdf`);
  await configureProfile(profile, mode);
  const result = await renderPdf(tools, soffice, profile, docx, output);
  const pdfPath = path.join(output, `${path.basename(docx, path.extname(docx))}.pdf`);
  if (result.code !== 0 || !existsSync(pdfPath)) throw new Error(`LibreOffice ${mode} render failed: ${(result.stderr || result.stdout).trim() || 'no PDF output'}`);
  return { pdfPath, profile };
}

async function extractPdfText(tools: RendererTools, command: string, pdfPath: string): Promise<string> {
  const result = await tools.run(command, ['-layout', pdfPath, '-']);
  if (result.code !== 0) throw new Error(`pdftotext failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

async function measurePdf(tools: RendererTools, pdftoppm: string, magick: string, pdfPath: string, workspace: string, name: string): Promise<{ pixels: PixelMeasurement; pageCount: number }> {
  const prefix = path.join(workspace, name);
  const raster = await tools.run(pdftoppm, ['-png', '-r', '96', pdfPath, prefix]);
  if (raster.code !== 0) throw new Error(`pdftoppm failed: ${(raster.stderr || raster.stdout).trim()}`);
  const directory = path.dirname(prefix);
  const stem = `${path.basename(prefix)}-`;
  const pages = (await readdir(directory))
    .filter((entry) => entry.startsWith(stem) && entry.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (pages.length === 0) throw new Error('pdftoppm produced no page images');
  const total: PixelMeasurement = { sampledPixels: 0, bluePixels: 0, redPixels: 0 };
  for (const page of pages) {
    // Process pages independently so a long agreement cannot overflow the
    // subprocess buffer merely because its revisions begin after page one.
    const pixels = await tools.run(magick, [path.join(directory, page), '-resize', '10%', 'txt:-']);
    if (pixels.code !== 0) throw new Error(`ImageMagick failed: ${(pixels.stderr || pixels.stdout).trim()}`);
    const measured = measurePixelBands(pixels.stdout);
    total.sampledPixels += measured.sampledPixels;
    total.bluePixels += measured.bluePixels;
    total.redPixels += measured.redPixels;
  }
  return { pixels: total, pageCount: pages.length };
}

async function reviewPages(tools: RendererTools, pdftoppm: string, pdfPath: string, outputDir: string, pages: number[]): Promise<string[]> {
  const result: string[] = [];
  for (const page of [...new Set(pages)].filter((entry) => Number.isInteger(entry) && entry > 0).sort((a, b) => a - b)) {
    const prefix = path.join(outputDir, `review-page-${page}`);
    const rendered = await tools.run(pdftoppm, ['-png', '-r', '144', '-f', String(page), '-l', String(page), pdfPath, prefix]);
    const candidates = (await readdir(outputDir))
      .filter((entry) => entry.startsWith(`${path.basename(prefix)}-`) && entry.endsWith('.png'));
    const png = candidates.length === 1 ? path.join(outputDir, candidates[0]!) : '';
    if (rendered.code !== 0 || png.length === 0 || !existsSync(png)) throw new Error(`review-page ${page} rasterization failed`);
    result.push(png);
  }
  return result;
}

/**
 * Render a finished DOCX in two disposable Writer profiles. This module never
 * loads or saves the authoritative DOCX; rendering always consumes a copied or
 * explicitly transformed workspace-only path.
 */
export async function verifyRenderedMarkup(request: RenderRequest): Promise<RenderVerdict> {
  const tools = request.tools ?? defaultRendererTools();
  const trackedBytes = await readFile(request.trackedDocxPath);
  const trackedSha256 = sha256(trackedBytes);
  const missing = (['soffice', 'pdftotext', 'pdftoppm', 'magick'] as const).filter((tool) => !tools.resolve(tool));
  if (missing.length > 0) return { status: 'not_run', reason: `Missing renderer tool(s): ${missing.join(', ')}`, trackedSha256, reviewPngs: [] };

  const soffice = tools.resolve('soffice')!;
  const pdftotext = tools.resolve('pdftotext')!;
  const pdftoppm = tools.resolve('pdftoppm')!;
  const magick = tools.resolve('magick')!;
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'safe-docx-render-'));
  try {
    await mkdir(request.outputDir, { recursive: true });
    const inputPath = path.join(workspace, `tracked${path.extname(request.trackedDocxPath) || '.docx'}`);
    await copyFile(request.trackedDocxPath, inputPath);
    let renderInput = inputPath;
    let transform: RenderVerdict['transform'];
    if (request.transform) {
      const before = sha256(await readFile(request.trackedDocxPath));
      renderInput = await request.transform.apply(inputPath, workspace);
      const after = sha256(await readFile(request.trackedDocxPath));
      const workspaceRoot = `${path.resolve(workspace)}${path.sep}`;
      if (before !== after || !path.resolve(renderInput).startsWith(workspaceRoot) || !(await stat(renderInput)).isFile()) {
        return { status: 'fail', reason: 'Render-only transform attempted to escape its disposable workspace or mutate authoritative DOCX.', trackedSha256, reviewPngs: [] };
      }
      transform = { id: request.transform.id, version: request.transform.version, inputSha256: sha256(await readFile(inputPath)), outputSha256: sha256(await readFile(renderInput)) };
    }
    const renderedInputBytes = await readFile(renderInput);
    const configured = await renderOne(tools, soffice, renderInput, workspace, 'configured');
    const control = await renderOne(tools, soffice, renderInput, workspace, 'by-author');
    const pdfText = await extractPdfText(tools, pdftotext, configured.pdfPath);
    const [configuredMeasured, controlMeasured, reviewPngs] = await Promise.all([
      measurePdf(tools, pdftoppm, magick, configured.pdfPath, workspace, 'configured'),
      measurePdf(tools, pdftoppm, magick, control.pdfPath, workspace, 'control'),
      reviewPages(tools, pdftoppm, configured.pdfPath, request.outputDir, request.reviewPages ?? [1]),
    ]);
    const configuredPixels = configuredMeasured.pixels;
    const controlPixels = controlMeasured.pixels;
    const packageEvidence = await analyzeRenderedPackage(renderedInputBytes, configuredMeasured.pageCount);
    const textBinding = bindLogicalMarkupText(request.expectedMarkupText, pdfText, packageEvidence.pagination, packageEvidence.revisionBoundaries);
    const markupTextMatchesPdf = textBinding.matched;
    const configuredContrastPassed = configuredContrast(configuredPixels, controlPixels, request.configuredPixelFloor ?? 4);
    const measuredVisibility = revisionVisibility(configuredPixels, controlPixels, request.configuredPixelFloor ?? 4);
    const revisionMarkup = packageEvidence.revisionMarkup;
    // Colour visibility is classified from pixel and revision-markup evidence
    // only. A text-binding failure is reported as its own reason and never
    // relabels calibrated colour evidence as insufficient-contrast.
    const visibility = measuredVisibility !== 'hidden-deletions' || (revisionMarkup.insertions && revisionMarkup.deletions)
      ? measuredVisibility
      : 'insufficient-contrast';
    const reasons: string[] = [];
    if (!markupTextMatchesPdf) {
      reasons.push(textBinding.missingTokenSample.length > 0
        ? 'PDF text binding failed: expected logical markup content is missing from the rendered PDF.'
        : 'PDF text binding failed: rendered text is not attributable to logical markup or pagination artifacts.');
    }
    if (visibility === 'hidden-deletions') reasons.push('LibreOffice rendered configured insertions but hid configured deletions.');
    else if (!configuredContrastPassed) reasons.push('Configured render did not exceed by-author control colour bands.');
    const pdfOut = path.join(request.outputDir, 'tracked-configured.pdf');
    await copyFile(configured.pdfPath, pdfOut);
    return {
      status: markupTextMatchesPdf && configuredContrastPassed ? 'pass' : 'fail',
      reason: reasons.length > 0 ? reasons.join(' ') : undefined,
      trackedSha256,
      renderedInputSha256: sha256(renderedInputBytes),
      transform,
      pdfPath: pdfOut,
      reviewPngs,
      markupTextMatchesPdf,
      textBinding,
      configured: configuredPixels,
      byAuthorControl: controlPixels,
      configuredContrastPassed,
      revisionVisibility: visibility,
    };
  } catch (error) {
    return { status: 'not_run', reason: `Renderer invocation unavailable: ${(error as Error).message}`, trackedSha256, reviewPngs: [] };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
