/**
 * Atomizer Module
 *
 * Provides factory functions for creating ComparisonUnitAtom instances.
 * Implements the core atomization logic from WmlComparer.
 *
 * @see WmlComparer.cs ComparisonUnitAtom constructor (lines 2314-2343)
 */

import { createHash } from 'crypto';
import { parseXml } from '@usejunior/docx-core';
import {
  ComparisonUnitAtom,
  CorrelationStatus,
  OpcPart,
  WmlElement,
} from '@usejunior/docx-core';
import {
  getLeafText,
  setLeafText,
  childElements,
  findChildByTagName,
} from '@usejunior/docx-core';
import { OOXML } from '@usejunior/docx-core';
import {
  captureInlineSdtPassthrough,
  sameOpaqueOwner,
  validateInlineSdtNamespaceOwnership,
} from './baselines/atomizer/opaquePassthrough.js';

// =============================================================================
// Shared synthetic document for creating virtual elements
// =============================================================================

/**
 * A shared document used to create synthetic/virtual DOM elements.
 * These elements are not part of any real parsed document.
 */
const SYNTHETIC_DOC = parseXml('<root/>');

// =============================================================================
// SHA1 Hashing
// =============================================================================

/**
 * Calculate SHA1 hash of a string.
 *
 * Used for quick equality checking of comparison units.
 *
 * @param content - The string content to hash
 * @returns Hexadecimal SHA1 hash string
 */
export function sha1(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}

/**
 * Attributes that should be excluded from hashing for certain elements.
 *
 * - xml:space: A whitespace preservation hint that doesn't affect content.
 *   Documents may have this attribute present on some w:t elements and absent
 *   on others with identical text, causing spurious hash mismatches.
 */
const IGNORED_HASH_ATTRIBUTES = new Set(['xml:space']);

/**
 * Build the pre-hash identity string for a WmlElement.
 *
 * This is the exact string {@link hashElement} feeds to SHA1: tag name, sorted
 * attributes (excluding presentation-only ones like `xml:space`), and the leaf
 * text. Exposed so the interner can key on element identity directly, avoiding a
 * crypto round-trip where only an equality token is needed.
 *
 * @param element - The element to identify
 * @returns The deterministic pre-hash identity string
 */
export function elementIdentityString(element: WmlElement): string {
  const parts: string[] = [element.tagName];

  // Sort attributes for deterministic hashing, excluding presentation-only attributes
  const attrs: [string, string][] = [];
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i]!;
    attrs.push([attr.name, attr.value]);
  }
  const sortedAttrs = attrs
    .filter(([key]) => !IGNORED_HASH_ATTRIBUTES.has(key))
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of sortedAttrs) {
    parts.push(`${key}=${value}`);
  }

  const leafText = getLeafText(element);
  if (leafText !== undefined) {
    parts.push(leafText);
  }

  return parts.join('|');
}

/**
 * Calculate SHA1 hash for a WmlElement.
 *
 * Includes tag name, attributes, and text content for uniqueness.
 * Excludes presentation-only attributes like xml:space that don't affect content.
 *
 * @param element - The element to hash
 * @returns Hexadecimal SHA1 hash string
 */
export function hashElement(element: WmlElement): string {
  return sha1(elementIdentityString(element));
}

// =============================================================================
// Atom identity: lazy SHA1 + interner key
// =============================================================================

/**
 * Backing slots for an atom's lazily-computed SHA1 and its interner key.
 *
 * `sha1Hash` is exposed as an enumerable accessor (see {@link LAZY_SHA1_DESCRIPTOR})
 * so that:
 * - reads that genuinely need the digest (empty-paragraph context signatures,
 *   the numbering/hyperlink salts, tests asserting 40-char hex) materialize it
 *   on first access and cache it, and
 * - the overwhelmingly common case — a `w:t` leaf compared only by its interned
 *   identity id in the LCS loops — never triggers `createHash('sha1')` at all.
 *
 * The backing slots are non-enumerable so `{...atom}` spreads (documentReconstructor)
 * copy only a materialized `sha1Hash` string, not the compute closure.
 */
const SHA1_CACHE = Symbol('atom.sha1Cache');
const SHA1_COMPUTE = Symbol('atom.sha1Compute');

/**
 * Interner key: the finalized `atomsEqual` triple as a single string, of shape
 * `identityCore \u0000 textContent \u0000 tagName`. Kept in sync with `sha1Hash`
 * by the salt sites and by {@link refreshAtomIdentityAfterTextMutation}.
 */
const IDENTITY_KEY = Symbol('atom.identityKey');

/**
 * Interned integer identity, assigned by {@link assignIdentityIds} once all
 * identity mutations (numbering + hyperlink salts, run merges) are finalized,
 * immediately before LCS. Module-private (not exported, and stored as a
 * non-enumerable property) so the public `ComparisonUnit` shape is unchanged,
 * `JSON.stringify` never emits it, and `{...atom}` spreads never carry it.
 */
const IDENTITY_ID = Symbol('atom.identityId');

/** Separator between the three identity components; `\u0000` is the file's established sentinel. */
const IDENTITY_SEP = '\u0000';

const LAZY_SHA1_DESCRIPTOR: PropertyDescriptor = {
  enumerable: true,
  configurable: true,
  get(this: Record<symbol, unknown>): string {
    let cached = this[SHA1_CACHE] as string | undefined;
    if (cached === undefined) {
      cached = (this[SHA1_COMPUTE] as (self: unknown) => string)(this);
      this[SHA1_CACHE] = cached;
    }
    return cached;
  },
  set(this: Record<symbol, unknown>, value: string): void {
    // Salt sites assign the extended (colon-form) hash verbatim; store as-is so
    // subsequent reads return byte-identical strings.
    this[SHA1_CACHE] = value;
  },
};

/** Build the interner key from an atom's finalized identity components. */
function buildIdentityKey(identityCore: string, textContent: string, tagName: string): string {
  return identityCore + IDENTITY_SEP + textContent + IDENTITY_SEP + tagName;
}

/**
 * Install lazy `sha1Hash` and the interner key on a freshly-built atom literal.
 *
 * @param atom - The atom literal, omitting `sha1Hash` (installed here as an accessor)
 * @param computeHash - Produces the SHA1 hex on first read of `sha1Hash`
 * @param identityCore - The pre-hash identity string the hash derives from
 *   (`elementIdentityString(el)` for element leaves, or the raw `hashContent`
 *   string for empty-paragraph atoms)
 * @param textContent - Recursive text content, folded into the key so the
 *   interned relation matches `atomsEqual`'s `textContent` recheck exactly
 * @param tagName - The content element's tag name
 */
function withAtomIdentity(
  atom: Omit<ComparisonUnitAtom, 'sha1Hash'>,
  computeHash: (self: ComparisonUnitAtom) => string,
  identityCore: string,
  textContent: string,
  tagName: string
): ComparisonUnitAtom {
  Object.defineProperty(atom, SHA1_COMPUTE, {
    value: computeHash,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(atom, SHA1_CACHE, {
    value: undefined,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(atom, IDENTITY_KEY, {
    value: buildIdentityKey(identityCore, textContent, tagName),
    enumerable: false,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(atom, 'sha1Hash', LAZY_SHA1_DESCRIPTOR);
  return atom as ComparisonUnitAtom;
}

/** Read an atom's interner key (undefined for atoms not built via {@link withAtomIdentity}). */
function getIdentityKey(atom: ComparisonUnitAtom): string | undefined {
  return (atom as unknown as Record<symbol, unknown>)[IDENTITY_KEY] as string | undefined;
}

/**
 * Drop any interned id so a subsequent identity change can't be consumed as a
 * stale token. Any mutation of an atom's identity (salt or text merge) must call
 * this; the id is re-derived by the next {@link assignIdentityIds} pass. In the
 * production pipeline these mutations run before interning (so this is a no-op),
 * but the helpers are exported, so we invalidate defensively.
 */
function invalidateIdentityId(atom: ComparisonUnitAtom): void {
  delete (atom as unknown as Record<symbol, unknown>)[IDENTITY_ID];
}

/** Append a structured salt suffix to both `sha1Hash` and the interner key, keeping them in sync. */
export function appendIdentitySalt(atom: ComparisonUnitAtom, suffix: string): void {
  atom.sha1Hash = `${atom.sha1Hash}${suffix}`;
  const key = getIdentityKey(atom);
  if (key !== undefined) {
    (atom as unknown as Record<symbol, unknown>)[IDENTITY_KEY] = key + suffix;
  }
  invalidateIdentityId(atom);
}

/**
 * After an in-place text mutation of `contentElement` (run merge), drop the
 * cached hash so it recomputes from the mutated element, and rebuild the
 * interner key from the new text.
 */
function refreshAtomIdentityAfterTextMutation(atom: ComparisonUnitAtom): void {
  const el = atom.contentElement;
  const record = atom as unknown as Record<symbol, unknown>;
  record[SHA1_CACHE] = undefined;
  if (record[IDENTITY_KEY] !== undefined) {
    record[IDENTITY_KEY] = buildIdentityKey(
      elementIdentityString(el),
      el.textContent ?? '',
      el.tagName
    );
  }
  invalidateIdentityId(atom);
}

/**
 * Assign interned integer identities to a batch of atoms via a shared interner.
 * Must run after every identity mutation and before LCS. Two atoms receive the
 * same id exactly when they satisfy the `atomsEqual` relation.
 */
export function assignIdentityIds(atoms: ComparisonUnitAtom[], interner: IdentityInterner): void {
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]!;
    let key = getIdentityKey(atom);
    if (key === undefined) {
      // A construction site bypassed withAtomIdentity: surface the wiring gap
      // loudly outside production, and in production fall back to a key that still
      // encodes the FULL atomsEqual relation (hash + recursive text + tag) — not
      // sha1Hash alone — so equality stays sound even on the fallback path.
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(
          'assignIdentityIds: atom is missing its interner key — a ComparisonUnitAtom ' +
            'was constructed without withAtomIdentity()'
        );
      }
      key = buildIdentityKey(
        atom.sha1Hash,
        atom.contentElement.textContent ?? '',
        atom.contentElement.tagName
      );
    }
    // Non-enumerable so the id never leaks through `{...atom}` spreads or JSON.
    Object.defineProperty(atom, IDENTITY_ID, {
      value: interner.intern(key),
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
}

/** Read an atom's interned identity id, or undefined if it was never interned. */
export function getIdentityId(atom: ComparisonUnitAtom): number | undefined {
  return (atom as unknown as Record<symbol, unknown>)[IDENTITY_ID] as number | undefined;
}

/**
 * String interner: maps each distinct identity string to a small integer, shared
 * across both documents in one compare so equal identities get equal integers.
 * One instance per `compareDocuments` invocation — never a process-global.
 */
export class IdentityInterner {
  private readonly map = new Map<string, number>();
  private next = 0;

  intern(key: string): number {
    let id = this.map.get(key);
    if (id === undefined) {
      id = this.next++;
      this.map.set(key, id);
    }
    return id;
  }

  get size(): number {
    return this.map.size;
  }
}

// =============================================================================
// Revision Tracking Detection
// =============================================================================

/**
 * Revision tracking element tag names.
 */
const REVISION_TRACKING_TAGS = new Set(['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo']);

/**
 * Find a revision tracking element in the ancestor chain.
 *
 * Searches ancestors from nearest to root for w:ins, w:del, w:moveFrom, or w:moveTo.
 *
 * @param ancestors - Ancestor elements from root to parent
 * @returns The revision tracking element if found, undefined otherwise
 */
export function findRevisionTrackingElement(
  ancestors: WmlElement[]
): WmlElement | undefined {
  // Search from nearest ancestor to root
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    if (ancestor && REVISION_TRACKING_TAGS.has(ancestor.tagName)) {
      return ancestor;
    }
  }
  return undefined;
}

/**
 * Determine initial correlation status from revision tracking element.
 *
 * @param revTrackElement - The revision tracking element (if any)
 * @returns Initial correlation status
 */
export function getStatusFromRevisionTracking(
  revTrackElement: WmlElement | undefined
): CorrelationStatus {
  if (!revTrackElement) {
    return CorrelationStatus.Unknown;
  }

  switch (revTrackElement.tagName) {
    case 'w:ins':
      return CorrelationStatus.Inserted;
    case 'w:del':
      return CorrelationStatus.Deleted;
    case 'w:moveFrom':
      return CorrelationStatus.MovedSource;
    case 'w:moveTo':
      return CorrelationStatus.MovedDestination;
    default:
      return CorrelationStatus.Unknown;
  }
}

// =============================================================================
// Ancestor Unid Extraction
// =============================================================================

/**
 * Extract Unid attributes from ancestor elements.
 *
 * WmlComparer uses w:Unid attributes to correlate elements between documents.
 *
 * @param ancestors - Ancestor elements from root to parent
 * @returns Array of Unid values found in ancestors
 */
export function extractAncestorUnids(ancestors: WmlElement[]): string[] {
  const unids: string[] = [];
  for (const ancestor of ancestors) {
    const unid = ancestor.getAttribute('w:Unid');
    if (unid) {
      unids.push(unid);
    }
  }
  return unids;
}

// =============================================================================
// Leaf Node Detection
// =============================================================================

/**
 * Tag names that represent leaf nodes in the atomization tree.
 */
const LEAF_NODE_TAGS = new Set([
  'w:t', // Text
  'w:br', // Break
  'w:cr', // Carriage return
  'w:tab', // Tab character
  'w:sym', // Symbol
  'w:softHyphen', // Soft hyphen
  'w:noBreakHyphen', // Non-breaking hyphen
  'w:fldChar', // Field character
  'w:instrText', // Field instruction text
  'w:delText', // Deleted text
  'w:dayShort', // Date field short day
  'w:dayLong', // Date field long day
  'w:monthShort', // Date field short month
  'w:monthLong', // Date field long month
  'w:yearShort', // Date field short year
  'w:yearLong', // Date field long year
  'w:annotationRef', // Annotation reference
  'w:footnoteRef', // Footnote reference marker
  'w:endnoteRef', // Endnote reference marker
  'w:footnoteReference', // Footnote reference
  'w:endnoteReference', // Endnote reference
  'w:commentReference', // Comment reference anchor (run-level child).
  // Note: w:commentRangeStart / w:commentRangeEnd / w:bookmarkStart /
  // w:bookmarkEnd / w:moveFromRangeStart/End / w:moveToRangeStart/End /
  // w:permStart / w:permEnd are paragraph-level markers
  // (siblings of <w:r>, not children). They are
  // tracked in PARAGRAPH_LEVEL_TAGS below and atomized via a separate branch in
  // atomizeTreeInternal so the reconstructor can emit them outside synthetic
  // <w:r> wrappers.
  'w:separator', // Separator
  'w:continuationSeparator', // Continuation separator
  'w:pgNum', // Page number
  'w:drawing', // Drawing (treat as atomic)
  'w:pict', // Picture (VML)
  'w:object', // Embedded object
  'mc:AlternateContent', // Alternate content
]);

/**
 * Tag names that are paragraph-level OOXML markers.
 *
 * These elements are valid as direct children of <w:p> (and revision wrappers
 * like <w:ins>/<w:del>/<w:moveFrom>/<w:moveTo>) but never inside <w:r>. The
 * rebuild reconstructor emits them as siblings of <w:r>, not leaves wrapped in
 * a synthetic run.
 *
 * Scope: commentRange, bookmark, moveFromRange / moveToRange, and
 * range-permission (permStart / permEnd) markers. Explicit move-range markers
 * coexist with the synthetic emission in wrapWithMoveFrom and wrapWithMoveTo:
 * the reconstructor suppresses synthesis for paragraphs whose atom stream
 * already carries explicit markers of the same kind, so the two paths never
 * double-emit.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @see https://github.com/UseJunior/safe-docx/issues/110
 * @see https://github.com/UseJunior/safe-docx/issues/111
 */
export const PARAGRAPH_LEVEL_TAGS = new Set([
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:bookmarkStart',
  'w:bookmarkEnd',
  'w:moveFromRangeStart',
  'w:moveFromRangeEnd',
  'w:moveToRangeStart',
  'w:moveToRangeEnd',
  'w:permStart',
  'w:permEnd',
]);

/**
 * Special tag name for empty paragraph boundary atoms.
 * These atoms are created for paragraphs that have no content (only w:pPr).
 */
export const EMPTY_PARAGRAPH_TAG = '__emptyParagraph__';

export interface AtomizeTreeOptions {
  /**
   * Clone leaf nodes into atom.contentElement instead of reusing the parsed AST nodes.
   *
   * This prevents boundary normalization (merge/split) from mutating the document AST,
   * which is required for safe `reconstructionMode: 'inplace'`.
   *
   * Default: false (preserve historical behavior/perf).
   */
  cloneLeafNodes?: boolean;
  /**
   * Allow normalization to merge atoms across run boundaries if formatting matches.
   *
   * For `reconstructionMode: 'inplace'`, this should usually be false so that atom
   * ancestry continues to point at the correct run for wrapping.
   *
   * Default: true.
   */
  mergeAcrossRuns?: boolean;
  /**
   * Allow punctuation normalization to merge across run boundaries.
   *
   * Default: true.
   */
  mergePunctuationAcrossRuns?: boolean;
  /**
   * Split text atoms on word boundaries for fine-grained diffs.
   *
   * Default: true.
   */
  splitTextIntoWords?: boolean;
  /**
   * Atomize paragraph-level markers (commentRange*, bookmark*, moveFromRange*,
   * moveToRange*, perm* — see PARAGRAPH_LEVEL_TAGS) so the rebuild
   * reconstructor can re-emit them as siblings of <w:r>.
   *
   * MUST be false for inplace mode. Inplace handlers are run-anchored and
   * silently no-op on atoms with no sourceRunElement, but inplace's bookmark
   * reconciliation breaks if bookmarkStart/End atoms enter the stream
   * (orphaned bookmark warnings, round-trip safety check fails).
   *
   * Default: false.
   */
  atomizeParagraphLevelMarkers?: boolean;
  /** Capture unchanged inline SDTs as bounded opaque rebuild nodes. */
  captureInlineSdtPassthrough?: boolean;
}

/**
 * Check if an element is a leaf node for atomization.
 *
 * Leaf nodes are the smallest units that can be compared.
 *
 * @param element - The element to check
 * @returns True if this is a leaf node
 */
export function isLeafNode(element: WmlElement): boolean {
  return LEAF_NODE_TAGS.has(element.tagName);
}

/**
 * Check if an element is a paragraph-level OOXML marker.
 *
 * Paragraph-level markers (PARAGRAPH_LEVEL_TAGS: commentRange*, bookmark*,
 * moveFromRange*, moveToRange*, perm*) are
 * atomized only when they sit inside a <w:p> ancestor — body/table-sibling
 * placements stay out of the atom stream and are handled by the scaffold-strip
 * block in the reconstructor.
 */
export function isParagraphLevelLeaf(element: WmlElement): boolean {
  return PARAGRAPH_LEVEL_TAGS.has(element.tagName);
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Options for creating a ComparisonUnitAtom.
 */
export interface CreateAtomOptions {
  /** The leaf element (w:t, w:br, etc.) */
  contentElement: WmlElement;
  /** Ancestor elements from root to parent of contentElement */
  ancestors: WmlElement[];
  /** The OPC part this atom belongs to */
  part: OpcPart;
}

/**
 * Create a ComparisonUnitAtom from a leaf element.
 *
 * Replicates the C# ComparisonUnitAtom constructor logic:
 * 1. Finds revision tracking elements in ancestors
 * 2. Sets initial correlation status based on revision type
 * 3. Extracts ancestor Unids for correlation
 * 4. Calculates SHA1 hash for equality checking
 *
 * @param options - Options containing element, ancestors, and part
 * @returns A new ComparisonUnitAtom
 *
 * @see WmlComparer.cs lines 2314-2343
 */
export function createComparisonUnitAtom(
  options: CreateAtomOptions
): ComparisonUnitAtom {
  const { contentElement, ancestors, part } = options;

  // Find revision tracking element in ancestors
  const revTrackElement = findRevisionTrackingElement(ancestors);

  // Determine initial correlation status
  const correlationStatus = getStatusFromRevisionTracking(revTrackElement);

  // Extract Unids from ancestors
  const ancestorUnids = extractAncestorUnids(ancestors);

  // Pre-hash identity string; the SHA1 digest is computed lazily on first read.
  const identityCore = elementIdentityString(contentElement);

  // Extract and clone run properties for first-class rPr access
  const rPrElement = getRunProperties({ ancestorElements: ancestors } as ComparisonUnitAtom);
  const rPr = rPrElement ? (rPrElement.cloneNode(true) as Element) : null;

  return withAtomIdentity(
    {
      contentElement,
      ancestorElements: [...ancestors], // Copy to avoid mutation
      ancestorUnids,
      part,
      revTrackElement,
      correlationStatus,
      rPr,
    },
    (self) => hashElement(self.contentElement),
    identityCore,
    contentElement.textContent ?? '',
    contentElement.tagName
  );
}

// =============================================================================
// Tree Atomization
// =============================================================================

/**
 * Check if a paragraph element is empty (has no content-bearing children).
 *
 * Empty paragraphs have only paragraph properties, or proofing-error anchors.
 * `w:proofErr` marks spelling/grammar proofing state and carries no document
 * content, so a paragraph containing only those anchors is empty for
 * comparison.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.8.1
 * @see https://github.com/UseJunior/safe-docx/issues/456
 */
const EMPTY_PARAGRAPH_TRANSPARENT_TAGS = new Set(['w:pPr', 'w:proofErr']);

function isEmptyParagraph(node: WmlElement): boolean {
  if (node.tagName !== 'w:p') return false;
  const kids = childElements(node);
  if (kids.length === 0) return true;

  for (const child of kids) {
    if (!EMPTY_PARAGRAPH_TRANSPARENT_TAGS.has(child.tagName)) {
      return false;
    }
  }
  return true;
}

/**
 * Create an empty paragraph boundary atom with context-aware hash.
 *
 * These atoms represent empty paragraphs that have no text content,
 * ensuring they are preserved during document reconstruction.
 *
 * The hash includes a paragraph-level content signature for the previous
 * content-bearing paragraph and a consecutive-empty index. Text fragment
 * boundaries are ignored, while non-text leaves contribute stable tokens.
 *
 * @param paragraphElement - The w:p element
 * @param ancestors - Ancestor elements from root to parent
 * @param part - The OPC part
 * @param state - Atomization state with context information
 */
function createEmptyParagraphAtomWithContext(
  paragraphElement: WmlElement,
  ancestors: WmlElement[],
  part: OpcPart,
  state: AtomizationState
): ComparisonUnitAtom {
  // Create a virtual element to represent the empty paragraph
  const virtualElement = SYNTHETIC_DOC.createElement(EMPTY_PARAGRAPH_TAG);

  // Find revision tracking element in ancestors
  const revTrackElement = findRevisionTrackingElement(ancestors);

  // Determine initial correlation status
  const correlationStatus = getStatusFromRevisionTracking(revTrackElement);

  const pPr = findChildByTagName(paragraphElement, 'w:pPr');
  const pPrHash = pPr ? hashElement(pPr) : 'no-pPr';
  const contextHash = state.lastContentHash || 'document-start';
  const hashContent = `empty-paragraph:${contextHash}:${state.consecutiveEmptyIndex}:${pPrHash}`;

  // Empty-paragraph identity is the context signature, not the (empty) element.
  return withAtomIdentity(
    {
      contentElement: virtualElement,
      ancestorElements: [...ancestors, paragraphElement],
      ancestorUnids: extractAncestorUnids(ancestors),
      part,
      revTrackElement,
      correlationStatus,
      isEmptyParagraph: true, // Mark this as an empty paragraph atom
      rPr: null, // Empty paragraphs have no run formatting
    },
    () => sha1(hashContent),
    hashContent,
    '',
    virtualElement.tagName
  );
}

/**
 * State for tracking context during atomization.
 */
interface AtomizationState {
  /** Total empty paragraph count for reporting. */
  emptyParagraphCount: number;
  /** Index among consecutive empty paragraphs after the same content context. */
  consecutiveEmptyIndex: number;
  /** Hash of the last non-empty content for context-aware matching */
  lastContentHash: string;
}

function updateParagraphContentContext(
  node: WmlElement,
  atoms: ComparisonUnitAtom[],
  state: AtomizationState
): void {
  if (node.tagName !== 'w:p') {
    return;
  }

  const contentAtoms = atoms.filter(
    (atom) => !PARAGRAPH_LEVEL_TAGS.has(atom.contentElement.tagName)
  );
  if (contentAtoms.length === 0) {
    return;
  }

  const signature = contentAtoms
    .map((atom) => {
      if (atom.contentElement.tagName === 'w:t') {
        return getLeafText(atom.contentElement) ?? '';
      }
      return `\u0000${atom.contentElement.tagName}:${atom.sha1Hash}\u0000`;
    })
    .join('');

  state.lastContentHash = sha1(`para-content:${signature}`);
  state.consecutiveEmptyIndex = 0;
}

/**
 * Internal recursive atomization function with state tracking.
 */
function atomizeTreeInternal(
  node: WmlElement,
  ancestors: WmlElement[],
  part: OpcPart,
  state: AtomizationState,
  options: Required<Pick<AtomizeTreeOptions, 'cloneLeafNodes' | 'atomizeParagraphLevelMarkers'>>
): ComparisonUnitAtom[] {
  const atoms: ComparisonUnitAtom[] = [];

  if (isLeafNode(node)) {
    const atom = createComparisonUnitAtom({
      contentElement: options.cloneLeafNodes ? (node.cloneNode(true) as Element) : node,
      ancestors,
      part,
    });
    atoms.push(atom);
  } else if (
    options.atomizeParagraphLevelMarkers &&
    isParagraphLevelLeaf(node) &&
    ancestors.some((a) => a.tagName === 'w:p')
  ) {
    // Paragraph-level markers (commentRange*, bookmark*, perm*) inside a <w:p>
    // become atoms so the rebuild reconstructor can re-emit them as siblings
    // of <w:r>.
    // Body/table-sibling placements are intentionally skipped — they are
    // already handled by the scaffold-strip block in the reconstructor and
    // would otherwise misattach to the previous paragraph in
    // assignParagraphIndices().
    const atom = createComparisonUnitAtom({
      contentElement: options.cloneLeafNodes ? (node.cloneNode(true) as Element) : node,
      ancestors,
      part,
    });
    atoms.push(atom);
  } else if (isEmptyParagraph(node)) {
    // Create empty paragraph atom with context-aware hash
    atoms.push(createEmptyParagraphAtomWithContext(node, ancestors, part, state));
    state.emptyParagraphCount++;
    state.consecutiveEmptyIndex++;
  } else {
    for (const child of childElements(node)) {
      atoms.push(...atomizeTreeInternal(child, [...ancestors, node], part, state, options));
    }
    updateParagraphContentContext(node, atoms, state);
  }

  return atoms;
}

/**
 * Atomize a document tree into a flat list of ComparisonUnitAtoms.
 *
 * Recursively traverses the tree, creating atoms for each leaf node.
 * Also creates special atoms for empty paragraphs to preserve document structure.
 *
 * @param node - The current node in the tree
 * @param ancestors - Ancestor elements from root to parent of node
 * @param part - The OPC part this tree belongs to
 * @returns Array of ComparisonUnitAtoms from leaf nodes
 */
export function atomizeTree(
  node: WmlElement,
  ancestors: WmlElement[],
  part: OpcPart,
  options: AtomizeTreeOptions = {}
): { atoms: ComparisonUnitAtom[]; emptyParagraphCount: number } {
  const normalizedOptions = {
    cloneLeafNodes: options.cloneLeafNodes ?? false,
    mergeAcrossRuns: options.mergeAcrossRuns ?? true,
    mergePunctuationAcrossRuns: options.mergePunctuationAcrossRuns ?? true,
    splitTextIntoWords: options.splitTextIntoWords ?? true,
    atomizeParagraphLevelMarkers: options.atomizeParagraphLevelMarkers ?? false,
    captureInlineSdtPassthrough: options.captureInlineSdtPassthrough ?? false,
  };

  const state: AtomizationState = {
    emptyParagraphCount: 0,
    consecutiveEmptyIndex: 0,
    lastContentHash: '',
  };
  if (normalizedOptions.captureInlineSdtPassthrough) validateInlineSdtNamespaceOwnership(node);
  const rawAtoms = atomizeTreeInternal(node, ancestors, part, state, normalizedOptions);
  if (normalizedOptions.captureInlineSdtPassthrough) captureInlineSdtPassthrough(node, rawAtoms);

  // Step 1: Collapse field sequences into single atoms based on visible text
  // This allows matching between hardcoded text and field references
  const fieldCollapsedAtoms = collapseFieldSequences(rawAtoms);

  // Step 2: Merge contiguous text atoms with same formatting
  // This normalizes different w:t split boundaries
  const mergedAtoms = mergeContiguousTextAtoms(fieldCollapsedAtoms, normalizedOptions);

  // Step 3: Split merged atoms at word boundaries for finer-grained comparison
  // This enables word-level diffing within paragraphs
  const wordSplitAtoms = normalizedOptions.splitTextIntoWords
    ? splitAtomsIntoWords(mergedAtoms)
    : mergedAtoms;

  // Step 4: Merge punctuation-only atoms with preceding text
  // This handles "Conduct" + "," vs "Conduct," split differences
  // Must run AFTER word split since that's when punctuation becomes separate atoms
  const atoms = mergePunctuationAtoms(wordSplitAtoms, normalizedOptions);

  console.log(
    `[DEBUG] atomizeTree: created ${rawAtoms.length} atoms, field-collapsed to ${fieldCollapsedAtoms.length}, merged to ${mergedAtoms.length}, word-split to ${wordSplitAtoms.length}, punct-merged to ${atoms.length}, ${state.emptyParagraphCount} empty paragraphs`
  );
  return { atoms, emptyParagraphCount: state.emptyParagraphCount };
}

/**
 * Get all ancestors of a node by following parent references.
 *
 * @param node - The node to get ancestors for
 * @returns Array of ancestors from root to immediate parent
 */
export function getAncestors(node: WmlElement): WmlElement[] {
  const ancestors: WmlElement[] = [];
  let current = node.parentNode;
  while (current && current.nodeType === 1 /* ELEMENT_NODE */) {
    ancestors.unshift(current as WmlElement);
    current = current.parentNode;
  }
  return ancestors;
}

/**
 * Assign paragraph indices to atoms based on their w:p ancestors.
 *
 * This enables paragraph grouping in the document reconstructor when
 * merging atoms from different source trees (original vs revised).
 *
 * @param atoms - Array of atoms to assign indices to
 */
export function assignParagraphIndices(atoms: ComparisonUnitAtom[]): void {
  const paragraphToIndex = new Map<Element, number>();
  let nextIndex = 0;

  for (const atom of atoms) {
    // Find the w:p ancestor
    const pAncestor = atom.ancestorElements.find((a) => a.tagName === 'w:p');

    if (pAncestor) {
      // Get or assign index for this paragraph
      let index = paragraphToIndex.get(pAncestor);
      if (index === undefined) {
        index = nextIndex++;
        paragraphToIndex.set(pAncestor, index);
      }
      atom.paragraphIndex = index;
    }
  }
}

// =============================================================================
// Field Sequence Collapsing
// =============================================================================

/**
 * Special tag name for collapsed field atoms.
 * These represent Word field codes (REF, PAGEREF, etc.) collapsed to their visible result.
 */
export const COLLAPSED_FIELD_TAG = '__collapsedField__';

/**
 * Check if an atom is a field begin marker.
 */
function isFieldBegin(atom: ComparisonUnitAtom): boolean {
  return (
    atom.contentElement.tagName === 'w:fldChar' &&
    atom.contentElement.getAttribute('w:fldCharType') === 'begin'
  );
}

/**
 * Check if an atom is a field separate marker.
 */
function isFieldSeparate(atom: ComparisonUnitAtom): boolean {
  return (
    atom.contentElement.tagName === 'w:fldChar' &&
    atom.contentElement.getAttribute('w:fldCharType') === 'separate'
  );
}

/**
 * Check if an atom is a field end marker.
 */
function isFieldEnd(atom: ComparisonUnitAtom): boolean {
  return (
    atom.contentElement.tagName === 'w:fldChar' &&
    atom.contentElement.getAttribute('w:fldCharType') === 'end'
  );
}

/**
 * Extract visible text from a sequence of atoms (field result portion).
 * Only includes w:t elements, ignoring field markers and instructions.
 */
function extractVisibleText(atoms: ComparisonUnitAtom[]): string {
  return atoms
    .filter((a) => a.contentElement.tagName === 'w:t')
    .map((a) => getLeafText(a.contentElement) ?? '')
    .join('');
}

/**
 * Check if a field spans multiple paragraphs.
 * Multi-paragraph fields (like TOC) should not be collapsed.
 */
function fieldSpansMultipleParagraphs(fieldAtoms: ComparisonUnitAtom[]): boolean {
  const paragraphs = new Set<WmlElement>();

  for (const atom of fieldAtoms) {
    const para = atom.ancestorElements.find((e) => e.tagName === 'w:p');
    if (para) {
      paragraphs.add(para);
      if (paragraphs.size > 1) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Collapse field sequences into single atoms based on visible text.
 *
 * Word fields consist of:
 * - w:fldChar[begin] - field start
 * - w:instrText - field instruction (e.g., "REF _Ref123 \h")
 * - w:fldChar[separate] - separates instruction from result
 * - w:t (one or more) - visible result text
 * - w:fldChar[end] - field end
 *
 * This function collapses each field sequence into a single atom whose hash
 * is based only on the visible text. This allows matching between:
 * - Hardcoded text: "2.6"
 * - Field reference: [REF field]2.6[/field]
 *
 * Both will produce atoms with the same hash if the visible text matches.
 *
 * NOTE: Multi-paragraph fields (like TOC, INDEX) are NOT collapsed because
 * they would lose paragraph structure information.
 *
 * @param atoms - Array of atoms from atomization
 * @returns Array with field sequences collapsed to single atoms
 */
export function collapseFieldSequences(
  atoms: ComparisonUnitAtom[]
): ComparisonUnitAtom[] {
  if (atoms.length === 0) return atoms;

  const result: ComparisonUnitAtom[] = [];
  let i = 0;

  while (i < atoms.length) {
    const atom = atoms[i]!;

    if (isFieldBegin(atom)) {
      // Found field start - collect until matching end
      const fieldAtoms: ComparisonUnitAtom[] = [atom];
      let depth = 1;
      let separatorIndex = -1;
      i++;

      while (i < atoms.length && depth > 0) {
        const current = atoms[i]!;
        fieldAtoms.push(current);

        if (isFieldBegin(current)) {
          depth++;
        } else if (isFieldEnd(current)) {
          depth--;
        } else if (isFieldSeparate(current) && depth === 1) {
          // Track separator position for the outermost field
          separatorIndex = fieldAtoms.length - 1;
        }
        i++;
      }

      // Check if field spans multiple paragraphs (like TOC, INDEX)
      // If so, don't collapse the outer field - preserve paragraph structure.
      // But recursively collapse inner single-paragraph fields (e.g., PAGEREF
      // nested inside TOC) so they are treated as single atoms during LCS.
      if (fieldSpansMultipleParagraphs(fieldAtoms)) {
        if (separatorIndex >= 0 && separatorIndex < fieldAtoms.length - 1) {
          // Pass through outer field markers: begin, instrText..., separate
          result.push(...fieldAtoms.slice(0, separatorIndex + 1));
          // Recursively collapse inner content (between separator and end)
          const innerContent = fieldAtoms.slice(separatorIndex + 1, -1);
          result.push(...collapseFieldSequences(innerContent));
          // Pass through outer end marker
          result.push(fieldAtoms[fieldAtoms.length - 1]!);
        } else {
          // No separator found (unusual), pass through unchanged
          result.push(...fieldAtoms);
        }
        continue;
      }

      // Extract visible text from the field result (after separator)
      let visibleText: string;
      if (separatorIndex >= 0) {
        // Get text between separator and end (exclusive of markers)
        const resultAtoms = fieldAtoms.slice(separatorIndex + 1, -1);
        visibleText = extractVisibleText(resultAtoms);
      } else {
        // No separator - might be a field with no result yet, use instruction
        visibleText = extractVisibleText(fieldAtoms);
      }

      // Create a collapsed field atom with the visible text
      const firstAtom = fieldAtoms[0]!;
      // Use w:t so it can merge with adjacent text
      const virtualElement = SYNTHETIC_DOC.createElementNS(OOXML.W_NS, 'w:t');
      setLeafText(virtualElement, visibleText);
      if (/\s/.test(visibleText)) {
        virtualElement.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      }

      const collapsedAtom: ComparisonUnitAtom = withAtomIdentity(
        {
          contentElement: virtualElement,
          ancestorElements: [...firstAtom.ancestorElements],
          ancestorUnids: firstAtom.ancestorUnids,
          part: firstAtom.part,
          revTrackElement: firstAtom.revTrackElement,
          correlationStatus: firstAtom.correlationStatus,
          // Store original atoms for document reconstruction
          collapsedFieldAtoms: fieldAtoms,
          // Inherit rPr from first atom in the field sequence
          rPr: firstAtom.rPr,
          opaquePassthrough: firstAtom.opaquePassthrough,
        },
        (self) => hashElement(self.contentElement),
        elementIdentityString(virtualElement),
        virtualElement.textContent ?? '',
        virtualElement.tagName
      );

      result.push(collapsedAtom);
    } else {
      // Not a field - pass through unchanged
      result.push(atom);
      i++;
    }
  }

  return result;
}

// =============================================================================
// Word-Level Splitting
// =============================================================================

/**
 * Split a w:t atom into word-level atoms.
 *
 * This enables finer-grained comparison when text is stored in single w:t elements.
 * For example, "Hello World" becomes ["Hello", " ", "World"].
 *
 * Preserves whitespace as separate atoms to maintain spacing.
 *
 * @param atom - A w:t atom to split
 * @returns Array of word-level atoms (or original atom if not w:t)
 */
function splitAtomIntoWords(atom: ComparisonUnitAtom): ComparisonUnitAtom[] {
  // Only split w:t elements
  if (atom.contentElement.tagName !== 'w:t') {
    return [atom];
  }

  // Don't split collapsed fields - they should stay as-is
  if (atom.collapsedFieldAtoms) {
    return [atom];
  }

  const text = getLeafText(atom.contentElement) ?? '';

  // Don't split short text or single words
  if (text.length <= 1 || !text.includes(' ')) {
    return [atom];
  }

  // Split into words and whitespace, preserving both
  // Uses regex to split on word boundaries while keeping whitespace
  const parts = text.split(/(\s+)/);
  if (parts.length <= 1) {
    return [atom];
  }

  const result: ComparisonUnitAtom[] = [];

  for (const part of parts) {
    if (part === '') continue;

    // Create a new element for this word/whitespace
    const wordElement = SYNTHETIC_DOC.createElementNS(OOXML.W_NS, 'w:t');
    // Copy attributes from the original content element
    for (let i = 0; i < atom.contentElement.attributes.length; i++) {
      const attr = atom.contentElement.attributes[i]!;
      wordElement.setAttribute(attr.name, attr.value);
    }
    setLeafText(wordElement, part);
    // Ensure OOXML renderers preserve whitespace in this fragment
    if (/\s/.test(part)) {
      wordElement.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    }

    // Create atom for this word
    const wordAtom: ComparisonUnitAtom = withAtomIdentity(
      {
        contentElement: wordElement,
        ancestorElements: atom.ancestorElements,
        ancestorUnids: atom.ancestorUnids,
        part: atom.part,
        revTrackElement: atom.revTrackElement,
        correlationStatus: atom.correlationStatus,
        paragraphIndex: atom.paragraphIndex,
        // Track that this came from a split atom for potential later merge
        splitFromAtom: atom,
        // Share rPr reference (read-only after atomization)
        rPr: atom.rPr,
        opaquePassthrough: atom.opaquePassthrough,
      },
      (self) => hashElement(self.contentElement),
      elementIdentityString(wordElement),
      wordElement.textContent ?? '',
      wordElement.tagName
    );

    result.push(wordAtom);
  }

  return result;
}

/**
 * Split all w:t atoms into word-level atoms.
 *
 * @param atoms - Array of atoms
 * @returns Array with w:t atoms split into words
 */
export function splitAtomsIntoWords(
  atoms: ComparisonUnitAtom[]
): ComparisonUnitAtom[] {
  const result: ComparisonUnitAtom[] = [];

  for (const atom of atoms) {
    result.push(...splitAtomIntoWords(atom));
  }

  return result;
}

// =============================================================================
// Atom Boundary Normalization
// =============================================================================

/**
 * Get the run properties (w:rPr) from an atom's run ancestor.
 */
function getRunProperties(atom: ComparisonUnitAtom): WmlElement | undefined {
  const run = atom.ancestorElements.find((e) => e.tagName === 'w:r');
  if (!run) return undefined;
  return findChildByTagName(run, 'w:rPr') ?? undefined;
}

/**
 * Compute a deep hash of an element including its children.
 */
function hashElementDeep(element: WmlElement): string {
  const parts: string[] = [element.tagName];

  // Sort attributes for deterministic hashing
  const attrs: [string, string][] = [];
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i]!;
    attrs.push([attr.name, attr.value]);
  }
  const sortedAttrs = attrs.sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of sortedAttrs) {
    parts.push(`${key}=${value}`);
  }

  const leafText = getLeafText(element);
  if (leafText !== undefined) {
    parts.push(leafText);
  }

  // Recursively hash children
  for (const child of childElements(element)) {
    parts.push(hashElementDeep(child));
  }

  return sha1(parts.join('|'));
}

/**
 * Compare two w:rPr elements for equivalence.
 * Returns true if they have the same formatting properties.
 */
function runPropertiesEqual(
  a: WmlElement | undefined,
  b: WmlElement | undefined
): boolean {
  // Both undefined = equal (no formatting)
  if (!a && !b) return true;
  // One undefined = not equal
  if (!a || !b) return false;

  // Compare by deep hashing (includes children for w:rPr properties)
  return hashElementDeep(a) === hashElementDeep(b);
}

/**
 * Find the nearest `w:hyperlink` ancestor of an atom, or null.
 *
 * Boundary normalization must never merge text atoms across a hyperlink
 * boundary: the surviving atom keeps a single ancestor chain, so a
 * cross-boundary merge either absorbs adjacent plain text into the link
 * (formatting bleed) or detaches link text from its wrapper.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @see https://github.com/UseJunior/safe-docx/issues/368
 */
export function nearestHyperlinkAncestor(atom: ComparisonUnitAtom): WmlElement | null {
  for (let i = atom.ancestorElements.length - 1; i >= 0; i--) {
    const ancestor = atom.ancestorElements[i]!;
    if (ancestor.tagName === 'w:hyperlink') return ancestor;
    // w:hyperlink always sits between the run and its paragraph; once the
    // walk reaches w:p there is no hyperlink wrapper.
    if (ancestor.tagName === 'w:p') break;
  }
  return null;
}

/**
 * The logical destination of a w:hyperlink, used to salt atom identity.
 *
 * Prefers the *resolved* target over the raw r:id: an external r:id resolves
 * through `relsMap` to its URL, an internal link salts on its w:anchor, and an
 * unresolvable r:id falls back to the raw id so at least attribute-level
 * discrimination survives. Same destination on both sides yields the same salt
 * (still Equal); a changed destination yields different salts, which is what
 * turns a retarget into delete-old-link + insert-new-link.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @see https://github.com/UseJunior/safe-docx/issues/376
 */
function hyperlinkDestinationSalt(
  link: WmlElement,
  relsMap: ReadonlyMap<string, string>
): string | null {
  const rid = link.getAttribute('r:id');
  const anchor = link.getAttribute('w:anchor');
  const parts: string[] = [];
  if (rid) parts.push(`rel=${relsMap.get(rid) ?? `unresolved:${rid}`}`);
  if (anchor) parts.push(`anchor=${anchor}`);
  return parts.length > 0 ? parts.join('|') : null;
}

/**
 * Fold each atom's nearest-hyperlink destination into its identity hash so the
 * LCS stops matching equal text that sits under different link targets. Applied
 * as a post-atomization pass (after run/word merging and numbering salting, all
 * of which leave each atom with a single well-defined ancestry) so it need not
 * be duplicated at every hash-recompute site.
 *
 * Atoms outside any hyperlink, and hyperlinks with neither r:id nor anchor, are
 * left untouched — their hashes stay byte-identical to the pre-#376 output.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @see https://github.com/UseJunior/safe-docx/issues/376
 */
export function applyHyperlinkDestinationSalt(
  atoms: ComparisonUnitAtom[],
  relsMap: ReadonlyMap<string, string>
): void {
  for (const atom of atoms) {
    const link = nearestHyperlinkAncestor(atom);
    if (!link) continue;
    const salt = hyperlinkDestinationSalt(link, relsMap);
    if (salt !== null) {
      appendIdentitySalt(atom, `:hlink:${salt}`);
    }
  }
}

/**
 * Check if two atoms can be merged into one.
 *
 * Atoms can be merged if they:
 * - Are both w:t (text) elements
 * - Neither is a collapsed field (fields should stay as separate atoms for finer diff)
 * - Are in the same paragraph
 * - Are inside the same w:hyperlink wrapper (or both outside one)
 * - Have the same run formatting (w:rPr) OR are in the same run
 * - Have the same revision tracking status
 *
 * @param a - First atom
 * @param b - Second atom (immediately following a)
 * @returns True if atoms can be merged
 */
function canMergeAtoms(
  a: ComparisonUnitAtom,
  b: ComparisonUnitAtom,
  options: Required<Pick<AtomizeTreeOptions, 'mergeAcrossRuns'>>
): boolean {
  // Only merge w:t elements
  if (a.contentElement.tagName !== 'w:t') return false;
  if (b.contentElement.tagName !== 'w:t') return false;

  // Never merge collapsed fields - they should stay as separate atoms for finer-grained diff
  if (a.collapsedFieldAtoms || b.collapsedFieldAtoms) return false;

  // Opaque boundaries own ordering. Never absorb plain text into a boundary,
  // cross between two controls, or lose the descriptor retained by the target.
  if (!sameOpaqueOwner(a, b)) return false;

  // Must be in the same paragraph
  const aPara = a.ancestorElements.find((e) => e.tagName === 'w:p');
  const bPara = b.ancestorElements.find((e) => e.tagName === 'w:p');
  if (aPara !== bPara) return false;

  // Must have same revision tracking status
  const aRevTag = a.revTrackElement?.tagName;
  const bRevTag = b.revTrackElement?.tagName;
  if (aRevTag !== bRevTag) return false;

  // Check if same run (fast path)
  const aRun = a.ancestorElements.find((e) => e.tagName === 'w:r');
  const bRun = b.ancestorElements.find((e) => e.tagName === 'w:r');
  if (aRun === bRun) return true;

  // Different runs - allow cross-run merge only if enabled.
  // (In inplace mode we disable this so each atom stays anchored to a real run.)
  if (!options.mergeAcrossRuns) return false;

  // Never merge across a w:hyperlink boundary — the merged atom keeps only
  // one side's ancestry, so link text would detach from (or plain text be
  // absorbed into) the hyperlink wrapper.
  if (nearestHyperlinkAncestor(a) !== nearestHyperlinkAncestor(b)) return false;

  // Different runs - check if they have equivalent formatting
  const aRPr = getRunProperties(a);
  const bRPr = getRunProperties(b);
  return runPropertiesEqual(aRPr, bRPr);
}

/**
 * Merge source atom's text content into target atom.
 *
 * Concatenates text content and recomputes the hash.
 *
 * @param target - Atom to merge into
 * @param source - Atom to merge from
 */
function mergeIntoAtom(target: ComparisonUnitAtom, source: ComparisonUnitAtom): void {
  // Concatenate text content
  const newText =
    (getLeafText(target.contentElement) ?? '') +
    (getLeafText(source.contentElement) ?? '');
  setLeafText(target.contentElement, newText);

  // Invalidate the cached hash (recomputed lazily from the mutated element) and
  // rebuild the interner key so identity tracks the merged text.
  refreshAtomIdentityAfterTextMutation(target);
}

/**
 * Check if an atom contains only punctuation.
 */
function isPunctuationOnlyAtom(atom: ComparisonUnitAtom): boolean {
  if (atom.contentElement.tagName !== 'w:t') return false;
  const text = getLeafText(atom.contentElement) ?? '';
  // Match common punctuation that should attach to adjacent words
  return /^[,.:;!?'")\]}>]+$/.test(text);
}

/**
 * Check if two atoms can be merged for punctuation normalization.
 *
 * More permissive than canMergeAtoms - allows merging punctuation with
 * preceding text even if they're in different runs, as long as they're
 * in the same paragraph and have the same revision tracking status.
 */
function canMergePunctuation(
  a: ComparisonUnitAtom,
  b: ComparisonUnitAtom,
  options: Required<Pick<AtomizeTreeOptions, 'mergePunctuationAcrossRuns'>>
): boolean {
  // Only merge w:t elements
  if (a.contentElement.tagName !== 'w:t') return false;
  if (b.contentElement.tagName !== 'w:t') return false;

  // B must be punctuation-only
  if (!isPunctuationOnlyAtom(b)) return false;

  // Never merge collapsed fields
  if (a.collapsedFieldAtoms || b.collapsedFieldAtoms) return false;

  if (!sameOpaqueOwner(a, b)) return false;

  // Must be in the same paragraph
  const aPara = a.ancestorElements.find((e) => e.tagName === 'w:p');
  const bPara = b.ancestorElements.find((e) => e.tagName === 'w:p');
  if (aPara !== bPara) return false;

  // Must have same revision tracking status
  const aRevTag = a.revTrackElement?.tagName;
  const bRevTag = b.revTrackElement?.tagName;
  if (aRevTag !== bRevTag) return false;

  // A must end with a word character (not whitespace or punctuation)
  const aText = getLeafText(a.contentElement) ?? '';
  if (!/\w$/.test(aText)) return false;

  // Never merge across a w:hyperlink boundary: punctuation that follows a
  // link must not inherit the link run's ancestry/formatting (e.g. the
  // sentence period after a URL turning underlined).
  if (nearestHyperlinkAncestor(a) !== nearestHyperlinkAncestor(b)) return false;

  // If cross-run punctuation merge is disabled, require same run.
  if (!options.mergePunctuationAcrossRuns) {
    const aRun = a.ancestorElements.find((e) => e.tagName === 'w:r');
    const bRun = b.ancestorElements.find((e) => e.tagName === 'w:r');
    if (aRun !== bRun) return false;
  }

  return true;
}

/**
 * Merge punctuation-only atoms with preceding text.
 *
 * This handles cases where documents have different w:t boundaries around
 * punctuation (e.g., "Conduct" + "," vs "Conduct,"). Punctuation is merged
 * with the preceding word regardless of run formatting differences.
 *
 * @param atoms - Array of atoms
 * @returns Atoms with punctuation merged into preceding text
 */
export function mergePunctuationAtoms(
  atoms: ComparisonUnitAtom[],
  options: Required<Pick<AtomizeTreeOptions, 'mergePunctuationAcrossRuns'>> = { mergePunctuationAcrossRuns: true }
): ComparisonUnitAtom[] {
  if (atoms.length === 0) return atoms;

  const result: ComparisonUnitAtom[] = [];

  for (const atom of atoms) {
    const prev = result[result.length - 1];

    if (prev && canMergePunctuation(prev, atom, options)) {
      // Merge punctuation into previous atom
      mergeIntoAtom(prev, atom);
    } else {
      result.push(atom);
    }
  }

  return result;
}

/**
 * Merge contiguous w:t atoms within the same run into single atoms.
 *
 * This normalization ensures that identical text split differently across
 * w:t elements in original vs revised documents will produce matching hashes.
 *
 * Example:
 *   Before: ["Def", "initions"] (2 atoms)
 *   After:  ["Definitions"] (1 atom)
 *
 * @param atoms - Array of atoms from atomization
 * @returns Normalized array with contiguous text atoms merged
 */
export function mergeContiguousTextAtoms(
  atoms: ComparisonUnitAtom[],
  options: Required<Pick<AtomizeTreeOptions, 'mergeAcrossRuns'>> = { mergeAcrossRuns: true }
): ComparisonUnitAtom[] {
  if (atoms.length === 0) return atoms;

  const result: ComparisonUnitAtom[] = [];

  for (const atom of atoms) {
    const prev = result[result.length - 1];

    // Only merge w:t elements in the same run
    if (prev && canMergeAtoms(prev, atom, options)) {
      // Merge text content into previous atom
      mergeIntoAtom(prev, atom);
    } else {
      result.push(atom);
    }
  }

  return result;
}
