/**
 * From-scratch DOCX generation (OpenSpec capability: docx-generation).
 *
 * Re-exported from the package root since the final phase of the
 * add-docx-generation change, with the cross-reader compatibility matrix
 * recorded in docs/generation-manual-compat-checklist.md.
 */

export { generateDocx, type GenerateDocxOptions } from './compile.js';
export { GenerationSpecError, GenerationInternalError, type GenerationSpecErrorCode } from './errors.js';
export { checkGeneratedPackage, type StructuralCheckOptions, type StructuralCheckResult, type StructuralIssue } from './structural-checks.js';
export {
  BOOKMARK_NAME_MAX_LENGTH,
  BookmarkNameError,
  bookmarkNameForSlug,
  bookmarkNamesForSlugs,
  isWordBookmarkName,
  type BookmarkNameErrorCode,
} from './bookmark-names.js';
export { CROSS_REFERENCE_NUMBERS } from './types.js';
export type {
  BlockSpec,
  BorderSpec,
  BreakSpec,
  CrossReferenceNumber,
  CrossReferenceSpec,
  DocumentDefaultsSpec,
  DocumentMetaSpec,
  DocumentSpec,
  DraftingNoteSpec,
  FieldSpec,
  FootnoteSpec,
  HeaderFooterSet,
  HeaderFooterSpec,
  InlineSpec,
  NumberingInstanceSpec,
  NumberingLevelFormat,
  NumberingLevelOverrideSpec,
  NumberingLevelSpec,
  NumberingSpec,
  ParagraphBorders,
  ParagraphSpec,
  RunProps,
  RunSpec,
  SectionSpec,
  StyleSpec,
  TableBorders,
  TableCellSpec,
  TableRowSpec,
  TableSpec,
  TabSpec,
  TabStopSpec,
} from './types.js';
