import { parseXml } from './xml.js';
import { childElements, createWmlElement, renameElement } from './dom-helpers.js';

const SYNTHETIC_DOC = parseXml(
  '<root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
);

const EXCLUDED_PPR_CHANGE_CHILDREN = new Set(['w:rPr', 'w:rPrChange', 'w:pPrChange', 'w:sectPr']);
const EXCLUDED_TRPR_CHANGE_CHILDREN = new Set(['w:trPrChange', 'w:ins', 'w:del']);
// CT_TcPrInner (the inner pPr under <w:tcPrChange>) preserves cell-topology
// revision children (w:cellIns, w:cellDel, w:cellMerge). Only the
// change-of-a-change marker w:tcPrChange itself is excluded. See:
// https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.previoustablecellproperties
const EXCLUDED_TCPR_CHANGE_CHILDREN = new Set(['w:tcPrChange']);
const EXCLUDED_RPR_CHANGE_CHILDREN = new Set(['w:rPrChange']);

/**
 * State for allocating monotonically increasing revision IDs.
 *
 * `moveRangeIds` exists so comparison-time emitters can reserve paired source
 * and destination IDs for move ranges while sharing the same counter.
 */
export interface RevisionIdState {
  nextId: number;
  moveRangeIds: Map<string, { sourceRangeId: number; destRangeId: number }>;
}

/**
 * Create a revision ID allocator.
 *
 * @param startId - First ID to allocate. Defaults to `1`.
 */
export function createRevisionIdState(startId: number = 1): RevisionIdState {
  return {
    nextId: startId,
    moveRangeIds: new Map(),
  };
}

/**
 * Allocate the next revision ID from a shared state object.
 */
export function allocateRevisionId(state: RevisionIdState): number {
  return state.nextId++;
}

/**
 * Serialized metadata shared by tracked-change emitters.
 */
export interface RevisionContext {
  author: string;
  date: string;
  idState: RevisionIdState;
}

/**
 * Options for constructing a revision context.
 */
export interface RevisionContextOptions {
  author: string;
  date?: Date | string;
  idState?: RevisionIdState;
}

/**
 * Format a revision timestamp as OOXML-friendly ISO 8601.
 */
export function formatDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Escape XML attribute text used in serialized revision markup.
 */
export function escapeXmlAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Create a reusable revision context for tracked-change emission.
 */
export function createRevisionContext(options: RevisionContextOptions): RevisionContext {
  const { author, date, idState = createRevisionIdState() } = options;
  return {
    author,
    date: typeof date === 'string' ? date : formatDate(date ?? new Date()),
    idState,
  };
}

/**
 * Create a fresh tracked-change container (`<w:ins>` or `<w:del>`) into which
 * the caller appends owned child nodes.
 *
 * Use this when wrapping multiple sibling elements under one revision marker.
 * For single-element wrapping, prefer `wrapElementWithIns` / `wrapElementWithDel`.
 */
export function createRevisionContainer(
  doc: Document,
  kind: 'ins' | 'del',
  ctx: RevisionContext,
): Element {
  return createRevisionWrapperElement(doc, kind, ctx);
}

/**
 * Rewrite `<w:t>` → `<w:delText>` and `<w:instrText>` → `<w:delInstrText>`
 * on the given element and all its descendants, for use inside a `<w:del>`
 * container.
 *
 * **CALLERS MUST USE THE RETURN VALUE.** When the input element itself is a
 * root `<w:t>` or `<w:instrText>`, this helper creates a renamed replacement
 * node (you cannot rename a DOM element in place); the input element is
 * detached from the tree and the new node is returned. Pattern:
 *
 *   const ready = prepareElementForDeletion(detachedElement);
 *   wrapper.appendChild(ready);
 *
 * The element MUST already be detached from any parent. Calling on an
 * attached element will leave the original tree in an inconsistent state.
 */
export function prepareElementForDeletion(element: Element): Element {
  return normalizeDeletionElement(element);
}

/**
 * Wrap an xmldom element in `<w:ins>`.
 *
 * The source element is cloned; the original DOM node is left untouched.
 */
export function wrapElementWithIns(element: Element, ctx: RevisionContext): Element {
  const wrapper = createRevisionContainer(getOwnerDocument(element), 'ins', ctx);
  wrapper.appendChild(element.cloneNode(true));
  return wrapper;
}

/**
 * Wrap an xmldom element in `<w:del>`.
 *
 * Any descendant `<w:t>` and `<w:instrText>` nodes are converted to the OOXML
 * deletion equivalents before the cloned element is appended.
 */
export function wrapElementWithDel(element: Element, ctx: RevisionContext): Element {
  const wrapper = createRevisionContainer(getOwnerDocument(element), 'del', ctx);
  const cloned = prepareElementForDeletion(element.cloneNode(true) as Element);
  wrapper.appendChild(cloned);
  return wrapper;
}

/**
 * Build a `<w:pPrChange>` wrapper containing the previous paragraph properties.
 *
 * The nested snapshot excludes children that are not valid in `CT_PPrBase`.
 */
export function buildPPrChangeElement(oldPPr: Element | null, ctx: RevisionContext): Element {
  const pPrChange = createWmlElement(
    getOwnerDocument(oldPPr),
    'pPrChange',
    revisionAttributes(ctx),
  );
  const previousPPr = createWmlElement(getOwnerDocument(oldPPr), 'pPr');

  if (oldPPr) {
    for (const child of childElements(oldPPr)) {
      if (!EXCLUDED_PPR_CHANGE_CHILDREN.has(child.tagName)) {
        previousPPr.appendChild(child.cloneNode(true));
      }
    }
  }

  pPrChange.appendChild(previousPPr);
  return pPrChange;
}

/**
 * Build a `<w:trPrChange>` wrapper containing the previous row properties.
 *
 * The nested snapshot excludes children that are not valid in `CT_TrPrBase`.
 */
export function buildTrPrChangeElement(oldTrPr: Element | null, ctx: RevisionContext): Element {
  const trPrChange = createWmlElement(
    getOwnerDocument(oldTrPr),
    'trPrChange',
    revisionAttributes(ctx),
  );
  const previousTrPr = createWmlElement(getOwnerDocument(oldTrPr), 'trPr');

  if (oldTrPr) {
    for (const child of childElements(oldTrPr)) {
      if (!EXCLUDED_TRPR_CHANGE_CHILDREN.has(child.tagName)) {
        previousTrPr.appendChild(child.cloneNode(true));
      }
    }
  }

  trPrChange.appendChild(previousTrPr);
  return trPrChange;
}

/**
 * Build a `<w:tcPrChange>` wrapper containing the previous cell properties.
 *
 * The nested snapshot excludes children that are not valid in `CT_TcPrBase`.
 */
export function buildTcPrChangeElement(oldTcPr: Element | null, ctx: RevisionContext): Element {
  const tcPrChange = createWmlElement(
    getOwnerDocument(oldTcPr),
    'tcPrChange',
    revisionAttributes(ctx),
  );
  const previousTcPr = createWmlElement(getOwnerDocument(oldTcPr), 'tcPr');

  if (oldTcPr) {
    for (const child of childElements(oldTcPr)) {
      if (!EXCLUDED_TCPR_CHANGE_CHILDREN.has(child.tagName)) {
        previousTcPr.appendChild(child.cloneNode(true));
      }
    }
  }

  tcPrChange.appendChild(previousTcPr);
  return tcPrChange;
}

/**
 * Build a `<w:rPrChange>` wrapper containing the previous run properties.
 *
 * The nested snapshot excludes any existing `w:rPrChange` child. This filtering
 * is intentional: OOXML does not permit recursively nested `w:rPrChange` (a
 * change-of-a-change is undefined), so the helper drops it. Note this is a
 * stricter contract than the legacy reconstructor's per-child loop, which
 * would have passed a nested `w:rPrChange` through verbatim. The reconstructor
 * still uses its own per-child path; this helper is for new primitive code
 * (#136 onward).
 */
export function buildRPrChangeElement(oldRPr: Element | null, ctx: RevisionContext): Element {
  const rPrChange = createWmlElement(
    getOwnerDocument(oldRPr),
    'rPrChange',
    revisionAttributes(ctx),
  );
  const previousRPr = createWmlElement(getOwnerDocument(oldRPr), 'rPr');

  if (oldRPr) {
    for (const child of childElements(oldRPr)) {
      if (!EXCLUDED_RPR_CHANGE_CHILDREN.has(child.tagName)) {
        previousRPr.appendChild(child.cloneNode(true));
      }
    }
  }

  rPrChange.appendChild(previousRPr);
  return rPrChange;
}

/**
 * Wrap serialized OOXML content in a `<w:ins>` element.
 *
 * This keeps the reconstructor on its string-based emission path while sharing
 * revision metadata handling with the DOM-aware helpers above.
 */
export function wrapSerializedContentWithIns(content: string, ctx: RevisionContext): string {
  return `${createSerializedRevisionOpenTag('w:ins', ctx)}${content}</w:ins>`;
}

/**
 * Wrap serialized OOXML content in a `<w:del>` element.
 *
 * Visible text nodes are rewritten to their deletion-tag equivalents before
 * the wrapper is serialized.
 */
export function wrapSerializedContentWithDel(content: string, ctx: RevisionContext): string {
  return `${createSerializedRevisionOpenTag('w:del', ctx)}${convertSerializedDeletionContent(content)}</w:del>`;
}

/**
 * Convert serialized run content from insertion-style text tags to deletion
 * equivalents (`w:t` -> `w:delText`, `w:instrText` -> `w:delInstrText`).
 */
export function convertSerializedDeletionContent(content: string): string {
  return content
    .replace(/<w:t([^>]*)>([^<]*)<\/w:t>/g, '<w:delText$1>$2</w:delText>')
    .replace(/<w:instrText([^>]*)>([^<]*)<\/w:instrText>/g, '<w:delInstrText$1>$2</w:delInstrText>');
}

function getOwnerDocument(element: Element | null): Document {
  return element?.ownerDocument ?? SYNTHETIC_DOC;
}

function revisionAttributes(ctx: RevisionContext): Record<string, string> {
  return {
    'w:id': String(allocateRevisionId(ctx.idState)),
    'w:author': ctx.author,
    'w:date': ctx.date,
  };
}

function createRevisionWrapperElement(
  doc: Document,
  tag: 'ins' | 'del',
  ctx: RevisionContext,
): Element {
  return createWmlElement(doc, tag, revisionAttributes(ctx));
}

function createSerializedRevisionOpenTag(
  tagName: 'w:ins' | 'w:del',
  ctx: RevisionContext,
): string {
  const id = allocateRevisionId(ctx.idState);
  return `<${tagName} w:id="${id}" w:author="${escapeXmlAttr(ctx.author)}" w:date="${ctx.date}">`;
}

function normalizeDeletionElement(element: Element): Element {
  for (const child of childElements(element)) {
    normalizeDeletionElement(child);
  }

  if (element.tagName === 'w:t') {
    return renameElement(element, 'w:delText');
  }
  if (element.tagName === 'w:instrText') {
    return renameElement(element, 'w:delInstrText');
  }

  return element;
}
