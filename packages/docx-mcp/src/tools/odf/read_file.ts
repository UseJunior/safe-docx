import {
  formatToonDataLine,
  renderToon,
  type DocumentViewNode,
} from '@usejunior/docx-core';
import { type OdfSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';
import { buildPaginationMeta, DEFAULT_CONTENT_TOKEN_BUDGET, estimateTokens } from '../pagination.js';
import { READ_SIMPLE_PREVIEW_CHARS, previewText } from '../preview.js';

function odfParagraphsToDocumentViewNodes(session: OdfSession): DocumentViewNode[] {
  return session.doc.getParagraphs().map((paragraph: { id: string; text: string }) => ({
    id: paragraph.id,
    list_label: '',
    header: '',
    style: 'body',
    text: paragraph.text,
    clean_text: paragraph.text,
    tagged_text: paragraph.text,
    list_metadata: {
      list_level: -1,
      label_type: null,
      label_string: '',
      header_text: null,
      header_style: null,
      header_formatting: null,
      is_auto_numbered: false,
    },
    style_fingerprint: {
      list_level: -1,
      left_indent_pt: 0,
      first_line_indent_pt: 0,
      style_name: 'body',
      alignment: 'LEFT',
    },
    paragraph_style_id: null,
    paragraph_style_name: 'body',
    paragraph_alignment: 'LEFT',
    paragraph_indents_pt: { left: 0, first_line: 0 },
    numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
    header_formatting: null,
    body_run_formatting: null,
  }));
}

export async function odfReadFile(
  _manager: SessionManager,
  session: OdfSession,
  params: { offset?: number; limit?: number; node_ids?: string[]; format?: string },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const format = (params.format ?? 'toon').toLowerCase();
    if (format !== 'toon' && format !== 'json' && format !== 'simple') {
      return err('INVALID_FORMAT', `Invalid format: ${params.format}`, "Use 'toon' (default), 'json', or 'simple'.");
    }

    const nodes = odfParagraphsToDocumentViewNodes(session);
    const totalParagraphs = nodes.length;

    const hasExplicitLimit = typeof params.limit === 'number';
    const hasExplicitOffset = typeof params.offset === 'number';
    const hasNodeIds = params.node_ids != null && params.node_ids.length > 0;
    const budgetActive = !hasExplicitLimit && !hasExplicitOffset && !hasNodeIds;

    let filtered = nodes;
    let startIdx = 0;
    if (hasNodeIds) {
      const set = new Set(params.node_ids!);
      filtered = nodes.filter((n) => set.has(n.id));
    } else {
      if (hasExplicitOffset) {
        if (params.offset! > 0) startIdx = Math.max(0, params.offset! - 1);
        if (params.offset! < 0) startIdx = Math.max(0, totalParagraphs + params.offset!);
      }
      const endIdx = hasExplicitLimit ? Math.min(totalParagraphs, startIdx + params.limit!) : totalParagraphs;
      filtered = nodes.slice(startIdx, endIdx);
    }

    let content: string;
    let paragraphsReturned: number;

    if (!budgetActive) {
      if (format === 'json') {
        content = JSON.stringify(filtered, null, 2);
      } else if (format === 'simple') {
        content = renderSimpleOdf(filtered);
      } else {
        content = renderToon(filtered);
      }
      paragraphsReturned = filtered.length;
    } else {
      const result = renderToonWithBudgetOdf(filtered, DEFAULT_CONTENT_TOKEN_BUDGET);
      content = result.content;
      paragraphsReturned = result.count;
    }

    const paginationMeta = buildPaginationMeta(totalParagraphs, paragraphsReturned, startIdx);

    return ok({
      file_path: session.originalPath,
      provider: 'odf',
      content,
      total_paragraphs: totalParagraphs,
      paragraphs_returned: paragraphsReturned,
      ...paginationMeta,
      ...metadata,
    });
  } catch (e: unknown) {
    return err('READ_ERROR', e instanceof Error ? e.message : String(e), 'Check session status and try again.');
  }
}

function renderSimpleOdf(nodes: readonly DocumentViewNode[]): string {
  const lines: string[] = ['#TOON id | text'];
  for (const n of nodes) {
    lines.push(`${n.id} | ${previewText(n.clean_text, READ_SIMPLE_PREVIEW_CHARS)}`);
  }
  return lines.join('\n');
}

// ODF Phase 1 flattens table cells to body paragraphs, so nodes never carry
// `table_context`. The budget renderer therefore has no table-marker handling
// (unlike the DOCX/gdocs renderers) — keeping it free of structurally-unreachable
// branches.
function renderToonWithBudgetOdf(
  nodes: readonly DocumentViewNode[],
  budget: number,
): { content: string; count: number } {
  let accumulated = '#SCHEMA id | list_label | header | style | text';
  let count = 0;

  for (const node of nodes) {
    const candidate = accumulated + '\n' + formatToonDataLine(node);
    if (count > 0 && estimateTokens(candidate) > budget) break;
    accumulated = candidate;
    count++;
  }

  return { content: accumulated, count };
}
