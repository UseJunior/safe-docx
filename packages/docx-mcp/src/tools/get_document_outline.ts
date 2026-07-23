import { SessionManager } from '../session/manager.js';
import { errorMessage } from '../error_utils.js';
import { ok, err, type ToolResponse } from './types.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import {
  isDeterministicHeadingSource,
  type DocumentViewNode,
  type HeadingSource,
} from '@usejunior/docx-core';

type OutlineEntry = {
  paragraph_id: string;
  text: string;
  level: number | null;
  source: HeadingSource;
};

/**
 * Projects the document view into outline entries. Deterministic style,
 * numbering, and outline-property sources are included by default; heuristic
 * sources remain opt-in so the default outline stays low-noise.
 */
export function projectOutline(
  nodes: readonly DocumentViewNode[],
  includeHeuristic: boolean,
): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const node of nodes) {
    const heading = node.heading;
    if (!heading) continue;
    if (!includeHeuristic && !isDeterministicHeadingSource(heading.source)) continue;
    entries.push({
      paragraph_id: node.id,
      text: heading.text,
      level: heading.level,
      source: heading.source,
    });
  }
  return entries;
}

/**
 * Renders outline entries as an indented Markdown ATX outline. The heading depth
 * reflects the outline `level`; heuristic headings without a level render at
 * depth 1. Depth is clamped to the ATX 1..6 range.
 */
export function renderOutlineMarkdown(entries: readonly OutlineEntry[]): string {
  return entries
    .map((entry) => {
      const depth = Math.min(6, Math.max(1, entry.level ?? 1));
      return `${'#'.repeat(depth)} ${entry.text}`;
    })
    .join('\n');
}

export async function getDocumentOutline(
  manager: SessionManager,
  params: {
    file_path?: string;
    format?: string;
    include_heuristic_headings?: boolean;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'get_document_outline' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  const format = (params.format ?? 'json').toLowerCase();
  if (format !== 'json' && format !== 'markdown') {
    return err('INVALID_FORMAT', `Invalid format: ${params.format}`, "Use 'json' (default) or 'markdown'.");
  }

  try {
    const { nodes } = session.doc.buildDocumentView({ showFormatting: false });
    const includeHeuristic = params.include_heuristic_headings ?? false;
    const outline = projectOutline(nodes, includeHeuristic);

    const base = {
      file_path: manager.normalizePath(session.originalPath),
      total_paragraphs: nodes.length,
      total_headings: outline.length,
    };

    if (format === 'markdown') {
      return ok(mergeSessionResolutionMetadata({ ...base, content: renderOutlineMarkdown(outline) }, metadata));
    }

    return ok(mergeSessionResolutionMetadata({ ...base, outline }, metadata));
  } catch (e: unknown) {
    return err('OUTLINE_ERROR', errorMessage(e), 'Check session status and try again.');
  }
}
