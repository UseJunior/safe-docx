import { SessionManager } from '../session/manager.js';
import { errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import {
  OOXML,
  W,
  INLINE_COMMENT_MARKER_RUNTIME,
  renderToon,
  renderToonWithCommentEndnotes,
  formatToonDataLine,
  formatToonCommentLines,
  formatToonCommentsEndnotesBlock,
  formatToonFootnotesEndnotesBlock,
  collectInlineCommentMarkers,
  collectTableMarkerInfo,
  formatTableMarker,
  computeContentFingerprint,
  getParagraphBookmarkId,
  getParagraphText,
  type Comment,
  type DocumentViewComment,
  type DocumentViewNode,
  type Footnote,
  type ToonFootnoteEndnote,
} from '@usejunior/docx-core';
import { READ_SIMPLE_PREVIEW_CHARS, previewText } from './preview.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { estimateTokens, DEFAULT_CONTENT_TOKEN_BUDGET, buildPaginationMeta } from './pagination.js';

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`) ?? el.getAttribute(localName);
}

enum FieldState {
  OUTSIDE_FIELD = 0,
  IN_FIELD_CODE = 1,
  IN_FIELD_RESULT = 2,
}

function escapeCommentSuffixText(text: string): string {
  return text
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('|', '\\|');
}

type InlineCommentMarkerRuntime = {
  startVisibleOffset: number;
  endVisibleOffset: number;
  suppressInlineMarkers: boolean;
};

function getCommentAnchorParagraphId(comment: Comment): string | null {
  return comment.anchoredParagraphId ?? comment.endParagraphId ?? null;
}

function getParagraphRunVisibleLengths(paragraphEl: Element): number[] {
  const runLengths: number[] = [];
  const runElements = Array.from(paragraphEl.getElementsByTagNameNS(OOXML.W_NS, W.r));
  let fieldState = FieldState.OUTSIDE_FIELD;

  for (const runEl of runElements) {
    let visibleLength = 0;

    for (const child of Array.from(runEl.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== OOXML.W_NS) continue;

      if (el.localName === W.fldChar) {
        const type = getWAttr(el, 'fldCharType') ?? '';
        if (type === 'begin') fieldState = FieldState.IN_FIELD_CODE;
        else if (type === 'separate') fieldState = FieldState.IN_FIELD_RESULT;
        else if (type === 'end') fieldState = FieldState.OUTSIDE_FIELD;
        continue;
      }

      if (fieldState === FieldState.IN_FIELD_CODE) continue;

      if (el.localName === W.t) {
        visibleLength += (el.textContent ?? '').length;
      } else if (el.localName === W.tab || el.localName === W.br) {
        visibleLength += 1;
      }
    }

    runLengths.push(visibleLength);
  }

  return runLengths;
}

function resolveCommentVisibleOffset(
  runVisibleLengths: readonly number[],
  runIndex: number | undefined,
  charOffset: number | undefined,
): number | undefined {
  if (runIndex == null || charOffset == null) return undefined;
  if (runIndex < 0 || runIndex >= runVisibleLengths.length) return undefined;

  const runVisibleLength = runVisibleLengths[runIndex];
  if (runVisibleLength == null || charOffset < 0 || charOffset > runVisibleLength) {
    return undefined;
  }

  let offset = charOffset;
  for (let index = 0; index < runIndex; index++) {
    offset += runVisibleLengths[index] ?? 0;
  }
  return offset;
}

function buildInlineCommentMarkerRuntime(
  comment: Comment,
  paragraphElementsById: ReadonlyMap<string, Element>,
  paragraphRunLengthsById: Map<string, number[]>,
): InlineCommentMarkerRuntime | undefined {
  if (
    !comment.anchoredParagraphId ||
    !comment.endParagraphId ||
    comment.startRunIndex == null ||
    comment.startCharOffset == null ||
    comment.endRunIndex == null ||
    comment.endCharOffset == null
  ) {
    return undefined;
  }

  const getRunLengths = (paragraphId: string): number[] | undefined => {
    const cached = paragraphRunLengthsById.get(paragraphId);
    if (cached) return cached;
    const paragraphEl = paragraphElementsById.get(paragraphId);
    if (!paragraphEl) return undefined;
    const runLengths = getParagraphRunVisibleLengths(paragraphEl);
    paragraphRunLengthsById.set(paragraphId, runLengths);
    return runLengths;
  };

  const startRunLengths = getRunLengths(comment.anchoredParagraphId);
  const endRunLengths = getRunLengths(comment.endParagraphId);
  if (!startRunLengths || !endRunLengths) return undefined;

  const startVisibleOffset = resolveCommentVisibleOffset(
    startRunLengths,
    comment.startRunIndex,
    comment.startCharOffset,
  );
  const endVisibleOffset = resolveCommentVisibleOffset(
    endRunLengths,
    comment.endRunIndex,
    comment.endCharOffset,
  );
  if (startVisibleOffset == null || endVisibleOffset == null) return undefined;

  const endParagraphVisibleLength = endRunLengths.reduce((sum, length) => sum + length, 0);
  return {
    startVisibleOffset,
    endVisibleOffset,
    suppressInlineMarkers:
      comment.anchoredParagraphId === comment.endParagraphId &&
      startVisibleOffset === 0 &&
      endVisibleOffset === endParagraphVisibleLength,
  };
}

function mapDocumentViewComment(
  comment: Comment,
  options?: {
    includeRange?: boolean;
    paragraphElementsById?: ReadonlyMap<string, Element>;
    paragraphRunLengthsById?: Map<string, number[]>;
  },
): DocumentViewComment {
  const mapped: DocumentViewComment = {
    id: comment.id,
    author: comment.author,
    date: comment.date || null,
    initials: comment.initials,
    text: comment.text,
    replies: comment.replies.map((reply) => mapDocumentViewComment(reply, options)),
  };

  if (options?.includeRange && comment.anchoredParagraphId && comment.endParagraphId) {
    mapped.range = {
      startParagraphId: comment.anchoredParagraphId,
      endParagraphId: comment.endParagraphId,
      startRunIndex: comment.startRunIndex,
      startCharOffset: comment.startCharOffset,
      endRunIndex: comment.endRunIndex,
      endCharOffset: comment.endCharOffset,
    };

    const runtime = options.paragraphElementsById && options.paragraphRunLengthsById
      ? buildInlineCommentMarkerRuntime(
          comment,
          options.paragraphElementsById,
          options.paragraphRunLengthsById,
        )
      : undefined;

    if (runtime) {
      Object.defineProperty(mapped, INLINE_COMMENT_MARKER_RUNTIME, {
        value: runtime,
        enumerable: false,
      });
    }
  }

  return mapped;
}

function attachParagraphComments(
  nodes: readonly DocumentViewNode[],
  comments: readonly Comment[],
  options?: { includeInlineMarkers?: boolean; paragraphElementsById?: ReadonlyMap<string, Element> },
): DocumentViewNode[] {
  const commentsByParagraph = new Map<string, DocumentViewComment[]>();
  const paragraphRunLengthsById = new Map<string, number[]>();
  for (const comment of comments) {
    const paragraphId = getCommentAnchorParagraphId(comment);
    if (!paragraphId) continue;
    const rootComments = commentsByParagraph.get(paragraphId) ?? [];
    rootComments.push(mapDocumentViewComment(comment, {
      includeRange: options?.includeInlineMarkers,
      paragraphElementsById: options?.paragraphElementsById,
      paragraphRunLengthsById,
    }));
    commentsByParagraph.set(paragraphId, rootComments);
  }

  return nodes.map((node) => {
    const nodeComments = commentsByParagraph.get(node.id);
    return nodeComments && nodeComments.length > 0
      ? { ...node, comments: nodeComments }
      : node;
  });
}

type InlineFootnote = { id: number; display_number: number; text: string };

function attachParagraphFootnotes(
  nodes: readonly Record<string, unknown>[],
  footnotes: readonly Footnote[],
): Record<string, unknown>[] {
  const footnotesByParagraph = new Map<string, InlineFootnote[]>();
  for (const footnote of footnotes) {
    // Eligibility (#158): bootstrap scaffolding (display_number 0 / empty
    // body) and orphaned notes (no anchored paragraph) never attach inline.
    // get_footnotes stays the authoritative whole-document enumeration that
    // still returns them.
    if (footnote.displayNumber <= 0 || footnote.text.trim().length === 0) continue;
    if (!footnote.anchoredParagraphId) continue;
    const anchored = footnotesByParagraph.get(footnote.anchoredParagraphId) ?? [];
    anchored.push({ id: footnote.id, display_number: footnote.displayNumber, text: footnote.text });
    footnotesByParagraph.set(footnote.anchoredParagraphId, anchored);
  }

  return nodes.map((node) => {
    const nodeFootnotes = footnotesByParagraph.get(String(node.id));
    return nodeFootnotes && nodeFootnotes.length > 0
      ? { ...node, footnotes: nodeFootnotes }
      : node;
  });
}

/**
 * The top-level `footnotes` field for JSON output (#207). Unlike the per-node
 * inline attachment (#158), this is document-wide (never windowed) and carries
 * the full-fidelity shape: `ref_paragraph_ids` (an ARRAY — a malformed DOCX can
 * reuse one footnote id from several paragraphs) and multi-paragraph
 * `paragraphs[]` with run-formatting-preserving `tagged_text`. Reserved
 * scaffolding notes (display_number 0 / empty body) are omitted so the array
 * matches the visible `[^N]` markers in the body.
 */
type TopLevelFootnote = {
  id: string;
  display_number: number;
  ref_paragraph_ids: string[];
  paragraphs: { text: string; tagged_text: string; style: string | null }[];
};

function isRenderableFootnote(footnote: Footnote): boolean {
  return footnote.displayNumber > 0 && footnote.text.trim().length > 0;
}

function buildTopLevelFootnotes(footnotes: readonly Footnote[]): TopLevelFootnote[] {
  return footnotes.filter(isRenderableFootnote).map((footnote) => ({
    id: String(footnote.id),
    display_number: footnote.displayNumber,
    ref_paragraph_ids: [...footnote.refParagraphIds],
    paragraphs: footnote.paragraphs.map((p) => ({
      text: p.text,
      tagged_text: p.tagged_text,
      style: p.style,
    })),
  }));
}

function buildToonFootnotes(footnotes: readonly Footnote[]): ToonFootnoteEndnote[] {
  return footnotes.filter(isRenderableFootnote).map((footnote) => ({
    id: String(footnote.id),
    displayNumber: footnote.displayNumber,
    refParagraphIds: footnote.refParagraphIds,
    paragraphs: footnote.paragraphs.map((p) => ({ text: p.text })),
  }));
}

function collectSimpleCommentSuffixes(
  comments: readonly DocumentViewComment[],
  parentId?: number,
): string[] {
  const suffixes: string[] = [];
  for (const comment of comments) {
    const text = escapeCommentSuffixText(comment.text);
    suffixes.push(parentId == null
      ? `[c${comment.id}: ${text}]`
      : `[c${comment.id}->c${parentId}: ${text}]`);
    suffixes.push(...collectSimpleCommentSuffixes(comment.replies, comment.id));
  }
  return suffixes;
}

function formatSimpleTextLine(node: DocumentViewNode): string {
  const preview = previewText(node.clean_text, READ_SIMPLE_PREVIEW_CHARS);
  const commentSuffixes = node.comments ? collectSimpleCommentSuffixes(node.comments) : [];
  return commentSuffixes.length > 0
    ? `${preview} ${commentSuffixes.join(' ')}`
    : preview;
}

export async function readFile(
  manager: SessionManager,
  params: {
    file_path?: string;
    offset?: number;
    limit?: number;
    node_ids?: string[];
    format?: string;
    show_formatting?: boolean;
    comment_rendering?: string;
    include_fingerprint?: boolean;
    include_fingerprint_ordinal?: boolean;
    include_footnotes?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'read_file' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const format = (params.format ?? 'toon').toLowerCase();
    if (format !== 'toon' && format !== 'json' && format !== 'simple') {
      return err('INVALID_FORMAT', `Invalid format: ${params.format}`, "Use 'toon' (default), 'json', or 'simple'.");
    }

    const commentRendering = (params.comment_rendering ?? 'paragraph_notes').toLowerCase();
    if (
      commentRendering !== 'none' &&
      commentRendering !== 'paragraph_notes' &&
      commentRendering !== 'endnotes' &&
      commentRendering !== 'inline_markers'
    ) {
      return err(
        'INVALID_COMMENT_RENDERING',
        `Invalid comment_rendering: ${params.comment_rendering}`,
        "Use 'paragraph_notes' (default), 'inline_markers', 'endnotes', or 'none'.",
      );
    }

    const showFormatting = params.show_formatting ?? true;
    const { nodes } = session.doc.buildDocumentView({
      includeSemanticTags: showFormatting,
      showFormatting,
    });
    const totalParagraphs = nodes.length;

    // Determine if the user explicitly specified pagination/targeting params
    const hasExplicitLimit = typeof params.limit === 'number';
    const hasExplicitOffset = typeof params.offset === 'number';
    const hasNodeIds = params.node_ids != null && params.node_ids.length > 0;
    const budgetActive = !hasExplicitLimit && !hasExplicitOffset && !hasNodeIds;

    let filtered = nodes;
    let startIdx = 0;
    if (hasNodeIds) {
      const requestedIds = new Set(params.node_ids!);
      const selectedCanonicalIds = new Set(
        nodes.filter((node) => requestedIds.has(node.id)).map((node) => node.id),
      );

      for (const requestedId of requestedIds) {
        if (selectedCanonicalIds.has(requestedId)) continue;
        // A `_bk_*` selector that didn't already match a node's canonical id can
        // never resolve via the foreign-bookmark path (findParagraphByBookmarkId
        // returns null for an unmatched `_bk_*` name), so skip the linear scan.
        if (requestedId.startsWith('_bk_')) continue;
        const paragraph = session.doc.getParagraphElementById(requestedId);
        const canonicalId = paragraph ? getParagraphBookmarkId(paragraph) : null;
        if (canonicalId) selectedCanonicalIds.add(canonicalId);
      }

      filtered = nodes.filter((node) => selectedCanonicalIds.has(node.id));
    } else {
      if (hasExplicitOffset) {
        if (params.offset! > 0) startIdx = Math.max(0, params.offset! - 1);
        if (params.offset! < 0) startIdx = Math.max(0, totalParagraphs + params.offset!);
      }
      const endIdx = hasExplicitLimit ? Math.min(totalParagraphs, startIdx + params.limit!) : totalParagraphs;
      filtered = nodes.slice(startIdx, endIdx);
    }

    // Build a single paragraph-element index up front. All downstream enrichment
    // passes (comment inline markers, content_fingerprint) consult this map
    // instead of calling getParagraphElementById() per node, which would be
    // a linear scan and turn the read into O(N^2) on large documents.
    const paragraphElementsById = (() => {
      const map = new Map<string, Element>();
      for (const p of session.doc.getParagraphs()) {
        const id = getParagraphBookmarkId(p);
        if (id) map.set(id, p);
      }
      return map;
    })();

    // Footnote [^N] markers: the document view already injects them into
    // tagged_text/text at the reference's visible offset AND exposes the same
    // derivation as node.footnote_refs — one fldChar walk, one numbering
    // authority, so the fields cannot disagree about which footnotes exist
    // (#382's failure shape). @see #393. Only clean_text is enriched here —
    // the view deliberately keeps it marker-free for core consumers (edit
    // matching, signature-cluster detection), so the suffix is a read_file
    // output concern. Appending to all three fields doubled every marker.
    // @see #382
    let enriched = filtered.map((node) => {
      if (!node.footnote_refs || node.footnote_refs.length === 0) return node;
      const markerSuffix = node.footnote_refs.map(({ display }) => `[^${display}]`).join('');
      return {
        ...node,
        clean_text: `${node.clean_text}${markerSuffix}`,
      };
    });

    // When comment loading fails after add_comment ran (e.g., a third-party docx ships a
    // comments.xml lacking xmlns:w14 and our writer wrote w14:paraId into it — see #154),
    // surface the cause via metadata. We still don't fail the read so the body content
    // remains consumable, but the caller (and our smoke tests) can detect the silent drop.
    let commentLoadError: string | null = null;
    if (commentRendering !== 'none') {
      try {
        const comments = await session.doc.getComments();
        // Inline-marker rendering also needs paragraph elements for comment anchor
        // paragraphs that may not appear in `enriched` (e.g., when a comment range
        // spans into a paragraph outside the visible window). The shared index covers
        // those because we built it from the full document above.
        enriched = attachParagraphComments(enriched, comments, {
          includeInlineMarkers: commentRendering === 'inline_markers',
          paragraphElementsById:
            commentRendering === 'inline_markers' ? paragraphElementsById : undefined,
        });
      } catch (e: unknown) {
        commentLoadError = errorMessage(e);
      }
    }

    // Optional content_fingerprint for JSON output. Computed from raw visible text
    // (the same surface used by the _bk_* fallback seed), NOT from node.clean_text
    // which has list labels stripped and footnote markers appended above.
    let jsonNodes: readonly Record<string, unknown>[] = enriched;
    if (params.include_fingerprint && format === 'json') {
      // Opt-in duplicate-disambiguation metadata (#205). When
      // include_fingerprint_ordinal is also set, compute document-order ordinals
      // and counts per fingerprint over the FULL document (not the returned
      // slice) so a paginated / node_ids-filtered read still reports stable,
      // document-wide ordinals and counts. The ordinal is a read-only
      // disambiguator, never an edit anchor.
      const ordinalByNodeId = new Map<string, { ordinal: number; count: number }>();
      // Cache fingerprints computed during the ordinal pass so the per-node
      // enrichment below reuses them instead of recomputing the same
      // computeContentFingerprint(getParagraphText(...)) for every windowed
      // node. Both sites key off the same paragraph element, so the value is
      // identical — this only avoids the double compute (#205).
      const fingerprintByNodeId = new Map<string, string>();
      if (params.include_fingerprint_ordinal) {
        const groupCounts = new Map<string, number>();
        for (const node of nodes) {
          const paragraphEl = paragraphElementsById.get(node.id);
          if (!paragraphEl) continue;
          const fp = computeContentFingerprint(getParagraphText(paragraphEl));
          fingerprintByNodeId.set(node.id, fp);
          groupCounts.set(fp, (groupCounts.get(fp) ?? 0) + 1);
        }
        const runningOrdinal = new Map<string, number>();
        for (const node of nodes) {
          const fp = fingerprintByNodeId.get(node.id);
          if (fp == null) continue;
          const ordinal = (runningOrdinal.get(fp) ?? 0) + 1;
          runningOrdinal.set(fp, ordinal);
          ordinalByNodeId.set(node.id, { ordinal, count: groupCounts.get(fp)! });
        }
      }

      jsonNodes = enriched.map((node) => {
        const paragraphEl = paragraphElementsById.get(node.id);
        if (!paragraphEl) return node;
        const fingerprint =
          fingerprintByNodeId.get(node.id) ??
          computeContentFingerprint(getParagraphText(paragraphEl));
        const withFingerprint: Record<string, unknown> = {
          ...node,
          content_fingerprint: fingerprint,
        };
        const ordinalInfo = ordinalByNodeId.get(node.id);
        if (ordinalInfo) {
          withFingerprint.content_fingerprint_ordinal = ordinalInfo.ordinal;
          withFingerprint.content_fingerprint_count_in_document = ordinalInfo.count;
          withFingerprint.portable_paragraph_ref = `${fingerprint}#${ordinalInfo.ordinal}`;
        }
        return withFingerprint;
      });
    }

    // Opt-in footnote retrieval (#158 inline bodies, #207 single-call full-
    // fidelity). When include_footnotes is set we load footnotes ONCE and use
    // them three ways:
    //   1. JSON: attach inline `footnotes:[{id,display_number,text}]` per node
    //      (#158). Runs on the already-windowed slice, so pagination comes for
    //      free and the payload counts toward the same token budget.
    //   2. JSON: a TOP-LEVEL `footnotes` array (#207) with ref_paragraph_ids[]
    //      and multi-paragraph `paragraphs[]` — the full-fidelity ingest. Kept
    //      OUT of content[] to preserve the 1:1 content[] index invariant that
    //      edit tooling relies on. Document-wide (never windowed).
    //   3. TOON: a trailing `#FOOTNOTES` sidecar (#207), symmetric with
    //      `#COMMENTS`.
    // Mirrors the comment_load_error contract: a footnote part that fails to
    // parse degrades to metadata, never fails the read.
    let footnoteLoadError: string | null = null;
    let topLevelFootnotes: TopLevelFootnote[] | null = null;
    let toonFootnotes: ToonFootnoteEndnote[] | null = null;
    if (params.include_footnotes) {
      try {
        // ODT and Google Doc sessions have no footnote primitive; the flag
        // no-ops there (same contract as include_fingerprint) instead of
        // reporting a missing-method as a load error.
        if (typeof session.doc.getFootnotes === 'function') {
          const footnotes = await session.doc.getFootnotes();
          if (format === 'json') {
            jsonNodes = attachParagraphFootnotes(jsonNodes, footnotes);
            const built = buildTopLevelFootnotes(footnotes);
            // Omit the field entirely when there are no renderable footnotes, so
            // a footnote-free document's output stays clean (and byte-identical
            // to the default path save for the absent field).
            topLevelFootnotes = built.length > 0 ? built : null;
          } else if (format === 'toon') {
            toonFootnotes = buildToonFootnotes(footnotes);
          }
        }
      } catch (e: unknown) {
        footnoteLoadError = errorMessage(e);
      }
    }

    // The trailing #FOOTNOTES sidecar for TOON output. Empty (null) unless
    // include_footnotes produced footnotes for a toon read.
    const toonFootnotesSuffix =
      toonFootnotes && toonFootnotes.length > 0
        ? '\n' + formatToonFootnotesEndnotesBlock(toonFootnotes).join('\n')
        : '';

    let content: string;
    let paragraphsReturned: number;

    if (!budgetActive) {
      // Explicit limit/offset/node_ids — render everything, no budget
      if (format === 'json') {
        content = JSON.stringify(jsonNodes, null, 2);
      } else if (format === 'simple') {
        content = renderSimpleWithTableMarkers(enriched);
      } else {
        content = (commentRendering === 'endnotes'
          ? renderToonWithCommentEndnotes(enriched)
          : renderToon(enriched)) + toonFootnotesSuffix;
      }
      paragraphsReturned = enriched.length;
    } else {
      // One-pass token-budget accumulation
      const budget = DEFAULT_CONTENT_TOKEN_BUDGET;
      const result =
        format === 'json'
          ? renderJsonWithBudget(jsonNodes, budget)
          : renderWithBudget(enriched, format, budget, commentRendering);
      // The #FOOTNOTES sidecar is document-wide and appended after budgeting —
      // like the top-level JSON `footnotes`, it is not subject to windowing.
      content = format === 'toon' ? result.content + toonFootnotesSuffix : result.content;
      paragraphsReturned = result.count;

      const paginationMeta = buildPaginationMeta(totalParagraphs, paragraphsReturned, startIdx);

      return ok(mergeSessionResolutionMetadata({
        file_path: manager.normalizePath(session.originalPath),
        content,
        total_paragraphs: totalParagraphs,
        paragraphs_returned: paragraphsReturned,
        ...(result.warnings ? { warnings: result.warnings } : {}),
        ...paginationMeta,
        ...(topLevelFootnotes != null ? { footnotes: topLevelFootnotes } : {}),
        ...(commentLoadError != null ? { comment_load_error: commentLoadError } : {}),
        ...(footnoteLoadError != null ? { footnote_load_error: footnoteLoadError } : {}),
      }, metadata));
    }

    const paginationMeta = buildPaginationMeta(totalParagraphs, paragraphsReturned, startIdx);

    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      content,
      total_paragraphs: totalParagraphs,
      paragraphs_returned: paragraphsReturned,
      ...paginationMeta,
      ...(topLevelFootnotes != null ? { footnotes: topLevelFootnotes } : {}),
      ...(commentLoadError != null ? { comment_load_error: commentLoadError } : {}),
      ...(footnoteLoadError != null ? { footnote_load_error: footnoteLoadError } : {}),
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return err('READ_ERROR', msg, 'Check session status and try again.');
  }
}

interface BudgetResult {
  content: string;
  count: number;
  warnings?: string[];
}

const BUDGET_EXCEEDED_BY_FIRST_NODE_WARNING = 'budget_exceeded_by_first_node';

function firstNodeOverflowWarnings(firstNodeOverflow: boolean): string[] | undefined {
  return firstNodeOverflow ? [BUDGET_EXCEEDED_BY_FIRST_NODE_WARNING] : undefined;
}

function renderWithBudget(
  enriched: readonly DocumentViewNode[],
  format: string,
  budget: number,
  commentRendering: string,
): BudgetResult {
  if (format === 'json') {
    return renderJsonWithBudget(enriched, budget);
  }
  if (format === 'simple') {
    return renderSimpleWithBudget(enriched, budget);
  }
  return renderToonWithBudget(enriched, budget, commentRendering);
}

function renderToonWithBudget(
  enriched: readonly DocumentViewNode[],
  budget: number,
  commentRendering: string,
): BudgetResult {
  const headerLine = '#SCHEMA id | list_label | header | style | text';
  let accumulated = headerLine;
  let count = 0;
  let currentTableIndex: number | null = null;
  const includedNodes: DocumentViewNode[] = [];
  const useInlineMarkers = commentRendering === 'inline_markers';
  const commentMarkers = useInlineMarkers ? collectInlineCommentMarkers(enriched) : undefined;
  // Captured the moment node 0 is admitted, BEFORE post-loop closures
  // (#END_TABLE, endnotes block) inflate `accumulated`. Computing this
  // after the loop produces false positives when row 1 of a table fits but
  // we break at row 2 — the closing #END_TABLE bumps the final size over
  // budget, but node 1 itself was fine.
  let firstNodeOverflow = false;

  // Pre-scan: collect table marker info for #TABLE lines
  const tableInfo = collectTableMarkerInfo(enriched);

  for (const node of enriched) {
    const tc = node.table_context;
    const nodeTableIndex = tc ? tc.table_index : null;

    // Close previous table if we left it or moved to a different table
    if (currentTableIndex !== null && nodeTableIndex !== currentTableIndex) {
      accumulated += '\n#END_TABLE';
      currentTableIndex = null;
    }

    // Open new table if entering one
    if (nodeTableIndex !== null && currentTableIndex === null) {
      const info = tableInfo.get(nodeTableIndex);
      if (info) {
        const marker = formatTableMarker(info);
        const candidateWithMarker = accumulated + '\n' + marker;
        if (count > 0 && estimateTokens(candidateWithMarker) > budget) {
          break;
        }
        accumulated = candidateWithMarker;
      }
      currentTableIndex = nodeTableIndex;
    }

    const dataLine = useInlineMarkers
      ? formatToonDataLine(node, { commentMarkers })
      : formatToonDataLine(node);
    const commentLines =
      commentRendering === 'paragraph_notes' || useInlineMarkers
        ? formatToonCommentLines(node)
        : [];
    const nodeLines = [dataLine, ...commentLines].join('\n');
    const candidateBase = accumulated + '\n' + nodeLines;
    let candidate = candidateBase;
    if (commentRendering === 'endnotes') {
      if (nodeTableIndex !== null) {
        candidate += '\n#END_TABLE';
      }
      const endnotesBlock = formatToonCommentsEndnotesBlock([...includedNodes, node]);
      if (endnotesBlock.length > 0) {
        candidate += '\n' + endnotesBlock.join('\n');
      }
    }
    if (count > 0 && estimateTokens(candidate) > budget) {
      // Close table before breaking
      if (currentTableIndex !== null) {
        accumulated += '\n#END_TABLE';
      }
      break;
    }
    accumulated = candidateBase;
    if (count === 0 && estimateTokens(candidate) > budget) {
      // Use `candidate` (not `accumulated`) so endnotes-mode counts the
      // endnotes block that's already part of node 1's first-page payload.
      // This is substantive content, unlike the post-loop `#END_TABLE`
      // structural closure that we deliberately exclude.
      firstNodeOverflow = true;
    }
    includedNodes.push(node);
    count++;
  }

  // Close any open table at end of loop
  if (currentTableIndex !== null) {
    accumulated += '\n#END_TABLE';
  }

  if (commentRendering === 'endnotes') {
    const endnotesBlock = formatToonCommentsEndnotesBlock(includedNodes);
    if (endnotesBlock.length > 0) {
      accumulated += '\n' + endnotesBlock.join('\n');
    }
  }

  return {
    content: accumulated,
    count,
    warnings: firstNodeOverflowWarnings(firstNodeOverflow),
  };
}

function renderSimpleWithTableMarkers(
  enriched: readonly DocumentViewNode[],
): string {
  const lines: string[] = ['#TOON id | text'];
  const tableInfo = collectTableMarkerInfo(enriched);
  let currentTableIndex: number | null = null;

  for (const n of enriched) {
    const tc = n.table_context;
    const nodeTableIndex = tc ? tc.table_index : null;

    if (currentTableIndex !== null && nodeTableIndex !== currentTableIndex) {
      lines.push('#END_TABLE');
      currentTableIndex = null;
    }
    if (nodeTableIndex !== null && currentTableIndex === null) {
      const info = tableInfo.get(nodeTableIndex);
      if (info) lines.push(formatTableMarker(info));
      currentTableIndex = nodeTableIndex;
    }

    lines.push(`${n.id} | ${formatSimpleTextLine(n)}`);
  }

  if (currentTableIndex !== null) {
    lines.push('#END_TABLE');
  }

  return lines.join('\n');
}

function renderSimpleWithBudget(
  enriched: readonly DocumentViewNode[],
  budget: number,
): BudgetResult {
  const headerLine = '#TOON id | text';
  let accumulated = headerLine;
  let count = 0;
  let currentTableIndex: number | null = null;
  // Captured at admission of node 0; see comment in renderToonWithBudget.
  let firstNodeOverflow = false;

  const tableInfo = collectTableMarkerInfo(enriched);

  for (const n of enriched) {
    const tc = n.table_context;
    const nodeTableIndex = tc ? tc.table_index : null;

    if (currentTableIndex !== null && nodeTableIndex !== currentTableIndex) {
      accumulated += '\n#END_TABLE';
      currentTableIndex = null;
    }
    if (nodeTableIndex !== null && currentTableIndex === null) {
      const info = tableInfo.get(nodeTableIndex);
      if (info) {
        const marker = formatTableMarker(info);
        const candidateWithMarker = accumulated + '\n' + marker;
        if (count > 0 && estimateTokens(candidateWithMarker) > budget) break;
        accumulated = candidateWithMarker;
      }
      currentTableIndex = nodeTableIndex;
    }

    const dataLine = `${n.id} | ${formatSimpleTextLine(n)}`;
    const candidate = accumulated + '\n' + dataLine;
    if (count > 0 && estimateTokens(candidate) > budget) {
      if (currentTableIndex !== null) {
        accumulated += '\n#END_TABLE';
      }
      break;
    }
    accumulated = candidate;
    if (count === 0 && estimateTokens(accumulated) > budget) {
      firstNodeOverflow = true;
    }
    count++;
  }

  if (currentTableIndex !== null) {
    accumulated += '\n#END_TABLE';
  }

  return {
    content: accumulated,
    count,
    warnings: firstNodeOverflowWarnings(firstNodeOverflow),
  };
}

function renderJsonWithBudget(
  enriched: readonly Record<string, unknown>[],
  budget: number,
): BudgetResult {
  const items: string[] = [];
  let totalChars = 2; // for "[\n" and "]"
  let count = 0;
  // Captured at admission of node 0; see comment in renderToonWithBudget.
  let firstNodeOverflow = false;

  for (const node of enriched) {
    const serialized = JSON.stringify(node, null, 2);
    const overhead = items.length > 0 ? 2 : 0; // ",\n" between items
    const candidateChars = totalChars + overhead + serialized.length;
    if (count > 0 && Math.ceil(candidateChars / 4) > budget) break;
    items.push(serialized);
    totalChars = candidateChars;
    if (count === 0) {
      // Final render is `[\n${items.join(',\n')}\n]` — 4 chars of framing,
      // not 2. The pagination break check uses the same approximation as
      // the loop, but the warning needs to reflect the true final length.
      const finalChars = candidateChars + 2; // closing `\n]`
      if (Math.ceil(finalChars / 4) > budget) {
        firstNodeOverflow = true;
      }
    }
    count++;
  }

  const content = '[\n' + items.join(',\n') + '\n]';
  return {
    content,
    count,
    warnings: firstNodeOverflowWarnings(firstNodeOverflow),
  };
}
