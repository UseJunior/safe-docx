import {
  OOXML,
  W,
  bookmarkNameForSlug,
  buildParagraphIndex,
  classifyFieldInstruction,
  getAttributeSafe,
  type IndexedField,
  type IndexedParagraphNode,
  type ParagraphIndex,
} from '@usejunior/docx-core';
import { DocxMarkdocError } from './errors.js';
import type { AnchoredCrossReference, CrossReferenceNumber } from './types.js';

/**
 * Cross-references in the anchored (import/compile) dialect.
 *
 * A Word REF field whose bookmark names a body paragraph imports as an inline
 * `{% xref %}` tag whose content is the field's cached result, so the
 * paragraph's text, fingerprint and offsets stay those of the source:
 *
 * ```markdoc
 * See {% xref to="escrow-release" %}2(a)(i){% /xref %}.
 * ```
 *
 * The tag names the target by its creation id (`to=`) when the bookmark name
 * is one {@link bookmarkNameForSlug} produces from a kebab-case id, and by the
 * bookmark name itself (`bookmark=`) otherwise. Its form mirrors the creation
 * grammar: `show="number"` (the default) with `number="full"` (`\w`, the
 * default) or `number="paragraph"` (`\n`), or `show="text"` (no number
 * switch). `hyperlink=false` records a REF without `\h`.
 *
 * A REF field this dialect cannot carry fails closed with
 * `XREF_IMPORT_UNSUPPORTED` (on import) or `XREF_SOURCE_UNSUPPORTED` (when
 * compile reads the source), whose `details.reason` names the cause.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/1260
 */

/** A creation id: lowercase kebab-case starting with a letter (the create grammar's `TARGET_ID_RE`). */
const CREATION_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
/** The tail {@link bookmarkNameForSlug} gives a name it shortened. */
const HASHED_NAME_RE = /_[0-9a-f]{8}$/u;

/**
 * Number forms and the REF switch each writes. A REF field carries at most
 * one of them; a text reference carries none.
 *
 * #1258 (`\r`, relative numbers) extends this table with its `number` value.
 */
export const XREF_NUMBER_SWITCHES: Readonly<Record<CrossReferenceNumber, string>> = {
  full: '\\w',
  paragraph: '\\n',
};

const SWITCH_NUMBERS = new Map<string, CrossReferenceNumber>(
  Object.entries(XREF_NUMBER_SWITCHES).map(([number, fieldSwitch]) => [fieldSwitch, number as CrossReferenceNumber]),
);

export type CrossReferenceUnsupportedReason =
  | 'malformed-instruction'
  | 'unknown-switch'
  | 'duplicate-switch'
  | 'missing-bookmark'
  | 'duplicate-bookmark'
  | 'unresolved-target'
  | 'nested-field'
  | 'unterminated-field'
  | 'missing-result'
  | 'empty-result'
  | 'unsupported-result-content'
  | 'unsupported-instruction-content'
  | 'tracked-change';

/**
 * The slug a bookmark name came from, when {@link bookmarkNameForSlug} is
 * reversible on it: the name maps back to a kebab-case creation id that maps
 * forward to the same name, and does not end the way a shortened name does.
 * A long id's hashed name, a Word `_Ref…` name or any other bookmark returns
 * `undefined` and is kept as a bookmark name.
 */
export function slugForBookmarkName(name: string): string | undefined {
  // A long id's name ends in `_` and eight hex digits of its hash. Another id
  // can map to that same name verbatim, so the name does not say which id it
  // came from: keep it as a bookmark name.
  if (HASHED_NAME_RE.test(name)) return undefined;
  const slug = name.replace(/_/gu, '-');
  if (!CREATION_ID_RE.test(slug)) return undefined;
  return bookmarkNameForSlug(slug) === name ? slug : undefined;
}

/** The REF instruction for a reference, in the canonical shape generation writes. */
export function referenceInstruction(reference: AnchoredCrossReference): string {
  const switches = [
    ...(reference.show === 'number' ? [XREF_NUMBER_SWITCHES[reference.number ?? 'full']] : []),
    ...(reference.hyperlink ? ['\\h'] : []),
  ];
  return ` REF ${[reference.bookmark, ...switches].join(' ')} `;
}

/** Two references to the same bookmark in the same form. */
export function sameReference(left: AnchoredCrossReference, right: AnchoredCrossReference): boolean {
  return left.bookmark === right.bookmark
    && left.show === right.show
    && (left.show === 'text' || (left.number ?? 'full') === (right.number ?? 'full'))
    && left.hyperlink === right.hyperlink;
}

/** Parse a REF instruction into a reference, or the reason it cannot be one. */
export function parseReferenceInstruction(instruction: string):
  | { reference: AnchoredCrossReference }
  | { reason: CrossReferenceUnsupportedReason; detail: string } {
  const classification = classifyFieldInstruction(instruction);
  if (classification.kind !== 'REF') return { reason: 'malformed-instruction', detail: `not a REF field: ${instruction.trim()}` };
  if (!classification.target || classification.reason === 'missing-ref-target' || classification.reason === 'malformed-field-instruction') {
    return { reason: 'malformed-instruction', detail: instruction.trim() };
  }
  // The classifier stops at the first switch it does not know; re-read the
  // tail so an argument (`\* MERGEFORMAT`, `\d "-"`) is named, not swallowed.
  const tokens = classification.normalizedInstruction.split(/\s+/u).slice(2);
  let number: CrossReferenceNumber | undefined;
  let hyperlink = false;
  for (const token of tokens) {
    const fieldSwitch = token.toLowerCase();
    if (fieldSwitch === '\\h') {
      if (hyperlink) return { reason: 'duplicate-switch', detail: `${instruction.trim()} repeats \\h` };
      hyperlink = true;
      continue;
    }
    const mapped = SWITCH_NUMBERS.get(fieldSwitch);
    if (mapped === undefined) return { reason: 'unknown-switch', detail: `${instruction.trim()} has switch ${token}` };
    if (number !== undefined) return { reason: 'duplicate-switch', detail: `${instruction.trim()} has more than one number switch` };
    number = mapped;
  }
  return {
    reference: {
      bookmark: classification.target,
      show: number === undefined ? 'text' : 'number',
      ...(number === undefined ? {} : { number }),
      hyperlink,
    },
  };
}

function wAttribute(element: Element, name: string): string | null {
  return getAttributeSafe(element, OOXML.W_NS, name, 'w');
}

function isW(element: Element | null | undefined, localName: string): boolean {
  return element?.nodeType === 1 && element.namespaceURI === OOXML.W_NS && element.localName === localName;
}

function enclosingParagraph(element: Element): Element | null {
  for (let node: Node | null = element.parentNode; node; node = node.parentNode) {
    if (isW(node as Element, W.p)) return node as Element;
  }
  return null;
}

/** The paragraph a body-level bookmark start marks: the next paragraph in document order. */
function followingParagraph(element: Element): Element | null {
  for (let node: Node | null = element.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const candidate = node as Element;
    if (isW(candidate, W.p)) return candidate;
    const nested = candidate.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0);
    if (nested) return nested;
    if (isW(candidate, 'bookmarkStart') || isW(candidate, 'bookmarkEnd')) continue;
    return null;
  }
  return null;
}

export type BookmarkTarget = { name: string; paragraph: Element | null; count: number };

/**
 * Every named bookmark of the main document and the paragraph it starts in
 * (or, for a bookmark start between paragraphs, the paragraph that follows).
 */
export function documentBookmarkTargets(documentXml: Document): Map<string, BookmarkTarget> {
  const targets = new Map<string, BookmarkTarget>();
  for (const node of Array.from(documentXml.getElementsByTagNameNS(OOXML.W_NS, 'bookmarkStart'))) {
    const start = node as Element;
    const name = wAttribute(start, 'name');
    if (!name) continue;
    const existing = targets.get(name);
    if (existing) {
      existing.count += 1;
      continue;
    }
    targets.set(name, { name, paragraph: enclosingParagraph(start) ?? followingParagraph(start), count: 1 });
  }
  return targets;
}

/** One admitted REF field of a paragraph, located in the paragraph's visible text. */
export type ParagraphCrossReference = {
  start: number;
  end: number;
  text: string;
  reference: AnchoredCrossReference;
  /** The field's instruction as the source writes it. */
  instruction: string;
  /** The field's position among every complex field of the paragraph. */
  fieldOrdinal: number;
};

const REVISION_ELEMENTS = new Set(['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange', 'pPrChange']);
/** Zero-width markers that may sit inside a REF field without changing it. */
const FIELD_NEUTRAL_MARKERS = new Set(['bookmarkStart', 'bookmarkEnd', 'proofErr', 'commentRangeStart', 'commentRangeEnd', 'permStart', 'permEnd']);
/** Zero-width run content Word writes where layout fell; it carries no text. */
const RUN_NEUTRAL_CONTENT = new Set(['lastRenderedPageBreak']);

function isInside(element: Element, ancestor: Element): boolean {
  for (let node: Node | null = element; node; node = node.parentNode) if (node === ancestor) return true;
  return false;
}

function nodesBetween(index: ParagraphIndex, from: IndexedParagraphNode, to: IndexedParagraphNode | null): IndexedParagraphNode[] {
  const last = to?.structuralIndex ?? Number.POSITIVE_INFINITY;
  return index.nodes.filter((node) => node.structuralIndex > from.structuralIndex && node.structuralIndex < last);
}

/** A REF field of a paragraph that the dialect cannot carry, and why. */
export type UnsupportedCrossReference = {
  fieldOrdinal: number;
  instruction: string;
  reason: CrossReferenceUnsupportedReason;
  detail: string;
};

/**
 * The error for a REF field compile would have to rewrite but cannot carry:
 * an edit to its paragraph, or a note or comment body compile writes again.
 */
export function unsupportedCrossReferenceError(
  code: string,
  where: string,
  unsupported: UnsupportedCrossReference,
  extra: Record<string, unknown> = {},
): DocxMarkdocError {
  return new DocxMarkdocError(
    code,
    `${where} holds a REF field that cannot be represented as a cross-reference (${unsupported.reason}: ${unsupported.detail}); compile can only keep it by leaving it untouched.`,
    { reason: unsupported.reason, instruction: unsupported.instruction, ...extra },
  );
}

/**
 * Check one REF field's markup: its instruction holds only instruction text,
 * its result only plain text runs, and no part of it is a tracked change.
 */
function fieldContentProblem(index: ParagraphIndex, field: IndexedField): { reason: CrossReferenceUnsupportedReason; detail: string } | null {
  const inside = nodesBetween(index, field.begin, field.end);
  const separate = inside.find((node) => isW(node.element, W.fldChar) && wAttribute(node.element, 'fldCharType') === 'separate');
  const runOf = (node: IndexedParagraphNode): Element | null => (node.runIndex === null ? null : index.runs[node.runIndex]?.element ?? null);
  for (const marker of [field.begin, ...(separate ? [separate] : []), ...(field.end ? [field.end] : [])]) {
    for (let node: Node | null = marker.element; node && node !== index.paragraph; node = node.parentNode) {
      if (node.nodeType === 1 && REVISION_ELEMENTS.has((node as Element).localName)) return { reason: 'tracked-change', detail: 'a field marker sits in a tracked change' };
    }
  }
  for (const node of inside) {
    const element = node.element;
    if (REVISION_ELEMENTS.has(element.localName)) return { reason: 'tracked-change', detail: `w:${element.localName} inside the field` };
    for (let ancestor: Node | null = element.parentNode; ancestor && ancestor !== index.paragraph; ancestor = ancestor.parentNode) {
      if (ancestor.nodeType === 1 && REVISION_ELEMENTS.has((ancestor as Element).localName)) return { reason: 'tracked-change', detail: `w:${(ancestor as Element).localName} inside the field` };
    }
    const run = runOf(node);
    const inResult = separate !== undefined && node.structuralIndex > separate.structuralIndex;
    if (node.kind === 'run') continue;
    // Run properties and their descendants format the run; they hold no content.
    let formatting = false;
    for (let ancestor: Node | null = element; ancestor && ancestor !== run; ancestor = ancestor.parentNode) {
      if (ancestor.nodeType === 1 && (ancestor as Element).localName === W.rPr) formatting = true;
    }
    if (formatting) continue;
    if (run && element.parentNode === run) {
      if (element.localName === W.fldChar || RUN_NEUTRAL_CONTENT.has(element.localName)) continue;
      if (!inResult && (element.localName === W.instrText)) continue;
      if (inResult && element.localName === W.t) continue;
      return inResult
        ? { reason: 'unsupported-result-content', detail: `w:${element.localName} in the result` }
        : { reason: 'unsupported-instruction-content', detail: `w:${element.localName} in the instruction` };
    }
    if (!run && FIELD_NEUTRAL_MARKERS.has(element.localName)) continue;
    if (!run && element.localName === W.r) continue;
    return { reason: inResult ? 'unsupported-result-content' : 'unsupported-instruction-content', detail: `w:${element.localName} inside the field` };
  }
  return null;
}

export type ParagraphCrossReferenceOptions = {
  bookmarks: ReadonlyMap<string, BookmarkTarget>;
};

/**
 * The REF fields of one paragraph as cross-references, in order, each with
 * the visible-text range its cached result occupies. Fields other than REF
 * are not reported (they stay their cached text, as before). A REF field
 * that is nested, unterminated, without a result, with switches outside the
 * admitted forms, with a bookmark that is missing, repeated or marks no
 * paragraph, or whose markup holds a tracked change or anything but plain
 * text runs is reported in `unsupported` instead: it stays its cached text in
 * the Markdoc, and compile refuses anything that would rewrite it.
 */
export function paragraphCrossReferences(paragraph: Element, options: ParagraphCrossReferenceOptions): {
  index: ParagraphIndex;
  references: ParagraphCrossReference[];
  unsupported: UnsupportedCrossReference[];
} {
  const index = buildParagraphIndex(paragraph);
  const references: ParagraphCrossReference[] = [];
  const unsupported: UnsupportedCrossReference[] = [];
  const isReference = (field: IndexedField): boolean => /^\s*REF(?:\s|$)/iu.test(field.instruction);
  const contains = (outer: IndexedField, inner: IndexedField): boolean => outer !== inner
    && inner.begin.structuralIndex > outer.begin.structuralIndex
    && (outer.end === null || inner.begin.structuralIndex < outer.end.structuralIndex);
  index.fields.forEach((field, fieldOrdinal) => {
    const nestedWith = index.fields.find((other) => contains(other, field) || contains(field, other));
    if (!isReference(field)) return;
    const problem = ((): { reason: CrossReferenceUnsupportedReason; detail: string } | ParagraphCrossReference => {
      if (nestedWith) return { reason: 'nested-field', detail: `${field.instruction} and ${nestedWith.instruction} are nested` };
      if (field.end === null) return { reason: 'unterminated-field', detail: `${field.instruction} does not end in its paragraph` };
      if (!field.hasResult) return { reason: 'missing-result', detail: `${field.instruction} has no cached result` };
      const parsed = parseReferenceInstruction(field.instruction);
      if ('reason' in parsed) return parsed;
      const content = fieldContentProblem(index, field);
      if (content) return content;
      const target = options.bookmarks.get(parsed.reference.bookmark);
      if (!target) return { reason: 'missing-bookmark', detail: `bookmark ${parsed.reference.bookmark} is not in the document` };
      if (target.count > 1) return { reason: 'duplicate-bookmark', detail: `bookmark ${parsed.reference.bookmark} is named ${target.count} times` };
      if (!target.paragraph) return { reason: 'unresolved-target', detail: `bookmark ${parsed.reference.bookmark} marks no paragraph` };
      const resultNodes = index.nodes.filter((node) => node.kind === 'text' && node.fieldResultId === field.id && isInside(node.element, paragraph));
      const start = resultNodes.length ? Math.min(...resultNodes.map((node) => node.visibleStart)) : 0;
      const end = resultNodes.length ? Math.max(...resultNodes.map((node) => node.visibleEnd)) : 0;
      if (end <= start) return { reason: 'empty-result', detail: `${field.instruction} has an empty cached result` };
      return { start, end, text: index.text.slice(start, end), reference: parsed.reference, instruction: field.instruction, fieldOrdinal };
    })();
    if ('reason' in problem) unsupported.push({ fieldOrdinal, instruction: field.instruction, ...problem });
    else references.push(problem);
  });
  return { index, references, unsupported };
}

/** Markdoc attributes for an `{% xref %}` tag, shortest form first. */
export function crossReferenceAttributes(reference: AnchoredCrossReference): string {
  const slug = slugForBookmarkName(reference.bookmark);
  return [
    slug ? `to="${slug}"` : `bookmark="${reference.bookmark.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`,
    ...(reference.show === 'text' ? ['show="text"'] : []),
    ...(reference.show === 'number' && reference.number && reference.number !== 'full' ? [`number="${reference.number}"`] : []),
    ...(reference.hyperlink ? [] : ['hyperlink=false']),
  ].join(' ');
}

/**
 * Read an `{% xref %}` tag's attributes back into a reference. Returns the
 * problem as a message when the attributes are not one admitted form.
 */
export function crossReferenceFromAttributes(attributes: Record<string, unknown>): AnchoredCrossReference | string {
  const to = attributes.to;
  const bookmark = attributes.bookmark;
  if ((to === undefined) === (bookmark === undefined)) return 'An xref names its target with exactly one of to="id" or bookmark="name".';
  let name: string;
  if (to !== undefined) {
    if (typeof to !== 'string' || !CREATION_ID_RE.test(to)) return `xref to="${String(to)}" must be a kebab-case id.`;
    name = bookmarkNameForSlug(to);
  } else {
    if (typeof bookmark !== 'string' || !/^[^\s"\\]+$/u.test(bookmark)) return 'xref bookmark= must be a bookmark name without spaces, quotes or backslashes.';
    name = bookmark;
  }
  const show = attributes.show ?? 'number';
  if (show !== 'number' && show !== 'text') return `xref show="${String(show)}" must be number or text.`;
  const number = attributes.number;
  if (number !== undefined && (typeof number !== 'string' || !(number in XREF_NUMBER_SWITCHES))) {
    return `xref number="${String(number)}" must be one of ${Object.keys(XREF_NUMBER_SWITCHES).join(', ')}.`;
  }
  if (show === 'text' && number !== undefined) return 'A text xref (show="text") takes no number=.';
  const hyperlink = attributes.hyperlink ?? true;
  if (typeof hyperlink !== 'boolean') return 'xref hyperlink= must be true or false.';
  return {
    bookmark: name,
    show,
    ...(show === 'number' ? { number: (number as CrossReferenceNumber | undefined) ?? 'full' } : {}),
    hyperlink,
  };
}
