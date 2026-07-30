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

export interface FieldLocator {
  paragraphOrdinal: number;
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
  instructionParts: string[];
  resultTexts: Element[];
  nested: boolean;
  hasNested: boolean;
  parent?: ComplexField;
}

interface BookmarkRange {
  start: Element;
  end: Element;
  startIndex: number;
  endIndex: number;
}

const REVISION_CONTAINERS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

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

function enumerateElements(root: Node): Element[] {
  const elements: Element[] = [];
  const visit = (node: Node): void => {
    for (const child of elementChildren(node)) {
      elements.push(child);
      visit(child);
    }
  };
  visit(root);
  return elements;
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
          instructionParts: [],
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
      field.instructionParts.push(element.textContent ?? '');
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

function bookmarkText(
  elements: Element[],
  range: BookmarkRange,
  field: ComplexField,
): { value?: string; reason?: string } {
  const fieldStart = elements.indexOf(field.begin);
  const fieldEnd = elements.indexOf(field.end!);
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
    const isRenderable =
      isWordElement(element, 't') ||
      isWordElement(element, 'tab') ||
      isWordElement(element, 'br') ||
      isWordElement(element, 'cr');
    if (!isRenderable) continue;
    const paragraph = nearestWordAncestor(element, 'p');
    if (renderedParagraph && paragraph && paragraph !== renderedParagraph) value += '\n';
    if (paragraph) renderedParagraph = paragraph;
    if (isWordElement(element, 't')) value += element.textContent ?? '';
    else if (isWordElement(element, 'tab')) value += '\t';
    else value += '\n';
  }
  return { value };
}

function unsupportedReason(
  field: ComplexField,
  classification: FieldInstructionClassification,
  elements: Element[],
): string | undefined {
  if (field.nested || field.hasNested) return 'nested-field';
  if (!field.separate || !field.end) return 'incomplete-field';
  if (
    classification.evaluationClass === 'deterministic-ref' &&
    nearestWordAncestor(field.begin, 'p') !== nearestWordAncestor(field.end, 'p')
  ) {
    return 'cross-paragraph-field';
  }
  if (hasRevisionAncestor(field.begin) || hasRevisionAncestor(field.end)) {
    return 'field-contains-revisions';
  }
  const startIndex = elements.indexOf(field.begin);
  const endIndex = elements.indexOf(field.end!);
  if (
    elements
      .slice(startIndex, endIndex + 1)
      .some((element) => hasRevisionAncestor(element))
  ) {
    return 'field-contains-revisions';
  }
  const locked = wAttribute(field.begin, 'fldLock');
  if (locked === 'true' || locked === '1') return 'locked-field';
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
    locators.set(field, {
      paragraphOrdinal: paragraphOrdinals.get(paragraph!) ?? -1,
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
  const bookmarkRanges = resolveBookmarkRanges(elements);
  const locators = fieldLocators(document, fields);
  const outcomes: FieldRefreshOutcome[] = [];
  let changed = false;

  fields.forEach((field, index) => {
    const instruction = field.instructionParts.join('');
    const classification = classifyFieldInstruction(instruction);
    const base = {
      index,
      locator: locators.get(field)!,
      kind: classification.kind,
      instruction: classification.normalizedInstruction,
      target: classification.target,
    };
    const structuralReason = unsupportedReason(field, classification, elements);
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
      const projection = bookmarkText(elements, bookmark, field);
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

/** Refresh supported fields in `word/document.xml` of a DOCX package. */
export async function refreshDocxFields(
  document: Buffer,
  options: FieldRefreshOptions = {},
): Promise<FieldDocxRefreshResult> {
  const archive = await DocxArchive.load(document);
  const result = refreshDocumentFieldsXml(await archive.getDocumentXml(), options);
  if (!result.changed) {
    return { document, changed: false, outcomes: result.outcomes };
  }
  archive.setDocumentXml(result.documentXml);
  return {
    document: await archive.save(),
    changed: true,
    outcomes: result.outcomes,
  };
}
