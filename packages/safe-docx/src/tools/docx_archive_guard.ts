import { inspectZipEntries } from '@usejunior/docx-primitives';
import { errorCode, errorMessage } from "../error_utils.js";
import { err, type ToolResponse } from './types.js';

export type ArchiveGuardOutcome =
  | { ok: true }
  | { ok: false; response: ToolResponse };

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const MAX_ARCHIVE_ENTRIES = () => readIntEnv('SAFE_DOCX_MAX_ARCHIVE_ENTRIES', 2000);
const MAX_TOTAL_UNCOMPRESSED_BYTES = () => readIntEnv('SAFE_DOCX_MAX_UNCOMPRESSED_BYTES', 200 * 1024 * 1024);
const MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES = () => readIntEnv('SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES', 50 * 1024 * 1024);
const MAX_COMPRESSION_RATIO = () => readIntEnv('SAFE_DOCX_MAX_COMPRESSION_RATIO', 200);

export async function validateDocxArchiveSafety(buffer: Buffer): Promise<ArchiveGuardOutcome> {
  let entries: Awaited<ReturnType<typeof inspectZipEntries>>;
  try {
    entries = await inspectZipEntries(buffer);
  } catch (e: unknown) {
    return {
      ok: false,
      response: err(
        'INVALID_DOCX_ARCHIVE',
        `Unable to parse .docx archive: ${errorMessage(e)}`,
        'Ensure the input file is a valid .docx package.',
      ),
    };
  }

  const files = entries.filter((entry) => !entry.isDirectory);
  if (files.length > MAX_ARCHIVE_ENTRIES()) {
    return {
      ok: false,
      response: err(
        'DOCX_ARCHIVE_TOO_MANY_ENTRIES',
        `Archive contains ${files.length} entries (max ${MAX_ARCHIVE_ENTRIES()}).`,
        'Use a simpler .docx package or raise SAFE_DOCX_MAX_ARCHIVE_ENTRIES intentionally.',
      ),
    };
  }

  let totalUncompressed = 0;
  for (const file of files) {
    const compressedSize = file.compressedSize;
    const uncompressedSize = file.uncompressedSize;
    totalUncompressed += uncompressedSize;

    if (uncompressedSize > MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES()) {
      return {
        ok: false,
        response: err(
          'DOCX_ARCHIVE_ENTRY_TOO_LARGE',
          `Archive entry '${file.name}' is ${uncompressedSize} bytes uncompressed (max ${MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES()}).`,
          'Reduce embedded object sizes or raise SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES intentionally.',
        ),
      };
    }

    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES()) {
      return {
        ok: false,
        response: err(
          'DOCX_ARCHIVE_UNCOMPRESSED_TOO_LARGE',
          `Archive expands to ${totalUncompressed} bytes (max ${MAX_TOTAL_UNCOMPRESSED_BYTES()}).`,
          'Reduce archive complexity or raise SAFE_DOCX_MAX_UNCOMPRESSED_BYTES intentionally.',
        ),
      };
    }

    if (uncompressedSize > 0) {
      const ratio = compressedSize > 0 ? uncompressedSize / compressedSize : Number.POSITIVE_INFINITY;
      if (ratio > MAX_COMPRESSION_RATIO()) {
        return {
          ok: false,
          response: err(
            'DOCX_ARCHIVE_COMPRESSION_RATIO_TOO_HIGH',
            `Archive entry '${file.name}' has compression ratio ${ratio.toFixed(2)} (max ${MAX_COMPRESSION_RATIO()}).`,
            'This may indicate a highly compressed or hostile archive. Adjust SAFE_DOCX_MAX_COMPRESSION_RATIO only if trusted.',
          ),
        };
      }
    }
  }

  return { ok: true };
}
