import fs from 'node:fs/promises';
import { errorCode, errorMessage } from "../error_utils.js";
import path from 'node:path';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { enforceReadPathPolicy } from './path_policy.js';
import { validateDocxArchiveSafety } from './docx_archive_guard.js';
import { SAFE_DOCX_MCP_TOOLS } from '../tool_catalog.js';

function getAvailableToolsSchema(): Array<{
  name: string;
  description: string;
  parameters: string[];
  defaults?: Record<string, unknown>;
}> {
  const toolDefaultsByName: Record<string, Record<string, unknown>> = {
    grep: { dedupe_by_paragraph: true },
    download: {
      download_format: 'both',
      clean_bookmarks: true,
      returned_variants: ['clean', 'tracked'],
    },
  };

  return SAFE_DOCX_MCP_TOOLS.map((tool) => {
    const parameters = getTopLevelPropertyNames(tool.inputSchema);
    const defaults = toolDefaultsByName[tool.name];
    return defaults
      ? { name: tool.name, description: tool.description, parameters, defaults }
      : { name: tool.name, description: tool.description, parameters };
  });
}

function getTopLevelPropertyNames(inputSchema: Record<string, unknown>): string[] {
  const rawProperties = inputSchema['properties'];
  if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
    return [];
  }
  return Object.keys(rawProperties);
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
            double_elevations_fixed: session.normalizationStats.doubleElevationsFixed,
            normalization_skipped: false,
          }
        : { runs_merged: 0, redlines_simplified: 0, double_elevations_fixed: 0, normalization_skipped: true },
      download_defaults: {
        default_variants: ['clean', 'redline'],
        default_download_format: 'both',
        supports_variant_override: true,
        redownload_by_session_id: true,
      },
      tools: getAvailableToolsSchema(),
    });
  } catch (e: unknown) {
    return err('FILE_READ_ERROR', `Failed to read file: ${errorMessage(e)}`, 'Ensure the file exists and is readable.');
  }
}
