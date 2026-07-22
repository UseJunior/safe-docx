import path from 'node:path';
import fs from 'node:fs/promises';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { enforceWritePathPolicy, resolvesToSamePath } from './path_policy.js';
import { checkGDocsSupport } from './provider_guard.js';
import { loadOdfCore } from '../odf_loader.js';

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

/**
 * Convert a DOCX document to OpenDocument Text (`.odt`) via odf-core's native converter.
 *
 * Conversion is semantic and intentionally lossy (no round-trip guarantee): visible text,
 * headings, basic run formatting, lists, and tables are mapped; everything downgraded is
 * itemized in the returned `lossiness` summary. The converted package is validated with
 * `validateOdfArchiveSafety` BEFORE writing — an unsafe artifact is never persisted.
 *
 * DOCX in, ODT out. `file_path`-first like every session tool; Google Docs is out of scope,
 * and a `.odt` input is rejected by session resolution (there is nothing to convert).
 */
export async function convertToOdt(
  manager: SessionManager,
  params: {
    file_path?: string;
    google_doc_id?: string;
    output_path?: string;
    allow_overwrite?: boolean;
  },
): Promise<ToolResponse> {
  try {
    if (typeof params.google_doc_id === 'string' && params.google_doc_id.trim().length > 0) {
      return checkGDocsSupport('convert_to_odt')!;
    }

    const resolved = await resolveSessionForTool(manager, params, { toolName: 'convert_to_odt' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const parsedSource = path.parse(session.originalPath);
    const outputPath = expandPath(
      params.output_path?.trim()
        ? params.output_path
        : path.join(parsedSource.dir, `${parsedSource.name}.odt`),
    );

    // Never clobber the source document; realpath-compare so a symlink can't slip past.
    if (await resolvesToSamePath(outputPath, session.originalPath)) {
      return err(
        'OVERWRITE_BLOCKED',
        `Refusing to overwrite the source document: ${outputPath}`,
        'Choose a different output_path.',
      );
    }
    if (!params.allow_overwrite) {
      const exists = await fs
        .access(outputPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        return err(
          'OVERWRITE_BLOCKED',
          `Output file already exists: ${outputPath}`,
          'Set allow_overwrite=true to overwrite, or choose a different output_path.',
        );
      }
    }

    const odfCore = await loadOdfCore();
    if (!odfCore) {
      return err(
        'ODF_UNAVAILABLE',
        'DOCX→ODT conversion requires @usejunior/odf-core.',
        'Install @usejunior/odf-core to enable conversion.',
      );
    }

    // Convert the session's CURRENT state (including unsaved edits), not the on-disk file.
    const { buffer } = await session.doc.toBuffer({ cleanBookmarks: false });
    const { odt, lossiness } = await odfCore.convertDocxToOdt(buffer);

    const safety = await odfCore.validateOdfArchiveSafety(odt);
    if (!safety.ok) {
      return err(
        'CONVERSION_UNSAFE_OUTPUT',
        `Converted package failed ODF archive safety validation: ${safety.message}`,
        'This is a converter bug — please report it. No file was written.',
      );
    }

    const policy = await enforceWritePathPolicy(outputPath);
    if (!policy.ok) return policy.response;
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, new Uint8Array(odt));

    return ok(
      mergeSessionResolutionMetadata(
        {
          output_path: manager.normalizePath(outputPath),
          bytes_written: odt.byteLength,
          lossiness,
        },
        metadata,
      ),
    );
  } catch (error) {
    return err('CONVERT_FAILED', error instanceof Error ? error.message : String(error));
  }
}
