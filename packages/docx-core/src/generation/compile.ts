/**
 * The generation compiler: DocumentSpec → validated spec → per-part emitters
 * → ordered file record → zip buffer.
 *
 * Determinism contract: identical specs compile to byte-identical buffers.
 * No emitter reads the clock or randomness; zip entry dates are pinned to a
 * fixed epoch (document-facing dates come from spec.meta.createdIso).
 */

import { createZipBuffer } from '../primitives/zip.js';
import { CompileContext } from './context.js';
import { emitDocumentPart } from './emit/document-part.js';
import { emitPackageParts } from './emit/package-parts.js';
import type { DocumentSpec } from './types.js';
import { validateSpec } from './validate-spec.js';

/** Fixed zip-entry timestamp (2006-01-01T00:00:00Z, the OOXML vintage). */
const ZIP_EPOCH = new Date(Date.UTC(2006, 0, 1));

export type GenerateDocxOptions = {
  /** Overrides spec.options.includeDraftingNotes when provided. */
  includeDraftingNotes?: boolean;
};

/** Compile a DocumentSpec into a complete DOCX package. */
export async function generateDocx(spec: DocumentSpec, _opts?: GenerateDocxOptions): Promise<Buffer> {
  validateSpec(spec);

  const ctx = new CompileContext();
  ctx.setFileContent('word/document.xml', emitDocumentPart(spec));
  emitPackageParts(spec, ctx);

  return createZipBuffer(ctx.toFileRecord(), { fileDate: ZIP_EPOCH });
}
