import {
  iterateSerializerBlocks,
  formatTableMarker,
  formatToonDataLine,
  formatToonCommentLines,
  formatToonCommentsEndnotesBlock,
  collectInlineCommentMarkers,
  type DocumentViewNode,
  type DocumentViewComment,
} from '@usejunior/docx-core';
import { DEFAULT_CONTENT_TOKEN_BUDGET } from './pagination.js';
import { previewText, READ_SIMPLE_PREVIEW_CHARS } from './preview.js';

export interface BudgetResult {
  content: string;
  count: number;
  warnings?: string[];
}

/** Input progress is independent of output size, including empty rendered nodes. */
export class ReadBudget {
  consumedInput = 0;
  renderedCharacters = 0;
  firstNodeOverflow = false;
  state: 'accepting' | 'blocked' | 'exhausted' = 'accepting';

  constructor(private readonly tokens: number) {}

  admit(candidateCharacters: number, renderedCharacters = candidateCharacters,
    overflowCharacters = candidateCharacters): boolean {
    if (this.state !== 'accepting') return false;
    if (this.consumedInput > 0 && Math.ceil(candidateCharacters / 4) > this.tokens) {
      this.state = 'blocked';
      return false;
    }
    if (this.consumedInput === 0) {
      this.firstNodeOverflow = Math.ceil(overflowCharacters / 4) > this.tokens;
    }
    this.consumedInput++;
    this.renderedCharacters = renderedCharacters;
    return true;
  }

  finish(): void {
    if (this.state === 'accepting') this.state = 'exhausted';
  }

  result(content: string): BudgetResult {
    this.finish();
    this.renderedCharacters = content.length;
    return {
      content,
      count: this.consumedInput,
      ...(this.firstNodeOverflow ? { warnings: ['budget_exceeded_by_first_node'] } : {}),
    };
  }
}

function simpleCommentSuffixes(comments: readonly DocumentViewComment[], parentId?: number): string[] {
  return comments.flatMap((comment) => {
    const text = comment.text.replaceAll('\r\n', '\\n').replaceAll('\r', '\\r')
      .replaceAll('\n', '\\n').replaceAll('|', '\\|');
    return [parentId == null ? `[c${comment.id}: ${text}]` : `[c${comment.id}->c${parentId}: ${text}]`,
      ...simpleCommentSuffixes(comment.replies, comment.id)];
  });
}

export function formatSimpleDataLine(node: DocumentViewNode): string {
  const preview = previewText(node.clean_text, READ_SIMPLE_PREVIEW_CHARS);
  const suffixes = simpleCommentSuffixes(node.comments ?? []);
  return `${node.id} | ${suffixes.length ? `${preview} ${suffixes.join(' ')}` : preview}`;
}

/**
 * Tables supply boundaries, not atomic admission units: text may split between
 * cells, while JSON retains one serialized object per input node. End-table
 * framing is excluded from ordinary text admission as before; comment endnotes
 * are substantive payload and included in the candidate estimate.
 */
export function renderTextWithBudget(
  nodes: readonly DocumentViewNode[],
  format: 'toon' | 'simple',
  budget = DEFAULT_CONTENT_TOKEN_BUDGET,
  commentRendering = 'paragraph_notes',
): BudgetResult {
  const page = new ReadBudget(budget);
  let content = format === 'simple' ? '#TOON id | text' : '#SCHEMA id | list_label | header | style | text';
  const included: DocumentViewNode[] = [];
  const inline = commentRendering === 'inline_markers';
  const commentMarkers = inline ? collectInlineCommentMarkers(nodes) : undefined;
  let tableOpen = false;

  outer: for (const block of iterateSerializerBlocks(nodes)) {
    const blockNodes = 'nodes' in block ? block.nodes : [block.node];
    let opening = '';
    if (block.kind === 'table') {
      const tc = block.nodes[0]!.table_context!;
      opening = '\n' + formatTableMarker({ id: tc.table_id, totalRows: tc.total_rows, totalCols: tc.total_cols });
    }
    for (const node of blockNodes) {
      const line = format === 'simple' ? formatSimpleDataLine(node)
        : [formatToonDataLine(node, { commentMarkers }),
          ...(commentRendering === 'paragraph_notes' || inline ? formatToonCommentLines(node) : [])].join('\n');
      const candidateBase = content + opening + '\n' + line;
      let candidate = candidateBase;
      if (format === 'toon' && commentRendering === 'endnotes') {
        if (block.kind === 'table') candidate += '\n#END_TABLE';
        const endnotes = formatToonCommentsEndnotesBlock([...included, node]);
        if (endnotes.length) candidate += '\n' + endnotes.join('\n');
      }
      if (!page.admit(candidate.length, candidateBase.length)) break outer;
      content = candidateBase;
      tableOpen = block.kind === 'table';
      opening = '';
      included.push(node);
    }
    if (tableOpen) {
      content += '\n#END_TABLE';
      tableOpen = false;
    }
  }
  if (tableOpen) content += '\n#END_TABLE';
  if (format === 'toon' && commentRendering === 'endnotes') {
    const endnotes = formatToonCommentsEndnotesBlock(included);
    if (endnotes.length) content += '\n' + endnotes.join('\n');
  }
  return page.result(content);
}

export function renderJsonWithBudget(
  nodes: readonly Record<string, unknown>[], budget = DEFAULT_CONTENT_TOKEN_BUDGET,
): BudgetResult {
  const page = new ReadBudget(budget);
  const items: string[] = [];
  let chars = 2;
  for (const node of nodes) {
    const item = JSON.stringify(node, null, 2);
    const candidate = chars + (items.length ? 2 : 0) + item.length;
    // Preserve the established admission approximation, but use the full JSON
    // framing for first-node overflow detection.
    if (!page.admit(candidate, candidate + 2, candidate + 2)) break;
    chars = candidate;
    items.push(item);
  }
  return page.result('[\n' + items.join(',\n') + '\n]');
}
