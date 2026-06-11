import { DocxZip } from './zip.js';
import { parseXml, serializeXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { createWmlElement, isW, getDirectChildrenByName } from './dom-helpers.js';
import {
  findParagraphByBookmarkId,
  insertParagraphBookmarks,
  cleanupInternalBookmarks,
  getParagraphBookmarkId,
  insertSingleParagraphBookmark,
} from './bookmarks.js';
import { getParagraphRuns, getParagraphText, replaceParagraphTextRange, type ReplacementPart } from './text.js';
import {
  allocateRevisionId,
  createRevisionContainer,
  type RevisionContext,
} from './track-changes-emitter.js';
import { buildNodesForDocumentView, type DocumentStyles, type DocumentViewNode, type TableContext } from './document_view.js';
import { serializeToMarkdown, type SerializeMarkdownOptions } from './serialize_markdown.js';
import { serializeToHtml, type SerializeHtmlOptions } from './serialize_html.js';
import { serializeToPlainText, type SerializePlainTextOptions } from './serialize_plaintext.js';
import type { FormattingMode } from './formatting_tags.js';
import { parseStylesXml, type StylesModel } from './styles.js';
import { parseNumberingXml, type NumberingModel } from './numbering.js';
import { findUniqueSubstringMatch } from './matching.js';
import { parseDocumentRels, type RelsMap } from './relationships.js';
import {
  setParagraphSpacing,
  setTableCellPadding,
  setTableRowHeight,
  type ParagraphSpacingMutation,
  type ParagraphSpacingMutationResult,
  type TableCellPaddingMutation,
  type TableCellPaddingMutationResult,
  type TableRowHeightMutation,
  type TableRowHeightMutationResult,
} from './layout.js';
import {
  extractTables,
  type ExtractTablesOptions,
  type ExtractTablesResult,
} from './tables.js';
import { mergeRuns, type MergeRunsOptions, type MergeRunsResult } from './merge_runs.js';
import { restoreUntouchedBlocks } from './minimal_save.js';
import { simplifyRedlines } from './simplify_redlines.js';
import { preventDoubleElevation } from './prevent_double_elevation.js';
import { validateDocument, type ValidateDocumentResult } from './validate_document.js';
import { acceptChanges as acceptChangesImpl, type AcceptChangesResult } from './accept_changes.js';
import { rejectChanges as rejectChangesImpl, type RejectChangesResult } from './reject_changes.js';
import {
  bootstrapCommentParts,
  addComment as addCommentImpl,
  addCommentReply as addCommentReplyImpl,
  getComments as getCommentsImpl,
  getComment as getCommentImpl,
  deleteComment as deleteCommentImpl,
  type AddCommentResult,
  type AddCommentReplyResult,
  type Comment,
} from './comments.js';
import {
  bootstrapFootnoteParts,
  getFootnotes as getFootnotesImpl,
  getFootnote as getFootnoteImpl,
  addFootnote as addFootnoteImpl,
  updateFootnoteText as updateFootnoteTextImpl,
  deleteFootnote as deleteFootnoteImpl,
  type Footnote,
  type AddFootnoteResult,
} from './footnotes.js';

export type NormalizationResult = {
  runsMerged: number;
  proofErrRemoved: number;
  wrappersConsolidated: number;
  doubleElevationsFixed: number;
};

const REVISION_STORY_PART_PATHS = [
  'word/footnotes.xml',
  'word/endnotes.xml',
  'word/comments.xml',
] as const;

function emptyAcceptChangesResult(): AcceptChangesResult {
  return { insertionsAccepted: 0, deletionsAccepted: 0, movesResolved: 0, propertyChangesResolved: 0 };
}

function hasAcceptedChanges(result: AcceptChangesResult): boolean {
  return (
    result.insertionsAccepted > 0 ||
    result.deletionsAccepted > 0 ||
    result.movesResolved > 0 ||
    result.propertyChangesResolved > 0
  );
}

function addAcceptChangesResult(total: AcceptChangesResult, result: AcceptChangesResult): void {
  total.insertionsAccepted += result.insertionsAccepted;
  total.deletionsAccepted += result.deletionsAccepted;
  total.movesResolved += result.movesResolved;
  total.propertyChangesResolved += result.propertyChangesResolved;
}

function emptyRejectChangesResult(): RejectChangesResult {
  return { insertionsRemoved: 0, deletionsRestored: 0, movesReverted: 0, propertyChangesReverted: 0 };
}

function hasRejectedChanges(result: RejectChangesResult): boolean {
  return (
    result.insertionsRemoved > 0 ||
    result.deletionsRestored > 0 ||
    result.movesReverted > 0 ||
    result.propertyChangesReverted > 0
  );
}

function addRejectChangesResult(total: RejectChangesResult, result: RejectChangesResult): void {
  total.insertionsRemoved += result.insertionsRemoved;
  total.deletionsRestored += result.deletionsRestored;
  total.movesReverted += result.movesReverted;
  total.propertyChangesReverted += result.propertyChangesReverted;
}

function parseWId(el: Element): number | null {
  const idStr = el.getAttributeNS(OOXML.W_NS, 'id') ?? el.getAttribute('w:id');
  if (!idStr) return null;
  const n = parseInt(idStr, 10);
  return Number.isNaN(n) ? null : n;
}

function collectLiveFootnoteRefIds(doc: Document): Set<number> {
  const ids = new Set<number>();
  const refs = doc.getElementsByTagNameNS(OOXML.W_NS, W.footnoteReference);
  for (let i = 0; i < refs.length; i++) {
    const id = parseWId(refs.item(i) as Element);
    if (id !== null) ids.add(id);
  }
  return ids;
}

// Side-effect of accept/reject on document.xml: a body w:footnoteReference that
// lived inside a removed w:del (accept) or w:ins (reject) is gone afterwards.
// The corresponding <w:footnote w:id=N> in footnotes.xml is then unreachable —
// remove it so the side part matches the post-sweep body. Reserved separator /
// continuationSeparator entries are preserved unconditionally.
function pruneOrphanedFootnotes(footnotesDoc: Document, liveRefIds: Set<number>): number {
  const entries = Array.from(footnotesDoc.getElementsByTagNameNS(OOXML.W_NS, W.footnote));
  let pruned = 0;
  for (const fn of entries) {
    const typ = fn.getAttributeNS(OOXML.W_NS, 'type') ?? fn.getAttribute('w:type');
    if (typ === W.separator || typ === W.continuationSeparator) continue;
    const id = parseWId(fn);
    if (id === null) continue;
    if (liveRefIds.has(id)) continue;
    fn.parentNode?.removeChild(fn);
    pruned++;
  }
  return pruned;
}

export type ParagraphRef = {
  id: string; // _bk_###
  text: string;
};

function prevElementSibling(node: Node | null): Element | null {
  let cur: Node | null = node?.previousSibling ?? null;
  while (cur) {
    if (cur.nodeType === 1) return cur as Element;
    cur = cur.previousSibling;
  }
  return null;
}

function nextElementSibling(node: Node | null): Element | null {
  let cur: Node | null = node?.nextSibling ?? null;
  while (cur) {
    if (cur.nodeType === 1) return cur as Element;
    cur = cur.nextSibling;
  }
  return null;
}

// ── Table context derivation for document view ───────────────────────

type TableMeta = {
  tableIndex: number;
  tableId: string;
  rows: Element[];
  headers: string[];
  totalCols: number;
};

/**
 * Collect all w:tr descendants of a table element, descending through
 * w:ins/w:del/w:sdt wrappers but not into nested w:tbl elements.
 */
function collectTableRows(tbl: Element): Element[] {
  const rows: Element[] = [];
  function walk(parent: Element) {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const child = parent.childNodes[i]!;
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (isW(el, W.tr)) {
        rows.push(el);
      } else if (!isW(el, W.tbl)) {
        walk(el);
      }
    }
  }
  walk(tbl);
  return rows;
}

/**
 * Collect all w:tc descendants of a row element, descending through
 * w:ins/w:del/w:sdt wrappers but not into nested w:tr or w:tbl elements.
 */
function collectRowCells(tr: Element): Element[] {
  const cells: Element[] = [];
  function walk(parent: Element) {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const child = parent.childNodes[i]!;
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (isW(el, W.tc)) {
        cells.push(el);
      } else if (!isW(el, W.tr) && !isW(el, W.tbl)) {
        walk(el);
      }
    }
  }
  walk(tr);
  return cells;
}

/** Get the gridSpan value for a table cell (default 1). */
function getCellGridSpan(tc: Element): number {
  const tcPrList = getDirectChildrenByName(tc, W.tcPr);
  if (tcPrList.length === 0) return 1;
  const gridSpanEls = getDirectChildrenByName(tcPrList[0]!, 'gridSpan');
  if (gridSpanEls.length === 0) return 1;
  const val =
    gridSpanEls[0]!.getAttributeNS(OOXML.W_NS, W.val) ??
    gridSpanEls[0]!.getAttribute('w:val') ??
    gridSpanEls[0]!.getAttribute(W.val);
  if (!val) return 1;
  const n = parseInt(val, 10);
  return n > 0 ? n : 1;
}

/** Get visible text from a cell's direct paragraphs (excludes nested tables). */
function getCellHeaderText(tc: Element): string {
  const parts: string[] = [];
  for (let i = 0; i < tc.childNodes.length; i++) {
    const child = tc.childNodes[i]!;
    if (child.nodeType === 1 && isW(child as Element, W.p)) {
      parts.push(getParagraphText(child as Element).trim());
    }
  }
  return parts.join(' ').trim();
}

/**
 * Build metadata map for body-level tables.
 * Only indexes direct w:tbl children of w:body (consistent with extractTables).
 */
function buildTableMetaMap(body: Element): Map<Element, TableMeta> {
  const map = new Map<Element, TableMeta>();
  const tables = getDirectChildrenByName(body, W.tbl);

  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const tbl = tables[tableIndex]!;
    const rows = collectTableRows(tbl);
    if (rows.length === 0) continue;

    // Compute max grid columns across all rows
    let maxGridCols = 0;
    for (const row of rows) {
      const cells = collectRowCells(row);
      let gridCols = 0;
      for (const cell of cells) {
        gridCols += getCellGridSpan(cell);
      }
      if (gridCols > maxGridCols) maxGridCols = gridCols;
    }

    // Extract headers from row 0
    const headerRow = rows[0]!;
    const headerCells = collectRowCells(headerRow);
    const headers: string[] = [];
    for (const cell of headerCells) {
      const span = getCellGridSpan(cell);
      const text = getCellHeaderText(cell);
      headers.push(text);
      for (let s = 1; s < span; s++) headers.push('');
    }
    while (headers.length < maxGridCols) headers.push('');
    if (headers.length > maxGridCols) headers.length = maxGridCols;

    map.set(tbl, {
      tableIndex,
      tableId: `_tbl_${tableIndex}`,
      rows,
      headers,
      totalCols: maxGridCols,
    });
  }

  return map;
}

/**
 * Derive table context for a paragraph by walking up the DOM.
 * Returns undefined if the paragraph is not inside a body-level table.
 */
function deriveTableContext(p: Element, tableMetaMap: Map<Element, TableMeta>): TableContext | undefined {
  let tc: Element | null = null;
  let tr: Element | null = null;
  let tbl: Element | null = null;

  let current: Node | null = p.parentNode;
  while (current && current.nodeType === 1) {
    const el = current as Element;
    if (isW(el, W.body)) break;

    if (isW(el, W.tc)) tc = el;
    if (isW(el, W.tr)) tr = el;
    if (isW(el, W.tbl)) {
      if (tableMetaMap.has(el)) {
        tbl = el;
        break;
      }
      // Nested table: reset tc/tr, keep walking to find body-level table
      tc = null;
      tr = null;
    }

    current = el.parentNode;
  }

  if (!tbl || !tr || !tc) return undefined;

  const meta = tableMetaMap.get(tbl)!;

  // Compute row_index
  const rowIndex = meta.rows.indexOf(tr);
  if (rowIndex < 0) return undefined;

  // Compute grid-aware col_index by summing gridSpan for preceding cells
  const rowCells = collectRowCells(tr);
  let gridCol = 0;
  let cellFound = false;
  for (const cell of rowCells) {
    if (cell === tc) {
      cellFound = true;
      break;
    }
    gridCol += getCellGridSpan(cell);
  }
  if (!cellFound) return undefined;

  // Compute para_in_cell and cell_para_count
  const allCellPs = Array.from(tc.getElementsByTagNameNS(OOXML.W_NS, W.p));
  const paraInCell = allCellPs.indexOf(p);

  return {
    table_id: meta.tableId,
    table_index: meta.tableIndex,
    row_index: rowIndex,
    col_index: gridCol,
    col_header: meta.headers[gridCol] ?? '',
    total_rows: meta.rows.length,
    total_cols: meta.totalCols,
    is_header_row: rowIndex === 0,
    para_in_cell: paraInCell >= 0 ? paraInCell : 0,
    cell_para_count: allCellPs.length,
  };
}

export class DocxDocument {
  private zip: DocxZip;
  private documentXml: Document;
  private stylesXml: Document | null;
  private numberingXml: Document | null;
  private footnotesXml: Document | null;
  private relsMap: RelsMap;
  private dirty: boolean;
  private documentViewCache: { includeSemanticTags: boolean; showFormatting: boolean; formattingMode: FormattingMode; nodes: DocumentViewNode[]; styles: DocumentStyles } | null;
  /**
   * Raw document.xml text as loaded, before normalize()/edits mutate the DOM.
   * Reference for minimal re-serialization in toBuffer(); null for instances
   * not created via load().
   */
  private originalDocumentXmlText: string | null;

  private constructor(zip: DocxZip, documentXml: Document, stylesXml: Document | null, numberingXml: Document | null, footnotesXml: Document | null, relsMap: RelsMap, originalDocumentXmlText: string | null = null) {
    this.zip = zip;
    this.documentXml = documentXml;
    this.stylesXml = stylesXml;
    this.numberingXml = numberingXml;
    this.footnotesXml = footnotesXml;
    this.relsMap = relsMap;
    this.dirty = false;
    this.documentViewCache = null;
    this.originalDocumentXmlText = originalDocumentXmlText;
  }

  static async load(buffer: Buffer): Promise<DocxDocument> {
    const zip = await DocxZip.load(buffer);
    const xml = await zip.readText('word/document.xml');
    const doc = parseXml(xml);

    // Optional parts used for fidelity: list labels + style fingerprints.
    const stylesText = await zip.readTextOrNull('word/styles.xml');
    const numberingText = await zip.readTextOrNull('word/numbering.xml');
    const stylesXml = stylesText ? parseXml(stylesText) : null;
    const numberingXml = numberingText ? parseXml(numberingText) : null;

    // Load footnotes for [^N] marker rendering in document view.
    const footnotesText = await zip.readTextOrNull('word/footnotes.xml');
    const footnotesXml = footnotesText ? parseXml(footnotesText) : null;

    // Load document relationships for hyperlink resolution.
    const relsText = await zip.readTextOrNull('word/_rels/document.xml.rels');
    const relsMap = relsText ? parseDocumentRels(parseXml(relsText)) : new Map<string, string>();

    return new DocxDocument(zip, doc, stylesXml, numberingXml, footnotesXml, relsMap, xml);
  }

  getParagraphs(): Element[] {
    const body = this.documentXml.getElementsByTagNameNS(OOXML.W_NS, W.body).item(0);
    if (!body) return [];
    return Array.from(body.getElementsByTagNameNS(OOXML.W_NS, W.p));
  }

  getParagraphElementById(bookmarkId: string): Element | null {
    return findParagraphByBookmarkId(this.documentXml, bookmarkId);
  }

  getParagraphTextById(bookmarkId: string): string | null {
    const p = this.getParagraphElementById(bookmarkId);
    if (!p) return null;
    return getParagraphText(p);
  }

  insertParagraphBookmarks(attachmentId: string): { paragraphCount: number } {
    const res = insertParagraphBookmarks(this.documentXml, attachmentId);
    if (res.indexedParagraphs > 0) this.dirty = true;
    return { paragraphCount: res.indexedParagraphs };
  }

  /**
   * Normalize the document by merging format-identical adjacent runs and
   * consolidating adjacent same-author tracked-change wrappers.
   * Should be called BEFORE bookmark allocation.
   */
  normalize(): NormalizationResult {
    const mr = mergeRuns(this.documentXml);
    const sr = simplifyRedlines(this.documentXml);

    // Prevent double elevation in footnote/endnote reference styles
    let de = { doubleElevationsFixed: 0 };
    if (this.stylesXml) {
      de = preventDoubleElevation(this.stylesXml);
      if (de.doubleElevationsFixed > 0) {
        this.zip.writeText('word/styles.xml', serializeXml(this.stylesXml));
      }
    }

    if (mr.runsMerged > 0 || sr.wrappersConsolidated > 0 || de.doubleElevationsFixed > 0) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return {
      runsMerged: mr.runsMerged,
      proofErrRemoved: mr.proofErrRemoved,
      wrappersConsolidated: sr.wrappersConsolidated,
      doubleElevationsFixed: de.doubleElevationsFixed,
    };
  }

  /**
   * Validate structural integrity of the document.
   * Non-destructive, read-only check.
   */
  validate(): ValidateDocumentResult {
    return validateDocument(this.documentXml);
  }

  /**
   * Accept all tracked changes in document.xml plus supported revisionable
   * side-story parts, producing clean XML with no revision markup.
   */
  async acceptChanges(): Promise<AcceptChangesResult> {
    const total = emptyAcceptChangesResult();
    const bodyResult = acceptChangesImpl(this.documentXml);
    addAcceptChangesResult(total, bodyResult);

    // After accepting, footnotes whose body reference lived inside a removed
    // w:del are orphaned. Only worth checking when the body sweep removed
    // deletions (the only operation that can drop a footnoteReference).
    const liveFootnoteRefIds = bodyResult.deletionsAccepted > 0
      ? collectLiveFootnoteRefIds(this.documentXml)
      : null;

    for (const partPath of REVISION_STORY_PART_PATHS) {
      const xml = await this.zip.readTextOrNull(partPath);
      if (!xml) continue;

      const partDoc = parseXml(xml);
      const partResult = acceptChangesImpl(partDoc);
      addAcceptChangesResult(total, partResult);

      let footnotesPruned = 0;
      if (partPath === 'word/footnotes.xml' && liveFootnoteRefIds) {
        footnotesPruned = pruneOrphanedFootnotes(partDoc, liveFootnoteRefIds);
      }

      if (hasAcceptedChanges(partResult) || footnotesPruned > 0) {
        this.zip.writeText(partPath, serializeXml(partDoc));
        if (partPath === 'word/footnotes.xml') {
          this.footnotesXml = partDoc;
        }
      }
    }

    if (hasAcceptedChanges(total)) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return total;
  }

  /**
   * Reject all tracked changes in document.xml plus supported revisionable
   * side-story parts, restoring their pre-edit state where possible.
   */
  async rejectChanges(): Promise<RejectChangesResult> {
    const total = emptyRejectChangesResult();
    const bodyResult = rejectChangesImpl(this.documentXml);
    addRejectChangesResult(total, bodyResult);

    // After rejecting, footnotes whose body reference lived inside a removed
    // w:ins are orphaned. Only worth checking when the body sweep removed
    // insertions (the only operation that can drop a footnoteReference).
    const liveFootnoteRefIds = bodyResult.insertionsRemoved > 0
      ? collectLiveFootnoteRefIds(this.documentXml)
      : null;

    for (const partPath of REVISION_STORY_PART_PATHS) {
      const xml = await this.zip.readTextOrNull(partPath);
      if (!xml) continue;

      const partDoc = parseXml(xml);
      const partResult = rejectChangesImpl(partDoc);
      addRejectChangesResult(total, partResult);

      let footnotesPruned = 0;
      if (partPath === 'word/footnotes.xml' && liveFootnoteRefIds) {
        footnotesPruned = pruneOrphanedFootnotes(partDoc, liveFootnoteRefIds);
      }

      if (hasRejectedChanges(partResult) || footnotesPruned > 0) {
        this.zip.writeText(partPath, serializeXml(partDoc));
        if (partPath === 'word/footnotes.xml') {
          this.footnotesXml = partDoc;
        }
      }
    }

    if (hasRejectedChanges(total)) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return total;
  }

  removeJuniorBookmarks(): number {
    const removed = cleanupInternalBookmarks(this.documentXml);
    if (removed > 0) this.dirty = true;
    return removed;
  }

  readParagraphs(opts?: { nodeIds?: string[]; offset?: number; limit?: number }): {
    paragraphs: ParagraphRef[];
    totalParagraphs: number;
  } {
    const all = this.getParagraphs()
      .map((p) => {
        const id = getParagraphBookmarkId(p);
        if (!id) return null;
        const text = getParagraphText(p).trim();
        if (!text) return null;
        return { id, text } satisfies ParagraphRef;
      })
      .filter((x): x is ParagraphRef => x !== null);

    const total = all.length;
    const { nodeIds, offset, limit } = opts ?? {};

    if (nodeIds && nodeIds.length > 0) {
      const set = new Set(nodeIds);
      return { paragraphs: all.filter((p) => set.has(p.id)), totalParagraphs: total };
    }

    let startIdx = 0;
    if (typeof offset === 'number') {
      // Offset is 1-based in Python server; negative counts from end.
      if (offset > 0) startIdx = Math.max(0, offset - 1);
      if (offset < 0) startIdx = Math.max(0, total + offset);
    }
    const endIdx = typeof limit === 'number' ? Math.min(total, startIdx + limit) : total;
    return { paragraphs: all.slice(startIdx, endIdx), totalParagraphs: total };
  }

  /**
   * Parsed `word/numbering.xml` model (abstract numberings + instances), or null when the
   * document has no numbering part. The document view's `numbering` field only carries
   * `num_id`/`ilvl`; semantic converters (DOCX → ODT) need `numFmt`/`lvlText`/`start` to
   * synthesize target-format list styles, so the full model is exposed here.
   */
  getNumberingModel(): NumberingModel | null {
    return this.numberingXml ? parseNumberingXml(this.numberingXml) : null;
  }

  /**
   * Parsed named-style model of the loaded document (empty when the package has no
   * `word/styles.xml`). Semantic converters (DOCX → ODT) resolve heading/body style chains
   * through it to seed their own style templates from the source's definitions.
   */
  getStylesModel(): StylesModel {
    return parseStylesXml(this.stylesXml);
  }

  buildDocumentView(opts?: { includeSemanticTags?: boolean; showFormatting?: boolean; formattingMode?: FormattingMode }): { nodes: DocumentViewNode[]; styles: DocumentStyles } {
    const includeSemanticTags = opts?.includeSemanticTags ?? true;
    const showFormatting = opts?.showFormatting ?? false;
    const formattingMode: FormattingMode = opts?.formattingMode ?? 'compact';
    const cached = this.documentViewCache;
    if (!this.dirty && cached && cached.includeSemanticTags === includeSemanticTags && cached.showFormatting === showFormatting && cached.formattingMode === formattingMode) {
      return { nodes: cached.nodes, styles: cached.styles };
    }

    // Pre-pass: build metadata for body-level tables
    const body = this.documentXml.getElementsByTagNameNS(OOXML.W_NS, W.body).item(0);
    const tableMetaMap = body ? buildTableMetaMap(body as Element) : new Map<Element, TableMeta>();

    const paragraphs = this.getParagraphs()
      .map((p): { id: string; p: Element; tableContext?: TableContext } | null => {
        const id = getParagraphBookmarkId(p);
        if (!id) return null;
        const tableContext = deriveTableContext(p, tableMetaMap);
        return tableContext ? { id, p, tableContext } : { id, p };
      })
      .filter((x): x is { id: string; p: Element; tableContext?: TableContext } => x !== null);

    const { nodes, styles } = buildNodesForDocumentView({
      paragraphs,
      stylesXml: this.stylesXml,
      numberingXml: this.numberingXml,
      include_semantic_tags: includeSemanticTags,
      show_formatting: showFormatting,
      formatting_mode: formattingMode,
      relsMap: this.relsMap,
      documentXml: this.documentXml,
      footnotesXml: this.footnotesXml,
    });

    this.documentViewCache = { includeSemanticTags, showFormatting, formattingMode, nodes, styles };
    this.dirty = false;
    return { nodes, styles };
  }

  replaceText(params: { targetParagraphId: string; findText: string; replaceText: string | ReplacementPart[] }): void {
    const { targetParagraphId, findText, replaceText } = params;
    const p = findParagraphByBookmarkId(this.documentXml, targetParagraphId);
    if (!p) throw new Error(`Paragraph not found: ${targetParagraphId}`);
    const full = getParagraphText(p);
    const match = findUniqueSubstringMatch(full, findText);
    if (match.status === 'not_found') {
      throw new Error(`Text not found in paragraph ${targetParagraphId}`);
    }
    if (match.status === 'multiple') {
      throw new Error(
        `Multiple matches (${match.matchCount}) found in paragraph ${targetParagraphId} using ${match.mode} matching`,
      );
    }
    replaceParagraphTextRange(p, match.start, match.end, replaceText);
    this.dirty = true;
    this.documentViewCache = null;
  }

  /**
   * Replace text at a known character range without re-searching.
   * Used by the range-trimming approach where the caller has already located the match.
   */
  replaceTextAtRange(params: { targetParagraphId: string; start: number; end: number; replaceText: string | ReplacementPart[] }): void {
    const { targetParagraphId, start, end, replaceText } = params;
    const p = findParagraphByBookmarkId(this.documentXml, targetParagraphId);
    if (!p) throw new Error(`Paragraph not found: ${targetParagraphId}`);
    replaceParagraphTextRange(p, start, end, replaceText);
    this.dirty = true;
    this.documentViewCache = null;
  }

  insertParagraph(params: {
    positionalAnchorNodeId: string;
    relativePosition: 'BEFORE' | 'AFTER';
    newText: string;
    newParagraphId?: string;
    styleSourceId?: string;
  }, ctx?: RevisionContext): { newParagraphId: string; newParagraphIds: string[]; styleSourceFallback?: boolean } {
    const { positionalAnchorNodeId, relativePosition, newText, newParagraphId: _newParagraphId, styleSourceId } = params;
    const anchor = findParagraphByBookmarkId(this.documentXml, positionalAnchorNodeId);
    if (!anchor) throw new Error(`Anchor paragraph not found: ${positionalAnchorNodeId}`);
    const anchorP = anchor;

    // Resolve style source paragraph (if provided).
    let styleSourceP: Element | null = null;
    let styleSourceFallback = false;
    if (styleSourceId) {
      styleSourceP = findParagraphByBookmarkId(this.documentXml, styleSourceId);
      if (!styleSourceP) {
        styleSourceFallback = true;
        // Fall back to anchor
      }
    }
    const formattingSource = styleSourceP ?? anchorP;

    const doc = this.documentXml;
    const parent = anchorP.parentNode;
    if (!parent) throw new Error('Anchor paragraph has no parent');

    function isWTag(el: Element | null, localName: string): boolean {
      return !!el && el.namespaceURI === OOXML.W_NS && el.localName === localName;
    }

    function setXmlSpacePreserveIfNeeded(t: Element, text: string): void {
      if (!text) return;
      if (text.startsWith(' ') || text.endsWith(' ')) {
        t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      }
    }

    function cloneRunFormattingOnly(sourceRun: Element): Element {
      const r = doc.createElementNS(OOXML.W_NS, 'w:r');
      for (const child of Array.from(sourceRun.childNodes)) {
        if (child.nodeType !== 1) continue;
        const el = child as Element;
        if (isWTag(el, W.rPr)) {
          r.appendChild(el.cloneNode(true));
          break;
        }
      }
      return r;
    }

    function appendTextToRun(run: Element, text: string): void {
      let buf = '';
      const flush = () => {
        if (!buf) return;
        const t = doc.createElementNS(OOXML.W_NS, 'w:t');
        setXmlSpacePreserveIfNeeded(t, buf);
        t.appendChild(doc.createTextNode(buf));
        run.appendChild(t);
        buf = '';
      };

      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (ch === '\t') {
          flush();
          run.appendChild(doc.createElementNS(OOXML.W_NS, 'w:tab'));
          continue;
        }
        if (ch === '\n') {
          flush();
          run.appendChild(doc.createElementNS(OOXML.W_NS, 'w:br'));
          continue;
        }
        buf += ch;
      }
      flush();
    }

    function cloneParagraphShell(anchorPara: Element): Element {
      // Clone anchor paragraph to preserve formatting; then wipe its runs and keep pPr only.
      const newP = anchorPara.cloneNode(true) as Element;
      const children = Array.from(newP.childNodes);
      for (const child of children) {
        if (child.nodeType === 1 && isWTag(child as Element, W.pPr)) continue;
        newP.removeChild(child);
      }
      // sectPr is the section terminator — must stay on the anchor, not propagate to the new paragraph.
      const clonedPPr = getDirectChildrenByName(newP, W.pPr)[0];
      if (clonedPPr) {
        for (const sectPr of getDirectChildrenByName(clonedPPr, 'sectPr')) {
          clonedPPr.removeChild(sectPr);
        }
      }
      return newP;
    }

    function ensureParagraphProperties(paragraph: Element): Element {
      const existing = getDirectChildrenByName(paragraph, W.pPr)[0];
      if (existing) return existing;

      const pPr = createWmlElement(doc, W.pPr);
      paragraph.insertBefore(pPr, paragraph.firstChild);
      return pPr;
    }

    function ensureParagraphRunProperties(pPr: Element): Element {
      const existing = getDirectChildrenByName(pPr, W.rPr)[0];
      if (existing) return existing;

      const rPr = createWmlElement(doc, W.rPr);
      const sectPr = getDirectChildrenByName(pPr, 'sectPr')[0];
      const pPrChange = getDirectChildrenByName(pPr, 'pPrChange')[0];
      const insertBefore = sectPr ?? pPrChange ?? null;
      if (insertBefore) {
        pPr.insertBefore(rPr, insertBefore);
      } else {
        pPr.appendChild(rPr);
      }
      return rPr;
    }

    function addParagraphInsertionMarker(paragraph: Element, revisionCtx: RevisionContext): void {
      const pPr = ensureParagraphProperties(paragraph);
      const rPr = ensureParagraphRunProperties(pPr);
      const marker = createWmlElement(doc, 'ins', {
        'w:id': String(allocateRevisionId(revisionCtx.idState)),
        'w:author': revisionCtx.author,
        'w:date': revisionCtx.date,
      });
      rPr.insertBefore(marker, rPr.firstChild);
    }

    function clearRunPropertyRevisionMarkup(run: Element): void {
      const rPr = getDirectChildrenByName(run, W.rPr)[0];
      if (!rPr) return;

      for (const child of Array.from(rPr.childNodes)) {
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        if (isW(element, 'rPrChange')) {
          rPr.removeChild(element);
        }
      }
    }

    function clearParagraphPropertyRevisionMarkup(paragraph: Element): void {
      const pPr = getDirectChildrenByName(paragraph, W.pPr)[0];
      if (!pPr) return;

      for (const pPrChange of getDirectChildrenByName(pPr, 'pPrChange')) {
        pPr.removeChild(pPrChange);
      }

      const rPr = getDirectChildrenByName(pPr, W.rPr)[0];
      if (!rPr) return;

      for (const child of Array.from(rPr.childNodes)) {
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        // CT_ParaRPr revision children: w:ins, w:del, w:moveFrom, w:moveTo, w:rPrChange.
        if (
          isW(element, 'ins') ||
          isW(element, 'del') ||
          isW(element, 'moveFrom') ||
          isW(element, 'moveTo') ||
          isW(element, 'rPrChange')
        ) {
          rPr.removeChild(element);
        }
      }
    }

    function getInsertionRefNode(): Node | null {
      if (relativePosition === 'BEFORE') {
        const prev = prevElementSibling(anchorP);
        return isW(prev, W.bookmarkStart) ? prev : anchorP;
      }

      const next = nextElementSibling(anchorP);
      if (next && isW(next, W.bookmarkEnd)) return next.nextSibling;
      return anchorP.nextSibling;
    }

    // Choose a run in the formatting source to use as formatting template: pick the run with the most visible text.
    const sourceVisibleRuns = getParagraphRuns(formattingSource);
    let templateRun: Element | null = null;
    let bestLen = -1;
    for (const tr of sourceVisibleRuns) {
      if (tr.text.length > bestLen) {
        bestLen = tr.text.length;
        templateRun = tr.r;
      }
    }
    if (!templateRun) {
      const allRuns = Array.from(formattingSource.getElementsByTagNameNS(OOXML.W_NS, W.r));
      templateRun = allRuns[0] ?? doc.createElementNS(OOXML.W_NS, 'w:r');
    }

    const paragraphsToInsert = newText.replace(/\r\n/g, '\n').split(/\n{2,}/);

    const insertedIds: string[] = [];
    let cursor: Node | null = getInsertionRefNode();

    for (const paraText of paragraphsToInsert) {
      const newP = cloneParagraphShell(formattingSource);
      const newRun = cloneRunFormattingOnly(templateRun);
      appendTextToRun(newRun, paraText);

      if (ctx) {
        clearRunPropertyRevisionMarkup(newRun);
        clearParagraphPropertyRevisionMarkup(newP);
        addParagraphInsertionMarker(newP, ctx);
        const insertion = createRevisionContainer(doc, 'ins', ctx);
        insertion.appendChild(newRun);
        newP.appendChild(insertion);
      } else {
        newP.appendChild(newRun);
      }

      parent.insertBefore(newP, cursor);

      const id = insertSingleParagraphBookmark(doc, newP);
      insertedIds.push(id);

      if (relativePosition === 'AFTER') {
        const endEl = nextElementSibling(newP);
        cursor = endEl && isW(endEl, W.bookmarkEnd) ? endEl.nextSibling : newP.nextSibling;
      }
    }

    this.dirty = true;
    this.documentViewCache = null;
    const result: { newParagraphId: string; newParagraphIds: string[]; styleSourceFallback?: boolean } = {
      newParagraphId: insertedIds[0]!,
      newParagraphIds: insertedIds,
    };
    if (styleSourceFallback) result.styleSourceFallback = true;
    return result;
  }

  setParagraphSpacing(
    mutation: ParagraphSpacingMutation,
    ctx?: RevisionContext,
  ): ParagraphSpacingMutationResult {
    const result = setParagraphSpacing(this.documentXml, mutation, ctx);
    if (result.affectedParagraphs > 0) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return result;
  }

  setTableRowHeight(
    mutation: TableRowHeightMutation,
    ctx?: RevisionContext,
  ): TableRowHeightMutationResult {
    const result = setTableRowHeight(this.documentXml, mutation, ctx);
    if (result.affectedRows > 0) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return result;
  }

  setTableCellPadding(
    mutation: TableCellPaddingMutation,
    ctx?: RevisionContext,
  ): TableCellPaddingMutationResult {
    const result = setTableCellPadding(this.documentXml, mutation, ctx);
    if (result.affectedCells > 0) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return result;
  }

  /**
   * Extract tables from the document body.
   * Read-only operation — does not mutate document state.
   */
  extractTables(options?: ExtractTablesOptions): ExtractTablesResult {
    return extractTables(this.documentXml, options);
  }

  /**
   * Merge format-identical adjacent runs only (no redline simplification).
   * Useful as a pre-processing step before text search when runs may be fragmented.
   * Pass `{ preserveRsidIdentity: true }` from edit pipelines that must not
   * disturb rsid attributes on runs the caller did not touch (#286).
   */
  mergeRunsOnly(opts: MergeRunsOptions = {}): MergeRunsResult {
    const result = mergeRuns(this.documentXml, opts);
    if (result.runsMerged > 0) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return result;
  }

  /**
   * Add a root comment anchored to a text range within a paragraph.
   *
   * Bootstraps comment parts if missing (idempotent).
   * Returns the allocated comment ID.
   */
  async addComment(params: {
    paragraphId: string;
    start?: number;
    end?: number;
    author: string;
    text: string;
    initials?: string;
  }, ctx?: RevisionContext): Promise<AddCommentResult> {
    const p = findParagraphByBookmarkId(this.documentXml, params.paragraphId);
    if (!p) throw new Error(`Paragraph not found: ${params.paragraphId}`);

    await bootstrapCommentParts(this.zip);
    const result = await addCommentImpl(this.documentXml, this.zip, {
      paragraphEl: p,
      start: params.start,
      end: params.end,
      author: params.author,
      text: params.text,
      initials: params.initials,
    }, ctx);

    this.dirty = true;
    this.documentViewCache = null;
    return result;
  }

  /**
   * Add a threaded reply to an existing comment.
   *
   * Bootstraps comment parts if missing (idempotent).
   * Returns the allocated comment ID and parent ID.
   */
  async addCommentReply(params: {
    parentCommentId: number;
    author: string;
    text: string;
    initials?: string;
  }, ctx?: RevisionContext): Promise<AddCommentReplyResult> {
    await bootstrapCommentParts(this.zip);
    const result = await addCommentReplyImpl(this.documentXml, this.zip, {
      parentCommentId: params.parentCommentId,
      author: params.author,
      text: params.text,
      initials: params.initials,
    }, ctx);

    this.dirty = true;
    this.documentViewCache = null;
    return result;
  }

  async getComments(): Promise<Comment[]> {
    return getCommentsImpl(this.zip, this.documentXml);
  }

  async getComment(commentId: number): Promise<Comment | null> {
    return getCommentImpl(this.zip, this.documentXml, commentId);
  }

  async deleteComment(params: { commentId: number }, ctx?: RevisionContext): Promise<void> {
    await deleteCommentImpl(this.documentXml, this.zip, params, ctx);
    this.dirty = true;
    this.documentViewCache = null;
  }

  // ── Footnote methods ──────────────────────────────────────────────────

  private async refreshFootnotesXml(): Promise<void> {
    const text = await this.zip.readTextOrNull('word/footnotes.xml');
    this.footnotesXml = text ? parseXml(text) : null;
  }

  async getFootnotes(): Promise<Footnote[]> {
    return getFootnotesImpl(this.zip, this.documentXml);
  }

  /**
   * Serialize the document to GitHub-Flavored Markdown. Convenience wrapper that wires the
   * structured document view (with inline formatting) and footnotes into
   * {@link serializeToMarkdown}. Markdown is intentionally lossy — see that serializer.
   *
   * Async because footnote extraction reads the footnotes part from the zip.
   */
  async toMarkdown(opts?: SerializeMarkdownOptions): Promise<string> {
    const { nodes } = this.buildDocumentView({ showFormatting: true });
    const footnotes = await this.getFootnotes();
    return serializeToMarkdown(nodes, footnotes, opts);
  }

  /**
   * Serialize the document to semantic HTML. Convenience wrapper that wires the structured
   * document view (with inline formatting) and footnotes into {@link serializeToHtml}. The
   * default output is a complete `<!DOCTYPE html>` document; pass `{ fragment: true }` for the
   * body-level elements only. This is the semantic tier — exact layout is not reproduced.
   *
   * Async because footnote extraction reads the footnotes part from the zip.
   */
  async toHtml(opts?: SerializeHtmlOptions): Promise<string> {
    const { nodes } = this.buildDocumentView({ showFormatting: true });
    const footnotes = await this.getFootnotes();
    return serializeToHtml(nodes, footnotes, opts);
  }

  /**
   * Serialize the document to plain text (no markup). Convenience wrapper that wires the
   * structured document view and footnotes into {@link serializeToPlainText}. All formatting
   * is stripped; block structure survives as blank-line-separated paragraphs, `- ` bullets,
   * and tab-separated table rows. Intentionally lossy — see that serializer.
   *
   * Uses the same `showFormatting: true` view as {@link toMarkdown} so the block structure
   * and injected `[^n]` footnote markers match; the inline tags it produces are then stripped.
   *
   * Async because footnote extraction reads the footnotes part from the zip.
   */
  async toPlainText(opts?: SerializePlainTextOptions): Promise<string> {
    const { nodes } = this.buildDocumentView({ showFormatting: true });
    const footnotes = await this.getFootnotes();
    return serializeToPlainText(nodes, footnotes, opts);
  }

  async getFootnote(noteId: number): Promise<Footnote | null> {
    return getFootnoteImpl(this.zip, this.documentXml, noteId);
  }

  /**
   * Add a footnote anchored to a paragraph, optionally after specific text.
   *
   * Bootstraps footnote parts if missing (idempotent).
   * Returns the allocated footnote ID.
   */
  async addFootnote(params: {
    paragraphId: string;
    afterText?: string;
    text: string;
  }, ctx?: RevisionContext): Promise<AddFootnoteResult> {
    const p = findParagraphByBookmarkId(this.documentXml, params.paragraphId);
    if (!p) throw new Error(`Paragraph not found: ${params.paragraphId}`);

    await bootstrapFootnoteParts(this.zip);
    const result = await addFootnoteImpl(this.documentXml, this.zip, {
      paragraphEl: p,
      afterText: params.afterText,
      text: params.text,
    }, ctx);

    await this.refreshFootnotesXml();
    this.dirty = true;
    this.documentViewCache = null;
    return result;
  }

  /**
   * Update the text content of an existing footnote.
   */
  async updateFootnoteText(params: { noteId: number; newText: string }, ctx?: RevisionContext): Promise<void> {
    await updateFootnoteTextImpl(this.zip, params, ctx);
    await this.refreshFootnotesXml();
    this.dirty = true;
    this.documentViewCache = null;
  }

  /**
   * Delete a footnote and its references from the document.
   */
  async deleteFootnote(params: { noteId: number }, ctx?: RevisionContext): Promise<void> {
    await deleteFootnoteImpl(this.documentXml, this.zip, params, ctx);
    await this.refreshFootnotesXml();
    this.dirty = true;
    this.documentViewCache = null;
  }

  /**
   * Return a deep clone of the internal document.xml DOM.
   * Callers can mutate the clone (e.g. acceptChanges / rejectChanges)
   * without affecting session state.
   */
  getDocumentXmlClone(): Document {
    return this.documentXml.cloneNode(true) as Document;
  }

  /**
   * Return a deep clone of the comments.xml DOM, or null if the document
   * has no comments part.
   */
  async getCommentsXmlClone(): Promise<Document | null> {
    const commentsText = await this.zip.readTextOrNull('word/comments.xml');
    if (!commentsText) return null;
    return parseXml(commentsText);
  }

  /**
   * Serialize the document to a .docx buffer.
   *
   * With `minimalReserialization` (requires `cleanBookmarks`), top-level body
   * blocks that no edit touched are restored element-for-element from the
   * original document.xml instead of carrying the open-time normalization
   * (proofErr stripping, run merging) to disk — so output diffs reflect the
   * actual edit blast radius. Edited/inserted blocks are emitted as-is.
   * Falls back to full re-serialization (blocksRestored: 0) when no original
   * text was captured or reconciliation fails.
   *
   * @see https://github.com/UseJunior/safe-docx/issues/408
   */
  async toBuffer(opts?: { cleanBookmarks?: boolean; minimalReserialization?: boolean }): Promise<{ buffer: Buffer; bookmarksRemoved: number; blocksRestored: number }> {
    // Always write the latest document.xml when saving.
    // Important: when cleanBookmarks=true (download), we must NOT mutate session state.
    const xmlWithBookmarks = serializeXml(this.documentXml);
    this.zip.writeText('word/document.xml', xmlWithBookmarks);

    if (opts?.cleanBookmarks) {
      const cloned = parseXml(xmlWithBookmarks);
      const bookmarksRemoved = cleanupInternalBookmarks(cloned);
      let blocksRestored = 0;
      if (opts.minimalReserialization && this.originalDocumentXmlText !== null) {
        try {
          blocksRestored = restoreUntouchedBlocks(cloned, this.originalDocumentXmlText);
        } catch {
          // Reconciliation is best-effort; the fully re-serialized DOM is
          // always a correct (if non-minimal) save.
          blocksRestored = 0;
        }
      }
      const cleanedXml = serializeXml(cloned);

      // Temporarily swap document.xml in the zip for output, then restore.
      this.zip.writeText('word/document.xml', cleanedXml);
      const buffer = await this.zip.toBuffer();
      this.zip.writeText('word/document.xml', xmlWithBookmarks);
      return { buffer, bookmarksRemoved, blocksRestored };
    }

    const buffer = await this.zip.toBuffer();
    return { buffer, bookmarksRemoved: 0, blocksRestored: 0 };
  }
}
