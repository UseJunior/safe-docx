// Re-export shared utilities
export * from './shared/ooxml/namespaces.js';
export * from './generated/ecma-376-vocabulary.js';
export * from './shared/ooxml/types.js';
export * from './shared/docx/DocxArchive.js';
export * from './shared/field-structure.js';
export * from './shared/validators/structural.js';

// Re-export core WmlComparer types
export * from './core-types.js';

// Re-export numbering utilities
export * from './numbering.js';

// Re-export footnote utilities
export * from './footnotes.js';

// Re-export primitives (editing, DOM helpers, document operations)
export * from './primitives/index.js';
export * from './primitives/schema-corpus-capture.js';
export * from './primitives/xml-helpers.js';
export {
  allocateRevisionId,
  buildPPrChangeElement,
  buildTcPrChangeElement,
  buildTrPrChangeElement,
  buildRPrChangeElement,
  createRevisionContainer,
  createRevisionContext,
  createRevisionIdState,
  escapeXmlAttr,
  formatDate,
  prepareElementForDeletion,
  convertSerializedDeletionContent,
  wrapSerializedContentWithDel,
  wrapSerializedContentWithIns,
  wrapElementWithDel,
  wrapElementWithIns,
} from './primitives/track-changes-emitter.js';
export type {
  RevisionContext,
  RevisionContextOptions,
  RevisionIdState,
} from './primitives/track-changes-emitter.js';

// Re-export the LibreOffice accept/reject oracle (gated reference voter; callers skip when
// `resolveSoffice()` is null or `probeSofficeUsable()` is false — the binary can exist yet
// abort on launch under a restricted shell). odf-core's round-trip tests drive it with `.odt` jobs.
export { resolveSoffice, probeSofficeUsable, runLibreOfficeOracle, type OracleJob } from './integration/libreoffice-oracle.js';

// Synthetic-DOCX fixture builders re-exported for downstream packages' test suites
// (odf-core's DOCX→ODT conversion tests build their inputs with these). They live under
// `integration/` because `src/testing/**` is excluded from the package build.
export {
  buildSyntheticDocx,
  buildDocxFromParts,
  type SyntheticDocxOptions,
  type DocxPartsOptions,
} from './integration/synthetic-docx-fixture.js';

// From-scratch generation (OpenSpec capability: docx-generation). Public as of
// the final phase of add-docx-generation: compatibility matrix recorded, all
// scenario coverage enforced strictly in CI.
export {
  generateDocx,
  type GenerateDocxOptions,
  GenerationSpecError,
  GenerationInternalError,
  type GenerationSpecErrorCode,
  checkGeneratedPackage,
  type StructuralCheckResult,
  type StructuralIssue,
} from './generation/index.js';
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
} from './generation/index.js';
