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

const SESSION_OR_FILE_FIELDS = {
  session_id: z.string().optional(),
  file_path: z.string().optional(),
};

const PLAN_OBJECT_SCHEMA = z.object({}).catchall(z.unknown());

export const SAFE_DOCX_TOOL_CATALOG = [
  {
    name: 'read_file',
    description: 'Read document content with paragraph IDs. Accepts session_id or file_path.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
      offset: z.number().optional(),
      limit: z.number().optional(),
      node_ids: z.array(z.string()).optional(),
      format: z.enum(['toon', 'json', 'simple']).optional(),
      show_formatting: z
        .boolean()
        .optional()
        .describe(
          'When true (default), shows inline formatting tags (<b>, <i>, <u>, <highlighting>, <a>). When false, emits plain text with no inline tags.',
        ),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'grep',
    description: 'Search paragraphs with regex. Accepts session_id or file_path.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
      patterns: z.array(z.string()),
      case_sensitive: z.boolean().optional(),
      whole_word: z.boolean().optional(),
      max_results: z.number().optional(),
      context_chars: z.number().optional(),
      dedupe_by_paragraph: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'init_plan',
    description: 'Initialize revision-bound context metadata for coordinated multi-agent planning. Accepts session_id or file_path.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
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
    name: 'replace_text',
    description: 'Replace text in a paragraph by jr_para_* id, preserving formatting. Accepts session_id or file_path.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
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
    description: 'Insert a paragraph before/after an anchor paragraph by jr_para_* id. Accepts session_id or file_path.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
      positional_anchor_node_id: z.string(),
      new_string: z.string(),
      instruction: z.string(),
      position: z.enum(['BEFORE', 'AFTER']).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'download',
    description:
      'Save clean and/or tracked changes output back to the user filesystem. Defaults to both clean and tracked outputs when no format override is provided. Accepts session_id or file_path.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
      save_to_local_path: z.string(),
      clean_bookmarks: z.boolean().optional(),
      download_format: z.enum(['clean', 'tracked', 'both']).optional(),
      allow_overwrite: z.boolean().optional(),
      tracked_save_to_local_path: z.string().optional(),
      tracked_changes_author: z.string().optional(),
      tracked_changes_engine: z.enum(['auto', 'atomizer', 'diffmatch']).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'format_layout',
    description: 'Apply deterministic OOXML layout controls (paragraph spacing, table row height, cell padding). Accepts session_id or file_path.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
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
      ...SESSION_OR_FILE_FIELDS,
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'has_tracked_changes',
    description: 'Check whether the document body contains tracked-change markers (insertions, deletions, moves, and property-change records). Read-only.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'get_session_status',
    description: 'Get session metadata. Accepts session_id or file_path.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'clear_session',
    description: 'Clear one session, all sessions for a file path, or all sessions with explicit confirmation.',
    input: z.object({
      session_id: z.string().optional(),
      file_path: z.string().optional(),
      clear_all: z.boolean().optional(),
      confirm: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'duplicate_document',
    description: 'Duplicate a source .docx and auto-open a fresh editing session for the duplicate.',
    input: z.object({
      source_file_path: z.string(),
      destination_file_path: z.string().optional(),
      overwrite: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'add_comment',
    description:
      'Add a comment or threaded reply to a document. Provide target_paragraph_id + anchor_text for root comments, or parent_comment_id for replies.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
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
      ...SESSION_OR_FILE_FIELDS,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'compare_documents',
    description:
      'Compare two DOCX documents and produce a tracked-changes output document. Provide original_file_path + revised_file_path for standalone comparison, or session_id/file_path to compare session edits against the original.',
    input: z.object({
      original_file_path: z.string().optional().describe('Path to the original DOCX file.'),
      revised_file_path: z.string().optional().describe('Path to the revised DOCX file.'),
      session_id: z.string().optional(),
      file_path: z.string().optional(),
      save_to_local_path: z.string().describe('Path to save the tracked-changes DOCX output.'),
      author: z.string().optional().describe("Author name for track changes. Default: 'Comparison'."),
      engine: z.enum(['auto', 'atomizer', 'diffmatch']).optional().describe("Comparison engine. Default: 'auto'."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'get_footnotes',
    description: 'Get all footnotes from the document with IDs, display numbers, text, and anchored paragraph IDs. Read-only.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'add_footnote',
    description:
      'Add a footnote anchored to a paragraph. Optionally position the reference after specific text using after_text. Note: [^N] markers in read_file output are display-only and not part of the editable text used by replace_text.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
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
      ...SESSION_OR_FILE_FIELDS,
      note_id: z.number().describe('Footnote ID to update.'),
      new_text: z.string().describe('New footnote body text.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'delete_footnote',
    description: 'Delete a footnote and its reference from the document.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
      note_id: z.number().describe('Footnote ID to delete.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'extract_revisions',
    description:
      'Extract tracked changes as structured JSON with before/after text per paragraph, revision details, and comments. Supports pagination via offset and limit. Read-only - does not modify the document.',
    input: z.object({
      ...SESSION_OR_FILE_FIELDS,
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
