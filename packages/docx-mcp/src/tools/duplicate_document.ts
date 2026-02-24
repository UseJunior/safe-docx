import fs from 'node:fs/promises';
import { errorCode, errorMessage } from "../error_utils.js";
import path from 'node:path';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { enforceReadPathPolicy, enforceWritePathPolicy } from './path_policy.js';
import { validateDocxArchiveSafety } from './docx_archive_guard.js';

function formatUtcTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function defaultDuplicatePath(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  const ext = parsed.ext || '.docx';
  return path.join(parsed.dir, `${parsed.name}.copy.${formatUtcTimestamp(new Date())}${ext}`);
}

export async function duplicateDocument(
  manager: SessionManager,
  params: {
    source_file_path: string;
    destination_file_path?: string;
    overwrite?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const sourcePathRaw = String(params.source_file_path ?? '').trim();
    if (!sourcePathRaw) {
      return err(
        'MISSING_SOURCE_PATH',
        'source_file_path is required.',
        'Provide source_file_path pointing to a .docx document to duplicate.',
      );
    }

    const sourcePath = manager.normalizePath(sourcePathRaw);
    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat || !sourceStat.isFile()) {
      return err(
        'FILE_NOT_FOUND',
        `File not found: ${sourcePathRaw}`,
        'Copy the file to ~/Downloads/ or ~/Documents/ first, then pass that path.',
      );
    }
    if (path.extname(sourcePath).toLowerCase() !== '.docx') {
      return err(
        'INVALID_FILE_TYPE',
        `Invalid file type: ${path.extname(sourcePath)}`,
        'Only .docx files are supported.',
      );
    }
    const sourcePolicy = await enforceReadPathPolicy(sourcePathRaw);
    if (!sourcePolicy.ok) return sourcePolicy.response;
    const safeSourcePath = sourcePolicy.normalizedPath;

    const destinationPath = params.destination_file_path
      ? manager.normalizePath(params.destination_file_path)
      : defaultDuplicatePath(safeSourcePath);
    if (path.extname(destinationPath).toLowerCase() !== '.docx') {
      return err(
        'INVALID_FILE_TYPE',
        `Invalid destination file type: ${path.extname(destinationPath)}`,
        'Destination path must end in .docx.',
      );
    }

    const overwrite = params.overwrite ?? false;
    if (!overwrite) {
      if (destinationPath === sourcePath) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite source document: ${destinationPath}`,
          'Provide a different destination_file_path or set overwrite=true.',
        );
      }
      const destinationExists = await fs.stat(destinationPath).then(() => true).catch(() => false);
      if (destinationExists) {
        return err(
          'OVERWRITE_BLOCKED',
          `Destination already exists: ${destinationPath}`,
          'Provide a different destination_file_path or set overwrite=true.',
        );
      }
    }
    const destinationPolicy = await enforceWritePathPolicy(destinationPath);
    if (!destinationPolicy.ok) return destinationPolicy.response;
    const safeDestinationPath = destinationPolicy.normalizedPath;

    await fs.mkdir(path.dirname(safeDestinationPath), { recursive: true });
    await fs.copyFile(safeSourcePath, safeDestinationPath);
    const destinationBuffer = await fs.readFile(safeDestinationPath);
    const archiveGuard = await validateDocxArchiveSafety(destinationBuffer as Buffer);
    if (!archiveGuard.ok) return archiveGuard.response;

    const session = await manager.createSession(
      destinationBuffer as Buffer,
      path.basename(safeDestinationPath),
      safeDestinationPath,
    );

    // Normalize: merge runs + simplify redlines BEFORE bookmark allocation.
    session.normalizationStats = session.doc.normalize();

    const info = session.doc.insertParagraphBookmarks(`mcp_${session.sessionId}`);
    manager.touch(session);

    return ok({
      source_file_path: safeSourcePath,
      destination_file_path: safeDestinationPath,
      overwrite,
      session_id: session.sessionId,
      session_resolution: 'opened_new_session',
      resolved_session_id: session.sessionId,
      resolved_file_path: safeDestinationPath,
      document: {
        filename: path.basename(safeDestinationPath),
        paragraphs: info.paragraphCount,
        size_bytes: destinationBuffer.length,
      },
    });
  } catch (e: unknown) {
    return err(
      'DUPLICATE_ERROR',
      `Failed to duplicate document: ${errorMessage(e)}`,
      'Check source/destination paths and filesystem permissions.',
    );
  }
}
