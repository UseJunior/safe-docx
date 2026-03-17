import { type GDocsSession, SessionManager } from '../../session/manager.js';
import { errorMessage } from '../../error_utils.js';
import { err, ok, type ToolResponse } from '../types.js';

type ParagraphMatch = {
  para_id: string;
  para_index_1based: number;
  list_label: string;
  header: string;
  match_count_in_paragraph: number;
  match_text: string;
  context: string;
};

export async function gdocsGrep(
  manager: SessionManager,
  session: GDocsSession,
  params: {
    patterns?: string[];
    pattern?: string;
    case_sensitive?: boolean;
    whole_word?: boolean;
    max_results?: number;
    context_chars?: number;
    dedupe_by_paragraph?: boolean;
    search_xml?: boolean;
  },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    if (params.search_xml) {
      return err('UNSUPPORTED_FOR_PROVIDER', 'search_xml is not supported for Google Docs.', 'Remove search_xml or use a DOCX file.');
    }

    let patterns = params.patterns ?? [];
    if (patterns.length === 0 && typeof params.pattern === 'string') {
      patterns = [params.pattern];
    }
    if (patterns.length === 0) {
      return err('MISSING_PATTERN', 'No search patterns provided.', 'Pass patterns: ["your search term"].');
    }

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
      return ok({ patterns, total_matches: 0, matches: [], error: `Invalid regex pattern: ${errorMessage(e)}` });
    }

    const paragraphs = session.doc.getParagraphs() as Array<{ anchorId: string; anchorName: string | null; text: string }>;
    const matches: ParagraphMatch[] = [];
    const paragraphsWithMatchesSet = new Set<string>();
    let totalMatches = 0;
    let matchesTruncated = false;

    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i]!;
      const paraId = p.anchorId || p.anchorName || `para_${i}`;
      const text = p.text;
      re.lastIndex = 0;

      let m: RegExpExecArray | null;
      let paragraphMatchCount = 0;
      let firstMatchText = '';
      let firstMatchIndex = -1;

      while ((m = re.exec(text)) !== null) {
        totalMatches++;
        paragraphMatchCount++;
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
            matches.push({
              para_id: paraId,
              para_index_1based: i + 1,
              list_label: '',
              header: '',
              match_count_in_paragraph: 1,
              match_text: m[0],
              context: `...${before}>>>${m[0]}<<<${after}...`,
            });
          } else {
            matchesTruncated = true;
          }
        }
        if (m[0].length === 0) break;
      }

      if (paragraphMatchCount > 0) {
        paragraphsWithMatchesSet.add(paraId);
        if (dedupeByParagraph) {
          if (matches.length < maxResults) {
            const start = Math.max(0, firstMatchIndex - contextChars);
            const end = Math.min(text.length, firstMatchIndex + firstMatchText.length + contextChars);
            const before = text.slice(start, firstMatchIndex);
            const after = text.slice(firstMatchIndex + firstMatchText.length, end);
            matches.push({
              para_id: paraId,
              para_index_1based: i + 1,
              list_label: '',
              header: '',
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

    return ok({
      google_doc_id: session.docId,
      patterns,
      dedupe_by_paragraph: dedupeByParagraph,
      total_matches: totalMatches,
      paragraphs_with_matches: paragraphsWithMatchesSet.size,
      matches,
      matches_returned: matches.length,
      max_results_applied: maxResults,
      matches_truncated: matchesTruncated,
      ...metadata,
    });
  } catch (e: unknown) {
    return err('SEARCH_ERROR', `Failed to search document: ${errorMessage(e)}`, 'Check patterns are valid regex and try again.');
  }
}
