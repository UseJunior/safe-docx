export const IR_VERSION = 1 as const;

export type SourceDescriptor = {
  sha256: string;
  paragraphs: number;
};

export type Rationale = {
  operationId: string;
  text: string;
  category?: string;
};

export type DraftRequirement = {
  id: string;
  description: string;
  satisfiedBy: string[];
  mode: 'all' | 'any';
};

export type RequirementWaiver = {
  requirementId: string;
  authority: string;
  reason: string;
};

export type AtomicChangeSet = {
  id: string;
  operationIds: string[];
};

export type DraftAssertion = {
  id: string;
  kind: 'present' | 'absent';
  text: string;
};

export type SourceParagraph = {
  id: string;
  fingerprint: string;
  style: string;
  originalText: string;
  revisedText: string;
};

export type InlineEditOperation = SourceParagraph & {
  kind: 'inline-edit';
  operationId: string;
};

export type ReplaceSourceOperation = SourceParagraph & {
  kind: 'replace-source';
  operationId: string;
  format: 'inherit-source-paragraph';
  /** Optional unique source text whose run formatting new text inherits. */
  formatSource?: string;
};

export type DeleteSourceOperation = SourceParagraph & {
  kind: 'delete-source';
  operationId: string;
  format: 'inherit-source-paragraph';
};

export type InsertOperation = {
  kind: 'insert-before' | 'insert-after';
  operationId: string;
  anchorId: string;
  revisedText: string;
  styleSourceId?: string;
};

export type EditOperation =
  | InlineEditOperation
  | ReplaceSourceOperation
  | DeleteSourceOperation
  | InsertOperation;

export type MarkdocEditIR = {
  version: typeof IR_VERSION;
  source: SourceDescriptor;
  scaffold: SourceParagraph[];
  operations: EditOperation[];
  rationales: Rationale[];
  /** Additive v1 fields; omitted legacy IR is treated as having no completeness declarations. */
  requirements?: DraftRequirement[];
  waivers?: RequirementWaiver[];
  changeSets?: AtomicChangeSet[];
  assertions?: DraftAssertion[];
};

export type ValidationIssue = {
  code: string;
  message: string;
  line?: number;
};

export type ValidationResult =
  | { valid: true; ir: MarkdocEditIR }
  | { valid: false; issues: ValidationIssue[] };

export type VerificationCertificate = {
  version: 1;
  sourceSha256Matches: boolean;
  scaffoldComplete: boolean;
  paragraphFingerprintsMatch: boolean;
  operationsAppliedExactlyOnce: boolean;
  rejectAllEqualsSource: boolean;
  acceptAllEqualsClean: boolean;
  unchangedPackagePartsPreserved: boolean;
  unsupportedStructures: string[];
  appliedOperations: string[];
  /** Exact source/reject and clean/accept replay verdict. */
  projectionPassed: boolean;
  draftCompletenessPassed: boolean;
  deliveryReady: boolean;
  completeness: DraftCompletenessReport;
  /** Conservative aggregate verdict: true only when the artifact is delivery-ready. */
  passed: boolean;
};

export type RequirementResult = {
  id: string;
  status: 'satisfied' | 'waived' | 'blocked';
  satisfiedBy: string[];
  missingOperations: string[];
  waiver?: RequirementWaiver;
};

export type ChangeSetResult = {
  id: string;
  complete: boolean;
  appliedOperations: string[];
  missingOperations: string[];
};

export type AssertionResult = DraftAssertion & {
  passed: boolean;
};

export type DraftCompletenessReport = {
  requirements: RequirementResult[];
  changeSets: ChangeSetResult[];
  assertions: AssertionResult[];
  passed: boolean;
};

export type CompileResult = {
  clean: Buffer;
  tracked: Buffer;
  ir: MarkdocEditIR;
  certificate: VerificationCertificate;
};

export type ImportResult = {
  anchoredSource: Buffer;
  markdoc: string;
  source: SourceDescriptor;
};

export type EditPair = {
  operationId: string;
  kind: EditOperation['kind'];
  anchorId: string;
  before: string;
  after: string;
  contextBefore: string[];
  contextAfter: string[];
  rationale?: string;
  category?: string;
  verified?: boolean;
  provenance?: Record<string, string>;
};

export type AdjacentRevisionPair = {
  anchorId: string;
  before: string;
  after: string;
  contextBefore: string[];
  contextAfter: string[];
  labels?: Record<string, string>;
};
