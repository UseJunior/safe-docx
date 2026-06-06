// ---------------------------------------------------------------------------
// Pure regex search core — shared by the DOCX grep tool (tools/grep.ts) and the
// ODF grep handler (tools/odf/grep.ts). Operates on a plain {id, text}[] paragraph
// list plus an optional locator map, so it has no dependency on any document model.
// Extracted from grep.ts with no behavior change (covered by grep.test.ts).
// ---------------------------------------------------------------------------

export type ParagraphMatch = {
  para_id: string;
  para_index_1based: number;
  list_label: string;
  header: string;
  match_count_in_paragraph: number;
  match_text: string;
  context: string;
};

export type XmlMatch = {
  char_start: number;
  char_end: number;
  line: number;
  match_text: string;
  context: string;
};

export type SearchParagraphsResult = {
  matches: ParagraphMatch[];
  totalMatches: number;
  paragraphsWithMatches: number;
  matchesTruncated: boolean;
};

/** A paragraph's locator context (DOCX-only; ODF passes empty strings). */
export type Locator = { list_label: string; header: string };

/**
 * Search a paragraph list with `re`. `locatorById` supplies optional list-label /
 * header context per paragraph id (DOCX); pass `null` when unavailable (ODF).
 */
export function searchParagraphsCore(
  paragraphs: Array<{ id: string; text: string }>,
  re: RegExp,
  opts: { maxResults: number; contextChars: number; dedupeByParagraph: boolean },
  locatorById: Map<string, Locator> | null,
): SearchParagraphsResult {
  const { maxResults, contextChars, dedupeByParagraph } = opts;

  const matches: ParagraphMatch[] = [];
  const paragraphsWithMatchesSet = new Set<string>();
  let totalMatches = 0;
  let matchesTruncated = false;

  for (let paraIndex = 0; paraIndex < paragraphs.length; paraIndex += 1) {
    const p = paragraphs[paraIndex]!;
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

/** Search a raw XML string with `re`, returning matches with approximate line numbers. */
export function searchRawXmlCore(
  xml: string,
  re: RegExp,
  opts: { maxResults: number; contextChars: number },
): { matches: XmlMatch[]; totalMatches: number; matchesTruncated: boolean } {
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
