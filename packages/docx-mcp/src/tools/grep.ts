import { DocxDocument, serializeXml } from '@usejunior/docx-core';
import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool, validateAndLoadDocxFromPath } from './session_resolution.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParagraphMatch = {
  para_id: string;
  para_index_1based: number;
  list_label: string;
  header: string;
  match_count_in_paragraph: number;
  match_text: string;
  context: string;
};

type XmlMatch = {
  char_start: number;
  char_end: number;
  line: number;
  match_text: string;
  context: string;
};

type SearchParagraphsResult = {
  matches: ParagraphMatch[];
  totalMatches: number;
  paragraphsWithMatches: number;
  matchesTruncated: boolean;
};

// ---------------------------------------------------------------------------
// Pure search core — extracted for reuse across session and stateless paths
// ---------------------------------------------------------------------------

function searchParagraphs(
  doc: DocxDocument,
  re: RegExp,
  opts: {
    maxResults: number;
    contextChars: number;
    dedupeByParagraph: boolean;
    includeContext?: boolean;
  },
): SearchParagraphsResult {
  const { maxResults, contextChars, dedupeByParagraph } = opts;
  const includeCtx = opts.includeContext ?? true;

  const { paragraphs } = doc.readParagraphs();
  const typed = paragraphs as Array<{ id: string; text: string }>;

  let locatorById: Map<string, { list_label: string; header: string }> | null = null;
  if (includeCtx) {
    const { nodes } = doc.buildDocumentView({ includeSemanticTags: true });
    locatorById = new Map(
      nodes.map((n) => [n.id, { list_label: n.list_label ?? '', header: n.header ?? '' }]),
    );
  }

  const matches: ParagraphMatch[] = [];
  const paragraphsWithMatchesSet = new Set<string>();
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
          const locator = locatorById?.get(p.id) ?? { list_label: '', header: '' };
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
      paragraphsWithMatchesSet.add(p.id);
      if (dedupeByParagraph) {
        if (matches.length < maxResults) {
          const start = Math.max(0, firstMatchIndex - contextChars);
          const end = Math.min(text.length, firstMatchIndex + firstMatchText.length + contextChars);
          const before = text.slice(start, firstMatchIndex);
          const after = text.slice(firstMatchIndex + firstMatchText.length, end);
          const locator = locatorById?.get(p.id) ?? { list_label: '', header: '' };
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

  return {
    matches,
    totalMatches,
    paragraphsWithMatches: paragraphsWithMatchesSet.size,
    matchesTruncated,
  };
}

// ---------------------------------------------------------------------------
// Raw XML search
// ---------------------------------------------------------------------------

function searchRawXml(
  doc: DocxDocument,
  re: RegExp,
  opts: { maxResults: number; contextChars: number },
): { matches: XmlMatch[]; totalMatches: number; matchesTruncated: boolean } {
  const xml = serializeXml(doc.getDocumentXmlClone());
  const matches: XmlMatch[] = [];
  let totalMatches = 0;
  let matchesTruncated = false;

  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(xml)) !== null) {
    totalMatches += 1;
    if (matches.length < opts.maxResults) {
      const charStart = m.index;
      const charEnd = m.index + m[0].length;
      // Count newlines up to match start for approximate line number
      let line = 1;
      for (let i = 0; i < charStart; i++) {
        if (xml[i] === '\n') line++;
      }
      const ctxStart = Math.max(0, charStart - opts.contextChars);
      const ctxEnd = Math.min(xml.length, charEnd + opts.contextChars);
      matches.push({
        char_start: charStart,
        char_end: charEnd,
        line,
        match_text: m[0],
        context: xml.slice(ctxStart, ctxEnd),
      });
    } else {
      matchesTruncated = true;
    }
    if (m[0].length === 0) break;
  }

  return { matches, totalMatches, matchesTruncated };
}

// ---------------------------------------------------------------------------
// Main grep tool
// ---------------------------------------------------------------------------

export async function grep(
  manager: SessionManager,
  params: {
    file_path?: string;
    file_paths?: string[];
    patterns?: string[];
    pattern?: string;
    case_sensitive?: boolean;
    whole_word?: boolean;
    max_results?: number;
    context_chars?: number;
    dedupe_by_paragraph?: boolean;
    search_xml?: boolean;
    include_context?: boolean;
  },
): Promise<ToolResponse> {
  try {
    // Accept both "patterns" (array) and "pattern" (string) for ergonomics
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
    const includeContext = params.include_context ?? true;

    const patternStr = wholeWord ? `\\b(${patterns.join('|')})\\b` : `(${patterns.join('|')})`;
    let re: RegExp;
    try {
      re = new RegExp(patternStr, caseSensitive ? 'g' : 'gi');
    } catch (e: unknown) {
      return ok({
        patterns,
        total_matches: 0,
        matches: [],
        error: `Invalid regex pattern: ${errorMessage(e)}`,
      });
    }

    // Multi-file stateless mode
    const filePaths = params.file_paths;
    if (filePaths && filePaths.length > 0) {
      return await grepMultiFile(manager, filePaths, re, {
        patterns, maxResults, contextChars, dedupeByParagraph, searchXml, includeContext,
      });
    }

    // Single-file session mode
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'grep' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    if (searchXml) {
      const xmlResult = searchRawXml(session.doc, re, { maxResults, contextChars });
      return ok(mergeSessionResolutionMetadata({
        file_path: manager.normalizePath(session.originalPath),
        patterns,
        search_xml: true,
        total_matches: xmlResult.totalMatches,
        matches: xmlResult.matches,
        matches_returned: xmlResult.matches.length,
        matches_truncated: xmlResult.matchesTruncated,
      }, metadata));
    }

    const result = searchParagraphs(session.doc, re, {
      maxResults, contextChars, dedupeByParagraph, includeContext,
    });

    const response = mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      patterns,
      dedupe_by_paragraph: dedupeByParagraph,
      total_matches: result.totalMatches,
      paragraphs_with_matches: result.paragraphsWithMatches,
      matches: result.matches,
      matches_returned: result.matches.length,
      max_results_applied: maxResults,
      matches_truncated: result.matchesTruncated,
    }, metadata) as Record<string, unknown>;
    if (result.matchesTruncated) {
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

// ---------------------------------------------------------------------------
// Multi-file stateless search
// ---------------------------------------------------------------------------

async function grepMultiFile(
  manager: SessionManager,
  filePaths: string[],
  re: RegExp,
  opts: {
    patterns: string[];
    maxResults: number;
    contextChars: number;
    dedupeByParagraph: boolean;
    searchXml: boolean;
    includeContext: boolean;
  },
): Promise<ToolResponse> {
  const files: Array<Record<string, unknown>> = [];
  let grandTotalMatches = 0;
  let grandTotalParagraphs = 0;

  // Process files sequentially (memory safety — one doc at a time)
  for (const fp of filePaths) {
    const loaded = await validateAndLoadDocxFromPath(manager, fp);
    if (!loaded.ok) {
      files.push({
        file_path: fp,
        error: (loaded.response as { error?: { message?: string } }).error?.message ?? 'Failed to load',
        matches: [],
        total_matches: 0,
      });
      continue;
    }

    const doc = await DocxDocument.load(loaded.content);
    doc.normalize();
    doc.insertParagraphBookmarks('_grep');

    if (opts.searchXml) {
      re.lastIndex = 0;
      const xmlResult = searchRawXml(doc, re, {
        maxResults: opts.maxResults,
        contextChars: opts.contextChars,
      });
      grandTotalMatches += xmlResult.totalMatches;
      files.push({
        file_path: loaded.normalizedPath,
        search_xml: true,
        total_matches: xmlResult.totalMatches,
        matches: xmlResult.matches,
        matches_truncated: xmlResult.matchesTruncated,
      });
    } else {
      re.lastIndex = 0;
      const result = searchParagraphs(doc, re, {
        maxResults: opts.maxResults,
        contextChars: opts.contextChars,
        dedupeByParagraph: opts.dedupeByParagraph,
        includeContext: opts.includeContext,
      });
      grandTotalMatches += result.totalMatches;
      grandTotalParagraphs += result.paragraphsWithMatches;
      files.push({
        file_path: loaded.normalizedPath,
        total_matches: result.totalMatches,
        paragraphs_with_matches: result.paragraphsWithMatches,
        matches: result.matches,
        matches_truncated: result.matchesTruncated,
      });
    }
  }

  return ok({
    patterns: opts.patterns,
    mode: 'multi_file',
    files_searched: filePaths.length,
    total_matches: grandTotalMatches,
    ...(opts.searchXml ? {} : { total_paragraphs_with_matches: grandTotalParagraphs }),
    files,
  });
}
