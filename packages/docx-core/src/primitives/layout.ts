import { findParagraphByBookmarkId } from './bookmarks.js';
import { OOXML, W } from './namespaces.js';

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
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (isW(el, localName)) out.push(el);
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
): ParagraphSpacingMutationResult {
  const paragraphIds = [...new Set(mutation.paragraphIds)];
  const missingParagraphIds: string[] = [];
  let affectedParagraphs = 0;

  for (const paragraphId of paragraphIds) {
    const paragraph = findParagraphByBookmarkId(doc, paragraphId);
    if (!paragraph) {
      missingParagraphIds.push(paragraphId);
      continue;
    }

    const pPr = ensureFirstChild(paragraph, W.pPr);
    const spacing = ensureChild(pPr, W.spacing);

    if (typeof mutation.beforeTwips === 'number') setWAttr(spacing, W.before, String(mutation.beforeTwips));
    if (typeof mutation.afterTwips === 'number') setWAttr(spacing, W.after, String(mutation.afterTwips));
    if (typeof mutation.lineTwips === 'number') setWAttr(spacing, W.line, String(mutation.lineTwips));
    if (typeof mutation.lineRule === 'string') setWAttr(spacing, W.lineRule, mutation.lineRule);

    affectedParagraphs += 1;
  }

  return { affectedParagraphs, missingParagraphIds };
}

export function setTableRowHeight(
  doc: Document,
  mutation: TableRowHeightMutation,
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
      const trPr = ensureFirstChild(row, W.trPr);
      const trHeight = ensureChild(trPr, W.trHeight);
      setWAttr(trHeight, W.val, String(mutation.valueTwips));
      setWAttr(trHeight, W.hRule, mutation.rule);
      affectedRows += 1;
    }
  }

  return { affectedRows, missingTableIndexes, missingRowIndexes };
}

export function setTableCellPadding(
  doc: Document,
  mutation: TableCellPaddingMutation,
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
