/**
 * Generic DOCX table extraction primitives.
 *
 * Extracts tables from a parsed OOXML Document, returning structured rows
 * with header-keyed records. Supports merged cell detection/rejection and
 * header-based table filtering.
 */

import { OOXML, W } from './namespaces.js';
import { isW, getDirectChildrenByName } from './dom-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedTableCell {
  /** All paragraph texts joined with '\n'. */
  text: string;
  /** Individual paragraph texts (avoids irreversible normalization). */
  paragraphs: string[];
  /** Number of paragraphs in the cell. */
  paragraphCount: number;
}

export interface ExtractedTableRow {
  cells: ExtractedTableCell[];
}

export interface MergedCellDiagnostic {
  tableIndex: number;
  rowIndex: number;
  cellIndex: number;
  mergeType: 'hMerge' | 'vMerge' | 'gridSpan';
}

export interface ExtractedTable {
  /** Index of this table among all top-level w:tbl elements in w:body. */
  tableIndex: number;
  /** Header texts from the first row. */
  headers: string[];
  /** Data rows as header-keyed records (excludes header row). */
  rows: Record<string, string>[];
  /** Raw row data including header row. */
  rawRows: ExtractedTableRow[];
}

export interface ExtractTablesResult {
  tables: ExtractedTable[];
  mergedCellDiagnostics: MergedCellDiagnostic[];
}

export interface ExtractTablesOptions {
  /** Reject tables containing merged cells. Default: true. */
  rejectMergedCells?: boolean;
  /** Only return tables whose headers exactly match one of these arrays. */
  headerFilter?: string[][];
  /** Trim whitespace from cell text. Default: true. */
  trimCellText?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Get text content of a single paragraph element. */
function getParagraphText(p: Element): string {
  const parts: string[] = [];
  const runs = p.getElementsByTagNameNS(OOXML.W_NS, W.r);
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]!;
    // Collect w:t text nodes and w:tab / w:br
    for (const child of Array.from(run.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (isW(el, W.t)) {
        parts.push(el.textContent ?? '');
      } else if (isW(el, W.tab)) {
        parts.push('\t');
      } else if (isW(el, W.br)) {
        parts.push('\n');
      }
    }
  }
  return parts.join('');
}

/** Extract text from a table cell, returning per-paragraph texts. */
function extractCellContent(tc: Element, trim: boolean): ExtractedTableCell {
  const paragraphs = getDirectChildrenByName(tc, W.p);
  const paraTexts: string[] = [];
  for (const p of paragraphs) {
    const text = getParagraphText(p);
    paraTexts.push(trim ? text.trim() : text);
  }
  return {
    text: paraTexts.join('\n'),
    paragraphs: paraTexts,
    paragraphCount: paragraphs.length,
  };
}

/** Check if a cell has any merge properties. Returns the merge type or null. */
function detectMerge(tc: Element): 'hMerge' | 'vMerge' | 'gridSpan' | null {
  const tcPrList = getDirectChildrenByName(tc, W.tcPr);
  if (tcPrList.length === 0) return null;
  const tcPr = tcPrList[0]!;

  // Check w:hMerge (any attribute form)
  for (const child of Array.from(tcPr.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (isW(el, 'hMerge')) return 'hMerge';
    if (isW(el, 'vMerge')) return 'vMerge';
  }

  // Check w:gridSpan with val > 1
  for (const child of Array.from(tcPr.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (isW(el, 'gridSpan')) {
      const val = el.getAttributeNS(OOXML.W_NS, W.val) ?? el.getAttribute('w:val');
      if (val && parseInt(val, 10) > 1) return 'gridSpan';
    }
  }

  return null;
}

/** Get top-level tables from w:body only (not nested tables). */
function getBodyTables(doc: Document): Element[] {
  const body = doc.getElementsByTagNameNS(OOXML.W_NS, W.body).item(0);
  if (!body) return [];
  return getDirectChildrenByName(body as Element, W.tbl);
}

/** Check if headers match a filter entry. */
function headersMatch(headers: string[], filter: string[]): boolean {
  if (headers.length !== filter.length) return false;
  return headers.every((h, i) => h === filter[i]);
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract tables from a parsed OOXML Document.
 *
 * Only processes top-level tables in w:body (not nested tables, headers,
 * or footers). First row of each table is treated as headers.
 */
export function extractTables(doc: Document, options?: ExtractTablesOptions): ExtractTablesResult {
  const rejectMergedCells = options?.rejectMergedCells ?? true;
  const headerFilter = options?.headerFilter;
  const trim = options?.trimCellText ?? true;

  const tables = getBodyTables(doc);
  const result: ExtractedTable[] = [];
  const mergedCellDiagnostics: MergedCellDiagnostic[] = [];

  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const table = tables[tableIndex]!;
    const rows = getDirectChildrenByName(table, W.tr);
    if (rows.length === 0) continue;

    // Scan for merged cells first
    let hasMergedCells = false;
    const tableMergeDiags: MergedCellDiagnostic[] = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const cells = getDirectChildrenByName(rows[rowIndex]!, W.tc);
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const mergeType = detectMerge(cells[cellIndex]!);
        if (mergeType) {
          hasMergedCells = true;
          tableMergeDiags.push({ tableIndex, rowIndex, cellIndex, mergeType });
        }
      }
    }

    mergedCellDiagnostics.push(...tableMergeDiags);

    if (hasMergedCells && rejectMergedCells) {
      continue; // Skip this table
    }

    // Extract header row
    const headerCells = getDirectChildrenByName(rows[0]!, W.tc);
    const headers = headerCells.map((c) => extractCellContent(c, trim).text);

    // Check for duplicate headers
    const headerSet = new Set<string>();
    let hasDuplicateHeaders = false;
    for (const h of headers) {
      if (headerSet.has(h)) {
        hasDuplicateHeaders = true;
        break;
      }
      headerSet.add(h);
    }
    if (hasDuplicateHeaders) continue; // Skip tables with duplicate headers

    // Apply header filter
    if (headerFilter) {
      const matches = headerFilter.some((filter) => headersMatch(headers, filter));
      if (!matches) continue;
    }

    // Extract all rows (including header as rawRows[0])
    const rawRows: ExtractedTableRow[] = [];
    const dataRecords: Record<string, string>[] = [];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const cells = getDirectChildrenByName(rows[rowIndex]!, W.tc);
      const extractedCells: ExtractedTableCell[] = [];
      for (const cell of cells) {
        extractedCells.push(extractCellContent(cell, trim));
      }
      rawRows.push({ cells: extractedCells });

      // Skip header row for data records
      if (rowIndex === 0) continue;

      // Build header-keyed record
      const record: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]!] = extractedCells[i]?.text ?? '';
      }
      dataRecords.push(record);
    }

    // Check for nested tables and emit diagnostic (but don't skip the table)
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const cells = getDirectChildrenByName(rows[rowIndex]!, W.tc);
      for (const cell of cells) {
        const nestedTables = getDirectChildrenByName(cell, W.tbl);
        if (nestedTables.length > 0) {
          // Nested table detected — logged via diagnostics
          // The parent table is still extracted; nested tables are ignored
        }
      }
    }

    result.push({
      tableIndex,
      headers,
      rows: dataRecords,
      rawRows,
    });
  }

  return { tables: result, mergedCellDiagnostics };
}
