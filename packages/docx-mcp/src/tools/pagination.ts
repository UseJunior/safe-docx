import {
  collectInlineCommentMarkers,
  collectTableMarkerInfo,
  formatTableMarker,
  formatToonCommentLines,
  formatToonCommentsEndnotesBlock,
  formatToonDataLine,
  type DocumentViewComment,
  type DocumentViewNode,
} from '@usejunior/docx-core';
import { READ_SIMPLE_PREVIEW_CHARS, previewText } from './preview.js';

export const DEFAULT_CONTENT_TOKEN_BUDGET = 14_000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface PaginationMeta {
  has_more: boolean;
  next_offset?: number;
  pagination_hint?: string;
}

export function buildPaginationMeta(
  total: number,
  returned: number,
  startOffset: number,
): PaginationMeta {
  const hasMore = startOffset + returned < total;
  if (!hasMore) return { has_more: false };
  const nextOffset = startOffset + returned + 1; // convert to 1-based
  return {
    has_more: true,
    next_offset: nextOffset,
    pagination_hint: `Showing ${returned} of ${total} paragraphs. Use offset=${nextOffset} to see next page.`,
  };
}

export interface BudgetResult {
  content: string;
  count: number;
  warnings?: string[];
}

export const BUDGET_EXCEEDED_BY_FIRST_NODE_WARNING = 'budget_exceeded_by_first_node';

export function firstNodeOverflowWarnings(firstNodeOverflow: boolean): string[] | undefined {
  return firstNodeOverflow ? [BUDGET_EXCEEDED_BY_FIRST_NODE_WARNING] : undefined;
}

function escapeCommentSuffixText(text: string): string {
  return text
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('|', '\\|');
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

export function formatSimpleTextLine(node: DocumentViewNode): string {
  const preview = previewText(node.clean_text, READ_SIMPLE_PREVIEW_CHARS);
  const commentSuffixes = node.comments ? collectSimpleCommentSuffixes(node.comments) : [];
  return commentSuffixes.length > 0
    ? `${preview} ${commentSuffixes.join(' ')}`
    : preview;
}

export function renderSimpleWithTableMarkers(
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

export function renderToonWithBudget(
  enriched: readonly DocumentViewNode[],
  budget: number = DEFAULT_CONTENT_TOKEN_BUDGET,
  commentRendering: string = 'paragraph_notes',
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
  // we break at row 2 - the closing #END_TABLE bumps the final size over
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

export function renderSimpleWithBudget(
  enriched: readonly DocumentViewNode[],
  budget: number = DEFAULT_CONTENT_TOKEN_BUDGET,
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

export function renderJsonWithBudget(
  enriched: readonly (DocumentViewNode | Record<string, unknown>)[],
  budget: number = DEFAULT_CONTENT_TOKEN_BUDGET,
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
      // Final render is `[\n${items.join(',\n')}\n]` - 4 chars of framing,
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

export interface RenderWithBudgetOptions {
  format?: string;
  budget?: number;
  commentRendering?: string;
}

export function renderWithBudget(
  nodes: readonly (DocumentViewNode | Record<string, unknown>)[],
  formatOrOptions?: string | RenderWithBudgetOptions,
  budgetArg?: number,
  commentRenderingArg?: string,
): BudgetResult {
  let format = 'toon';
  let budget = DEFAULT_CONTENT_TOKEN_BUDGET;
  let commentRendering = 'paragraph_notes';

  if (typeof formatOrOptions === 'object' && formatOrOptions !== null) {
    if (formatOrOptions.format !== undefined) format = formatOrOptions.format;
    if (formatOrOptions.budget !== undefined) budget = formatOrOptions.budget;
    if (formatOrOptions.commentRendering !== undefined) commentRendering = formatOrOptions.commentRendering;
  } else {
    if (typeof formatOrOptions === 'string') format = formatOrOptions;
    if (typeof budgetArg === 'number') budget = budgetArg;
    if (typeof commentRenderingArg === 'string') commentRendering = commentRenderingArg;
  }

  if (format === 'json') {
    return renderJsonWithBudget(nodes, budget);
  }
  if (format === 'simple') {
    return renderSimpleWithBudget(nodes as readonly DocumentViewNode[], budget);
  }
  return renderToonWithBudget(nodes as readonly DocumentViewNode[], budget, commentRendering);
}
