import { SessionManager } from '../session/manager.js';
import { errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { OOXML, W, renderToon } from '@usejunior/docx-core';
import { READ_SIMPLE_PREVIEW_CHARS, previewText } from './preview.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { estimateTokens, DEFAULT_CONTENT_TOKEN_BUDGET, buildPaginationMeta } from './pagination.js';

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`) ?? el.getAttribute(localName);
}

function collectFootnoteMarkerSuffix(
  paragraphEl: Element,
  displayNumberById: Map<number, number>,
): string {
  const markers: string[] = [];
  const refs = paragraphEl.getElementsByTagNameNS(OOXML.W_NS, W.footnoteReference);
  for (let i = 0; i < refs.length; i++) {
    const ref = refs.item(i) as Element;
    const rawId = getWAttr(ref, 'id');
    if (!rawId) continue;
    const numericId = Number.parseInt(rawId, 10);
    if (Number.isNaN(numericId)) continue;
    const display = displayNumberById.get(numericId) ?? numericId;
    markers.push(`[^${display}]`);
  }
  return markers.join('');
}

export async function readFile(
  manager: SessionManager,
  params: { session_id?: string; file_path?: string; offset?: number; limit?: number; node_ids?: string[]; format?: string; show_formatting?: boolean },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'read_file' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const format = (params.format ?? 'toon').toLowerCase();
    if (format !== 'toon' && format !== 'json' && format !== 'simple') {
      return err('INVALID_FORMAT', `Invalid format: ${params.format}`, "Use 'toon' (default), 'json', or 'simple'.");
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

    let enriched = filtered;
    try {
      const footnotes = await session.doc.getFootnotes();
      if (footnotes.length > 0) {
        const displayById = new Map<number, number>();
        for (const note of footnotes) {
          displayById.set(note.id, note.displayNumber > 0 ? note.displayNumber : note.id);
        }
        enriched = filtered.map((node) => {
          const paragraphEl = session.doc.getParagraphElementById(node.id);
          if (!paragraphEl) return node;
          const markerSuffix = collectFootnoteMarkerSuffix(paragraphEl, displayById);
          if (!markerSuffix) return node;
          return {
            ...node,
            clean_text: `${node.clean_text}${markerSuffix}`,
            tagged_text: `${node.tagged_text}${markerSuffix}`,
            text: `${node.text}${markerSuffix}`,
          };
        });
      }
    } catch {
      enriched = filtered;
    }

    let content: string;
    let paragraphsReturned: number;

    if (!budgetActive) {
      // Explicit limit/offset/node_ids — render everything, no budget
      if (format === 'json') {
        content = JSON.stringify(enriched, null, 2);
      } else if (format === 'simple') {
        const lines: string[] = ['#TOON id | text'];
        for (const n of enriched) {
          const text = previewText(n.clean_text, READ_SIMPLE_PREVIEW_CHARS);
          lines.push(`${n.id} | ${text}`);
        }
        content = lines.join('\n');
      } else {
        content = renderToon(enriched);
      }
      paragraphsReturned = enriched.length;
    } else {
      // One-pass token-budget accumulation
      const budget = DEFAULT_CONTENT_TOKEN_BUDGET;
      const result = renderWithBudget(enriched, format, budget);
      content = result.content;
      paragraphsReturned = result.count;
    }

    const paginationMeta = buildPaginationMeta(totalParagraphs, paragraphsReturned, startIdx);

    return ok(mergeSessionResolutionMetadata({
      session_id: session.sessionId,
      content,
      total_paragraphs: totalParagraphs,
      paragraphs_returned: paragraphsReturned,
      ...paginationMeta,
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return err('READ_ERROR', msg, 'Check session status and try again.');
  }
}

interface BudgetResult {
  content: string;
  count: number;
}

function renderWithBudget(
  enriched: readonly { id: string; list_label: string; header: string; style: string; tagged_text: string; clean_text: string; [key: string]: unknown }[],
  format: string,
  budget: number,
): BudgetResult {
  if (format === 'json') {
    return renderJsonWithBudget(enriched, budget);
  }
  if (format === 'simple') {
    return renderSimpleWithBudget(enriched, budget);
  }
  return renderToonWithBudget(enriched, budget);
}

function renderToonWithBudget(
  enriched: readonly { id: string; [key: string]: unknown }[],
  budget: number,
): BudgetResult {
  // Render all nodes with renderToon, then accumulate line-by-line
  const headerLine = '#SCHEMA id | list_label | header | style | text';
  let accumulated = headerLine;
  let count = 0;

  for (const node of enriched) {
    // Use renderToon on a single node and extract the data line
    const rendered = renderToon([node as Parameters<typeof renderToon>[0][number]]);
    const lines = rendered.split('\n');
    const dataLine = lines[1]; // second line is the data
    if (!dataLine) continue;

    const candidate = accumulated + '\n' + dataLine;
    if (count > 0 && estimateTokens(candidate) > budget) break;
    accumulated = candidate;
    count++;
  }

  return { content: accumulated, count };
}

function renderSimpleWithBudget(
  enriched: readonly { id: string; clean_text: string; [key: string]: unknown }[],
  budget: number,
): BudgetResult {
  const headerLine = '#TOON id | text';
  let accumulated = headerLine;
  let count = 0;

  for (const n of enriched) {
    const text = previewText(n.clean_text, READ_SIMPLE_PREVIEW_CHARS);
    const dataLine = `${n.id} | ${text}`;
    const candidate = accumulated + '\n' + dataLine;
    if (count > 0 && estimateTokens(candidate) > budget) break;
    accumulated = candidate;
    count++;
  }

  return { content: accumulated, count };
}

function renderJsonWithBudget(
  enriched: readonly Record<string, unknown>[],
  budget: number,
): BudgetResult {
  const items: string[] = [];
  let totalChars = 2; // for "[\n" and "]"
  let count = 0;

  for (const node of enriched) {
    const serialized = JSON.stringify(node, null, 2);
    const overhead = items.length > 0 ? 2 : 0; // ",\n" between items
    const candidateChars = totalChars + overhead + serialized.length;
    if (count > 0 && Math.ceil(candidateChars / 4) > budget) break;
    items.push(serialized);
    totalChars = candidateChars;
    count++;
  }

  const content = '[\n' + items.join(',\n') + '\n]';
  return { content, count };
}
