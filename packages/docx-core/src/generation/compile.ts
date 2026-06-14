/**
 * The generation compiler: DocumentSpec → validated spec → per-part emitters
 * → ordered file record → zip buffer.
 *
 * Determinism contract: identical specs compile to byte-identical buffers.
 * No emitter reads the clock or randomness; zip entry dates are pinned to a
 * fixed epoch (document-facing dates come from spec.meta.createdIso).
 *
 * Ordering: header/footer parts are allocated first so their relationship
 * ids exist when the document part binds section references; the standard
 * ancillary parts (theme, fontTable, webSettings) register before the package
 * plumbing, which runs last because [Content_Types].xml is assembled from the
 * part registry.
 */

import { createZipBuffer } from '../primitives/zip.js';
import { maybeCaptureEmittedDocumentXml } from '../primitives/schema-corpus-capture.js';
import { CompileContext } from './context.js';
import { emitCommentsPartsIfNeeded } from './emit/comments-part.js';
import { DraftingNoteCollector } from './emit/emit-context.js';
import { emitDocumentPart } from './emit/document-part.js';
import { emitFontTablePart } from './emit/font-table-part.js';
import { emitHeaderFooterParts } from './emit/header-footer-part.js';
import { emitNumberingPartIfNeeded } from './emit/numbering-part.js';
import { emitPackageParts } from './emit/package-parts.js';
import { emitSettingsPartIfNeeded } from './emit/settings-part.js';
import { emitStylesPart } from './emit/styles-part.js';
import { emitThemePart } from './emit/theme-part.js';
import { emitWebSettingsPart } from './emit/web-settings-part.js';
import { resolveThemeColorValues } from './theme-colors.js';
import type { DocumentSpec } from './types.js';
import { validateSpec } from './validate-spec.js';

/** Fixed zip-entry timestamp (2006-01-01T00:00:00Z, the OOXML vintage). */
const ZIP_EPOCH = new Date(Date.UTC(2006, 0, 1));

export type GenerateDocxOptions = {
  /** Overrides spec.options.includeDraftingNotes when provided. */
  includeDraftingNotes?: boolean;
};

/** Compile a DocumentSpec into a complete DOCX package. */
export async function generateDocx(spec: DocumentSpec, opts?: GenerateDocxOptions): Promise<Buffer> {
  validateSpec(spec);

  const notesEnabled = opts?.includeDraftingNotes ?? spec.options?.includeDraftingNotes ?? true;
  const ctx = new CompileContext();
  const themeColorValues = resolveThemeColorValues(spec.theme);
  const numberingIds = emitNumberingPartIfNeeded(spec, ctx);
  const headerFooterRefs = emitHeaderFooterParts(spec, ctx, { numberingIds, themeColorValues });
  const notes = notesEnabled ? new DraftingNoteCollector() : undefined;
  const documentPartXml = emitDocumentPart(spec, headerFooterRefs, { numberingIds, notes, themeColorValues });
  maybeCaptureEmittedDocumentXml(documentPartXml);
  ctx.setFileContent('word/document.xml', documentPartXml);
  if (notes) emitCommentsPartsIfNeeded(spec, ctx, notes);
  emitStylesPart(spec, ctx);
  emitSettingsPartIfNeeded(spec, ctx);
  // Standard ancillary parts every Word-authored package carries (issue #482):
  // theme → fontTable → webSettings, ordered for stable rId allocation. Package
  // plumbing must stay last — it assembles [Content_Types].xml from the registry.
  emitThemePart(ctx, spec.theme);
  emitFontTablePart(spec, ctx);
  emitWebSettingsPart(ctx);
  emitPackageParts(spec, ctx);

  return createZipBuffer(ctx.toFileRecord(), { fileDate: ZIP_EPOCH });
}
