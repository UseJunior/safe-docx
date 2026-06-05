/**
 * ODF archive-safety guard.
 *
 * Reuses docx-core's format-agnostic `inspectZipEntries` for the zip-bomb / entry
 * limits (entry count, single-entry size, total uncompressed size, compression
 * ratio), and additionally asserts the package declares the OpenDocument text
 * mimetype. Returns a plain result; the MCP layer maps failures to tool errors.
 */

import { inspectZipEntries } from '@usejunior/docx-core';
import JSZip from 'jszip';

import { ODF_PATHS, ODT_MIMETYPE } from './shared/odf/namespaces.js';

export type OdfArchiveSafetyResult =
  | { ok: true }
  | { ok: false; code: string; message: string; hint: string };

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const MAX_ARCHIVE_ENTRIES = () => readIntEnv('ODF_MAX_ARCHIVE_ENTRIES', 2000);
const MAX_TOTAL_UNCOMPRESSED_BYTES = () => readIntEnv('ODF_MAX_UNCOMPRESSED_BYTES', 200 * 1024 * 1024);
const MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES = () => readIntEnv('ODF_MAX_ENTRY_UNCOMPRESSED_BYTES', 50 * 1024 * 1024);
const MAX_COMPRESSION_RATIO = () => readIntEnv('ODF_MAX_COMPRESSION_RATIO', 200);

function fail(code: string, message: string, hint: string): OdfArchiveSafetyResult {
  return { ok: false, code, message, hint };
}

export async function validateOdfArchiveSafety(buffer: Buffer): Promise<OdfArchiveSafetyResult> {
  let entries: Awaited<ReturnType<typeof inspectZipEntries>>;
  try {
    entries = await inspectZipEntries(buffer);
  } catch (e: unknown) {
    return fail(
      'INVALID_ODF_ARCHIVE',
      `Unable to parse .odt archive: ${e instanceof Error ? e.message : String(e)}`,
      'Ensure the input file is a valid .odt (OpenDocument text) package.',
    );
  }

  const files = entries.filter((entry) => !entry.isDirectory);
  if (files.length > MAX_ARCHIVE_ENTRIES()) {
    return fail(
      'ODF_ARCHIVE_TOO_MANY_ENTRIES',
      `Archive contains ${files.length} entries (max ${MAX_ARCHIVE_ENTRIES()}).`,
      'Use a simpler .odt package or raise ODF_MAX_ARCHIVE_ENTRIES intentionally.',
    );
  }

  let totalUncompressed = 0;
  for (const file of files) {
    const { compressedSize, uncompressedSize } = file;
    totalUncompressed += uncompressedSize;

    if (uncompressedSize > MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES()) {
      return fail(
        'ODF_ARCHIVE_ENTRY_TOO_LARGE',
        `Archive entry '${file.name}' is ${uncompressedSize} bytes uncompressed (max ${MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES()}).`,
        'Reduce embedded object sizes or raise ODF_MAX_ENTRY_UNCOMPRESSED_BYTES intentionally.',
      );
    }

    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES()) {
      return fail(
        'ODF_ARCHIVE_UNCOMPRESSED_TOO_LARGE',
        `Archive expands to ${totalUncompressed} bytes (max ${MAX_TOTAL_UNCOMPRESSED_BYTES()}).`,
        'Reduce archive complexity or raise ODF_MAX_UNCOMPRESSED_BYTES intentionally.',
      );
    }

    if (uncompressedSize > 0) {
      const ratio = compressedSize > 0 ? uncompressedSize / compressedSize : Number.POSITIVE_INFINITY;
      if (ratio > MAX_COMPRESSION_RATIO()) {
        return fail(
          'ODF_ARCHIVE_COMPRESSION_RATIO_TOO_HIGH',
          `Archive entry '${file.name}' has compression ratio ${ratio.toFixed(2)} (max ${MAX_COMPRESSION_RATIO()}).`,
          'This may indicate a highly compressed or hostile archive. Adjust ODF_MAX_COMPRESSION_RATIO only if trusted.',
        );
      }
    }
  }

  // ODF identity: the package must declare the OpenDocument text mimetype.
  let mimetype: string | null = null;
  try {
    const zip = await JSZip.loadAsync(buffer);
    const mimeFile = zip.file(ODF_PATHS.MIMETYPE);
    mimetype = mimeFile ? (await mimeFile.async('string')).trim() : null;
  } catch {
    mimetype = null;
  }
  if (mimetype !== ODT_MIMETYPE) {
    return fail(
      'INVALID_ODF_ARCHIVE',
      `Not an OpenDocument text package (mimetype: ${mimetype ?? 'absent'}).`,
      `Provide a .odt whose 'mimetype' entry is '${ODT_MIMETYPE}'.`,
    );
  }

  return { ok: true };
}
