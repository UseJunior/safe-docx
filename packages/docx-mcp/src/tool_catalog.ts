import { z } from 'zod';

type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
};

type ToolCatalogEntry = {
  name: string;
  description: string;
  input: z.ZodTypeAny;
  annotations: ToolAnnotations;
};

const FILE_FIELD = {
  file_path: z.string().describe('Path to the DOCX file.'),
};

const FILE_FIELD_OPTIONAL = {
  file_path: z.string().optional().describe('Path to the DOCX file.'),
};

const GOOGLE_DOC_ID_FIELD = {
  google_doc_id: z.string().optional().describe(
    'Google Doc ID or URL (alternative to file_path). ' +
    'Extract from URL: docs.google.com/document/d/{ID}/edit',
  ),
};

const PLAN_OBJECT_SCHEMA = z.object({}).catchall(z.unknown());

export const SAFE_DOCX_TOOL_CATALOG = [
  {
    name: 'read_file',
    description: 'Read document content (DOCX or Google Doc). Output is token-limited (~14k tokens) by default with pagination metadata (has_more, next_offset). Use offset/limit to paginate.',
    input: z.object({
      ...FILE_FIELD_OPTIONAL,
      ...GOOGLE_DOC_ID_FIELD,
      offset: z.number().optional().describe('1-based paragraph offset for pagination. Negative values count from end.'),
      limit: z.number().optional().describe('Max paragraphs to return. When omitted, output is token-limited to ~14k tokens with pagination.'),
      node_ids: z.array(z.string()).optional(),
      format: z.enum(['toon', 'json', 'simple']).optional(),
      comment_rendering: z
        .enum(['none', 'paragraph_notes', 'endnotes', 'inline_markers'])
        .optional()
        .describe(
          'How to render comments in read_file output. Use "paragraph_notes" (default) for paragraph-local comment threads, "inline_markers" to add `[cm-start:N]`/`[cm-end:N]` milestones in TOON output (combined with the thread blocks), "endnotes" to collect threaded comments into a trailing #COMMENTS block in TOON output, or "none" for the legacy output with no comment rendering.',
        ),
      show_formatting: z
        .boolean()
        .optional()
        .describe(
          'When true (default), shows inline formatting tags (<b>, <i>, <u>, <highlighting>, <a>). When false, emits plain text with no inline tags.',
        ),
      include_fingerprint: z
        .boolean()
        .optional()
        .describe(
          'When true and format="json", include a portable content_fingerprint ("sha256:nfkc:<32hex>") on each paragraph. Read-only metadata derived from the paragraph\'s normalized visible text; NOT an edit anchor. Edit tools accept only `_bk_*` IDs. No effect on TOON/simple output. Ignored for Google Docs.',
        ),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'grep',
    description: 'Search paragraphs with regex. Use file_path for session-based search, file_paths for stateless multi-file search, or google_doc_id for Google Docs.',
    input: z.object({
      ...FILE_FIELD_OPTIONAL,
      ...GOOGLE_DOC_ID_FIELD,
      file_paths: z.array(z.string()).optional().describe('Multiple file paths for stateless multi-file search. No session created.'),
      patterns: z.array(z.string()).optional(),
      pattern: z.string().optional(),
      case_sensitive: z.boolean().optional(),
      whole_word: z.boolean().optional(),
      max_results: z.number().optional(),
      context_chars: z.number().optional(),
      dedupe_by_paragraph: z.boolean().optional(),
      search_xml: z.boolean().optional().describe('When true, search raw XML (word/document.xml) instead of paragraph text.'),
      include_context: z.boolean().optional().describe('When false, skip document view context (list labels, headers) for faster results. Default: true.'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'init_plan',
    description: 'Initialize revision-bound context metadata for coordinated multi-agent planning.',
    input: z.object({
      ...FILE_FIELD,
      plan_name: z.string().optional(),
      orchestrator_id: z.string().optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'merge_plans',
    description: 'Deterministically merge multiple sub-agent plans and detect hard conflicts before apply.',
    input: z.object({
      plans: z.array(PLAN_OBJECT_SCHEMA),
      fail_on_conflict: z.boolean().optional(),
      require_shared_base_revision: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'apply_plan',
    description:
      'Validate and apply a batch of edit steps (replace_text, insert_paragraph) to a document in one call. Validates all steps first; applies only if all pass. Accepts inline steps or a plan_file_path. Compatible with merge_plans output.',
    input: z.object({
      ...FILE_FIELD,
      steps: z
        .array(z.object({}).catchall(z.unknown()))
        .optional()
        .describe('JSON array of edit steps. Each step needs step_id, operation, and operation-specific fields.'),
      plan_file_path: z
        .string()
        .optional()
        .describe('Path to a .json file containing an array of edit steps. Mutually exclusive with steps.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'replace_text',
    description: 'Replace text in a paragraph by _bk_* id, preserving formatting. Supports DOCX and Google Docs.',
    input: z.object({
      ...FILE_FIELD_OPTIONAL,
      ...GOOGLE_DOC_ID_FIELD,
      target_paragraph_id: z.string(),
      old_string: z.string(),
      new_string: z.string(),
      instruction: z.string(),
      normalize_first: z
        .boolean()
        .optional()
        .describe('Merge format-identical adjacent runs before searching. Useful when text is fragmented across runs.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'insert_paragraph',
    description: 'Insert a paragraph before/after an anchor paragraph by _bk_* id. Supports DOCX and Google Docs.',
    input: z.object({
      ...FILE_FIELD_OPTIONAL,
      ...GOOGLE_DOC_ID_FIELD,
      positional_anchor_node_id: z.string(),
      new_string: z.string(),
      instruction: z.string(),
      position: z.enum(['BEFORE', 'AFTER']).optional(),
      style_source_id: z
        .string()
        .optional()
        .describe(
          'Paragraph _bk_* ID to clone formatting (pPr and template run) from instead of the positional anchor. Falls back to anchor with a warning if not found.',
        ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'save',
    description:
      'Save document. For DOCX: saves clean and/or tracked changes output. For Google Docs: checkpoint (default) returns revisionId, or snapshot exports as DOCX.',
    input: z.object({
      ...FILE_FIELD_OPTIONAL,
      ...GOOGLE_DOC_ID_FIELD,
      save_to_local_path: z.string(),
      clean_bookmarks: z.boolean().optional(),
      save_format: z.enum(['clean', 'tracked', 'both']).optional(),
      allow_overwrite: z.boolean().optional(),
      tracked_save_to_local_path: z.string().optional(),
      tracked_changes_author: z.string().optional(),
      tracked_changes_engine: z.enum(['auto', 'atomizer']).optional(),
      fail_on_rebuild_fallback: z
        .boolean()
        .optional()
        .describe(
          'When true, return an error instead of a destructive output if the comparison engine falls back to rebuild mode (which destroys table structure). Default: false.',
        ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'export',
    description:
      'Export a document to a portable rendering (Markdown or semantic HTML). Writes an output file (default: source path with the format extension, e.g. .md or .html) and returns its path, byte count, and the rendered content. Intentionally lossy (no round-trip); HTML is the semantic tier, not pixel-faithful. DOCX only — Google Docs is not supported.',
    input: z.object({
      ...FILE_FIELD_OPTIONAL,
      format: z
        .enum(['markdown', 'html'])
        .optional()
        .describe("Output format: 'markdown' (default) or 'html'. 'text' is planned."),
      output_path: z
        .string()
        .optional()
        .describe('Where to write the rendering. Defaults to the source path with the format extension.'),
      allow_overwrite: z
        .boolean()
        .optional()
        .describe('Overwrite output_path if it already exists. Default: false.'),
      include_markdown: z
        .boolean()
        .optional()
        .describe('Include the rendered content (under `content`) in the response. Default: true; set false for large documents.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'format_layout',
    description: 'Apply layout controls (paragraph spacing, table row height, cell padding). Google Docs supports paragraph spacing only.',
    input: z.object({
      ...FILE_FIELD_OPTIONAL,
      ...GOOGLE_DOC_ID_FIELD,
      strict: z.boolean().optional(),
      paragraph_spacing: z
        .object({
          paragraph_ids: z.array(z.string()).optional(),
          before_twips: z.number().optional(),
          after_twips: z.number().optional(),
          line_twips: z.number().optional(),
          line_rule: z.enum(['auto', 'exact', 'atLeast']).optional(),
        })
        .optional(),
      row_height: z
        .object({
          table_indexes: z.array(z.number()).optional(),
          row_indexes: z.array(z.number()).optional(),
          value_twips: z.number().optional(),
          rule: z.enum(['auto', 'exact', 'atLeast']).optional(),
        })
        .optional(),
      cell_padding: z
        .object({
          table_indexes: z.array(z.number()).optional(),
          row_indexes: z.array(z.number()).optional(),
          cell_indexes: z.array(z.number()).optional(),
          top_dxa: z.number().optional(),
          bottom_dxa: z.number().optional(),
          left_dxa: z.number().optional(),
          right_dxa: z.number().optional(),
        })
        .optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'accept_changes',
    description: 'Accept all tracked changes in the document body, producing a clean document with no revision markup. Returns acceptance stats.',
    input: z.object({
      ...FILE_FIELD,
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'has_tracked_changes',
    description: 'Check whether the document body contains tracked-change markers (insertions, deletions, moves, and property-change records). Read-only.',
    input: z.object({
      ...FILE_FIELD,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'get_file_status',
    description: 'Get file/session metadata including edit count, normalization stats, and cache info. Supports DOCX and Google Docs.',
    input: z.object({
      ...FILE_FIELD_OPTIONAL,
      ...GOOGLE_DOC_ID_FIELD,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'close_file',
    description: 'Close an open file session, or close all sessions with explicit confirmation. Supports DOCX and Google Docs.',
    input: z.object({
      ...FILE_FIELD_OPTIONAL,
      ...GOOGLE_DOC_ID_FIELD,
      clear_all: z.boolean().optional(),
      confirm: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'add_comment',
    description:
      'Add a comment or threaded reply to a document. Provide target_paragraph_id + anchor_text for root comments, or parent_comment_id for replies.',
    input: z.object({
      ...FILE_FIELD,
      target_paragraph_id: z.string().optional().describe('Paragraph ID to anchor the comment to (for root comments).'),
      anchor_text: z.string().optional().describe('Text within the paragraph to anchor the comment to. If omitted, anchors to entire paragraph.'),
      parent_comment_id: z.number().optional().describe('Parent comment ID for threaded replies.'),
      author: z.string().describe('Comment author name.'),
      text: z.string().describe('Comment body text.'),
      initials: z.string().optional().describe('Author initials (defaults to first letter of author name).'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'get_comments',
    description:
      'Get all comments from the document with IDs, authors, dates, text, and anchored paragraph IDs. Includes threaded replies. Read-only.',
    input: z.object({
      ...FILE_FIELD,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'delete_comment',
    description:
      'Delete a comment and all its threaded replies from the document. Cascade-deletes all descendants.',
    input: z.object({
      ...FILE_FIELD,
      comment_id: z.number().describe('Comment ID to delete.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'compare_documents',
    description:
      'Compare two DOCX documents and produce a tracked-changes output document. Provide original_file_path + revised_file_path for standalone comparison, or file_path to compare session edits against the original.',
    input: z.object({
      original_file_path: z.string().optional().describe('Path to the original DOCX file.'),
      revised_file_path: z.string().optional().describe('Path to the revised DOCX file.'),
      ...FILE_FIELD_OPTIONAL,
      save_to_local_path: z.string().describe('Path to save the tracked-changes DOCX output.'),
      author: z.string().optional().describe("Author name for track changes. Default: 'Comparison'."),
      engine: z.enum(['auto', 'atomizer']).optional().describe("Comparison engine. Default: 'auto'."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'get_footnotes',
    description: 'Get all footnotes from the document with IDs, display numbers, text, and anchored paragraph IDs. Read-only.',
    input: z.object({
      ...FILE_FIELD,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'add_footnote',
    description:
      'Add a footnote anchored to a paragraph. Optionally position the reference after specific text using after_text. Note: [^N] markers in read_file output are display-only and not part of the editable text used by replace_text.',
    input: z.object({
      ...FILE_FIELD,
      target_paragraph_id: z.string().describe('Paragraph ID to anchor the footnote to.'),
      after_text: z.string().optional().describe('Text after which to insert the footnote reference. If omitted, appends at end of paragraph.'),
      text: z.string().describe('Footnote body text.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'update_footnote',
    description: 'Update the text content of an existing footnote.',
    input: z.object({
      ...FILE_FIELD,
      note_id: z.number().describe('Footnote ID to update.'),
      new_text: z.string().describe('New footnote body text.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'delete_footnote',
    description: 'Delete a footnote and its reference from the document.',
    input: z.object({
      ...FILE_FIELD,
      note_id: z.number().describe('Footnote ID to delete.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'clear_formatting',
    description:
      'Clear specific run-level formatting (bold, italic, underline, highlight, color, font) from paragraphs.',
    input: z.object({
      ...FILE_FIELD,
      paragraph_ids: z.array(z.string()).optional().describe('Paragraph IDs to clear formatting from. If omitted, clears from all paragraphs.'),
      clear_highlight: z.boolean().optional().describe('Remove highlight formatting.'),
      clear_bold: z.boolean().optional().describe('Remove bold formatting.'),
      clear_italic: z.boolean().optional().describe('Remove italic formatting.'),
      clear_underline: z.boolean().optional().describe('Remove underline formatting.'),
      clear_color: z.boolean().optional().describe('Remove font color.'),
      clear_font: z.boolean().optional().describe('Remove font family and size.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'extract_revisions',
    description:
      'Extract tracked changes as structured JSON with before/after text per paragraph, revision details, and comments. Supports pagination via offset and limit. Read-only - does not modify the document.',
    input: z.object({
      ...FILE_FIELD,
      offset: z.number().optional().describe('0-based offset for pagination. Default: 0.'),
      limit: z.number().optional().describe('Max entries per page (1-500). Default: 50.'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
] as const satisfies readonly ToolCatalogEntry[];

function toJsonObjectSchema(schema: z.ZodTypeAny, name: string): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema);
  if (typeof jsonSchema !== 'object' || Array.isArray(jsonSchema) || jsonSchema === null) {
    throw new Error(`Expected JSON schema object for tool '${name}'.`);
  }
  return jsonSchema as Record<string, unknown>;
}

export const SAFE_DOCX_MCP_TOOLS = SAFE_DOCX_TOOL_CATALOG.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: toJsonObjectSchema(tool.input, tool.name),
  annotations: tool.annotations,
}));

export type SafeDocxToolName = (typeof SAFE_DOCX_TOOL_CATALOG)[number]['name'];
