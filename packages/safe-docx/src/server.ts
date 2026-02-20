import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { SessionManager } from './session/manager.js';
import { openDocument } from './tools/open_document.js';
import { readFile } from './tools/read_file.js';
import { grep } from './tools/grep.js';
import { smartEdit } from './tools/smart_edit.js';
import { smartInsert } from './tools/smart_insert.js';
import { download } from './tools/download.js';
import { getSessionStatus } from './tools/get_session_status.js';
import { clearSession } from './tools/clear_session.js';
import { duplicateDocument } from './tools/duplicate_document.js';
import { formatLayout } from './tools/format_layout.js';
import { acceptChanges } from './tools/accept_changes.js';
import { addComment } from './tools/add_comment.js';
import { compareDocuments_tool } from './tools/compare_documents.js';
import { extractRevisions_tool } from './tools/extract_revisions.js';

export const MCP_TRANSPORT = 'stdio' as const;

export const MCP_TOOLS = [
  {
    name: 'open_document',
    description: 'Open a Word document for editing and create a session. Deprecated as a primary entrypoint; prefer file_path on other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        skip_normalization: { type: 'boolean', description: 'Skip run merging and redline simplification on open. Default: false.' },
      },
      required: ['file_path'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'read_file',
    description: 'Read document content with paragraph IDs. Accepts session_id or file_path.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        offset: { type: 'number' },
        limit: { type: 'number' },
        node_ids: { type: 'array', items: { type: 'string' } },
        format: { type: 'string', enum: ['toon', 'json', 'simple'] },
        show_formatting: { type: 'boolean', description: 'When true (default), shows inline formatting tags (<b>, <i>, <u>, <highlighting>, <a>). When false, emits plain text with no inline tags.' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'grep',
    description: 'Search paragraphs with regex. Accepts session_id or file_path.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        patterns: { type: 'array', items: { type: 'string' } },
        case_sensitive: { type: 'boolean' },
        whole_word: { type: 'boolean' },
        max_results: { type: 'number' },
        context_chars: { type: 'number' },
        dedupe_by_paragraph: { type: 'boolean' },
      },
      required: ['patterns'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'smart_edit',
    description: 'Replace text in a paragraph by jr_para_* id, preserving formatting. Accepts session_id or file_path.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        target_paragraph_id: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        instruction: { type: 'string' },
        normalize_first: { type: 'boolean', description: 'Merge format-identical adjacent runs before searching. Useful when text is fragmented across runs.' },
      },
      required: ['target_paragraph_id', 'old_string', 'new_string', 'instruction'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'smart_insert',
    description: 'Insert a paragraph before/after an anchor paragraph by jr_para_* id. Accepts session_id or file_path.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        positional_anchor_node_id: { type: 'string' },
        new_string: { type: 'string' },
        instruction: { type: 'string' },
        position: { type: 'string', enum: ['BEFORE', 'AFTER'] },
      },
      required: ['positional_anchor_node_id', 'new_string', 'instruction'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'download',
    description: 'Save clean and/or tracked changes output back to the user filesystem. Defaults to both clean and tracked outputs when no format override is provided. Accepts session_id or file_path.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        save_to_local_path: { type: 'string' },
        clean_bookmarks: { type: 'boolean' },
        download_format: { type: 'string', enum: ['clean', 'tracked', 'both'] },
        allow_overwrite: { type: 'boolean' },
        tracked_save_to_local_path: { type: 'string' },
        tracked_changes_author: { type: 'string' },
        tracked_changes_engine: { type: 'string', enum: ['auto', 'atomizer', 'diffmatch'] },
      },
      required: ['save_to_local_path'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'format_layout',
    description: 'Apply deterministic OOXML layout controls (paragraph spacing, table row height, cell padding). Accepts session_id or file_path.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        strict: { type: 'boolean' },
        paragraph_spacing: {
          type: 'object',
          properties: {
            paragraph_ids: { type: 'array', items: { type: 'string' } },
            before_twips: { type: 'number' },
            after_twips: { type: 'number' },
            line_twips: { type: 'number' },
            line_rule: { type: 'string', enum: ['auto', 'exact', 'atLeast'] },
          },
        },
        row_height: {
          type: 'object',
          properties: {
            table_indexes: { type: 'array', items: { type: 'number' } },
            row_indexes: { type: 'array', items: { type: 'number' } },
            value_twips: { type: 'number' },
            rule: { type: 'string', enum: ['auto', 'exact', 'atLeast'] },
          },
        },
        cell_padding: {
          type: 'object',
          properties: {
            table_indexes: { type: 'array', items: { type: 'number' } },
            row_indexes: { type: 'array', items: { type: 'number' } },
            cell_indexes: { type: 'array', items: { type: 'number' } },
            top_dxa: { type: 'number' },
            bottom_dxa: { type: 'number' },
            left_dxa: { type: 'number' },
            right_dxa: { type: 'number' },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'accept_changes',
    description: 'Accept all tracked changes in the document body, producing a clean document with no revision markup. Returns acceptance stats.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'get_session_status',
    description: 'Get session metadata. Accepts session_id or file_path.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'clear_session',
    description: 'Clear one session, all sessions for a file path, or all sessions with explicit confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        clear_all: { type: 'boolean' },
        confirm: { type: 'boolean' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'duplicate_document',
    description: 'Duplicate a source .docx and auto-open a fresh editing session for the duplicate.',
    inputSchema: {
      type: 'object',
      properties: {
        source_file_path: { type: 'string' },
        destination_file_path: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      required: ['source_file_path'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'add_comment',
    description: 'Add a comment or threaded reply to a document. Provide target_paragraph_id + anchor_text for root comments, or parent_comment_id for replies.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        target_paragraph_id: { type: 'string', description: 'Paragraph ID to anchor the comment to (for root comments).' },
        anchor_text: { type: 'string', description: 'Text within the paragraph to anchor the comment to. If omitted, anchors to entire paragraph.' },
        parent_comment_id: { type: 'number', description: 'Parent comment ID for threaded replies.' },
        author: { type: 'string', description: 'Comment author name.' },
        text: { type: 'string', description: 'Comment body text.' },
        initials: { type: 'string', description: 'Author initials (defaults to first letter of author name).' },
      },
      required: ['author', 'text'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'compare_documents',
    description: 'Compare two DOCX documents and produce a redline with track changes. Provide original_file_path + revised_file_path for standalone comparison, or session_id/file_path to compare session edits against the original.',
    inputSchema: {
      type: 'object',
      properties: {
        original_file_path: { type: 'string', description: 'Path to the original DOCX file.' },
        revised_file_path: { type: 'string', description: 'Path to the revised DOCX file.' },
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        save_to_local_path: { type: 'string', description: 'Path to save the redline DOCX output.' },
        author: { type: 'string', description: "Author name for track changes. Default: 'Comparison'." },
        engine: { type: 'string', enum: ['auto', 'atomizer', 'diffmatch'], description: "Comparison engine. Default: 'auto'." },
      },
      required: ['save_to_local_path'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'extract_revisions',
    description: 'Extract tracked changes as structured JSON with before/after text per paragraph, revision details, and comments. Supports pagination via offset and limit. Read-only — does not modify the document.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        file_path: { type: 'string' },
        offset: { type: 'number', description: '0-based offset for pagination. Default: 0.' },
        limit: { type: 'number', description: 'Max entries per page (1–500). Default: 50.' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
] as const;

export async function runServer(): Promise<void> {
  const server = new Server(
    { name: 'safe-docx', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const sessions = new SessionManager();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: MCP_TOOLS as any };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const result =
      name === 'open_document'
        ? await openDocument(sessions, args as any)
        : name === 'read_file'
          ? await readFile(sessions, args as any)
          : name === 'grep'
            ? await grep(sessions, args as any)
            : name === 'smart_edit'
              ? await smartEdit(sessions, args as any)
              : name === 'smart_insert'
                ? await smartInsert(sessions, args as any)
                : name === 'download'
                  ? await download(sessions, args as any)
                  : name === 'format_layout'
                    ? await formatLayout(sessions, args as any)
                    : name === 'accept_changes'
                      ? await acceptChanges(sessions, args as any)
                  : name === 'get_session_status'
                    ? await getSessionStatus(sessions, args as any)
                    : name === 'clear_session'
                      ? await clearSession(sessions, args as any)
                      : name === 'duplicate_document'
                        ? await duplicateDocument(sessions, args as any)
                        : name === 'add_comment'
                          ? await addComment(sessions, args as any)
                          : name === 'compare_documents'
                            ? await compareDocuments_tool(sessions, args as any)
                            : name === 'extract_revisions'
                              ? await extractRevisions_tool(sessions, args as any)
                    : { success: false, error: { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` } };

    // MCP SDK expects tool results as content blocks.
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
