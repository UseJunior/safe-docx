import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';

export async function grep(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    patterns: string[];
    case_sensitive?: boolean;
    whole_word?: boolean;
    max_results?: number;
    context_chars?: number;
    dedupe_by_paragraph?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'grep' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const patterns = params.patterns ?? [];
    const caseSensitive = params.case_sensitive ?? false;
    const wholeWord = params.whole_word ?? false;
    const maxResults = params.max_results ?? 100;
    const contextChars = params.context_chars ?? 50;
    const dedupeByParagraph = params.dedupe_by_paragraph ?? true;

    const patternStr = wholeWord ? `\\b(${patterns.join('|')})\\b` : `(${patterns.join('|')})`;
    let re: RegExp;
    try {
      re = new RegExp(patternStr, caseSensitive ? 'g' : 'gi');
    } catch (e: unknown) {
      // Mirror Python behavior: return success but include an error in payload.
      return ok(mergeSessionResolutionMetadata({
        session_id: session.sessionId,
        patterns,
        dedupe_by_paragraph: dedupeByParagraph,
        total_matches: 0,
        paragraphs_with_matches: 0,
        matches: [],
        error: `Invalid regex pattern: ${errorMessage(e)}`,
      }, metadata));
    }

    const { paragraphs } = session.doc.readParagraphs();
    const typed = paragraphs as Array<{ id: string; text: string }>;
    const { nodes } = session.doc.buildDocumentView({ includeSemanticTags: true });
    const locatorById = new Map(
      nodes.map((n) => [n.id, { list_label: n.list_label ?? '', header: n.header ?? '' }]),
    );

    const matches: Array<{
      para_id: string;
      para_index_1based: number;
      list_label: string;
      header: string;
      match_count_in_paragraph: number;
      match_text: string;
      context: string;
    }> = [];
    const paragraphsWithMatches = new Set<string>();
    let totalMatches = 0;
    let matchesTruncated = false;

    for (let paraIndex = 0; paraIndex < typed.length; paraIndex += 1) {
      const p = typed[paraIndex]!;
      re.lastIndex = 0;
      const text = p.text;
      let m: RegExpExecArray | null;
      let paragraphMatchCount = 0;
      let firstMatchText = '';
      let firstMatchIndex = -1;
      // eslint-disable-next-line no-cond-assign
      while ((m = re.exec(text)) !== null) {
        totalMatches += 1;
        paragraphMatchCount += 1;
        if (firstMatchIndex === -1) {
          firstMatchText = m[0];
          firstMatchIndex = m.index;
        }
        if (!dedupeByParagraph) {
          if (matches.length < maxResults) {
            const start = Math.max(0, m.index - contextChars);
            const end = Math.min(text.length, m.index + m[0].length + contextChars);
            const before = text.slice(start, m.index);
            const after = text.slice(m.index + m[0].length, end);
            const locator = locatorById.get(p.id) ?? { list_label: '', header: '' };
            matches.push({
              para_id: p.id,
              para_index_1based: paraIndex + 1,
              list_label: locator.list_label,
              header: locator.header,
              match_count_in_paragraph: 1,
              match_text: m[0],
              context: `...${before}>>>${m[0]}<<<${after}...`,
            });
          } else {
            matchesTruncated = true;
          }
        }
        if (m[0].length === 0) break; // safety for zero-length regex
      }
      if (paragraphMatchCount > 0) {
        paragraphsWithMatches.add(p.id);
        if (dedupeByParagraph) {
          if (matches.length < maxResults) {
            const start = Math.max(0, firstMatchIndex - contextChars);
            const end = Math.min(text.length, firstMatchIndex + firstMatchText.length + contextChars);
            const before = text.slice(start, firstMatchIndex);
            const after = text.slice(firstMatchIndex + firstMatchText.length, end);
            const locator = locatorById.get(p.id) ?? { list_label: '', header: '' };
            matches.push({
              para_id: p.id,
              para_index_1based: paraIndex + 1,
              list_label: locator.list_label,
              header: locator.header,
              match_count_in_paragraph: paragraphMatchCount,
              match_text: firstMatchText,
              context: `...${before}>>>${firstMatchText}<<<${after}...`,
            });
          } else {
            matchesTruncated = true;
          }
        }
      }
    }

    const response = mergeSessionResolutionMetadata({
      session_id: session.sessionId,
      patterns,
      dedupe_by_paragraph: dedupeByParagraph,
      total_matches: totalMatches,
      paragraphs_with_matches: paragraphsWithMatches.size,
      matches,
      matches_returned: matches.length,
      max_results_applied: maxResults,
      matches_truncated: matchesTruncated,
    }, metadata) as Record<string, unknown>;
    if (matchesTruncated) {
      response.truncation_note = dedupeByParagraph
        ? 'max_results limits returned rows to matching paragraphs while total_matches counts all regex hits. Increase max_results or set dedupe_by_paragraph=false for per-match rows.'
        : 'max_results limits returned rows to individual matches while total_matches counts all regex hits. Increase max_results to see more matches.';
    }
    return ok(response);
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return err('SEARCH_ERROR', `Failed to search document: ${msg}`, 'Check patterns are valid regex and try again.');
  }
}
