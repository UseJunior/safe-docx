import { buildDocumentViewNodes } from '@usejunior/google-docs-core';
import { renderToon, type DocumentViewNode } from '@usejunior/docx-core';
import { type GDocsSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';
import { buildPaginationMeta } from '../pagination.js';
import { renderJsonWithBudget, renderTextWithBudget } from '../read_budget.js';
import { READ_SIMPLE_PREVIEW_CHARS, previewText } from '../preview.js';

export async function gdocsReadFile(
  manager: SessionManager,
  session: GDocsSession,
  params: { offset?: number; limit?: number; node_ids?: string[]; format?: string },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const format = (params.format ?? 'toon').toLowerCase();
    if (format !== 'toon' && format !== 'json' && format !== 'simple') {
      return err('INVALID_FORMAT', `Invalid format: ${params.format}`, "Use 'toon' (default), 'json', or 'simple'.");
    }

    const paragraphs = session.doc.getParagraphs();
    const gdocsNodes = buildDocumentViewNodes(paragraphs);
    // Cast to docx-core DocumentViewNode — structurally compatible
    const nodes = gdocsNodes as unknown as DocumentViewNode[];
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
        content = renderSimpleGDocs(filtered);
      } else {
        content = renderToon(filtered);
      }
      paragraphsReturned = filtered.length;
    } else {
      const result = format === 'json' ? renderJsonWithBudget(filtered)
        : renderTextWithBudget(filtered, format === 'simple' ? 'simple' : 'toon', undefined, 'none');
      content = result.content;
      paragraphsReturned = result.count;
    }

    const paginationMeta = buildPaginationMeta(totalParagraphs, paragraphsReturned, startIdx);

    return ok({
      google_doc_id: session.docId,
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

function renderSimpleGDocs(nodes: readonly DocumentViewNode[]): string {
  const lines: string[] = ['#TOON id | text'];
  for (const n of nodes) {
    lines.push(`${n.id} | ${previewText(n.clean_text, READ_SIMPLE_PREVIEW_CHARS)}`);
  }
  return lines.join('\n');
}
