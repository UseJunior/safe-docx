import { findParagraphByBookmarkId } from './bookmarks.js';
import { OOXML, W } from './namespaces.js';
import {
  buildTcPrChangeElement,
  foreignPPrChangeAuthor,
  recordPPrChange,
  buildTrPrChangeElement,
  type RevisionContext,
} from './track-changes-emitter.js';

export type SpacingLineRule = 'auto' | 'exact' | 'atLeast';
export type RowHeightRule = 'auto' | 'exact' | 'atLeast';

export type ParagraphSpacingMutation = {
  paragraphIds: string[];
  beforeTwips?: number;
  afterTwips?: number;
  lineTwips?: number;
  lineRule?: SpacingLineRule;
};

export type TableRowHeightMutation = {
  tableIndexes: number[];
  rowIndexes?: number[];
  valueTwips: number;
  rule: RowHeightRule;
};

export type TableCellPaddingMutation = {
  tableIndexes: number[];
  rowIndexes?: number[];
  cellIndexes?: number[];
  topDxa?: number;
  bottomDxa?: number;
  leftDxa?: number;
  rightDxa?: number;
};

export type ParagraphSpacingMutationResult = {
  affectedParagraphs: number;
  missingParagraphIds: string[];
};

export type TableRowHeightMutationResult = {
  affectedRows: number;
  missingTableIndexes: number[];
  missingRowIndexes: Array<{ tableIndex: number; rowIndex: number }>;
};

export type TableCellPaddingMutationResult = {
  affectedCells: number;
  missingTableIndexes: number[];
  missingRowIndexes: Array<{ tableIndex: number; rowIndex: number }>;
  missingCellIndexes: Array<{ tableIndex: number; rowIndex: number; cellIndex: number }>;
};

function isW(el: Element | null | undefined, localName: string): boolean {
  return !!el && el.namespaceURI === OOXML.W_NS && el.localName === localName;
}

function getDirectChildrenByName(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  const kids = parent.children;
  for (let i = 0; i < kids.length; i++) {
    if (isW(kids[i] as Element, localName)) out.push(kids[i] as Element);
  }
  return out;
}

function ensureFirstChild(parent: Element, localName: string): Element {
  const existing = getDirectChildrenByName(parent, localName)[0];
  if (existing) return existing;

  const doc = parent.ownerDocument;
  if (!doc) throw new Error(`Element ${parent.localName} has no ownerDocument`);

  const created = doc.createElementNS(OOXML.W_NS, `w:${localName}`);
  const firstNode = parent.firstChild;
  if (firstNode) parent.insertBefore(created, firstNode);
  else parent.appendChild(created);
  return created;
}

function ensureChild(parent: Element, localName: string): Element {
  const existing = getDirectChildrenByName(parent, localName)[0];
  if (existing) return existing;

  const doc = parent.ownerDocument;
  if (!doc) throw new Error(`Element ${parent.localName} has no ownerDocument`);

  const created = doc.createElementNS(OOXML.W_NS, `w:${localName}`);
  parent.appendChild(created);
  return created;
}

/** Replace all direct spacing children with one node at its CT_PPr sequence position. */
function normalizeParagraphSpacing(pPr: Element): Element {
  const doc = pPr.ownerDocument;
  if (!doc) throw new Error('Element pPr has no ownerDocument');
  const created = doc.createElementNS(OOXML.W_NS, `w:${W.spacing}`);
  const existing = getDirectChildrenByName(pPr, W.spacing);
  const source = existing[0];
  if (source) {
    for (let i = 0; i < source.attributes.length; i++) {
      const attr = source.attributes.item(i);
      if (attr) created.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
  }
  for (const stale of existing) pPr.removeChild(stale);
  const successors = new Set([W.ind, 'contextualSpacing', W.jc, 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', W.rPr, W.sectPr, 'pPrChange']);
  const successor = Array.from(pPr.children).find((child) => isW(child as Element, (child as Element).localName) && successors.has((child as Element).localName));
  if (successor) pPr.insertBefore(created, successor);
  else pPr.appendChild(created);
  return created;
}

/**
 * Keep per-cell margins in the CT_TcMar child sequence required by the schema.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.68
 */
function reorderCellMarginEdges(tcMar: Element): void {
  const orderedNames = [W.top, W.start, W.left, W.bottom, W.end, W.right];
  const ordered = orderedNames.flatMap((name) => getDirectChildrenByName(tcMar, name));
  for (const child of ordered) {
    tcMar.appendChild(child);
  }
}

function setWAttr(el: Element, localName: string, value: string): void {
  el.setAttributeNS(OOXML.W_NS, `w:${localName}`, value);
}

function dedupeSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function toRowIndexes(rowsCount: number, requested?: number[]): {
  indexes: number[];
  missing: number[];
} {
  if (!requested || requested.length === 0) {
    return { indexes: [...Array(rowsCount).keys()], missing: [] };
  }

  const indexes = dedupeSorted(requested).filter((idx) => idx >= 0 && idx < rowsCount);
  const missing = dedupeSorted(requested).filter((idx) => idx < 0 || idx >= rowsCount);
  return { indexes, missing };
}

function toCellIndexes(cellsCount: number, requested?: number[]): {
  indexes: number[];
  missing: number[];
} {
  if (!requested || requested.length === 0) {
    return { indexes: [...Array(cellsCount).keys()], missing: [] };
  }

  const indexes = dedupeSorted(requested).filter((idx) => idx >= 0 && idx < cellsCount);
  const missing = dedupeSorted(requested).filter((idx) => idx < 0 || idx >= cellsCount);
  return { indexes, missing };
}

function getTables(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.tbl));
}

export function setParagraphSpacing(
  doc: Document,
  mutation: ParagraphSpacingMutation,
  ctx?: RevisionContext,
): ParagraphSpacingMutationResult {
  for (const key of ['beforeTwips', 'afterTwips'] as const) {
    const value = mutation[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`${key} must be a non-negative safe integer`);
    }
  }
  if (mutation.lineTwips !== undefined && !Number.isSafeInteger(mutation.lineTwips)) {
    throw new RangeError('lineTwips must be a safe integer');
  }
  if (mutation.lineRule !== undefined && !(['auto', 'exact', 'atLeast'] as const).includes(mutation.lineRule)) {
    throw new RangeError(`Unsupported lineRule '${mutation.lineRule}'`);
  }
  const paragraphIds = [...new Set(mutation.paragraphIds)];
  const missingParagraphIds: string[] = [];
  let affectedParagraphs = 0;

  for (const paragraphId of paragraphIds) {
    const paragraph = findParagraphByBookmarkId(doc, paragraphId);
    if (!paragraph) {
      missingParagraphIds.push(paragraphId);
      continue;
    }

    const currentPPr = getDirectChildrenByName(paragraph, W.pPr)[0] ?? null;
    const oldPPr = currentPPr ? (currentPPr.cloneNode(true) as Element) : null;
    if (oldPPr && getDirectChildrenByName(oldPPr, W.spacing).length > 0) {
      normalizeParagraphSpacing(oldPPr);
    }
    const pPr = ensureFirstChild(paragraph, W.pPr);
    const spacing = normalizeParagraphSpacing(pPr);

    if (typeof mutation.beforeTwips === 'number') setWAttr(spacing, W.before, String(mutation.beforeTwips));
    if (typeof mutation.afterTwips === 'number') setWAttr(spacing, W.after, String(mutation.afterTwips));
    if (typeof mutation.lineTwips === 'number') setWAttr(spacing, W.line, String(mutation.lineTwips));
    if (typeof mutation.lineRule === 'string') setWAttr(spacing, W.lineRule, mutation.lineRule);
    if (ctx) recordPPrChange(pPr, oldPPr, ctx);

    affectedParagraphs += 1;
  }

  return { affectedParagraphs, missingParagraphIds };
}

export function setTableRowHeight(
  doc: Document,
  mutation: TableRowHeightMutation,
  ctx?: RevisionContext,
): TableRowHeightMutationResult {
  const tables = getTables(doc);
  const missingTableIndexes: number[] = [];
  const missingRowIndexes: Array<{ tableIndex: number; rowIndex: number }> = [];
  let affectedRows = 0;

  for (const tableIndex of dedupeSorted(mutation.tableIndexes)) {
    const table = tables[tableIndex];
    if (!table) {
      missingTableIndexes.push(tableIndex);
      continue;
    }

    const rows = getDirectChildrenByName(table, W.tr);
    const rowSelection = toRowIndexes(rows.length, mutation.rowIndexes);
    for (const missingRowIdx of rowSelection.missing) {
      missingRowIndexes.push({ tableIndex, rowIndex: missingRowIdx });
    }

    for (const rowIndex of rowSelection.indexes) {
      const row = rows[rowIndex]!;
      const currentTrPr = getDirectChildrenByName(row, W.trPr)[0] ?? null;
      const oldTrPr = currentTrPr ? (currentTrPr.cloneNode(true) as Element) : null;
      const trPr = ensureFirstChild(row, W.trPr);
      const trHeight = ensureChild(trPr, W.trHeight);
      setWAttr(trHeight, W.val, String(mutation.valueTwips));
      setWAttr(trHeight, W.hRule, mutation.rule);
      if (ctx) {
        // CT_TrPr permits at most one <w:trPrChange> child.
        for (const stale of getDirectChildrenByName(trPr, 'trPrChange')) {
          trPr.removeChild(stale);
        }
        trPr.appendChild(buildTrPrChangeElement(oldTrPr, ctx));
      }
      affectedRows += 1;
    }
  }

  return { affectedRows, missingTableIndexes, missingRowIndexes };
}

export function setTableCellPadding(
  doc: Document,
  mutation: TableCellPaddingMutation,
  ctx?: RevisionContext,
): TableCellPaddingMutationResult {
  const tables = getTables(doc);
  const missingTableIndexes: number[] = [];
  const missingRowIndexes: Array<{ tableIndex: number; rowIndex: number }> = [];
  const missingCellIndexes: Array<{ tableIndex: number; rowIndex: number; cellIndex: number }> = [];
  let affectedCells = 0;

  for (const tableIndex of dedupeSorted(mutation.tableIndexes)) {
    const table = tables[tableIndex];
    if (!table) {
      missingTableIndexes.push(tableIndex);
      continue;
    }

    const rows = getDirectChildrenByName(table, W.tr);
    const rowSelection = toRowIndexes(rows.length, mutation.rowIndexes);
    for (const missingRowIdx of rowSelection.missing) {
      missingRowIndexes.push({ tableIndex, rowIndex: missingRowIdx });
    }

    for (const rowIndex of rowSelection.indexes) {
      const row = rows[rowIndex]!;
      const cells = getDirectChildrenByName(row, W.tc);
      const cellSelection = toCellIndexes(cells.length, mutation.cellIndexes);
      for (const missingCellIdx of cellSelection.missing) {
        missingCellIndexes.push({ tableIndex, rowIndex, cellIndex: missingCellIdx });
      }

      for (const cellIndex of cellSelection.indexes) {
        const cell = cells[cellIndex]!;
        const currentTcPr = getDirectChildrenByName(cell, W.tcPr)[0] ?? null;
        const oldTcPr = currentTcPr ? (currentTcPr.cloneNode(true) as Element) : null;
        const tcPr = ensureFirstChild(cell, W.tcPr);
        const tcMar = ensureChild(tcPr, W.tcMar);

        if (typeof mutation.topDxa === 'number') {
          const top = ensureChild(tcMar, W.top);
          setWAttr(top, W.w, String(mutation.topDxa));
          setWAttr(top, W.type, 'dxa');
        }
        if (typeof mutation.bottomDxa === 'number') {
          const bottom = ensureChild(tcMar, W.bottom);
          setWAttr(bottom, W.w, String(mutation.bottomDxa));
          setWAttr(bottom, W.type, 'dxa');
        }
        if (typeof mutation.leftDxa === 'number') {
          const left = ensureChild(tcMar, W.left);
          setWAttr(left, W.w, String(mutation.leftDxa));
          setWAttr(left, W.type, 'dxa');
        }
        if (typeof mutation.rightDxa === 'number') {
          const right = ensureChild(tcMar, W.right);
          setWAttr(right, W.w, String(mutation.rightDxa));
          setWAttr(right, W.type, 'dxa');
        }
        reorderCellMarginEdges(tcMar);
        if (ctx) {
          // CT_TcPr permits at most one <w:tcPrChange> child.
          for (const stale of getDirectChildrenByName(tcPr, 'tcPrChange')) {
            tcPr.removeChild(stale);
          }
          tcPr.appendChild(buildTcPrChangeElement(oldTcPr, ctx));
        }

        affectedCells += 1;
      }
    }
  }

  return {
    affectedCells,
    missingTableIndexes,
    missingRowIndexes,
    missingCellIndexes,
  };
}

export type ParagraphJustification = 'left' | 'center' | 'right' | 'both';

export type ParagraphPropertiesMutation = {
  paragraphIds: string[];
  /** Direct `w:jc` value to set. */
  alignment?: ParagraphJustification;
  /** `true` sets a direct `<w:pageBreakBefore/>`; `false` removes a direct one. */
  pageBreakBefore?: boolean;
  /** `true` sets a direct `<w:keepNext/>`; `false` removes a direct one. */
  keepNext?: boolean;
  /** `true` sets a direct `<w:keepLines/>`; `false` removes a direct one. */
  keepLines?: boolean;
};

export type ParagraphPropertiesMutationResult = {
  /** Paragraphs whose direct properties actually changed. */
  affectedParagraphs: number;
  affectedParagraphIds: string[];
  /** Paragraphs that already had every requested value (no markup emitted). */
  unchangedParagraphIds: string[];
  missingParagraphIds: string[];
};

export class ParagraphPropertiesMutationError extends Error {
  constructor(
    readonly code: 'FOREIGN_PARAGRAPH_REVISION',
    message: string,
  ) {
    super(message);
    this.name = 'ParagraphPropertiesMutationError';
  }
}

const PARAGRAPH_ALIGNMENTS = new Set<ParagraphJustification>(['left', 'center', 'right', 'both']);

/**
 * CT_PPrBase child sequence followed by the CT_PPr tail (rPr, sectPr,
 * pPrChange). Used to insert a property at its schema position.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.26
 */
const PPR_CHILD_ORDER: readonly string[] = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
  'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
  'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd',
  'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc',
  'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle',
  'rPr', 'sectPr', 'pPrChange',
];

function insertInPPrOrder(pPr: Element, child: Element): void {
  const rank = PPR_CHILD_ORDER.indexOf(child.localName);
  const successor = Array.from(pPr.children).find((existing) => {
    const el = existing as Element;
    if (el.namespaceURI !== OOXML.W_NS) return false;
    const r = PPR_CHILD_ORDER.indexOf(el.localName);
    return r > rank;
  });
  if (successor) pPr.insertBefore(child, successor);
  else pPr.appendChild(child);
}

/** CT_OnOff: absent `w:val` means on; `0`, `false` and `off` mean off. */
function isOnOffElementOn(el: Element): boolean {
  const val = el.getAttributeNS(OOXML.W_NS, W.val) ?? el.getAttribute(`w:${W.val}`);
  if (val === null || val === '') return true;
  return !['0', 'false', 'off'].includes(val);
}

/**
 * Apply one on/off paragraph property. Returns true when the direct markup changed.
 *
 * `true` leaves exactly one bare element (the CT_OnOff "on" form). `false`
 * removes the direct element, so the style hierarchy decides the value again;
 * a direct element that is already explicitly off is left alone.
 */
function applyOnOffProperty(pPr: Element, localName: string, value: boolean): boolean {
  const existing = getDirectChildrenByName(pPr, localName);
  if (value) {
    if (existing.length === 1 && isOnOffElementOn(existing[0]!)) return false;
    for (const stale of existing) pPr.removeChild(stale);
    const created = pPr.ownerDocument!.createElementNS(OOXML.W_NS, `w:${localName}`);
    insertInPPrOrder(pPr, created);
    return true;
  }
  const on = existing.filter((el) => isOnOffElementOn(el));
  if (on.length === 0) return false;
  for (const stale of on) pPr.removeChild(stale);
  return true;
}

function applyAlignment(pPr: Element, alignment: ParagraphJustification): boolean {
  const existing = getDirectChildrenByName(pPr, W.jc);
  if (existing.length === 1) {
    const current = existing[0]!.getAttributeNS(OOXML.W_NS, W.val) ?? existing[0]!.getAttribute(`w:${W.val}`);
    if (current === alignment) return false;
  }
  for (const stale of existing) pPr.removeChild(stale);
  const created = pPr.ownerDocument!.createElementNS(OOXML.W_NS, `w:${W.jc}`);
  setWAttr(created, W.val, alignment);
  insertInPPrOrder(pPr, created);
  return true;
}

/**
 * Set or clear direct paragraph alignment and pagination properties
 * (`w:jc`, `w:pageBreakBefore`, `w:keepNext`, `w:keepLines`) on existing
 * paragraphs. With a revision context each changed paragraph records its
 * prior properties in one `w:pPrChange` (see `recordPPrChange`: an existing
 * same-author wrapper keeps its older snapshot). A target that already has a
 * `w:pPrChange` by another author is refused before any mutation, so an edit
 * is never attributed to someone else's revision. Requests that change
 * nothing emit no markup.
 *
 * Only `left`, `center`, `right` and `both` are offered; these are the
 * `ST_Jc` values Word writes for ordinary alignment. The bidi-relative
 * `start`/`end` and the distribution values are out of scope.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.13
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @see #1199
 */
export function setParagraphProperties(
  doc: Document,
  mutation: ParagraphPropertiesMutation,
  ctx?: RevisionContext,
): ParagraphPropertiesMutationResult {
  if (mutation.alignment !== undefined && !PARAGRAPH_ALIGNMENTS.has(mutation.alignment)) {
    throw new RangeError(`Unsupported alignment '${String(mutation.alignment)}'`);
  }
  for (const key of ['pageBreakBefore', 'keepNext', 'keepLines'] as const) {
    const value = mutation[key];
    if (value !== undefined && typeof value !== 'boolean') {
      throw new TypeError(`${key} must be a boolean`);
    }
  }

  const paragraphIds = [...new Set(mutation.paragraphIds)];
  const missingParagraphIds: string[] = [];
  const unchangedParagraphIds: string[] = [];
  const affectedParagraphIds: string[] = [];

  const targets: Array<{ paragraphId: string; paragraph: Element }> = [];
  for (const paragraphId of paragraphIds) {
    const paragraph = findParagraphByBookmarkId(doc, paragraphId);
    if (!paragraph) {
      missingParagraphIds.push(paragraphId);
      continue;
    }
    if (ctx) {
      const foreign = foreignPPrChangeAuthor(getDirectChildrenByName(paragraph, W.pPr)[0] ?? null, ctx);
      if (foreign !== null) {
        throw new ParagraphPropertiesMutationError(
          'FOREIGN_PARAGRAPH_REVISION',
          `Paragraph '${paragraphId}' already has a tracked paragraph-property change by '${foreign}'. `
            + 'Accept or reject that revision before changing its alignment or pagination.',
        );
      }
    }
    targets.push({ paragraphId, paragraph });
  }

  for (const { paragraphId, paragraph } of targets) {

    const existingPPr = getDirectChildrenByName(paragraph, W.pPr)[0] ?? null;
    const oldPPr = existingPPr ? (existingPPr.cloneNode(true) as Element) : null;
    const pPr = existingPPr ?? doc.createElementNS(OOXML.W_NS, `w:${W.pPr}`);

    let changed = false;
    if (mutation.alignment !== undefined) changed = applyAlignment(pPr, mutation.alignment) || changed;
    if (mutation.keepNext !== undefined) changed = applyOnOffProperty(pPr, 'keepNext', mutation.keepNext) || changed;
    if (mutation.keepLines !== undefined) changed = applyOnOffProperty(pPr, 'keepLines', mutation.keepLines) || changed;
    if (mutation.pageBreakBefore !== undefined) {
      changed = applyOnOffProperty(pPr, 'pageBreakBefore', mutation.pageBreakBefore) || changed;
    }

    if (!changed) {
      unchangedParagraphIds.push(paragraphId);
      continue;
    }

    if (!existingPPr) paragraph.insertBefore(pPr, paragraph.firstChild);
    if (ctx) recordPPrChange(pPr, oldPPr, ctx);
    affectedParagraphIds.push(paragraphId);
  }

  return {
    affectedParagraphs: affectedParagraphIds.length,
    affectedParagraphIds,
    unchangedParagraphIds,
    missingParagraphIds,
  };
}
