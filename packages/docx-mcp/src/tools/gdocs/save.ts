import path from 'node:path';
import fs from 'node:fs/promises';
import { type GDocsSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';
import { enforceWritePathPolicy } from '../path_policy.js';

export async function gdocsSave(
  manager: SessionManager,
  session: GDocsSession,
  params: { save_to_local_path?: string; save_format?: string },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const revisionId = session.doc.getRevisionId();
    const mode = params.save_to_local_path ? 'snapshot' : 'checkpoint';

    if (mode === 'checkpoint') {
      manager.touch(session);
      return ok({
        google_doc_id: session.docId,
        save_mode: 'checkpoint',
        revision_id: revisionId,
        is_revision_fresh: session.doc.isRevisionFresh(),
        edit_count: session.editCount,
        message: `Google Doc checkpoint: revision ${revisionId}. Edits are already persisted.`,
        ...metadata,
      });
    }

    // Snapshot: export as DOCX to local path
    const savePath = params.save_to_local_path!.startsWith('~')
      ? path.join(process.env.HOME || '', params.save_to_local_path!.slice(1))
      : params.save_to_local_path!;

    const writePolicy = await enforceWritePathPolicy(savePath);
    if (!writePolicy.ok) return writePolicy.response;

    const buffer = await session.doc.exportAsDocx();
    await fs.mkdir(path.dirname(savePath), { recursive: true });
    await fs.writeFile(savePath, new Uint8Array(buffer));

    manager.touch(session);

    return ok({
      google_doc_id: session.docId,
      save_mode: 'snapshot',
      revision_id: revisionId,
      saved_to: savePath,
      size_bytes: buffer.length,
      message: `Google Doc exported as DOCX to ${savePath}`,
      ...metadata,
    });
  } catch (e: unknown) {
    return err('SAVE_ERROR', `Failed to save: ${e instanceof Error ? e.message : String(e)}`, 'Check the path is valid and writable.');
  }
}
