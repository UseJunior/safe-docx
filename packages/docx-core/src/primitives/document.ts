import { DocxZip } from './zip.js';
import { parseXml, serializeXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import {
  findParagraphByBookmarkId,
  insertParagraphBookmarks,
  cleanupInternalBookmarks,
  getParagraphBookmarkId,
  insertSingleParagraphBookmark,
} from './bookmarks.js';
import { getParagraphRuns, getParagraphText, replaceParagraphTextRange, type ReplacementPart } from './text.js';
import { buildNodesForDocumentView, type DocumentStyles, type DocumentViewNode } from './document_view.js';
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
import { mergeRuns, type MergeRunsResult } from './merge_runs.js';
import { simplifyRedlines } from './simplify_redlines.js';
import { preventDoubleElevation } from './prevent_double_elevation.js';
import { validateDocument, type ValidateDocumentResult } from './validate_document.js';
import { acceptChanges as acceptChangesImpl, type AcceptChangesResult } from './accept_changes.js';
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

function isW(el: Element | null, localName: string): boolean {
  return !!el && el.namespaceURI === OOXML.W_NS && el.localName === localName;
}

export class DocxDocument {
  private zip: DocxZip;
  private documentXml: Document;
  private stylesXml: Document | null;
  private numberingXml: Document | null;
  private footnotesXml: Document | null;
  private relsMap: RelsMap;
  private dirty: boolean;
  private documentViewCache: { includeSemanticTags: boolean; showFormatting: boolean; nodes: DocumentViewNode[]; styles: DocumentStyles } | null;

  private constructor(zip: DocxZip, documentXml: Document, stylesXml: Document | null, numberingXml: Document | null, footnotesXml: Document | null, relsMap: RelsMap) {
    this.zip = zip;
    this.documentXml = documentXml;
    this.stylesXml = stylesXml;
    this.numberingXml = numberingXml;
    this.footnotesXml = footnotesXml;
    this.relsMap = relsMap;
    this.dirty = false;
    this.documentViewCache = null;
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

    return new DocxDocument(zip, doc, stylesXml, numberingXml, footnotesXml, relsMap);
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
   * Accept all tracked changes in the document body, producing a clean
   * document with no revision markup.
   */
  acceptChanges(): AcceptChangesResult {
    const result = acceptChangesImpl(this.documentXml);
    if (
      result.insertionsAccepted > 0 ||
      result.deletionsAccepted > 0 ||
      result.movesResolved > 0 ||
      result.propertyChangesResolved > 0
    ) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return result;
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

  buildDocumentView(opts?: { includeSemanticTags?: boolean; showFormatting?: boolean }): { nodes: DocumentViewNode[]; styles: DocumentStyles } {
    const includeSemanticTags = opts?.includeSemanticTags ?? true;
    const showFormatting = opts?.showFormatting ?? false;
    const cached = this.documentViewCache;
    if (!this.dirty && cached && cached.includeSemanticTags === includeSemanticTags && cached.showFormatting === showFormatting) {
      return { nodes: cached.nodes, styles: cached.styles };
    }

    const paragraphs = this.getParagraphs()
      .map((p) => {
        const id = getParagraphBookmarkId(p);
        if (!id) return null;
        return { id, p };
      })
      .filter((x): x is { id: string; p: Element } => x !== null);

    const { nodes, styles } = buildNodesForDocumentView({
      paragraphs,
      stylesXml: this.stylesXml,
      numberingXml: this.numberingXml,
      include_semantic_tags: includeSemanticTags,
      show_formatting: showFormatting,
      relsMap: this.relsMap,
      documentXml: this.documentXml,
      footnotesXml: this.footnotesXml,
    });

    this.documentViewCache = { includeSemanticTags, showFormatting, nodes, styles };
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

  insertParagraph(params: {
    positionalAnchorNodeId: string;
    relativePosition: 'BEFORE' | 'AFTER';
    newText: string;
    newParagraphId?: string;
    styleSourceId?: string;
  }): { newParagraphId: string; newParagraphIds: string[]; styleSourceFallback?: boolean } {
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
      return newP;
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
      newP.appendChild(newRun);

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

  setParagraphSpacing(mutation: ParagraphSpacingMutation): ParagraphSpacingMutationResult {
    const result = setParagraphSpacing(this.documentXml, mutation);
    if (result.affectedParagraphs > 0) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return result;
  }

  setTableRowHeight(mutation: TableRowHeightMutation): TableRowHeightMutationResult {
    const result = setTableRowHeight(this.documentXml, mutation);
    if (result.affectedRows > 0) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return result;
  }

  setTableCellPadding(mutation: TableCellPaddingMutation): TableCellPaddingMutationResult {
    const result = setTableCellPadding(this.documentXml, mutation);
    if (result.affectedCells > 0) {
      this.dirty = true;
      this.documentViewCache = null;
    }
    return result;
  }

  /**
   * Merge format-identical adjacent runs only (no redline simplification).
   * Useful as a pre-processing step before text search when runs may be fragmented.
   */
  mergeRunsOnly(): MergeRunsResult {
    const result = mergeRuns(this.documentXml);
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
    start: number;
    end: number;
    author: string;
    text: string;
    initials?: string;
  }): Promise<AddCommentResult> {
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
    });

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
  }): Promise<AddCommentReplyResult> {
    await bootstrapCommentParts(this.zip);
    const result = await addCommentReplyImpl(this.documentXml, this.zip, {
      parentCommentId: params.parentCommentId,
      author: params.author,
      text: params.text,
      initials: params.initials,
    });

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

  async deleteComment(params: { commentId: number }): Promise<void> {
    await deleteCommentImpl(this.documentXml, this.zip, params);
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
  }): Promise<AddFootnoteResult> {
    const p = findParagraphByBookmarkId(this.documentXml, params.paragraphId);
    if (!p) throw new Error(`Paragraph not found: ${params.paragraphId}`);

    await bootstrapFootnoteParts(this.zip);
    const result = await addFootnoteImpl(this.documentXml, this.zip, {
      paragraphEl: p,
      afterText: params.afterText,
      text: params.text,
    });

    await this.refreshFootnotesXml();
    this.dirty = true;
    this.documentViewCache = null;
    return result;
  }

  /**
   * Update the text content of an existing footnote.
   */
  async updateFootnoteText(params: { noteId: number; newText: string }): Promise<void> {
    await updateFootnoteTextImpl(this.zip, params);
    await this.refreshFootnotesXml();
    this.dirty = true;
    this.documentViewCache = null;
  }

  /**
   * Delete a footnote and its references from the document.
   */
  async deleteFootnote(params: { noteId: number }): Promise<void> {
    await deleteFootnoteImpl(this.documentXml, this.zip, params);
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

  async toBuffer(opts?: { cleanBookmarks?: boolean }): Promise<{ buffer: Buffer; bookmarksRemoved: number }> {
    // Always write the latest document.xml when saving.
    // Important: when cleanBookmarks=true (download), we must NOT mutate session state.
    const xmlWithBookmarks = serializeXml(this.documentXml);
    this.zip.writeText('word/document.xml', xmlWithBookmarks);

    if (opts?.cleanBookmarks) {
      const cloned = parseXml(xmlWithBookmarks);
      const bookmarksRemoved = cleanupInternalBookmarks(cloned);
      const cleanedXml = serializeXml(cloned);

      // Temporarily swap document.xml in the zip for output, then restore.
      this.zip.writeText('word/document.xml', cleanedXml);
      const buffer = await this.zip.toBuffer();
      this.zip.writeText('word/document.xml', xmlWithBookmarks);
      return { buffer, bookmarksRemoved };
    }

    const buffer = await this.zip.toBuffer();
    return { buffer, bookmarksRemoved: 0 };
  }
}
