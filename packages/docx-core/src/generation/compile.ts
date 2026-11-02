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

import { createZipBuffer, ZIP_EPOCH } from '../primitives/zip.js';
import { maybeCaptureEmittedDocumentXml } from '../primitives/schema-corpus-capture.js';
import { CompileContext } from './context.js';
import { emitCommentsPartsIfNeeded } from './emit/comments-part.js';
import { AnnotationIdAllocator, CrossReferenceResolver, DraftingNoteCollector, FootnoteCollector, type NumberingIdMap } from './emit/emit-context.js';
import { emitDocumentPart } from './emit/document-part.js';
import { emitFontTablePart } from './emit/font-table-part.js';
import { emitFootnotesPartIfNeeded } from './emit/footnotes-part.js';
import { emitHeaderFooterParts } from './emit/header-footer-part.js';
import { emitNumberingPartIfNeeded } from './emit/numbering-part.js';
import { emitPackageParts } from './emit/package-parts.js';
import { emitSettingsPart } from './emit/settings-part.js';
import { emitStylesPart } from './emit/styles-part.js';
import { emitThemePart } from './emit/theme-part.js';
import { emitWebSettingsPart } from './emit/web-settings-part.js';
import { resolveThemeColorValues } from './theme-colors.js';
import type { DocumentSpec } from './types.js';
import { collectBookmarkPaths, specHasFootnotes, validateSpec } from './validate-spec.js';
import { parseNumberingXml } from '../primitives/numbering.js';
import { parseStylesXml } from '../primitives/styles.js';
import { parseXml } from '../primitives/xml.js';

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
  const crossReferences = createCrossReferenceResolver(spec, ctx, numberingIds);
  const notes = notesEnabled ? new DraftingNoteCollector(crossReferences?.ids) : undefined;
  const footnotes = new FootnoteCollector();
  const documentPartXml = emitDocumentPart(spec, headerFooterRefs, { numberingIds, notes, footnotes, crossReferences, themeColorValues });
  maybeCaptureEmittedDocumentXml(documentPartXml);
  ctx.setFileContent('word/document.xml', documentPartXml);
  if (notes) emitCommentsPartsIfNeeded(spec, ctx, notes);
  // Footnotes register after comments and only when the body holds one, so
  // a document without footnotes keeps its relationship ids and bytes.
  emitFootnotesPartIfNeeded(ctx, footnotes, { numberingIds, crossReferences, themeColorValues });
  const hasFootnotes = footnotes.collected.length > 0;
  emitStylesPart(spec, ctx, numberingIds, { footnotes: hasFootnotes });
  emitSettingsPart(spec, ctx, { footnotes: hasFootnotes });
  // Standard ancillary parts every Word-authored package carries (issue #482):
  // theme → fontTable → webSettings, ordered for stable rId allocation. Package
  // plumbing must stay last — it assembles [Content_Types].xml from the registry.
  emitThemePart(ctx, spec.theme);
  emitFontTablePart(spec, ctx);
  emitWebSettingsPart(ctx);
  emitPackageParts(spec, ctx);

  return createZipBuffer(ctx.toFileRecord(), { fileDate: ZIP_EPOCH });
}

/**
 * A resolver for a document with bookmarks (every cross-reference names one;
 * validation checked). Cached results need the list numbers of the body, so
 * it reads the emitted numbering part and the styles part the compiler is
 * about to emit (from a scratch context, leaving part order and relationship
 * ids untouched). Without bookmarks there is no resolver and the output
 * keeps its bytes.
 */
function createCrossReferenceResolver(spec: DocumentSpec, ctx: CompileContext, numberingIds: NumberingIdMap): CrossReferenceResolver | undefined {
  const bookmarkPaths = collectBookmarkPaths(spec);
  if (bookmarkPaths.size === 0) return undefined;
  const scratch = new CompileContext();
  emitStylesPart(spec, scratch, numberingIds, { footnotes: specHasFootnotes(spec) });
  const numberingXml = ctx.getFileContent('word/numbering.xml');
  return new CrossReferenceResolver(
    new AnnotationIdAllocator(),
    parseNumberingXml(numberingXml === undefined ? null : parseXml(numberingXml)),
    parseStylesXml(parseXml(scratch.getFileContent('word/styles.xml')!)),
    bookmarkPaths,
  );
}
