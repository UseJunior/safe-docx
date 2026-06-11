/**
 * From-scratch DOCX generation (OpenSpec change: add-docx-generation).
 *
 * Module-internal surface for now: this index is deliberately NOT re-exported
 * from the package root until the cross-reader compatibility matrix is signed
 * off in the final phase of the change. Tests and in-repo consumers import
 * from this path directly.
 */

export { generateDocx, type GenerateDocxOptions } from './compile.js';
export { GenerationSpecError, GenerationInternalError, type GenerationSpecErrorCode } from './errors.js';
export { checkGeneratedPackage, type StructuralCheckResult, type StructuralIssue } from './structural-checks.js';
export { coverTermsTable, signatureBlock, type CoverTermsOptions, type SignatureBlockOptions } from './recipes.js';
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
