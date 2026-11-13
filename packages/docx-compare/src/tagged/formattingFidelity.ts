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

import { parseDocumentXml, serializeToXml } from './xmlToWmlElement.js';
import { isBlockContainer } from './blockContainer.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { childElements, findChildByTagName } from '@usejunior/docx-core';
import { RUN_PROPERTY_FRIENDLY_NAMES } from '@usejunior/docx-core';
import { PARAGRAPH_PROPERTY_FRIENDLY_NAMES } from '../propertyNaming.js';
import { normalizeVolatilePagerefCachesForComparison } from '../fieldComparisonSemantics.js';
import {
  inheritStoryReferences,
  STORY_ROLES,
  type StoryKind,
  type StoryRole,
} from './effectiveStoryBindings.js';

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
  /** Zero-based document-order section ordinal for section-scope divergences. */
  sectionIndex?: number;
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
  /**
   * Per-section-break w:sectPr comparison, aligned by document-order index.
   * Header/footer references compare by the part each section shows after
   * inheritance, not by the literal reference elements.
   */
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
 * Namespace declarations (`xmlns`, `xmlns:*`) are skipped: they record where
 * a prefix is bound, not formatting, and emitters legitimately declare the
 * same binding at different depths (inline vs inherited from the root).
 */
function canonicalizeElement(el: Element): string {
  const attrs: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!;
    if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue;
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
 * Canonical identity string for a paragraph's `w:pPr`, for use in atom
 * identity. Serialization topology is erased — namespace declarations,
 * inter-element whitespace, child order, attributes on the `w:pPr` itself
 * (OOXML `CT_PPrBase` permits none, so only namespace declarations or
 * non-conforming noise ever appear there), direct `w:pStyle`, and a bare or revision-only
 * `w:pPr` versus an absent one — while substantive children remain
 * identity-distinguishing. Direct style is excluded so an empty paragraph can
 * align and the comparison layer can represent the difference as one native
 * `w:pPrChange`.
 *
 * `w:sectPr` participates as a PRESENCE marker only. A section break's
 * existence is document topology: letting a section-break paragraph
 * compare equal to a plain empty paragraph makes reconstruction mode
 * decide whether the section survives. Its content is not identity: the
 * section's properties (page geometry, header/footer bindings via
 * package-local r:ids) belong to the section dimension — the same split
 * {@link PPR_EXCLUDED_TAGS} draws for the paragraph-formatting dimension —
 * and two documents routinely express an equivalent section break through
 * different relationship ids, so content-sensitive identity would turn
 * every both-sided section break into a delete+insert pair whose cloned
 * original r:ids cannot resolve in revised-based output.
 *
 * Revision-tracking subtrees and a `w:rPr` left empty after their removal
 * are provenance, not content.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/678
 * @see https://github.com/UseJunior/safe-docx/issues/679
 */
export function canonicalizeParagraphPropertiesForIdentity(
  pPr: Element | null | undefined,
): string {
  if (!pPr) return '<w:pPr/>';
  const children = childElements(pPr)
    .filter((child) =>
      !REVISION_PROPERTY_TAGS.has(child.tagName) && child.tagName !== 'w:pStyle')
    .map((child) => (child.tagName === 'w:sectPr' ? '<w:sectPr/>' : canonicalizeElement(child)))
    .filter((canonical) => canonical !== '<w:rPr/>')
    .sort();
  if (children.length === 0) return '<w:pPr/>';
  return `<w:pPr>${children.join('')}</w:pPr>`;
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

/**
 * Marker stamped (on a measurement copy only) onto each block container whose
 * whole content the candidate tracks as one revision kind, so the projection
 * that removes that content can recognise the container shell it leaves behind.
 */
const EMPTIED_CONTAINER_MARKER = 'data-sdx-emptied-by';

/** Whether a paragraph's mark (`w:pPr/w:rPr`) carries a tracked `w:ins`/`w:del`. */
function hasParagraphMarkRevision(paragraph: Element, revision: 'w:ins' | 'w:del'): boolean {
  const pPr = findChildByTagName(paragraph, 'w:pPr');
  const rPr = pPr ? findChildByTagName(pPr, 'w:rPr') : undefined;
  return Boolean(rPr && findChildByTagName(rPr, revision));
}

/**
 * Whether a paragraph sits in a table row, inside `container`, whose row
 * revision marker (`w:trPr/w:ins` or `w:trPr/w:del`) removes the row with the
 * projection. The final paragraph of a deleted cell keeps an unmarked
 * paragraph mark, so the row marker is what tracks it.
 */
function inTrackedRow(paragraph: Element, container: Element, revision: 'w:ins' | 'w:del'): boolean {
  for (let node = paragraph.parentNode as Element | null; node && node !== container; node = node.parentNode as Element | null) {
    if (node.tagName !== 'w:tr') continue;
    const trPr = findChildByTagName(node, 'w:trPr');
    if (trPr && findChildByTagName(trPr, revision)) return true;
  }
  return false;
}

/**
 * Stamp every block `w:sdt`/`w:customXml` of a tracked candidate whose
 * paragraphs all carry a `revision` paragraph mark, or sit in a row tracked
 * with that revision: the whole inserted (or deleted) container of #1386.
 * Reject All (or Accept All) removes its content but keeps the container,
 * emptied, with one placeholder paragraph.
 */
function markWholeTrackedContainers(candidateXml: string, revision: 'w:ins' | 'w:del'): string {
  const root = parseDocumentXml(candidateXml);
  const containers = [
    ...Array.from(root.getElementsByTagName('w:sdt')),
    ...Array.from(root.getElementsByTagName('w:customXml')),
  ];
  let marked = false;
  for (const container of containers) {
    if (!isBlockContainer(container)) continue;
    const paragraphs = Array.from(container.getElementsByTagName('w:p'));
    if (paragraphs.length === 0) continue;
    if (!paragraphs.every((paragraph) => hasParagraphMarkRevision(paragraph, revision)
      || inTrackedRow(paragraph, container, revision))) continue;
    container.setAttribute(EMPTIED_CONTAINER_MARKER, revision);
    marked = true;
  }
  return marked ? serializeToXml(root) : candidateXml;
}

/**
 * The sole paragraph of a block container the candidate inserted or deleted
 * whole, as the projection removing its content leaves it (#1386). Only a
 * container stamped by `markWholeTrackedContainers` qualifies, so an empty
 * control both documents hold keeps its formatting measured.
 */
function isEmptiedContainerPlaceholder(paragraph: Element): boolean {
  const parent = paragraph.parentNode as Element | null;
  if (!parent || !['w:sdtContent', 'w:customXml'].includes(parent.tagName)) return false;
  const container = parent.tagName === 'w:sdtContent' ? parent.parentNode as Element | null : parent;
  if (!container?.getAttribute(EMPTIED_CONTAINER_MARKER)) return false;
  return childElements(parent).filter((sibling) => sibling.tagName !== 'w:customXmlPr').length === 1;
}

function collectParagraphUnits(
  container: Element,
  chain: TableChainLevel[],
  out: ParagraphUnit[],
): void {
  for (const child of childElements(container)) {
    if (child.tagName === 'w:p') {
      const unit = buildParagraphUnit(child, chain, out.length);
      // A serializer may materialize a placeholder paragraph for an otherwise
      // empty body. With no text, direct paragraph properties, or table
      // context, it carries no formatting dimension to compare; section
      // properties are measured independently below.
      // Likewise the placeholder paragraph a reader keeps in a block container
      // whose content Accept/Reject removed: the emptied container is
      // reported as a `contentControl` unrepresented change (#1386).
      if (
        unit.text.length > 0 ||
        unit.pPrProps.size > 0 ||
        (unit.tableChain.length > 0 && !isEmptiedContainerPlaceholder(child))
      ) {
        out.push(unit);
      }
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

const STORY_KIND_BY_REFERENCE_TAG: Readonly<Record<string, StoryKind>> = {
  'w:headerReference': 'header',
  'w:footerReference': 'footer',
};

const STORY_ROLE_SET: ReadonlySet<string> = new Set(STORY_ROLES);

/**
 * The header/footer reference each section shows per kind and type, with
 * inheritance resolved, keyed by the canonical reference element. Kinds with
 * a reference Word cannot place (a missing or unknown `w:type`, or two
 * references of one type in one section) are listed in `unresolved`, and
 * their divergences are never treated as redundant.
 */
interface SectionStoryReferences {
  shown: ReadonlyMap<string, string | undefined>;
  unresolved: ReadonlySet<StoryKind>;
}

function sectionStoryReferences(sections: readonly Element[]): SectionStoryReferences {
  const explicit = new Map<string, string>();
  const unresolved = new Set<StoryKind>();
  sections.forEach((sectPr, sectionOrdinal) => {
    for (const reference of childElements(sectPr)) {
      const kind = STORY_KIND_BY_REFERENCE_TAG[reference.tagName];
      if (!kind) continue;
      const role = reference.getAttribute('w:type') ?? '';
      const key = `${sectionOrdinal}:${kind}:${role}`;
      if (!STORY_ROLE_SET.has(role) || explicit.has(key)) {
        unresolved.add(kind);
        continue;
      }
      explicit.set(key, canonicalizeElement(reference));
    }
  });
  const shown = new Map<string, string | undefined>();
  for (const slot of inheritStoryReferences(sections.length, ({ sectionOrdinal, kind, role }) =>
    explicit.get(`${sectionOrdinal}:${kind}:${role}`))) {
    shown.set(`${slot.sectionOrdinal}:${slot.kind}:${slot.role}`, slot.value);
  }
  return { shown, unresolved };
}

/**
 * Whether two sections at the same index show the same header (footer)
 * story of every type once inheritance is resolved. Within one relationship
 * id space, an explicit reference to the part the section would inherit
 * anyway shows the same pages as no reference, so a literal difference
 * between the two is not a formatting divergence. Word writes that shape
 * when it deletes a section break before a section with no references of its
 * own: the removed section's references move onto the following one. Every
 * type is compared, displayed or not, because a later section that turns
 * `w:titlePg` on inherits through a slot this section does not display.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/1203
 */
function showsSameStories(
  expected: SectionStoryReferences,
  actual: SectionStoryReferences,
  sectionOrdinal: number,
  kind: StoryKind,
): boolean {
  if (expected.unresolved.has(kind) || actual.unresolved.has(kind)) return false;
  return STORY_ROLES.every((role: StoryRole) => {
    const key = `${sectionOrdinal}:${kind}:${role}`;
    return expected.shown.get(key) === actual.shown.get(key);
  });
}

function compareSectionFormatting(
  expectedRoot: Element,
  actualRoot: Element,
  divergences: FormattingDivergence[],
): FormattingDimensionTally {
  const expectedSections = collectSectionProperties(expectedRoot);
  const actualSections = collectSectionProperties(actualRoot);
  const expectedStories = sectionStoryReferences(expectedSections);
  const actualStories = sectionStoryReferences(actualSections);
  const compared = Math.max(expectedSections.length, actualSections.length);
  let divergent = 0;
  for (let i = 0; i < compared; i++) {
    const expectedProps = propertyMap(expectedSections[i] ?? null, REVISION_PROPERTY_TAGS);
    const actualProps = propertyMap(actualSections[i] ?? null, REVISION_PROPERTY_TAGS);
    if (containerKey(expectedProps) === containerKey(actualProps)) continue;
    const bothPresent = i < expectedSections.length && i < actualSections.length;
    const diffs = diffPropertyMaps(expectedProps, actualProps, {}).filter((diff) => {
      const kind = STORY_KIND_BY_REFERENCE_TAG[diff.property];
      return !(bothPresent && kind && showsSameStories(expectedStories, actualStories, i, kind));
    });
    if (diffs.length === 0) continue;
    divergent++;
    for (const diff of diffs) {
      divergences.push({
        scope: 'section',
        paragraphIndex: -1,
        textSample: '',
        sectionIndex: i,
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
  const expectedRoot = parseDocumentXml(
    normalizeVolatilePagerefCachesForComparison(expectedDocumentXml),
  );
  const actualRoot = parseDocumentXml(
    normalizeVolatilePagerefCachesForComparison(actualDocumentXml),
  );

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

/** Measure one tracked candidate against the authoritative source sides. */
export function compareSourceProjectedFormattingFidelity(
  originalXml: string,
  revisedXml: string,
  candidateXml: string,
): ProjectedFormattingFidelity {
  const accept = compareFormattingFidelity(
    revisedXml,
    acceptAllChanges(markWholeTrackedContainers(candidateXml, 'w:del')),
  );
  const reject = compareFormattingFidelity(
    originalXml,
    rejectAllChanges(markWholeTrackedContainers(candidateXml, 'w:ins')),
  );
  return { accept, reject, score: Math.min(accept.score, reject.score) };
}
