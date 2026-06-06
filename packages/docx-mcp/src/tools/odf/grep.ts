import { type OdfSession, SessionManager } from '../../session/manager.js';
import { errorMessage } from '../../error_utils.js';
import { err, ok, type ToolResponse } from '../types.js';
import { searchParagraphsCore, searchRawXmlCore } from '../grep_core.js';

/**
 * ODF (.odt) `grep`. Session-mode only — the dispatcher resolves the ODF session by
 * `.odt` `file_path` before calling here (multi-file `file_paths` stays on the DOCX
 * lane). ODF paragraphs carry no list-label / header context, so those fields are
 * empty. Output shape mirrors the DOCX grep session response.
 */
export async function odfGrep(
  manager: SessionManager,
  session: OdfSession,
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
    let patterns = params.patterns ?? [];
    if (patterns.length === 0 && typeof params.pattern === 'string') {
      patterns = [params.pattern];
    }
    if (patterns.length === 0) {
      return err(
        'MISSING_PATTERN',
        'No search patterns provided.',
        'Pass patterns: ["your search term"] (array of regex strings).',
      );
    }

    const caseSensitive = params.case_sensitive ?? false;
    const wholeWord = params.whole_word ?? false;
    const maxResults = params.max_results ?? 100;
    const contextChars = params.context_chars ?? 50;
    const dedupeByParagraph = params.dedupe_by_paragraph ?? true;
    const searchXml = params.search_xml ?? false;

    const patternStr = wholeWord ? `\\b(${patterns.join('|')})\\b` : `(${patterns.join('|')})`;
    let re: RegExp;
    try {
      re = new RegExp(patternStr, caseSensitive ? 'g' : 'gi');
    } catch (e: unknown) {
      return ok({
        file_path: session.originalPath,
        provider: 'odf',
        patterns,
        total_matches: 0,
        matches: [],
        error: `Invalid regex pattern: ${errorMessage(e)}`,
        ...metadata,
      });
    }

    if (searchXml) {
      const xmlResult = searchRawXmlCore(session.doc.toXml(), re, { maxResults, contextChars });
      return ok({
        file_path: session.originalPath,
        provider: 'odf',
        patterns,
        search_xml: true,
        total_matches: xmlResult.totalMatches,
        matches: xmlResult.matches,
        matches_returned: xmlResult.matches.length,
        matches_truncated: xmlResult.matchesTruncated,
        ...metadata,
      });
    }

    const paragraphs = session.doc.getParagraphs();
    const result = searchParagraphsCore(
      paragraphs,
      re,
      { maxResults, contextChars, dedupeByParagraph },
      null,
    );

    const response: Record<string, unknown> = {
      file_path: session.originalPath,
      provider: 'odf',
      patterns,
      dedupe_by_paragraph: dedupeByParagraph,
      total_matches: result.totalMatches,
      paragraphs_with_matches: result.paragraphsWithMatches,
      matches: result.matches,
      matches_returned: result.matches.length,
      max_results_applied: maxResults,
      matches_truncated: result.matchesTruncated,
      ...metadata,
    };
    if (result.matchesTruncated) {
      response.truncation_note = dedupeByParagraph
        ? 'max_results limits returned rows to matching paragraphs while total_matches counts all regex hits. Increase max_results or set dedupe_by_paragraph=false for per-match rows.'
        : 'max_results limits returned rows to individual matches while total_matches counts all regex hits. Increase max_results to see more matches.';
    }
    return ok(response);
  } catch (e: unknown) {
    return err('SEARCH_ERROR', `Failed to search ODF document: ${errorMessage(e)}`, 'Check patterns are valid regex and try again.');
  }
}
