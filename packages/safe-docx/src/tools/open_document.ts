import fs from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { enforceReadPathPolicy } from './path_policy.js';
import { validateDocxArchiveSafety } from './docx_archive_guard.js';

function getAvailableToolsSchema(): Array<{
  name: string;
  description: string;
  parameters: string[];
  defaults?: Record<string, unknown>;
}> {
  // Mirrors app/mcp_server/server.py:_get_available_tools_schema()
  return [
    { name: 'read_file', description: 'Read document content with paragraph IDs', parameters: ['session_id', 'file_path', 'offset', 'limit', 'node_ids', 'format', 'show_formatting'] },
    {
      name: 'grep',
      description: 'Search for patterns, returns paragraph IDs',
      parameters: ['session_id', 'file_path', 'patterns', 'max_results', 'case_sensitive', 'whole_word', 'context_chars', 'dedupe_by_paragraph'],
      defaults: { dedupe_by_paragraph: true },
    },
    { name: 'smart_edit', description: 'Replace text in a specific paragraph', parameters: ['session_id', 'file_path', 'target_paragraph_id', 'old_string', 'new_string', 'instruction'] },
    { name: 'smart_insert', description: 'Insert new paragraph after anchor', parameters: ['session_id', 'file_path', 'positional_anchor_node_id', 'new_string', 'instruction', 'position'] },
    {
      name: 'format_layout',
      description: 'Apply deterministic layout controls (paragraph spacing, row height, cell padding) without inserting spacer paragraphs',
      parameters: ['session_id', 'file_path', 'strict', 'paragraph_spacing', 'row_height', 'cell_padding'],
    },
    {
      name: 'download',
      description: 'Save clean and/or tracked changes output. Defaults to both clean and tracked when no format override is provided.',
      parameters: [
        'session_id',
        'file_path',
        'save_to_local_path',
        'clean_bookmarks',
        'download_format',
        'allow_overwrite',
        'tracked_save_to_local_path',
        'tracked_changes_author',
        'tracked_changes_engine',
      ],
      defaults: {
        download_format: 'both',
        clean_bookmarks: true,
        returned_variants: ['clean', 'redline'],
      },
    },
    { name: 'get_session_status', description: 'Get session metadata', parameters: ['session_id', 'file_path'] },
    { name: 'clear_session', description: 'Clear one session, all sessions for a file path, or all sessions.', parameters: ['session_id', 'file_path', 'clear_all', 'confirm'] },
    { name: 'duplicate_document', description: 'Duplicate a source .docx and auto-open a fresh editing session for the copy.', parameters: ['source_file_path', 'destination_file_path', 'overwrite'] },
    { name: 'add_comment', description: 'Add a comment or threaded reply. Provide target_paragraph_id for root comments, or parent_comment_id for replies.', parameters: ['session_id', 'file_path', 'target_paragraph_id', 'anchor_text', 'parent_comment_id', 'author', 'text', 'initials'] },
  ];
}

export async function openDocument(
  manager: SessionManager,
  params: { file_path: string; skip_normalization?: boolean },
): Promise<ToolResponse> {
  const filePath = params.file_path;
  try {
    const expanded = manager.normalizePath(filePath);

    const stat = await fs.stat(expanded).catch(() => null);
    if (!stat || !stat.isFile()) {
      return err(
        'FILE_NOT_FOUND',
        `File not found: ${filePath}`,
        'Copy the file to ~/Downloads/ or ~/Documents/ first, then pass that path.',
      );
    }
    if (path.extname(expanded).toLowerCase() !== '.docx') {
      return err('INVALID_FILE_TYPE', `Invalid file type: ${path.extname(expanded)}`, 'Only .docx files are supported.');
    }
    const policy = await enforceReadPathPolicy(filePath);
    if (!policy.ok) return policy.response;
    const safePath = policy.normalizedPath;

    const content = await fs.readFile(safePath);
    if (content.length > 50 * 1024 * 1024) {
      return err('VALIDATION_ERROR', 'File too large', 'Check file type (.docx only) and size (max 50MB).');
    }
    const archiveGuard = await validateDocxArchiveSafety(content as Buffer);
    if (!archiveGuard.ok) return archiveGuard.response;

    const filename = path.basename(safePath);
    const session = await manager.createSession(content as Buffer, filename, safePath);

    // Normalize: merge runs + simplify redlines BEFORE bookmark allocation.
    if (!params.skip_normalization) {
      session.normalizationStats = session.doc.normalize();
    }

    // Insert paragraph bookmarks for stable paragraph ids.
    const info = session.doc.insertParagraphBookmarks(`mcp_${session.sessionId}`);

    manager.touch(session);
    return ok({
      session_id: session.sessionId,
      expires_at: session.expiresAt.toISOString(),
      deprecation_warning:
        "open_document is deprecated as the primary entrypoint. Prefer calling read_file, grep, smart_edit, smart_insert, download, or get_session_status with file_path for automatic session resolution.",
      document: {
        filename,
        paragraphs: info.paragraphCount,
        size_bytes: content.length,
      },
      normalization: session.normalizationStats
        ? {
            runs_merged: session.normalizationStats.runsMerged,
            proof_errors_removed: session.normalizationStats.proofErrRemoved,
            redlines_simplified: session.normalizationStats.wrappersConsolidated,
            normalization_skipped: false,
          }
        : { runs_merged: 0, redlines_simplified: 0, normalization_skipped: true },
      download_defaults: {
        default_variants: ['clean', 'redline'],
        default_download_format: 'both',
        supports_variant_override: true,
        redownload_by_session_id: true,
      },
      tools: getAvailableToolsSchema(),
    });
  } catch (e: any) {
    return err('FILE_READ_ERROR', `Failed to read file: ${String(e?.message ?? e)}`, 'Ensure the file exists and is readable.');
  }
}
