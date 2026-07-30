import { DocxArchive } from '../shared/docx/DocxArchive.js';
import {
  classifyFieldInstruction,
  type FieldInstructionClassification,
  type WordFieldKind,
} from '../shared/field-semantics.js';
import { W_NS } from '../shared/ooxml/namespaces.js';
import { parseXml, serializeXml } from './xml.js';

export type FieldRefreshStatus =
  | 'evaluated'
  | 'dirtied'
  | 'unchanged'
  | 'preserved'
  | 'unsupported';

/**
 * Where a field sits in the story it was read from.
 *
 * Both ordinals are document-order positions within a single refresh result.
 * They are not durable identities: inserting an earlier paragraph shifts every
 * later `paragraphOrdinal`. Use them to correlate an outcome with the XML that
 * produced it, not to remember a field across edits. `paragraphOrdinal` is
 * absent for a field that has no `w:p` ancestor.
 */
export interface FieldLocator {
  paragraphOrdinal?: number;
  fieldOrdinal: number;
}

export interface FieldRefreshOutcome {
  index: number;
  locator: FieldLocator;
  kind: WordFieldKind;
  instruction: string;
  status: FieldRefreshStatus;
  target?: string;
  reason?: string;
}

export interface FieldRefreshOptions {
  markLayoutDependentDirty?: boolean;
}

export interface FieldRefreshReport {
  changed: boolean;
  outcomes: FieldRefreshOutcome[];
}

export interface FieldXmlRefreshResult extends FieldRefreshReport {
  documentXml: string;
}

export interface FieldDocxRefreshResult extends FieldRefreshReport {
  document: Buffer;
  /**
   * Field-bearing parts present in the package that this operation did not
   * read, such as `word/header1.xml` or `word/footnotes.xml`.
   */
  skippedStories: string[];
}

export type FieldRefreshErrorCode = 'MALFORMED_FIELD_TOPOLOGY';

export class FieldRefreshError extends Error {
  readonly code: FieldRefreshErrorCode;

  constructor(code: FieldRefreshErrorCode, message: string) {
    super(message);
    this.name = 'FieldRefreshError';
    this.code = code;
  }
}

interface ComplexField {
  begin: Element;
  separate?: Element;
  end?: Element;
  /** Instruction text that survives in the current projection. */
  currentInstruction: string[];
  /** Instruction text carried inside a deletion revision. */
  deletedInstruction: string[];
  resultTexts: Element[];
  nested: boolean;
  hasNested: boolean;
  parent?: ComplexField;
}

/**
 * The instruction a reader would act on: the surviving text, or the deleted
 * text when the whole instruction was struck. Concatenating both views yields a
 * chimera like `REF Old REF New`, which describes neither revision state.
 */
function fieldInstructionView(field: ComplexField): string {
  const current = field.currentInstruction.join('');
  return current.trim().length > 0 ? current : field.deletedInstruction.join('');
}

interface BookmarkRange {
  start: Element;
  end: Element;
  startIndex: number;
  endIndex: number;
}

const REVISION_CONTAINERS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);
const DELETION_CONTAINERS = new Set(['del', 'moveFrom']);

function wAttribute(element: Element, localName: string): string | null {
  return (
    element.getAttributeNS(W_NS, localName) ??
    element.getAttribute(`w:${localName}`)
  );
}

function isWordElement(element: Element, localName: string): boolean {
  return element.namespaceURI === W_NS && element.localName === localName;
}

function elementChildren(node: Node): Element[] {
  const children: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) children.push(child as Element);
  }
  return children;
}

function nearestWordAncestor(node: Node, localName: string): Element | undefined {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (
      current.nodeType === 1 &&
      isWordElement(current as Element, localName)
    ) {
      return current as Element;
    }
  }
  return undefined;
}

function hasRevisionAncestor(node: Node): boolean {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (
      current.nodeType === 1 &&
      (current as Element).namespaceURI === W_NS &&
      REVISION_CONTAINERS.has((current as Element).localName)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Flatten the story in document order, treating `w:fldSimple` as opaque.
 *
 * The simple-field element itself is emitted so callers can recognize and
 * refuse it, but its subtree is not: a simple field owns its own instruction
 * and cached result, and letting those descendants surface in the flat
 * sequence lets an enclosing complex field adopt — and overwrite — them.
 */
function enumerateElements(root: Node): Element[] {
  const elements: Element[] = [];
  const visit = (node: Node): void => {
    for (const child of elementChildren(node)) {
      elements.push(child);
      if (isWordElement(child, 'fldSimple')) continue;
      visit(child);
    }
  };
  visit(root);
  return elements;
}

function hasDeletionAncestor(node: Node): boolean {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (
      current.nodeType === 1 &&
      (current as Element).namespaceURI === W_NS &&
      DELETION_CONTAINERS.has((current as Element).localName)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validate and enumerate complex fields before any mutation occurs.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @see https://github.com/UseJunior/safe-docx/issues/762
 */
function collectComplexFields(document: Document): ComplexField[] {
  const roots: ComplexField[] = [];
  const stack: ComplexField[] = [];

  for (const element of enumerateElements(document)) {
    if (isWordElement(element, 'fldSimple')) {
      continue;
    }
    if (isWordElement(element, 'fldChar')) {
      const type = wAttribute(element, 'fldCharType');
      if (type === 'begin') {
        const parent = stack[stack.length - 1];
        const field: ComplexField = {
          begin: element,
          currentInstruction: [],
          deletedInstruction: [],
          resultTexts: [],
          nested: parent !== undefined,
          hasNested: false,
          parent,
        };
        if (parent) parent.hasNested = true;
        if (!parent) roots.push(field);
        stack.push(field);
      } else if (type === 'separate') {
        const field = stack[stack.length - 1];
        if (!field || field.separate) {
          throw new FieldRefreshError(
            'MALFORMED_FIELD_TOPOLOGY',
            field ? 'Complex field contains more than one separator' : 'Stray field separator',
          );
        }
        field.separate = element;
      } else if (type === 'end') {
        const field = stack.pop();
        if (!field) {
          throw new FieldRefreshError('MALFORMED_FIELD_TOPOLOGY', 'Stray field end');
        }
        field.end = element;
      } else {
        throw new FieldRefreshError(
          'MALFORMED_FIELD_TOPOLOGY',
          `Unknown field character type: ${type ?? '(missing)'}`,
        );
      }
      continue;
    }

    const field = stack[stack.length - 1];
    if (!field) continue;
    if (
      !field.separate &&
      (isWordElement(element, 'instrText') || isWordElement(element, 'delInstrText'))
    ) {
      // `w:delInstrText` is the canonical deleted-instruction element, but Word
      // and our own atomizer both also emit plain `w:instrText` inside a
      // `w:del`. Ancestry is the only reliable signal.
      const target =
        isWordElement(element, 'delInstrText') || hasDeletionAncestor(element)
          ? field.deletedInstruction
          : field.currentInstruction;
      target.push(element.textContent ?? '');
    } else if (field.separate && isWordElement(element, 't')) {
      field.resultTexts.push(element);
    }
  }

  if (stack.length > 0) {
    throw new FieldRefreshError(
      'MALFORMED_FIELD_TOPOLOGY',
      'Unclosed complex field',
    );
  }
  return roots;
}

function resolveBookmarkRanges(
  elements: Element[],
): Map<string, BookmarkRange | string> {
  const startsByName = new Map<string, Element[]>();
  const startsById = new Map<string, Element[]>();
  const endsById = new Map<string, Element[]>();
  const indexes = new Map<Element, number>();
  elements.forEach((element, index) => indexes.set(element, index));

  for (const element of elements) {
    if (isWordElement(element, 'bookmarkStart')) {
      const name = wAttribute(element, 'name');
      const id = wAttribute(element, 'id');
      if (name) startsByName.set(name, [...(startsByName.get(name) ?? []), element]);
      if (id) startsById.set(id, [...(startsById.get(id) ?? []), element]);
    } else if (isWordElement(element, 'bookmarkEnd')) {
      const id = wAttribute(element, 'id');
      if (id) endsById.set(id, [...(endsById.get(id) ?? []), element]);
    }
  }

  const ranges = new Map<string, BookmarkRange | string>();
  for (const [name, starts] of startsByName) {
    if (starts.length !== 1) {
      ranges.set(name, 'duplicate-bookmark-name');
      continue;
    }
    const start = starts[0]!;
    const id = wAttribute(start, 'id');
    if (!id || (startsById.get(id)?.length ?? 0) !== 1) {
      ranges.set(name, 'duplicate-or-missing-bookmark-id');
      continue;
    }
    const ends = endsById.get(id) ?? [];
    if (ends.length !== 1) {
      ranges.set(name, 'missing-or-duplicate-bookmark-end');
      continue;
    }
    const startIndex = indexes.get(start)!;
    const endIndex = indexes.get(ends[0]!)!;
    if (endIndex <= startIndex) {
      ranges.set(name, 'reversed-bookmark-range');
      continue;
    }
    ranges.set(name, { start, end: ends[0]!, startIndex, endIndex });
  }
  return ranges;
}

/**
 * Project a bookmark range to the plain text a REF result should cache.
 *
 * Word writes a REF result structurally: a tab becomes `w:tab`, a break or a
 * paragraph transition becomes new run and paragraph content. This primitive
 * replaces a single `w:t` payload, so it can only faithfully represent a
 * projection that is itself a single run of characters. A range carrying tabs,
 * breaks, or a paragraph transition is therefore refused rather than flattened
 * into literal U+0009/U+000A, which Word collapses on display.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 * @see https://github.com/UseJunior/safe-docx/issues/762
 */
function bookmarkText(
  indexes: ReadonlyMap<Element, number>,
  elements: Element[],
  range: BookmarkRange,
  field: ComplexField,
): { value?: string; reason?: string } {
  const fieldStart = indexes.get(field.begin) ?? -1;
  const fieldEnd = indexes.get(field.end!) ?? -1;
  if (
    range.startIndex <= fieldStart &&
    range.endIndex >= fieldEnd
  ) {
    return { reason: 'self-referential-bookmark' };
  }

  let value = '';
  let renderedParagraph: Element | undefined;
  for (let index = range.startIndex + 1; index < range.endIndex; index += 1) {
    const element = elements[index]!;
    if (hasRevisionAncestor(element)) return { reason: 'bookmark-contains-revisions' };
    if (
      isWordElement(element, 'fldChar') ||
      isWordElement(element, 'fldSimple') ||
      isWordElement(element, 'drawing') ||
      isWordElement(element, 'object')
    ) {
      return { reason: 'unsupported-bookmark-content' };
    }
    if (
      isWordElement(element, 'tab') ||
      isWordElement(element, 'br') ||
      isWordElement(element, 'cr')
    ) {
      return { reason: 'unsupported-bookmark-layout' };
    }
    if (!isWordElement(element, 't')) continue;
    const paragraph = nearestWordAncestor(element, 'p');
    if (renderedParagraph && paragraph && paragraph !== renderedParagraph) {
      return { reason: 'unsupported-bookmark-layout' };
    }
    if (paragraph) renderedParagraph = paragraph;
    value += element.textContent ?? '';
  }
  return { value };
}

/**
 * Structural reasons a field cannot be refreshed, independent of its
 * instruction semantics.
 *
 * Revision detection is part of this pass and runs *before* the caller trusts
 * anything the classifier derived: a field whose instruction was edited under
 * tracked changes has two instruction states, and neither its kind nor its
 * bookmark target may be asserted from the mixture.
 */
function structuralRefreshBlocker(
  field: ComplexField,
  indexes: ReadonlyMap<Element, number>,
  elements: Element[],
): string | undefined {
  if (field.nested || field.hasNested) return 'nested-field';
  if (!field.separate || !field.end) return 'incomplete-field';
  if (hasRevisionAncestor(field.begin) || hasRevisionAncestor(field.end)) {
    return 'field-contains-revisions';
  }
  const startIndex = indexes.get(field.begin) ?? 0;
  const endIndex = indexes.get(field.end) ?? elements.length - 1;
  for (let index = startIndex; index <= endIndex; index += 1) {
    if (hasRevisionAncestor(elements[index]!)) return 'field-contains-revisions';
  }
  const locked = wAttribute(field.begin, 'fldLock');
  if (locked === 'true' || locked === '1') return 'locked-field';
  if (!nearestWordAncestor(field.begin, 'p')) return 'field-outside-paragraph';
  return undefined;
}

function semanticRefreshBlocker(
  field: ComplexField,
  classification: FieldInstructionClassification,
): string | undefined {
  if (
    classification.evaluationClass === 'deterministic-ref' &&
    nearestWordAncestor(field.begin, 'p') !== nearestWordAncestor(field.end!, 'p')
  ) {
    return 'cross-paragraph-field';
  }
  return classification.reason;
}

function replaceCachedResult(
  field: ComplexField,
  value: string,
): 'changed' | 'unchanged' | 'missing' {
  const first = field.resultTexts[0];
  if (!first) return 'missing';
  if (
    field.resultTexts.map((text) => text.textContent ?? '').join('') === value
  ) {
    return 'unchanged';
  }
  first.textContent = value;
  if (/^\s|\s$/u.test(value)) {
    first.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  } else {
    first.removeAttributeNS('http://www.w3.org/XML/1998/namespace', 'space');
  }
  for (const text of field.resultTexts.slice(1)) text.textContent = '';
  return 'changed';
}

function fieldLocators(
  document: Document,
  fields: ComplexField[],
): Map<ComplexField, FieldLocator> {
  const paragraphs = Array.from(document.getElementsByTagNameNS(W_NS, 'p'));
  const paragraphOrdinals = new Map<Element, number>(
    paragraphs.map((paragraph, index) => [paragraph, index]),
  );
  const nextFieldOrdinal = new Map<Element | undefined, number>();
  const locators = new Map<ComplexField, FieldLocator>();
  for (const field of fields) {
    const paragraph = nearestWordAncestor(field.begin, 'p');
    const fieldOrdinal = nextFieldOrdinal.get(paragraph) ?? 0;
    nextFieldOrdinal.set(paragraph, fieldOrdinal + 1);
    const paragraphOrdinal = paragraph
      ? paragraphOrdinals.get(paragraph)
      : undefined;
    locators.set(field, {
      ...(paragraphOrdinal === undefined ? {} : { paragraphOrdinal }),
      fieldOrdinal,
    });
  }
  return locators;
}

/**
 * Refresh the deterministic subset of complex fields in a main document story.
 *
 * Layout-dependent results are never synthesized. Callers may instead request
 * `w:dirty="true"` on their begin markers so a layout-capable host recalculates
 * them when the document is opened.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.44
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.42
 * @see https://github.com/UseJunior/safe-docx/issues/762
 */
export function refreshDocumentFieldsXml(
  documentXml: string,
  options: FieldRefreshOptions = {},
): FieldXmlRefreshResult {
  const document = parseXml(documentXml);
  const fields = collectComplexFields(document);
  const elements = enumerateElements(document);
  const indexes = new Map<Element, number>(
    elements.map((element, index) => [element, index]),
  );
  const bookmarkRanges = resolveBookmarkRanges(elements);
  const locators = fieldLocators(document, fields);
  const outcomes: FieldRefreshOutcome[] = [];
  let changed = false;

  fields.forEach((field, index) => {
    const classification = classifyFieldInstruction(fieldInstructionView(field));
    const base = {
      index,
      locator: locators.get(field)!,
      kind: classification.kind,
      instruction: classification.normalizedInstruction,
      target: classification.target,
    };
    const structuralReason =
      structuralRefreshBlocker(field, indexes, elements) ??
      semanticRefreshBlocker(field, classification);
    if (structuralReason) {
      outcomes.push({ ...base, status: 'unsupported', reason: structuralReason });
      return;
    }

    if (classification.evaluationClass === 'deterministic-ref') {
      const bookmark = bookmarkRanges.get(classification.target!);
      if (!bookmark) {
        outcomes.push({ ...base, status: 'unsupported', reason: 'bookmark-not-found' });
        return;
      }
      if (typeof bookmark === 'string') {
        outcomes.push({ ...base, status: 'unsupported', reason: bookmark });
        return;
      }
      const projection = bookmarkText(indexes, elements, bookmark, field);
      if (projection.reason) {
        outcomes.push({ ...base, status: 'unsupported', reason: projection.reason });
        return;
      }
      const replacement = replaceCachedResult(field, projection.value!);
      if (replacement === 'missing') {
        outcomes.push({ ...base, status: 'unsupported', reason: 'missing-cached-result-text' });
        return;
      }
      if (replacement === 'unchanged') {
        outcomes.push({ ...base, status: 'unchanged', reason: 'cached-result-current' });
        return;
      }
      changed = true;
      outcomes.push({ ...base, status: 'evaluated' });
      return;
    }

    if (
      classification.evaluationClass === 'layout-dependent' &&
      options.markLayoutDependentDirty
    ) {
      const dirty = wAttribute(field.begin, 'dirty');
      if (dirty !== 'true' && dirty !== '1') {
        field.begin.setAttributeNS(W_NS, 'w:dirty', 'true');
        changed = true;
        outcomes.push({ ...base, status: 'dirtied' });
      } else {
        outcomes.push({ ...base, status: 'unchanged', reason: 'already-dirty' });
      }
      return;
    }

    outcomes.push({
      ...base,
      status:
        classification.evaluationClass === 'layout-dependent'
          ? 'preserved'
          : 'unsupported',
      reason:
        classification.evaluationClass === 'layout-dependent'
          ? 'layout-refresh-not-requested'
          : classification.reason,
    });
  });

  return {
    documentXml: changed ? serializeXml(document) : documentXml,
    changed,
    outcomes,
  };
}

const ANCILLARY_STORY_PATTERN =
  /^word\/(header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/u;

/**
 * Field-bearing parts this operation does not read.
 *
 * Reported rather than ignored: a caller whose cross-references live in a
 * header cannot tell an empty outcome list from a document without fields.
 */
function skippedFieldStories(archive: DocxArchive): string[] {
  return archive
    .listFiles()
    .filter((path) => ANCILLARY_STORY_PATTERN.test(path))
    .sort();
}

/**
 * Refresh supported fields in `word/document.xml` of a DOCX package.
 *
 * Only the main story is read. Any other field-bearing part present in the
 * package is named in `skippedStories`.
 */
export async function refreshDocxFields(
  document: Buffer,
  options: FieldRefreshOptions = {},
): Promise<FieldDocxRefreshResult> {
  const archive = await DocxArchive.load(document);
  const skippedStories = skippedFieldStories(archive);
  const result = refreshDocumentFieldsXml(await archive.getDocumentXml(), options);
  if (!result.changed) {
    return { document, changed: false, outcomes: result.outcomes, skippedStories };
  }
  archive.setDocumentXml(result.documentXml);
  return {
    document: await archive.save(),
    changed: true,
    outcomes: result.outcomes,
    skippedStories,
  };
}
