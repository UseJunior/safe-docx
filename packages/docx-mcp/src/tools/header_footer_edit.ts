import {
  findUniqueSubstringMatch,
  stripAllInlineTags,
  type DocxDocument,
  type RevisionContext,
} from '@usejunior/docx-core';
import { hasAnyMarkupTags } from './tag_parser.js';
import { ERROR_PREVIEW_CHARS, RESULT_PREVIEW_CHARS, previewText } from './preview.js';
import { err, type ToolResponse } from './types.js';
import { ensureHeaderFooterParagraphIds } from './get_headers_footers.js';

/**
 * Header/footer paragraph routing for replace_text and insert_paragraph
 * (#1051). A paragraph id the body does not hold is looked up in the
 * header/footer parts the sections select; the edit then goes to docx-core's
 * story primitives, tracked (w:ins/w:del in the header or footer part) when
 * the session tracks changes.
 */
export async function findHeaderFooterPartForParagraph(
  doc: DocxDocument,
  sessionId: string,
  paragraphId: string,
): Promise<string | null> {
  if (doc.getParagraphTextById(paragraphId) !== null) return null;
  await ensureHeaderFooterParagraphIds(doc, sessionId);
  return doc.findStoryPartForParagraph(paragraphId);
}

const FORMATTING_PARAMS = ['bold', 'italic', 'underline', 'highlight', 'font_size', 'font_name', 'color', 'clear_highlight', 'normalize_first'] as const;

function unsupported(message: string): ToolResponse {
  return err(
    'UNSUPPORTED_FOR_HEADER_FOOTER',
    message,
    'Header/footer edits take plain text only; pass new_string without markup tags or formatting options.',
  );
}

export async function replaceHeaderFooterText(
  doc: DocxDocument,
  partPath: string,
  params: Record<string, unknown> & { target_paragraph_id: string; old_string: string; new_string: string; clean_match?: boolean },
  ctx: RevisionContext | undefined,
): Promise<ToolResponse | { before: string; after: string }> {
  const pid = params.target_paragraph_id;
  for (const name of FORMATTING_PARAMS) {
    if (params[name] !== undefined && params[name] !== false) {
      return unsupported(`${name} is not supported for header/footer paragraph ${pid}.`);
    }
  }
  if (hasAnyMarkupTags(params.new_string)) {
    return unsupported(`Markup tags in new_string are not supported for header/footer paragraph ${pid}.`);
  }
  const before = await doc.getStoryParagraphTextById(partPath, pid);
  if (before === null) return err('ANCHOR_NOT_FOUND', `Paragraph ID ${pid} not found in ${partPath}`);
  const oldStr = stripAllInlineTags(params.old_string);
  const match = findUniqueSubstringMatch(before, oldStr, { mode: params.clean_match ? 'clean' : 'default' });
  if (match.status === 'not_found') {
    return err('TEXT_NOT_FOUND', `Text '${previewText(oldStr, ERROR_PREVIEW_CHARS)}' not found in paragraph ${pid}`);
  }
  if (match.status === 'multiple') {
    return err('MULTIPLE_MATCHES', `Found ${match.matchCount} matches for '${previewText(oldStr, ERROR_PREVIEW_CHARS)}' in paragraph. Need unique match.`);
  }
  const newStr = params.new_string;
  const matched = match.matchedText;
  // Trim the common prefix/suffix so the tracked change covers only what differs.
  let prefix = 0;
  while (prefix < matched.length && prefix < newStr.length && matched[prefix] === newStr[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < matched.length - prefix && suffix < newStr.length - prefix
    && matched[matched.length - 1 - suffix] === newStr[newStr.length - 1 - suffix]
  ) suffix++;
  const start = match.start + prefix;
  const end = match.end - suffix;
  const insert = newStr.slice(prefix, newStr.length - suffix);
  if (start < end || insert.length > 0) {
    await doc.replaceStoryTextAtRange({ partPath, targetParagraphId: pid, start, end, replaceText: insert }, ctx);
  }
  const expected = before.slice(0, match.start) + newStr + before.slice(match.end);
  const after = (await doc.getStoryParagraphTextById(partPath, pid)) ?? '';
  if (after !== expected) {
    throw new Error(`Post-condition failed for header/footer paragraph ${pid}: text after replacement did not match the expected substitution.`);
  }
  return {
    before: previewText(before.trim(), RESULT_PREVIEW_CHARS),
    after: previewText(after.trim(), RESULT_PREVIEW_CHARS),
  };
}

export async function insertHeaderFooterParagraph(
  doc: DocxDocument,
  partPath: string,
  params: { positional_anchor_node_id: string; new_string: string; style_source_id?: string; target_style?: string },
  position: 'BEFORE' | 'AFTER',
  ctx: RevisionContext | undefined,
): Promise<ToolResponse | { newParagraphId: string; newParagraphIds: string[]; text: string; styleSourceFallback?: boolean }> {
  if (params.target_style !== undefined) {
    return unsupported('target_style is not supported for header/footer anchors; pass style_source_id of a paragraph in the same part.');
  }
  if (hasAnyMarkupTags(params.new_string)) {
    return unsupported(`Markup tags in new_string are not supported for header/footer anchor ${params.positional_anchor_node_id}.`);
  }
  const text = params.new_string.replace(/\r\n/g, '\n');
  const res = await doc.insertStoryParagraph({
    partPath,
    positionalAnchorNodeId: params.positional_anchor_node_id,
    relativePosition: position,
    newText: text,
    styleSourceId: params.style_source_id,
  }, ctx);
  return { ...res, text };
}
