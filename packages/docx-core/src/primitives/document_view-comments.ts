import type { DocumentViewComment, DocumentViewNode, ToonCommentMarker, ToonCommentMarkerMap, ToonInlineToken } from './document_view-types.js';

export type { DocumentViewComment, DocumentViewCommentRange, ToonCommentMarker, ToonCommentMarkerMap, ToonInlineToken } from './document_view-types.js';

export const INLINE_COMMENT_MARKER_RUNTIME = Symbol('inline_comment_marker_runtime');

type InlineCommentMarkerRuntime = {
  startVisibleOffset: number;
  endVisibleOffset: number;
  suppressInlineMarkers: boolean;
};

type DocumentViewCommentWithRuntime = DocumentViewComment & {
  [INLINE_COMMENT_MARKER_RUNTIME]?: InlineCommentMarkerRuntime;
};

// Matches the exact set of TOON inline formatting tags that emitFormattingTags() can emit:
//   <b>, </b>, <i>, </i>, <u>, </u>, <highlight>, <highlight color="...">, </highlight>,
//   <a href="...">, </a>, <font ATTR=...>, </font>
// Anything else in the form `<...>` is literal document text (e.g., `<Borrower>` placeholders
// in legal templates, or stylesheet samples like `<font>`) and must be counted as visible
// characters, not skipped as markup.
//
// Note the opening `a`/`font` alternative requires `\s[^>]*` (mandatory attributes), because
// the formatter only emits `<a href="...">` and `<font ATTR=...>` — never bare `<a>` or
// `<font>`. Allowing the bare forms would cause literal `<a>` / `<font>` in document text to
// be silently skipped, shifting marker positions. `<highlight>` appears both bare (compact
// mode) and attributed (full mode carries the source w:highlight value).
export const TOON_INLINE_TAG_RE = /^(?:<\/?(?:b|i|u|highlight)>|<\/(?:a|font)>|<(?:a|font|highlight)\s[^>]*>)/;

/**
 * Split a TOON inline-tag string (`DocumentViewNode.tagged_text` produced with
 * `show_formatting`) into an ordered list of `tag` and `text` tokens, using the exact same
 * grammar (`TOON_INLINE_TAG_RE`) the formatter emits. Consecutive literal characters are
 * coalesced into one `text` token. This is the shared tokenization primitive used by
 * downstream serializers (Markdown today, HTML next) so they never reason about the tag
 * grammar independently and drift from the emitter.
 */
export function tokenizeToonInline(text: string): ToonInlineToken[] {
  const tokens: ToonInlineToken[] = [];
  let buffer = '';
  for (let i = 0; i < text.length; i++) {
    const tagLen = toonTagLengthAt(text, i);
    if (tagLen > 0) {
      if (buffer) {
        tokens.push({ kind: 'text', value: buffer });
        buffer = '';
      }
      tokens.push({ kind: 'tag', value: text.slice(i, i + tagLen) });
      i += tagLen - 1;
      continue;
    }
    buffer += text[i];
  }
  if (buffer) tokens.push({ kind: 'text', value: buffer });
  return tokens;
}

function toonTagLengthAt(text: string, i: number): number {
  if (text[i] !== '<') return 0;
  const match = TOON_INLINE_TAG_RE.exec(text.slice(i));
  return match ? match[0].length : 0;
}

export function countVisibleTextCharacters(text: string): number {
  let visibleCount = 0;
  for (let i = 0; i < text.length; i++) {
    const tagLen = toonTagLengthAt(text, i);
    if (tagLen > 0) {
      i += tagLen - 1;
      continue;
    }
    visibleCount++;
  }
  return visibleCount;
}

export function findTaggedTextInsertionIndex(text: string, visibleOffset: number): number {
  if (visibleOffset <= 0) return 0;

  let visibleCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (visibleCount === visibleOffset) return i;

    const tagLen = toonTagLengthAt(text, i);
    if (tagLen > 0) {
      i += tagLen - 1;
      continue;
    }

    visibleCount++;
  }

  return text.length;
}

export function injectToonCommentMarkers(
  text: string,
  markers: readonly ToonCommentMarker[],
): string {
  if (markers.length === 0) return text;

  let result = text;
  for (const { offset, marker } of markers) {
    const insertionIndex = findTaggedTextInsertionIndex(result, offset);
    result = result.slice(0, insertionIndex) + marker + result.slice(insertionIndex);
  }
  return result;
}

type InlineCommentMarkerCandidate = {
  id: number;
  startParagraphId: string;
  endParagraphId: string;
  startParagraphIndex: number;
  startOffset: number;
  endOffset: number;
};

type InlineCommentMarkerGroup = {
  closes: InlineCommentMarkerCandidate[];
  opens: InlineCommentMarkerCandidate[];
};

function collectInlineCommentMarkerCandidates(
  comments: readonly DocumentViewComment[],
  paragraphIndexById: ReadonlyMap<string, number>,
  candidates: InlineCommentMarkerCandidate[],
): void {
  for (const comment of comments) {
    const runtime = (comment as DocumentViewCommentWithRuntime)[INLINE_COMMENT_MARKER_RUNTIME];
    if (comment.range && runtime && !runtime.suppressInlineMarkers) {
      candidates.push({
        id: comment.id,
        startParagraphId: comment.range.startParagraphId,
        endParagraphId: comment.range.endParagraphId,
        startParagraphIndex: paragraphIndexById.get(comment.range.startParagraphId) ?? Number.MAX_SAFE_INTEGER,
        startOffset: runtime.startVisibleOffset,
        endOffset: runtime.endVisibleOffset,
      });
    }

    if (comment.replies.length > 0) {
      collectInlineCommentMarkerCandidates(comment.replies, paragraphIndexById, candidates);
    }
  }
}

function compareInlineCommentCloseOrder(
  left: InlineCommentMarkerCandidate,
  right: InlineCommentMarkerCandidate,
): number {
  if (left.startParagraphIndex !== right.startParagraphIndex) {
    return right.startParagraphIndex - left.startParagraphIndex;
  }
  if (left.startOffset !== right.startOffset) {
    return right.startOffset - left.startOffset;
  }
  return right.id - left.id;
}

export function collectInlineCommentMarkers(
  nodes: readonly DocumentViewNode[],
): ToonCommentMarkerMap {
  const paragraphIndexById = new Map<string, number>();
  for (let index = 0; index < nodes.length; index++) {
    paragraphIndexById.set(nodes[index]!.id, index);
  }

  const candidates: InlineCommentMarkerCandidate[] = [];
  for (const node of nodes) {
    if (node.comments && node.comments.length > 0) {
      collectInlineCommentMarkerCandidates(node.comments, paragraphIndexById, candidates);
    }
  }

  const groupedByParagraph = new Map<string, Map<number, InlineCommentMarkerGroup>>();
  for (const candidate of candidates) {
    const startOffsets = groupedByParagraph.get(candidate.startParagraphId) ?? new Map<number, InlineCommentMarkerGroup>();
    const startGroup = startOffsets.get(candidate.startOffset) ?? { closes: [], opens: [] };
    startGroup.opens.push(candidate);
    startOffsets.set(candidate.startOffset, startGroup);
    groupedByParagraph.set(candidate.startParagraphId, startOffsets);

    const endOffsets = groupedByParagraph.get(candidate.endParagraphId) ?? new Map<number, InlineCommentMarkerGroup>();
    const endGroup = endOffsets.get(candidate.endOffset) ?? { closes: [], opens: [] };
    endGroup.closes.push(candidate);
    endOffsets.set(candidate.endOffset, endGroup);
    groupedByParagraph.set(candidate.endParagraphId, endOffsets);
  }

  const markersByParagraph = new Map<string, ToonCommentMarker[]>();
  for (const [paragraphId, offsetGroups] of groupedByParagraph.entries()) {
    const markers: ToonCommentMarker[] = [];
    const sortedOffsets = Array.from(offsetGroups.keys()).sort((left, right) => right - left);
    for (const offset of sortedOffsets) {
      const group = offsetGroups.get(offset);
      if (!group) continue;

      const closes = [...group.closes].sort(compareInlineCommentCloseOrder);
      const opens = [...group.opens].sort((left, right) => left.id - right.id);
      const marker =
        closes.map((comment) => `[cm-end:${comment.id}]`).join('') +
        opens.map((comment) => `[cm-start:${comment.id}]`).join('');
      if (!marker) continue;
      markers.push({ offset, marker });
    }

    if (markers.length > 0) {
      markersByParagraph.set(paragraphId, markers);
    }
  }

  return markersByParagraph;
}
