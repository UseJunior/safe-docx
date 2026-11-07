import { parseXml, serializeXml } from './xml.js';
import { childElements, createWmlElement, renameElement } from './dom-helpers.js';
import { OOXML, W } from './namespaces.js';
import { REVISION_ID_ELEMENT_NAME_SET } from './revision-vocabulary.js';

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
// CT_SectPrBase is EG_SectPrContents only: the live CT_SectPr adds
// EG_HdrFtrReferences and the w:sectPrChange record itself, neither of which
// may appear in the historical snapshot. Matched by namespace + local name so
// the policy does not depend on the source document's prefix.
const EXCLUDED_SECTPR_CHANGE_CHILDREN = new Set([
  'headerReference',
  'footerReference',
  'sectPrChange',
]);
const SECTPR_BASE_ATTRIBUTE_NAMES = new Set([
  'rsidRPr',
  'rsidDel',
  'rsidR',
  'rsidSect',
]);

/**
 * State for allocating monotonically increasing revision IDs.
 *
 * moveRangeIds exists so comparison-time emitters can reserve paired source
 * and destination IDs for move ranges while sharing the same counter.
 */
export interface RevisionIdState {
  nextId: number;
  moveRangeIds: Map<string, { sourceRangeId: number; destRangeId: number }>;
}

export type RevisionIdAllocatorStatus = 'unseeded' | 'seeding' | 'ready';

export interface RevisionIdAllocatorOptions {
  startId?: number;
  moveRangeIds?: Map<string, { sourceRangeId: number; destRangeId: number }>;
  status?: RevisionIdAllocatorStatus;
}

export type RevisionIdSeeder =
  | number
  | (Document | Element)[]
  | (() => number | (Document | Element)[] | Promise<number | (Document | Element)[]>);

/**
 * Encapsulated revision ID allocator representing unseeded, seeding, and ready
 * lifecycle states behind the allocator boundary.
 */
export class RevisionIdAllocator implements RevisionIdState {
  private _nextId: number;
  private _status: RevisionIdAllocatorStatus;
  private _seedPromise: Promise<this> | null = null;
  readonly moveRangeIds: Map<string, { sourceRangeId: number; destRangeId: number }>;

  constructor(options?: RevisionIdAllocatorOptions) {
    this._nextId = options?.startId ?? 1;
    this.moveRangeIds = options?.moveRangeIds ?? new Map();
    if (options?.status) {
      this._status = options.status;
    } else if (options?.startId !== undefined) {
      this._status = 'ready';
    } else {
      this._status = 'unseeded';
    }
  }

  get status(): RevisionIdAllocatorStatus {
    return this._status;
  }

  get isReady(): boolean {
    return this._status === 'ready';
  }

  get nextId(): number {
    return this._nextId;
  }

  set nextId(val: number) {
    this._nextId = val;
  }

  /**
   * Allocate the next revision ID.
   * Throws if the allocator is not yet in 'ready' status.
   */
  allocate(): number {
    if (this._status !== 'ready') {
      throw new Error('Revision ID allocator is not ready (status: ' + this._status + ')');
    }
    return this._nextId++;
  }

  /**
   * Reserve paired source and destination range IDs for move operations.
   */
  reserveMoveRange(key: string): { sourceRangeId: number; destRangeId: number } {
    if (this._status !== 'ready') {
      throw new Error('Revision ID allocator is not ready (status: ' + this._status + ')');
    }
    let pair = this.moveRangeIds.get(key);
    if (!pair) {
      pair = {
        sourceRangeId: this.allocate(),
        destRangeId: this.allocate(),
      };
      this.moveRangeIds.set(key, pair);
    }
    return pair;
  }

  /**
   * Reset the allocator back to unseeded status.
   */
  reset(): void {
    this._status = 'unseeded';
    this._seedPromise = null;
  }

  /**
   * Seed the allocator.
   * - Shares concurrent in-flight seed operations.
   * - Retries after failed seeds.
   * - Resolves immediately if already ready (unless force=true).
   */
  async seed(
    seeder: RevisionIdSeeder,
    options?: { force?: boolean },
  ): Promise<this> {
    if (this._status === 'ready' && !options?.force) {
      return this;
    }

    if (this._status === 'seeding' && this._seedPromise) {
      return this._seedPromise;
    }

    this._status = 'seeding';
    const seedOp = async (): Promise<this> => {
      try {
        const result = typeof seeder === 'function' ? await seeder() : await seeder;
        if (typeof result === 'number') {
          this._nextId = Math.max(this._nextId, result);
        } else if (Array.isArray(result)) {
          const startingId = inferStartingRevisionId(...result);
          this._nextId = Math.max(this._nextId, startingId);
        }
        this._status = 'ready';
        return this;
      } catch (err) {
        this._status = 'unseeded';
        throw err;
      } finally {
        this._seedPromise = null;
      }
    };

    const promise = seedOp();
    this._seedPromise = promise;
    return promise;
  }

  /**
   * Ensure the allocator is ready. If unseeded, runs the provided seeder or defaults to 1.
   */
  async ensureReady(seeder?: RevisionIdSeeder): Promise<this> {
    if (this.isReady) return this;
    if (seeder !== undefined) {
      return this.seed(seeder);
    }
    return this.seed(1);
  }
}

/**
 * WordprocessingML elements that carry package-wide revision w:id attributes.
 */
function getRevisionWordIdValue(element: Element): number | null {
  const raw =
    element.getAttributeNS(OOXML.W_NS, 'id')
    ?? element.getAttribute('w:id')
    ?? element.getAttribute('id');
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Compute the first unused revision ID that is strictly higher than any
 * existing revision ID found across the supplied documents.
 */
export function inferStartingRevisionId(...docs: (Document | Element)[]): number {
  let maxId = 0;

  for (const doc of docs) {
    if (!doc) continue;
    const elements: Element[] = typeof (doc as any).getElementsByTagName === 'function'
      ? Array.from((doc as Document | Element).getElementsByTagName('*'))
      : [(doc as Element)];

    for (const node of elements) {
      const localName = node.localName ?? '';
      if (!REVISION_ID_ELEMENT_NAME_SET.has(localName)) continue;
      if (node.namespaceURI && node.namespaceURI !== OOXML.W_NS) continue;
      const value = getRevisionWordIdValue(node);
      if (value !== null && value > maxId) {
        maxId = value;
      }
    }
  }

  return maxId + 1;
}

/**
 * Compute a starting RevisionIdAllocator whose first allocated w:id is
 * higher than any existing revision id found in the supplied documents.
 */
export function inferStartingRevisionIdState(...docs: (Document | Element)[]): RevisionIdAllocator {
  const startId = inferStartingRevisionId(...docs);
  return createRevisionIdAllocator({ startId, status: 'ready' });
}

/**
 * Create a revision ID allocator with lifecycle management.
 */
export function createRevisionIdAllocator(options?: RevisionIdAllocatorOptions): RevisionIdAllocator {
  return new RevisionIdAllocator(options);
}

/**
 * Create a revision ID allocator.
 *
 * @param startId - First ID to allocate. Defaults to 1.
 */
export function createRevisionIdState(startId: number = 1): RevisionIdAllocator {
  return new RevisionIdAllocator({ startId, status: 'ready' });
}

/**
 * Allocate the next revision ID from a shared state object.
 */
export function allocateRevisionId(state: RevisionIdState): number {
  if (state instanceof RevisionIdAllocator) {
    return state.allocate();
  }
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

function revisionAuthor(el: Element): string | null {
  return el.getAttributeNS(OOXML.W_NS, 'author') || el.getAttribute('w:author') || null;
}

/**
 * The author of a paragraph's existing direct `w:pPrChange` when it differs
 * from `ctx.author`, otherwise `null`.
 */
export function foreignPPrChangeAuthor(pPr: Element | null, ctx: RevisionContext): string | null {
  if (!pPr) return null;
  for (const child of childElements(pPr)) {
    if (child.namespaceURI === OOXML.W_NS && child.localName === 'pPrChange') {
      const author = revisionAuthor(child);
      if (author !== ctx.author) return author ?? '';
    }
  }
  return null;
}

/**
 * Record a paragraph-property edit on `pPr` as a `w:pPrChange`.
 *
 * CT_PPr permits at most one `w:pPrChange`. When the paragraph already has one
 * by the same author, it is kept: its snapshot is the older baseline, so a
 * reject restores the state before every edit in the series (Word likewise
 * keeps the original snapshot when a tracked paragraph is reformatted). Any
 * other wrapper is replaced by a new snapshot of `oldPPr`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 */
export function recordPPrChange(pPr: Element, oldPPr: Element | null, ctx: RevisionContext): void {
  const existing = childElements(pPr)
    .filter((child) => child.namespaceURI === OOXML.W_NS && child.localName === 'pPrChange');
  if (existing.length === 1 && revisionAuthor(existing[0]!) === ctx.author) return;
  for (const stale of existing) pPr.removeChild(stale);
  pPr.appendChild(buildPPrChangeElement(oldPPr, ctx));
}

/**
 * Build a `<w:trPrChange>` wrapper containing the previous row properties.
 *
 * The nested snapshot excludes children that are not valid in `CT_TrPrBase`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.37
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
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.36
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
 * Build the `CT_SectPrBase` snapshot recorded inside `<w:sectPrChange>`.
 *
 * The snapshot keeps only `EG_SectPrContents` and the base `rsid*`
 * attributes. Header/footer references (`EG_HdrFtrReferences`) are
 * relationship-bound properties of the live `CT_SectPr` only, and a prior
 * `w:sectPrChange` would be a change-of-a-change; both are excluded. This is
 * the single snapshot policy shared by every emitter of section-property
 * revisions, including the comparison serializer (#944).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.17
 * @see https://github.com/UseJunior/safe-docx/issues/944
 */
export function buildSectPrBaseSnapshot(
  oldSectPr: Element | null | undefined,
  ownerDocument: Document,
): Element {
  const previousSectPr = createWmlElement(ownerDocument, W.sectPr);
  if (!oldSectPr) return previousSectPr;

  for (let i = 0; i < oldSectPr.attributes.length; i++) {
    const attribute = oldSectPr.attributes.item(i);
    if (
      attribute
      && attribute.namespaceURI === OOXML.W_NS
      && SECTPR_BASE_ATTRIBUTE_NAMES.has(attribute.localName)
    ) {
      previousSectPr.setAttributeNS(
        OOXML.W_NS,
        `w:${attribute.localName}`,
        attribute.value,
      );
    }
  }

  for (const child of childElements(oldSectPr)) {
    if (
      child.namespaceURI === OOXML.W_NS
      && EXCLUDED_SECTPR_CHANGE_CHILDREN.has(child.localName)
    ) {
      continue;
    }
    previousSectPr.appendChild(child.cloneNode(true));
  }
  return previousSectPr;
}

/**
 * Build a `<w:sectPrChange>` wrapper containing the previous section
 * properties as a `CT_SectPrBase` snapshot (see `buildSectPrBaseSnapshot`).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see #654
 */
export function buildSectPrChangeElement(
  oldSectPr: Element,
  ctx: RevisionContext,
): Element {
  const ownerDocument = getOwnerDocument(oldSectPr);
  const sectPrChange = createWmlElement(
    ownerDocument,
    'sectPrChange',
    revisionAttributes(ctx),
  );
  sectPrChange.appendChild(buildSectPrBaseSnapshot(oldSectPr, ownerDocument));
  return sectPrChange;
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
      if (!(child.namespaceURI === OOXML.W_NS && child.localName === 'rPrChange')) {
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
 * Matches a `<w:t>` or `<w:instrText>` open tag (including the self-closing
 * form). Used as a fast path: content with no convertible tags is returned
 * byte-for-byte unchanged, skipping the parse/serialize round-trip.
 */
const CONVERTIBLE_TEXT_TAG = /<w:(?:t|instrText)[\s/>]/;

/**
 * Convert serialized run content from insertion-style text tags to deletion
 * equivalents (`w:t` -> `w:delText`, `w:instrText` -> `w:delInstrText`).
 *
 * The fragment is parsed into a DOM and renamed via the same traversal as
 * `prepareElementForDeletion`, so attribute order is preserved and shapes a
 * regex sweep mishandles (self-closing `<w:t/>`, attribute values containing
 * `>`) convert correctly. Namespace prefixes the fragment uses without an
 * inline declaration are bound on a temporary wrapper root that is stripped
 * from the returned serialization.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/102
 */
export function convertSerializedDeletionContent(content: string): string {
  if (!CONVERTIBLE_TEXT_TAG.test(content)) {
    return content;
  }

  const doc = parseXml(`<root${declareContentPrefixes(content)}>${content}</root>`);
  for (const child of childElements(doc.documentElement)) {
    normalizeDeletionElement(child);
  }

  // Strip the wrapper root: everything between the end of its open tag and
  // the start of its close tag. Safe because the declared URIs contain no '>'.
  const serialized = serializeXml(doc);
  return serialized.slice(serialized.indexOf('>') + 1, serialized.lastIndexOf('<'));
}

/**
 * Matches a `prefix:` occurrence in markup context — after `<`, `</`, or
 * whitespace (attribute position). May over-match inside text content, which
 * is harmless: it only yields an unused declaration on the wrapper root.
 */
const PREFIX_SCAN = /[<\s]\/?([A-Za-z_][A-Za-z0-9_.-]*):/g;

/**
 * Build `xmlns` declarations for every namespace prefix a serialized fragment
 * uses, so the fragment parses under a wrapper root (xmldom rejects
 * undeclared prefixes). `w` binds to the real WordprocessingML namespace —
 * the deletion rename produces elements in that namespace — while unknown
 * prefixes get placeholder URIs. The wrapper root carrying these declarations
 * is stripped after serialization, so placeholders never reach the output;
 * fragments serialized from a real document carry their own inline
 * declarations, which take precedence over the wrapper's.
 */
function declareContentPrefixes(content: string): string {
  const declarations = new Map<string, string>([['w', OOXML.W_NS]]);
  for (const match of content.matchAll(PREFIX_SCAN)) {
    const prefix = match[1]!;
    if (prefix !== 'xml' && prefix !== 'xmlns' && !declarations.has(prefix)) {
      declarations.set(prefix, `urn:safe-docx:undeclared-prefix:${prefix}`);
    }
  }
  return [...declarations].map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`).join('');
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
  return `<${tagName} w:id="${id}" w:author="${escapeXmlAttr(ctx.author)}" w:date="${escapeXmlAttr(ctx.date)}">`;
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
