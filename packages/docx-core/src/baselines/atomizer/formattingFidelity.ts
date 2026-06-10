/**
 * Formatting-Fidelity Comparison Check
 *
 * Deterministic, in-engine measurement of formatting divergence between two
 * word/document.xml views (e.g. inplace candidate vs rebuild candidate, or
 * candidate vs expected). Both existing safety oracles are formatting-blind:
 * the round-trip oracle compares text projections and the LibreOffice
 * oracle's paragraphShape() records only paragraph count + visible-text
 * presence — so rebuild mode's formatting loss passes every current gate
 * silently. This module quantifies that loss and gates inplace fixes.
 *
 * Alignment strategy: paragraphs are aligned by their visible text content
 * (LCS over paragraph texts), then run formatting is compared character by
 * character within each aligned pair. Comparing per character — not per run —
 * makes the check agnostic to run splits, which rebuild and inplace
 * legitimately produce differently. Content divergence is the text oracle's
 * job and is reported separately as alignment coverage, not folded into the
 * formatting tallies.
 *
 * LibreOffice is deliberately not involved: it rewrites formatting on
 * load/save (adds default w:pPr/w:rPr), so it cannot serve as a formatting
 * oracle. This comparison runs entirely over our own emitted XML.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/363
 */

import { parseDocumentXml } from './xmlToWmlElement.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { childElements, findChildByTagName } from '../../primitives/index.js';
import { RUN_PROPERTY_FRIENDLY_NAMES } from '../../core-types.js';
import { PARAGRAPH_PROPERTY_FRIENDLY_NAMES } from '../../format-detection.js';

// =============================================================================
// Report types
// =============================================================================

export type FormattingScope = 'run' | 'paragraph' | 'table' | 'section';

export type FormattingDivergenceKind = 'added' | 'removed' | 'changed';

export interface FormattingDivergence {
  scope: FormattingScope;
  /** Friendly property name when known (e.g. "bold"), else the OOXML tag. */
  property: string;
  /** "added"/"removed" are relative to the expected view. */
  kind: FormattingDivergenceKind;
  /** Canonical serialization of the property in the expected view. */
  expectedValue: string | null;
  /** Canonical serialization of the property in the actual view. */
  actualValue: string | null;
  /**
   * Document-order paragraph index in the expected view, or -1 for
   * section-scope divergences (section breaks are aligned by index, not
   * anchored to a paragraph).
   */
  paragraphIndex: number;
  /** Aligned text the divergence applies to (truncated). */
  textSample: string;
}

export interface FormattingDimensionTally {
  /** Units compared: chars (run), paragraphs (paragraph/table), section breaks (section). */
  compared: number;
  divergent: number;
  /** (compared - divergent) / compared; 1 when nothing was compared. */
  score: number;
}

export interface FormattingFidelityReport {
  /**
   * Alignment coverage × mean of the dimension scores that compared at
   * least one unit. Exactly 1.0 iff content aligned fully and no formatting
   * diverged, so the score doubles as an exact-preservation gate.
   */
  score: number;
  /** Character-weighted w:rPr comparison over aligned paragraph text. */
  runFormatting: FormattingDimensionTally;
  /** Per-paragraph w:pPr comparison (w:sectPr handled by the section dimension). */
  paragraphFormatting: FormattingDimensionTally;
  /** Per-paragraph w:tblPr/w:trPr/w:tcPr chain comparison for paragraphs inside tables. */
  tableFormatting: FormattingDimensionTally;
  /** Per-section-break w:sectPr comparison, aligned by document-order index. */
  sectionFormatting: FormattingDimensionTally;
  /** Paragraphs whose text could not be content-aligned (content divergence, not formatting). */
  unalignedExpectedParagraphs: number;
  unalignedActualParagraphs: number;
  divergences: FormattingDivergence[];
}

// =============================================================================
// Canonical property keys
// =============================================================================

/**
 * Revision-tracking elements excluded from canonicalization at every depth.
 * Two views that differ only in tracked-change provenance markup carry the
 * same formatting.
 */
const REVISION_PROPERTY_TAGS = new Set([
  'w:rPrChange',
  'w:pPrChange',
  'w:tblPrChange',
  'w:trPrChange',
  'w:tcPrChange',
  'w:sectPrChange',
  'w:ins',
  'w:del',
  'w:cellIns',
  'w:cellDel',
  'w:cellMerge',
]);

/** w:sectPr inside w:pPr is a section break — owned by the section dimension. */
const PPR_EXCLUDED_TAGS = new Set([...REVISION_PROPERTY_TAGS, 'w:sectPr']);

/**
 * Canonical serialization: sorted attributes, children sorted by their own
 * canonical form, revision markup dropped. A comparison key, not output XML —
 * sorting trades element-order semantics for emitter-order independence.
 */
function canonicalizeElement(el: Element): string {
  const attrs: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!;
    attrs.push(`${attr.name}="${attr.value}"`);
  }
  attrs.sort();
  const attrPart = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';

  const children = childElements(el)
    .filter((child) => !REVISION_PROPERTY_TAGS.has(child.tagName))
    .map(canonicalizeElement)
    .sort();
  if (children.length === 0) {
    const text = (el.textContent ?? '').trim();
    return text.length > 0
      ? `<${el.tagName}${attrPart}>${text}</${el.tagName}>`
      : `<${el.tagName}${attrPart}/>`;
  }
  return `<${el.tagName}${attrPart}>${children.join('')}</${el.tagName}>`;
}

/**
 * Map of property tag → canonical serialization for the direct children of a
 * property container (w:rPr, w:pPr, w:tcPr, ...). Repeated tags are merged
 * into one sorted entry. An absent container equals an empty one.
 */
function propertyMap(
  container: Element | null,
  excludedTags: ReadonlySet<string>,
): Map<string, string> {
  const collected = new Map<string, string[]>();
  if (container) {
    for (const child of childElements(container)) {
      if (excludedTags.has(child.tagName)) continue;
      const existing = collected.get(child.tagName);
      if (existing) existing.push(canonicalizeElement(child));
      else collected.set(child.tagName, [canonicalizeElement(child)]);
    }
  }
  const merged = new Map<string, string>();
  for (const [tag, values] of collected) {
    merged.set(tag, values.sort().join(''));
  }
  return merged;
}

function containerKey(props: Map<string, string>): string {
  return [...props.keys()]
    .sort()
    .map((tag) => props.get(tag)!)
    .join('');
}

interface PropertyDiff {
  property: string;
  kind: FormattingDivergenceKind;
  expectedValue: string | null;
  actualValue: string | null;
}

function diffPropertyMaps(
  expected: Map<string, string>,
  actual: Map<string, string>,
  friendlyNames: Record<string, string>,
): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];
  const allTags = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  for (const tag of allTags) {
    const expectedValue = expected.get(tag);
    const actualValue = actual.get(tag);
    if (expectedValue === actualValue) continue;
    diffs.push({
      property: friendlyNames[tag] ?? tag,
      kind:
        expectedValue === undefined
          ? 'added'
          : actualValue === undefined
            ? 'removed'
            : 'changed',
      expectedValue: expectedValue ?? null,
      actualValue: actualValue ?? null,
    });
  }
  return diffs;
}

// =============================================================================
// Paragraph unit extraction
// =============================================================================

interface TableChainLevel {
  tblPr: Element | null;
  trPr: Element | null;
  tcPr: Element | null;
}

interface ParagraphUnit {
  /** Document-order index of this paragraph within its view. */
  index: number;
  /** Visible text: concatenated w:t + w:delText character content. */
  text: string;
  /** Canonical w:rPr key per character of `text`. */
  charRPrKeys: string[];
  /** The w:rPr element each character's key was derived from (for divergence detail). */
  charRPrElements: (Element | null)[];
  pPrProps: Map<string, string>;
  pPrKey: string;
  /** Enclosing table property chain, outermost table first; empty outside tables. */
  tableChain: TableChainLevel[];
  tableKey: string;
}

function tableLevelKey(level: TableChainLevel): string {
  return [
    containerKey(propertyMap(level.tblPr, REVISION_PROPERTY_TAGS)),
    containerKey(propertyMap(level.trPr, REVISION_PROPERTY_TAGS)),
    containerKey(propertyMap(level.tcPr, REVISION_PROPERTY_TAGS)),
  ].join('§');
}

function collectRunText(
  el: Element,
  currentRPrKey: string,
  currentRPr: Element | null,
  unit: ParagraphUnit,
): void {
  for (const child of childElements(el)) {
    if (child.tagName === 'w:pPr') continue;
    if (child.tagName === 'w:r') {
      const rPr = findChildByTagName(child, 'w:rPr');
      const key = containerKey(propertyMap(rPr, REVISION_PROPERTY_TAGS));
      collectRunText(child, key, rPr, unit);
      continue;
    }
    if (child.tagName === 'w:t' || child.tagName === 'w:delText') {
      const text = child.textContent ?? '';
      unit.text += text;
      for (let i = 0; i < text.length; i++) {
        unit.charRPrKeys.push(currentRPrKey);
        unit.charRPrElements.push(currentRPr);
      }
      continue;
    }
    // Recurse through revision wrappers, hyperlinks, smart tags, sdt, ...
    collectRunText(child, currentRPrKey, currentRPr, unit);
  }
}

function buildParagraphUnit(
  paragraph: Element,
  chain: TableChainLevel[],
  index: number,
): ParagraphUnit {
  const pPr = findChildByTagName(paragraph, 'w:pPr');
  const pPrProps = propertyMap(pPr, PPR_EXCLUDED_TAGS);
  const unit: ParagraphUnit = {
    index,
    text: '',
    charRPrKeys: [],
    charRPrElements: [],
    pPrProps,
    pPrKey: containerKey(pPrProps),
    tableChain: chain,
    tableKey: chain.map(tableLevelKey).join('|'),
  };
  collectRunText(paragraph, '', null, unit);
  return unit;
}

function collectParagraphUnits(
  container: Element,
  chain: TableChainLevel[],
  out: ParagraphUnit[],
): void {
  for (const child of childElements(container)) {
    if (child.tagName === 'w:p') {
      out.push(buildParagraphUnit(child, chain, out.length));
      continue;
    }
    if (child.tagName === 'w:tbl') {
      const tblPr = findChildByTagName(child, 'w:tblPr');
      for (const row of childElements(child)) {
        if (row.tagName !== 'w:tr') continue;
        const trPr = findChildByTagName(row, 'w:trPr');
        for (const cell of childElements(row)) {
          if (cell.tagName !== 'w:tc') continue;
          const tcPr = findChildByTagName(cell, 'w:tcPr');
          collectParagraphUnits(cell, [...chain, { tblPr, trPr, tcPr }], out);
        }
      }
      continue;
    }
    // Recurse through sdt/customXml/revision wrappers that can hold blocks.
    collectParagraphUnits(child, chain, out);
  }
}

function collectSectionProperties(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element): void => {
    for (const child of childElements(el)) {
      if (child.tagName === 'w:sectPr') {
        out.push(child);
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  return out;
}

// =============================================================================
// Content alignment
// =============================================================================

/**
 * LCS over paragraph texts. O(n·m) — fine for a measurement/gate tool, not
 * intended for hot paths.
 */
function alignParagraphsByText(
  expected: ParagraphUnit[],
  actual: ParagraphUnit[],
): Array<[ParagraphUnit, ParagraphUnit]> {
  if (
    expected.length === actual.length &&
    expected.every((unit, i) => unit.text === actual[i]!.text)
  ) {
    return expected.map((unit, i) => [unit, actual[i]!]);
  }

  const n = expected.length;
  const m = actual.length;
  const table: number[] = new Array((n + 1) * (m + 1)).fill(0);
  const at = (i: number, j: number): number => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] =
        expected[i]!.text === actual[j]!.text
          ? table[at(i + 1, j + 1)]! + 1
          : Math.max(table[at(i + 1, j)]!, table[at(i, j + 1)]!);
    }
  }

  const pairs: Array<[ParagraphUnit, ParagraphUnit]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i]!.text === actual[j]!.text) {
      pairs.push([expected[i]!, actual[j]!]);
      i++;
      j++;
    } else if (table[at(i + 1, j)]! >= table[at(i, j + 1)]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

// =============================================================================
// Comparison
// =============================================================================

const TEXT_SAMPLE_LIMIT = 80;

function sampleText(text: string): string {
  return text.length > TEXT_SAMPLE_LIMIT ? `${text.slice(0, TEXT_SAMPLE_LIMIT)}…` : text;
}

function makeTally(compared: number, divergent: number): FormattingDimensionTally {
  return {
    compared,
    divergent,
    score: compared === 0 ? 1 : (compared - divergent) / compared,
  };
}

function compareRunFormatting(
  pairs: Array<[ParagraphUnit, ParagraphUnit]>,
  divergences: FormattingDivergence[],
): FormattingDimensionTally {
  let compared = 0;
  let divergent = 0;
  for (const [expected, actual] of pairs) {
    compared += expected.text.length;
    let rangeStart = -1;
    const flushRange = (end: number): void => {
      if (rangeStart < 0) return;
      const diffs = diffPropertyMaps(
        propertyMap(expected.charRPrElements[rangeStart] ?? null, REVISION_PROPERTY_TAGS),
        propertyMap(actual.charRPrElements[rangeStart] ?? null, REVISION_PROPERTY_TAGS),
        RUN_PROPERTY_FRIENDLY_NAMES,
      );
      const textSample = sampleText(expected.text.slice(rangeStart, end));
      for (const diff of diffs) {
        divergences.push({
          scope: 'run',
          paragraphIndex: expected.index,
          textSample,
          ...diff,
        });
      }
      rangeStart = -1;
    };
    for (let i = 0; i < expected.text.length; i++) {
      if (expected.charRPrKeys[i] === actual.charRPrKeys[i]) {
        flushRange(i);
        continue;
      }
      divergent++;
      // Coalesce contiguous chars with the same key pair into one report range.
      if (
        rangeStart >= 0 &&
        (expected.charRPrKeys[i] !== expected.charRPrKeys[rangeStart] ||
          actual.charRPrKeys[i] !== actual.charRPrKeys[rangeStart])
      ) {
        flushRange(i);
      }
      if (rangeStart < 0) rangeStart = i;
    }
    flushRange(expected.text.length);
  }
  return makeTally(compared, divergent);
}

function compareParagraphFormatting(
  pairs: Array<[ParagraphUnit, ParagraphUnit]>,
  divergences: FormattingDivergence[],
): FormattingDimensionTally {
  let divergent = 0;
  for (const [expected, actual] of pairs) {
    if (expected.pPrKey === actual.pPrKey) continue;
    divergent++;
    for (const diff of diffPropertyMaps(
      expected.pPrProps,
      actual.pPrProps,
      PARAGRAPH_PROPERTY_FRIENDLY_NAMES,
    )) {
      divergences.push({
        scope: 'paragraph',
        paragraphIndex: expected.index,
        textSample: sampleText(expected.text),
        ...diff,
      });
    }
  }
  return makeTally(pairs.length, divergent);
}

function compareTableFormatting(
  pairs: Array<[ParagraphUnit, ParagraphUnit]>,
  divergences: FormattingDivergence[],
): FormattingDimensionTally {
  let compared = 0;
  let divergent = 0;
  for (const [expected, actual] of pairs) {
    if (expected.tableChain.length === 0 && actual.tableChain.length === 0) continue;
    compared++;
    if (expected.tableKey === actual.tableKey) continue;
    divergent++;
    if (expected.tableChain.length !== actual.tableChain.length) {
      divergences.push({
        scope: 'table',
        property: 'tableNesting',
        kind: 'changed',
        expectedValue: String(expected.tableChain.length),
        actualValue: String(actual.tableChain.length),
        paragraphIndex: expected.index,
        textSample: sampleText(expected.text),
      });
      continue;
    }
    for (let level = 0; level < expected.tableChain.length; level++) {
      const expectedLevel = expected.tableChain[level]!;
      const actualLevel = actual.tableChain[level]!;
      const containers: Array<[Element | null, Element | null]> = [
        [expectedLevel.tblPr, actualLevel.tblPr],
        [expectedLevel.trPr, actualLevel.trPr],
        [expectedLevel.tcPr, actualLevel.tcPr],
      ];
      for (const [expectedContainer, actualContainer] of containers) {
        for (const diff of diffPropertyMaps(
          propertyMap(expectedContainer, REVISION_PROPERTY_TAGS),
          propertyMap(actualContainer, REVISION_PROPERTY_TAGS),
          {},
        )) {
          divergences.push({
            scope: 'table',
            paragraphIndex: expected.index,
            textSample: sampleText(expected.text),
            ...diff,
          });
        }
      }
    }
  }
  return makeTally(compared, divergent);
}

function compareSectionFormatting(
  expectedRoot: Element,
  actualRoot: Element,
  divergences: FormattingDivergence[],
): FormattingDimensionTally {
  const expectedSections = collectSectionProperties(expectedRoot);
  const actualSections = collectSectionProperties(actualRoot);
  const compared = Math.max(expectedSections.length, actualSections.length);
  let divergent = 0;
  for (let i = 0; i < compared; i++) {
    const expectedProps = propertyMap(expectedSections[i] ?? null, REVISION_PROPERTY_TAGS);
    const actualProps = propertyMap(actualSections[i] ?? null, REVISION_PROPERTY_TAGS);
    if (containerKey(expectedProps) === containerKey(actualProps)) continue;
    divergent++;
    for (const diff of diffPropertyMaps(expectedProps, actualProps, {})) {
      divergences.push({
        scope: 'section',
        paragraphIndex: -1,
        textSample: '',
        ...diff,
      });
    }
  }
  return makeTally(compared, divergent);
}

/**
 * Compare the formatting carried by two word/document.xml views.
 *
 * The views are expected to hold comparable content (e.g. two reconstruction
 * candidates for the same comparison, or the same projection of each); use
 * compareProjectedFormattingFidelity to compare tracked-changes candidates
 * whose revision-markup granularity may differ.
 */
export function compareFormattingFidelity(
  expectedDocumentXml: string,
  actualDocumentXml: string,
): FormattingFidelityReport {
  const expectedRoot = parseDocumentXml(expectedDocumentXml);
  const actualRoot = parseDocumentXml(actualDocumentXml);

  const expectedUnits: ParagraphUnit[] = [];
  const actualUnits: ParagraphUnit[] = [];
  collectParagraphUnits(expectedRoot, [], expectedUnits);
  collectParagraphUnits(actualRoot, [], actualUnits);

  const pairs = alignParagraphsByText(expectedUnits, actualUnits);

  const divergences: FormattingDivergence[] = [];
  const runFormatting = compareRunFormatting(pairs, divergences);
  const paragraphFormatting = compareParagraphFormatting(pairs, divergences);
  const tableFormatting = compareTableFormatting(pairs, divergences);
  const sectionFormatting = compareSectionFormatting(expectedRoot, actualRoot, divergences);

  const totalParagraphs = expectedUnits.length + actualUnits.length;
  const alignmentCoverage = totalParagraphs === 0 ? 1 : (2 * pairs.length) / totalParagraphs;
  const dimensions = [runFormatting, paragraphFormatting, tableFormatting, sectionFormatting].filter(
    (dimension) => dimension.compared > 0,
  );
  const dimensionScore =
    dimensions.length === 0
      ? 1
      : dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length;

  return {
    score: alignmentCoverage * dimensionScore,
    runFormatting,
    paragraphFormatting,
    tableFormatting,
    sectionFormatting,
    unalignedExpectedParagraphs: expectedUnits.length - pairs.length,
    unalignedActualParagraphs: actualUnits.length - pairs.length,
    divergences,
  };
}

// =============================================================================
// Projection-based candidate comparison
// =============================================================================

export interface ProjectedFormattingFidelity {
  /** Fidelity of accept-all(actual) measured against accept-all(expected). */
  accept: FormattingFidelityReport;
  /** Fidelity of reject-all(actual) measured against reject-all(expected). */
  reject: FormattingFidelityReport;
  /** min(accept.score, reject.score) — a candidate must preserve both projections. */
  score: number;
}

/**
 * Compare two tracked-changes candidates projection-to-projection, the same
 * stance the round-trip text oracle adopted in #347: accept-all and
 * reject-all projections strip revision markup, so candidates that encode
 * the same result with different w:ins/w:del granularity score 1.0 unless
 * their formatting actually diverges.
 */
export function compareProjectedFormattingFidelity(
  expectedCandidateXml: string,
  actualCandidateXml: string,
): ProjectedFormattingFidelity {
  const accept = compareFormattingFidelity(
    acceptAllChanges(expectedCandidateXml),
    acceptAllChanges(actualCandidateXml),
  );
  const reject = compareFormattingFidelity(
    rejectAllChanges(expectedCandidateXml),
    rejectAllChanges(actualCandidateXml),
  );
  return { accept, reject, score: Math.min(accept.score, reject.score) };
}
