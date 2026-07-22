/**
 * From-scratch DOCX generation (OpenSpec capability: docx-generation).
 *
 * Re-exported from the package root since the final phase of the
 * add-docx-generation change, with the cross-reader compatibility matrix
 * recorded in docs/generation-manual-compat-checklist.md.
 */

export { generateDocx, type GenerateDocxOptions } from './compile.js';
export { GenerationSpecError, GenerationInternalError, type GenerationSpecErrorCode } from './errors.js';
export { checkGeneratedPackage, type StructuralCheckResult, type StructuralIssue } from './structural-checks.js';
export type {
  BlockSpec,
  BorderSpec,
  BreakSpec,
  DocumentMetaSpec,
  DocumentSpec,
  DraftingNoteSpec,
  FieldSpec,
  HeaderFooterSet,
  HeaderFooterSpec,
  InlineSpec,
  NumberingSpec,
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
} from './types.js';
