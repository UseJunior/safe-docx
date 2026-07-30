import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DocumentIntegrityCertificate,
  DocumentIntegrityCheckCertificate,
  DocumentIntegrityCommentFailure,
  DocumentIntegrityCommentInventory,
  DocumentIntegrityCommentStory,
  DocumentIntegrityCommentStorySide,
  DocumentIntegrityNoteFailure,
  DocumentIntegrityNoteInventory,
  DocumentIntegrityNoteStory,
  DocumentIntegrityReferenceSourcePartition,
  DocumentIntegrityRelationshipSelectionFailure,
  DocumentIntegrityRelationshipSlot,
  DocumentIntegrityRelationshipStory,
  DocumentIntegrityStoryCertificate,
  LeanXmlVerifierOptions,
  ReconstructionMode,
} from '../../compare-types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_EXECUTABLE = 'verification/lean/.lake/build/bin/leanDocxChecker';
const MAX_RESPONSE_BYTES = 2_626_369;
const MAX_RESPONSE_JSON_BYTES = MAX_RESPONSE_BYTES - 1;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_EVIDENCE_STRING_BYTES = 1_572_864;
const MAX_ORDINARY_EVIDENCE_STRING_BYTES = 1_571_840;

interface LeanVerifierInput {
  originalDocx: Buffer;
  revisedDocx: Buffer;
  comparedDocx: Buffer;
  legacyDocumentXml: { original: string; revised: string; compared: string };
  reconstructionMode: ReconstructionMode;
  options: LeanXmlVerifierOptions;
}

interface LeanStoryJson {
  name: DocumentIntegrityStoryCertificate['name'];
  presence: { original: boolean; revised: boolean; combined: boolean };
  parsedTokenCounts: { original: number; revised: number; combined: number };
  report: {
    passed: boolean;
    checks: LeanChecks;
  };
}

interface LeanChecks {
  acceptPreservesFieldStructure: boolean;
  rejectPreservesFieldStructure: boolean;
  acceptTextMatchesRevised: boolean;
  rejectTextMatchesOriginal: boolean;
  combinedHasNoFldCharInsideDel: boolean;
  combinedHasValidMoveRanges: boolean;
}

interface LeanRelationshipStoryJson {
  physicalStoryOrdinal: number;
  kind: 'header' | 'footer';
  originalPartPath: string;
  revisedPartPath: string;
  comparedPartPath: string;
  selectingSlotOrdinals: number[];
  parsedTokenCounts: { original: number; revised: number; combined: number };
  report: { passed: boolean; checks: LeanChecks };
}

interface LeanVerifierJson {
  protocolVersion: 7;
  checker: 'safe-docx-lean-conventional-main-comment-range-integrity-checker';
  passed: boolean;
  fixedStories: LeanStoryJson[];
  presenceMismatches: [];
  fixedStoryIssues: [];
  relationshipSlots: DocumentIntegrityRelationshipSlot[];
  relationshipStories: LeanRelationshipStoryJson[];
  selectionIssues: DocumentIntegrityRelationshipSelectionFailure[];
  referenceSourcePartitions: DocumentIntegrityReferenceSourcePartition[];
  noteStories: LeanNoteStoryJson[];
  noteInventories: DocumentIntegrityNoteInventory[];
  noteIntegrityIssues: DocumentIntegrityNoteFailure[];
  commentStory: LeanCommentStoryJson;
  commentInventories: DocumentIntegrityCommentInventory[];
  commentIntegrityIssues: DocumentIntegrityCommentFailure[];
}

interface LeanCommentStoryJson {
  status: 'passed' | 'failed' | 'not_evaluated';
  original: DocumentIntegrityCommentStory['original'];
  revised: DocumentIntegrityCommentStory['revised'];
  compared: DocumentIntegrityCommentStory['compared'];
  parsedTokenCounts: { original: number; revised: number; combined: number };
}

interface LeanNoteStoryJson {
  kind: 'footnotes' | 'endnotes';
  status: 'passed' | 'failed' | 'not_evaluated';
  original: LeanDefinitionStoryJson;
  revised: LeanDefinitionStoryJson;
  compared: LeanDefinitionStoryJson;
  parsedTokenCounts: { original: number; revised: number; combined: number };
  report?: { passed: boolean; checks: LeanChecks };
}

interface LeanDefinitionStoryJson {
  kind: 'footnotes' | 'endnotes';
  relationship?: { relationshipId: string; normalizedPartPath: string };
  partPresent: boolean;
}

const CHECK_KEYS = [
  'acceptPreservesFieldStructure',
  'rejectPreservesFieldStructure',
  'acceptTextMatchesRevised',
  'rejectTextMatchesOriginal',
  'combinedHasNoFldCharInsideDel',
  'combinedHasValidMoveRanges',
] as const;

const SELECTION_CODES = new Set([
  'DUPLICATE_SECTION_BINDING', 'MISSING_RELATIONSHIP_ID', 'INVALID_BINDING_ROLE',
  'UNSUPPORTED_SECTION_PLACEMENT', 'INDIRECT_SECTION_BINDING',
  'MISSING_RELATIONSHIPS_PART', 'INVALID_RELATIONSHIPS_XML', 'INVALID_RELATIONSHIPS_ROOT',
  'RELATIONSHIP_LIMIT_EXCEEDED', 'MALFORMED_RELATIONSHIP_RECORD',
  'DUPLICATE_RELATIONSHIP_ID', 'MISSING_RELATIONSHIP', 'RELATIONSHIP_ID_LIMIT_EXCEEDED',
  'RELATIONSHIP_TYPE_MISMATCH', 'INVALID_TARGET_MODE', 'EXTERNAL_TARGET',
  'TARGET_LENGTH_LIMIT_EXCEEDED', 'UNSAFE_TARGET', 'MISSING_TARGET_PART',
  'SELECTED_PART_LIMIT_EXCEEDED', 'UNIQUE_SELECTED_PART_LIMIT_EXCEEDED',
  'AGGREGATE_COMPRESSED_LIMIT_EXCEEDED', 'AGGREGATE_EXPANDED_LIMIT_EXCEEDED',
  'INVALID_TARGET_XML', 'TARGET_ROOT_MISMATCH', 'XML_DEPTH_LIMIT_EXCEEDED',
  'XML_TOKEN_LIMIT_EXCEEDED', 'INVALID_UTF8', 'SECTION_COUNT_MISMATCH',
  'SECTION_SLOT_MISMATCH', 'EVIDENCE_STRING_BUDGET_EXCEEDED', 'ISSUE_LIMIT_EXCEEDED',
]);
const SIDES = ['original', 'revised', 'compared'] as const;
const KINDS = ['header', 'footer'] as const;
const ROLES = ['first', 'default', 'even'] as const;
const NOTE_KINDS = ['footnotes', 'endnotes'] as const;
const NOTE_STATUSES = ['passed', 'failed', 'not_evaluated'] as const;
const NOTE_ORDINAL_SPACES = [
  'relationship', 'source', 'definition', 'reference', 'poison', 'aggregate',
] as const;
const NOTE_ISSUE_CODES = new Set([
  'NOTE_RELATIONSHIP_AMBIGUOUS', 'NOTE_RELATIONSHIP_EXTERNAL',
  'NOTE_RELATIONSHIP_INVALID_TARGET_MODE', 'NOTE_RELATIONSHIP_UNSAFE_TARGET',
  'NOTE_RELATIONSHIP_TARGET_LIMIT_EXCEEDED', 'NOTE_RELATIONSHIP_REQUIRED',
  'NOTE_PART_MISSING', 'NOTE_PART_INVALID_UTF8', 'NOTE_PART_INVALID_XML',
  'NOTE_PART_ROOT_MISMATCH', 'NOTE_PART_LIMIT_EXCEEDED', 'NOTE_ID_MISSING',
  'NOTE_ID_INVALID_DECIMAL', 'NOTE_ID_LEXICAL_LIMIT_EXCEEDED', 'NOTE_TYPE_INVALID',
  'NOTE_USER_DEFINITION_DUPLICATE', 'NOTE_REFERENCE_MISSING_DEFINITION',
  'NOTE_REFERENCE_IN_DEFINITION_STORY', 'NOTE_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED',
  'NOTE_UNIQUE_REFERENCE_LIMIT_EXCEEDED', 'NOTE_DEFINITION_LIMIT_EXCEEDED',
  'NOTE_POISON_REFERENCE_LIMIT_EXCEEDED', 'NOTE_SOURCE_PARTITION_INCOMPLETE',
  'NOTE_ISSUE_LIMIT_EXCEEDED', 'NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED',
]);
const COMMENT_STATUSES = ['absent', 'passed', 'failed', 'not_evaluated'] as const;
const COMMENT_ISSUE_CODES = new Set([
  'COMMENT_RELATIONSHIP_AMBIGUOUS', 'COMMENT_RELATIONSHIP_EXTERNAL',
  'COMMENT_RELATIONSHIP_INVALID_TARGET_MODE', 'COMMENT_RELATIONSHIP_TARGET_LIMIT_EXCEEDED',
  'COMMENT_RELATIONSHIP_UNSAFE_TARGET', 'COMMENT_SOURCE_PARTITION_INCOMPLETE',
  'COMMENT_RELATIONSHIP_REQUIRED', 'COMMENT_PART_MISSING',
  'COMMENT_SELECTED_PART_LIMIT_EXCEEDED', 'COMMENT_TRIPLE_SELECTED_PART_LIMIT_EXCEEDED',
  'COMMENT_PART_COMPRESSED_LIMIT_EXCEEDED', 'COMMENT_PART_EXPANDED_LIMIT_EXCEEDED',
  'COMMENT_PART_RATIO_LIMIT_EXCEEDED', 'COMMENT_CUMULATIVE_COMPRESSED_LIMIT_EXCEEDED',
  'COMMENT_CUMULATIVE_EXPANDED_LIMIT_EXCEEDED', 'COMMENT_TRIPLE_COMPRESSED_LIMIT_EXCEEDED',
  'COMMENT_TRIPLE_EXPANDED_LIMIT_EXCEEDED', 'COMMENT_PART_EXTRACTION_FAILED',
  'COMMENT_PART_INVALID_UTF8', 'COMMENT_PART_INVALID_XML',
  'COMMENT_PART_XML_DEPTH_LIMIT_EXCEEDED', 'COMMENT_PART_XML_EVENT_LIMIT_EXCEEDED',
  'COMMENT_CUMULATIVE_XML_EVENT_LIMIT_EXCEEDED', 'COMMENT_TRIPLE_XML_EVENT_LIMIT_EXCEEDED',
  'COMMENT_PART_ROOT_MISMATCH', 'COMMENT_REFERENCE_ID_MISSING',
  'COMMENT_REFERENCE_ID_MALFORMED', 'COMMENT_REFERENCE_ID_TOO_LONG',
  'COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED',
  'COMMENT_RANGE_START_ID_MISSING', 'COMMENT_RANGE_START_ID_MALFORMED',
  'COMMENT_RANGE_START_ID_TOO_LONG', 'COMMENT_RANGE_END_ID_MISSING',
  'COMMENT_RANGE_END_ID_MALFORMED', 'COMMENT_RANGE_END_ID_TOO_LONG',
  'COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED',
  'COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED',
  'COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED',
  'COMMENT_DEFINITION_ID_MISSING',
  'COMMENT_DEFINITION_ID_MALFORMED', 'COMMENT_DEFINITION_ID_TOO_LONG',
  'COMMENT_DEFINITION_LIMIT_EXCEEDED', 'COMMENT_DEFINITION_NOT_DIRECT',
  'COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED', 'COMMENT_DEFINITION_DUPLICATE',
  'COMMENT_DEFINITION_MISSING', 'COMMENT_REFERENCE_DUPLICATE',
  'COMMENT_REFERENCE_MISSING', 'COMMENT_RANGE_START_DUPLICATE',
  'COMMENT_RANGE_END_DUPLICATE', 'COMMENT_RANGE_START_ORPHANED',
  'COMMENT_RANGE_END_ORPHANED', 'COMMENT_RANGE_REVERSED',
  'COMMENT_RANGE_CROSS_STORY', 'COMMENT_ISSUE_LIMIT_EXCEEDED',
  'COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED',
]);

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function notEvaluated(claim: string): DocumentIntegrityCheckCertificate {
  return { status: 'not_evaluated', claim };
}

function unevaluatedChecks(): DocumentIntegrityCertificate['checks'] {
  return {
    acceptingAllTrackedChangesMatchesRevisedText: notEvaluated(
      'Accepting all tracked changes in the compared document yields the same normalized text as the revised document.'
    ),
    rejectingAllTrackedChangesMatchesOriginalText: notEvaluated(
      'Rejecting all tracked changes in the compared document yields the same normalized text as the original document.'
    ),
    acceptingAllTrackedChangesKeepsValidFieldStructure: notEvaluated(
      'After accepting all tracked changes, Word field markers remain structurally valid.'
    ),
    rejectingAllTrackedChangesKeepsValidFieldStructure: notEvaluated(
      'After rejecting all tracked changes, Word field markers remain structurally valid.'
    ),
    comparedDocumentHasNoFieldMarkersInsideDeletions: notEvaluated(
      'The compared document does not place Word field markers inside deletion markup.'
    ),
    trackedMoveRangesAreCorrectlyPaired: notEvaluated(
      'Tracked move range markers are structurally paired by range ID and move name.'
    ),
  };
}

function check(status: boolean, claim: string): DocumentIntegrityCheckCertificate {
  return { status: status ? 'passed' : 'failed', claim };
}

function mappedChecks(checks: LeanChecks, relationship = false) {
  const scope = relationship ? 'selected relationship story' : 'story';
  return {
    acceptingAllTrackedChangesMatchesRevisedText: check(
      checks.acceptTextMatchesRevised,
      `Accepting all tracked changes in this ${scope} yields the same normalized text as the revised ${scope}.`
    ),
    rejectingAllTrackedChangesMatchesOriginalText: check(
      checks.rejectTextMatchesOriginal,
      `Rejecting all tracked changes in this ${scope} yields the same normalized text as the original ${scope}.`
    ),
    acceptingAllTrackedChangesKeepsValidFieldStructure: check(
      checks.acceptPreservesFieldStructure,
      `After accepting all tracked changes, Word field markers in this ${scope} remain structurally valid.`
    ),
    rejectingAllTrackedChangesKeepsValidFieldStructure: check(
      checks.rejectPreservesFieldStructure,
      `After rejecting all tracked changes, Word field markers in this ${scope} remain structurally valid.`
    ),
    comparedStoryHasNoFieldMarkersInsideDeletions: check(
      checks.combinedHasNoFldCharInsideDel,
      `The compared ${scope} does not place Word field markers inside deletion markup.`
    ),
    trackedMoveRangesAreCorrectlyPaired: check(
      checks.combinedHasValidMoveRanges,
      `Tracked move range markers in this ${scope} are structurally paired by range ID and move name.`
    ),
  };
}

function storyCertificate(story: LeanStoryJson): DocumentIntegrityStoryCertificate {
  return {
    name: story.name,
    status: story.report.passed ? 'passed' : 'failed',
    checks: mappedChecks(story.report.checks),
    parsedTokenCounts: {
      original: story.parsedTokenCounts.original,
      revised: story.parsedTokenCounts.revised,
      compared: story.parsedTokenCounts.combined,
    },
    presence: {
      original: story.presence.original,
      revised: story.presence.revised,
      compared: story.presence.combined,
    },
  };
}

function relationshipStoryCertificate(story: LeanRelationshipStoryJson): DocumentIntegrityRelationshipStory {
  return {
    physicalStoryOrdinal: story.physicalStoryOrdinal,
    kind: story.kind,
    originalPartPath: story.originalPartPath,
    revisedPartPath: story.revisedPartPath,
    comparedPartPath: story.comparedPartPath,
    selectingSlotOrdinals: [...story.selectingSlotOrdinals],
    status: story.report.passed ? 'passed' : 'failed',
    checks: mappedChecks(story.report.checks, true),
    parsedTokenCounts: {
      original: story.parsedTokenCounts.original,
      revised: story.parsedTokenCounts.revised,
      compared: story.parsedTokenCounts.combined,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key)) &&
    keys.length === new Set(keys).size;
}

function isNonnegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= maximum;
}

function isPresence(value: unknown): value is LeanStoryJson['presence'] {
  return isRecord(value) && hasExactKeys(value, ['original', 'revised', 'combined']) &&
    typeof value.original === 'boolean' && typeof value.revised === 'boolean' &&
    typeof value.combined === 'boolean';
}

function isCounts(value: unknown): value is LeanStoryJson['parsedTokenCounts'] {
  return isRecord(value) && hasExactKeys(value, ['original', 'revised', 'combined']) &&
    isNonnegativeInteger(value.original, 500_000) &&
    isNonnegativeInteger(value.revised, 500_000) &&
    isNonnegativeInteger(value.combined, 500_000);
}

function isChecks(value: unknown): value is LeanChecks {
  return isRecord(value) && hasExactKeys(value, CHECK_KEYS) &&
    CHECK_KEYS.every((key) => typeof value[key] === 'boolean');
}

function isReport(value: unknown): value is { passed: boolean; checks: LeanChecks } {
  if (!isRecord(value) || !hasExactKeys(value, ['passed', 'checks']) ||
      typeof value.passed !== 'boolean' || !isChecks(value.checks)) return false;
  const checks = value.checks;
  return value.passed === CHECK_KEYS.every((key) => checks[key]);
}

function isFixedStory(value: unknown): value is LeanStoryJson {
  if (!isRecord(value) || !hasExactKeys(value, ['name', 'presence', 'parsedTokenCounts', 'report'])) return false;
  if (!['main', 'footnotes', 'endnotes'].includes(value.name as string) ||
      !isPresence(value.presence) || !isCounts(value.parsedTokenCounts) || !isReport(value.report)) return false;
  const counts = value.parsedTokenCounts;
  const presence = value.presence;
  return (presence.original || counts.original === 0) &&
    (presence.revised || counts.revised === 0) &&
    (presence.combined || counts.combined === 0);
}

function isIdentity(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ['relationshipId', 'normalizedPartPath']) &&
    isBoundedString(value.relationshipId, 128) && value.relationshipId.length > 0 &&
    isBoundedString(value.normalizedPartPath, 256) && value.normalizedPartPath.length > 0;
}

function isSlot(value: unknown): value is DocumentIntegrityRelationshipSlot {
  return isRecord(value) &&
    hasExactKeys(value, [
      'slotOrdinal', 'sectionOrdinal', 'kind', 'role', 'original', 'revised',
      'compared', 'physicalStoryOrdinal',
    ]) &&
    isNonnegativeInteger(value.slotOrdinal, 383) &&
    isNonnegativeInteger(value.sectionOrdinal, 63) &&
    KINDS.includes(value.kind as (typeof KINDS)[number]) &&
    ROLES.includes(value.role as (typeof ROLES)[number]) &&
    isIdentity(value.original) && isIdentity(value.revised) && isIdentity(value.compared) &&
    isNonnegativeInteger(value.physicalStoryOrdinal, 383);
}

function isRelationshipStory(value: unknown): value is LeanRelationshipStoryJson {
  return isRecord(value) &&
    hasExactKeys(value, [
      'physicalStoryOrdinal', 'kind', 'originalPartPath', 'revisedPartPath',
      'comparedPartPath', 'selectingSlotOrdinals', 'parsedTokenCounts', 'report',
    ]) &&
    isNonnegativeInteger(value.physicalStoryOrdinal, 383) &&
    KINDS.includes(value.kind as (typeof KINDS)[number]) &&
    isBoundedString(value.originalPartPath, 256) &&
    isBoundedString(value.revisedPartPath, 256) &&
    isBoundedString(value.comparedPartPath, 256) &&
    Array.isArray(value.selectingSlotOrdinals) && value.selectingSlotOrdinals.length > 0 &&
    value.selectingSlotOrdinals.every((ordinal) => isNonnegativeInteger(ordinal, 383)) &&
    isCounts(value.parsedTokenCounts) && isReport(value.report);
}

function isSelectionIssue(value: unknown): value is DocumentIntegrityRelationshipSelectionFailure {
  if (!isRecord(value) || !hasExactKeys(value, ['code', 'detail'], [
    'side', 'sectionOrdinal', 'kind', 'role', 'relationshipId', 'rawTarget', 'normalizedPartPath',
  ])) return false;
  if (!SELECTION_CODES.has(value.code as string) || !isBoundedString(value.detail, 256)) return false;
  if ('side' in value && !SIDES.includes(value.side as (typeof SIDES)[number])) return false;
  if ('sectionOrdinal' in value && !isNonnegativeInteger(value.sectionOrdinal, 63)) return false;
  if ('kind' in value && !KINDS.includes(value.kind as (typeof KINDS)[number])) return false;
  if ('role' in value && !ROLES.includes(value.role as (typeof ROLES)[number])) return false;
  if ('relationshipId' in value && !isBoundedString(value.relationshipId, 128)) return false;
  if ('rawTarget' in value && !isBoundedString(value.rawTarget, 256)) return false;
  if ('normalizedPartPath' in value && !isBoundedString(value.normalizedPartPath, 256)) return false;
  return true;
}

function compareSlots(left: DocumentIntegrityRelationshipSlot, right: DocumentIntegrityRelationshipSlot): number {
  const kindRank = (kind: 'header' | 'footer') => KINDS.indexOf(kind);
  const roleRank = (role: 'first' | 'default' | 'even') => ROLES.indexOf(role);
  return left.sectionOrdinal - right.sectionOrdinal ||
    kindRank(left.kind) - kindRank(right.kind) ||
    roleRank(left.role) - roleRank(right.role);
}

function issueIdentity(issue: object): string {
  return JSON.stringify(issue);
}

function selectionIssueOrder(issue: DocumentIntegrityRelationshipSelectionFailure): string {
  const side = issue.side === undefined ? -1 : SIDES.indexOf(issue.side);
  const section = issue.sectionOrdinal ?? -1;
  const kind = issue.kind === undefined ? -1 : KINDS.indexOf(issue.kind);
  const role = issue.role === undefined ? -1 : ROLES.indexOf(issue.role);
  return [
    side.toString().padStart(2, '0'),
    section.toString().padStart(3, '0'),
    kind.toString().padStart(2, '0'),
    role.toString().padStart(2, '0'),
    issue.code,
    issue.relationshipId ?? '',
    issue.rawTarget ?? '',
    issue.normalizedPartPath ?? '',
  ].join('\0');
}

function noteIssueOrder(issue: DocumentIntegrityNoteFailure | DocumentIntegrityCommentFailure): string {
  const record = issue as unknown as Record<string, unknown>;
  const source = isRecord(record.source) ? record.source : {};
  const rank = (values: readonly string[], value: unknown) => {
    const index = values.indexOf(String(value));
    return String(index < 0 ? values.length : index).padStart(2, '0');
  };
  const present = (key: string, numericWidth?: number) => {
    if (!(key in record)) return '0';
    const value = record[key];
    return numericWidth === undefined
      ? `1${JSON.stringify(value)}`
      : `1${String(value).padStart(numericWidth, '0')}`;
  };
  return [
    rank(SIDES, issue.side),
    rank(NOTE_KINDS, issue.kind),
    rank(NOTE_ORDINAL_SPACES, issue.ordinalSpace),
    String(issue.firstOccurrenceOrdinal).padStart(5, '0'),
    rank(['main', 'header', 'footer', 'footnotes', 'endnotes'], source.sourceStory),
    String(source.sourceStoryOrdinal ?? -1).padStart(4, '0'),
    issue.code,
    present('canonicalId'),
    present('rawId'),
    present('rawIdByteLength', 9),
    present('rawIdDigest'),
    present('referencedKind'),
    present('relationshipId'),
    present('rawTarget'),
    present('normalizedPartPath'),
  ].join('\0');
}

function noteIssueCoalesceIdentity(
  issue: DocumentIntegrityNoteFailure | DocumentIntegrityCommentFailure,
): string {
  const record = issue as unknown as Record<string, unknown>;
  const source = isRecord(record.source) ? record.source : {};
  return JSON.stringify([
    issue.side,
    issue.kind,
    issue.code,
    issue.ordinalSpace,
    source.sourceStory ?? null,
    source.sourceStoryOrdinal ?? null,
    record.canonicalId ?? null,
    record.rawId ?? null,
    record.rawIdByteLength ?? null,
    record.rawIdDigest ?? null,
    record.referencedKind ?? null,
    record.relationshipId ?? null,
    record.rawTarget ?? null,
    record.normalizedPartPath ?? null,
  ]);
}

const COMMENT_SOURCE_CODE_ORDER = [
  'COMMENT_RANGE_START_ID_MISSING', 'COMMENT_RANGE_START_ID_TOO_LONG',
  'COMMENT_RANGE_START_ID_MALFORMED', 'COMMENT_RANGE_END_ID_MISSING',
  'COMMENT_RANGE_END_ID_TOO_LONG', 'COMMENT_RANGE_END_ID_MALFORMED',
  'COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED',
  'COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED',
  'COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED',
] as const;
const COMMENT_TOPOLOGY_CODE_ORDER = [
  'COMMENT_REFERENCE_DUPLICATE', 'COMMENT_REFERENCE_MISSING',
  'COMMENT_RANGE_START_DUPLICATE', 'COMMENT_RANGE_END_DUPLICATE',
  'COMMENT_RANGE_START_ORPHANED', 'COMMENT_RANGE_END_ORPHANED',
  'COMMENT_RANGE_CROSS_STORY', 'COMMENT_RANGE_REVERSED',
] as const;

function commentIssuePhase(code: string): number {
  if (code === 'COMMENT_SOURCE_PARTITION_INCOMPLETE') return 1;
  if (code.startsWith('COMMENT_DEFINITION_') ||
      code === 'COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED') return 2;
  if (COMMENT_SOURCE_CODE_ORDER.includes(code as never) ||
      code.startsWith('COMMENT_REFERENCE_ID_') ||
      code === 'COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED' ||
      code === 'COMMENT_RELATIONSHIP_REQUIRED') return 3;
  if (COMMENT_TOPOLOGY_CODE_ORDER.includes(code as never)) return 4;
  if (code === 'COMMENT_ISSUE_LIMIT_EXCEEDED' ||
      code === 'COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED') return 5;
  return 0;
}

function commentIssueOrder(issue: DocumentIntegrityCommentFailure): string {
  const source = issue.source;
  const codeOrder = commentIssuePhase(issue.code) === 3
    ? COMMENT_SOURCE_CODE_ORDER.indexOf(issue.code as never)
    : commentIssuePhase(issue.code) === 4
      ? COMMENT_TOPOLOGY_CODE_ORDER.indexOf(issue.code as never)
      : -1;
  const rank = (values: readonly string[], value: string | undefined) => {
    const index = value === undefined ? -1 : values.indexOf(value);
    return String(index < 0 ? values.length : index).padStart(2, '0');
  };
  return [
    rank(SIDES, issue.side),
    String(commentIssuePhase(issue.code)).padStart(2, '0'),
    String(issue.sourceSetOrdinal ?? 0).padStart(3, '0'),
    rank(['main', 'header', 'footer', 'footnotes', 'endnotes', 'comments'],
      source?.sourceStory),
    String(source?.sourceStoryOrdinal ?? 0).padStart(3, '0'),
    String(issue.sourceEventOrdinal ?? 0).padStart(6, '0'),
    rank(['rangeStart', 'rangeEnd', 'reference', 'relationship', 'source',
      'definition', 'aggregate'], issue.ordinalSpace),
    String(issue.firstOccurrenceOrdinal).padStart(4, '0'),
    String(codeOrder < 0 ? 999 : codeOrder).padStart(3, '0'),
    issue.code,
    issue.canonicalId ?? '',
  ].join('\0');
}

function commentIssueCoalesceIdentity(issue: DocumentIntegrityCommentFailure): string {
  const identity = { ...issue } as Record<string, unknown>;
  delete identity.detail;
  delete identity.firstOccurrenceOrdinal;
  delete identity.sourceEventOrdinal;
  delete identity.occurrenceCount;
  return JSON.stringify(identity);
}

function isStrictlyOrdered<T>(values: readonly T[], key: (value: T) => string): boolean {
  return values.every((value, index) => index === 0 || key(values[index - 1]!) < key(value));
}

function evidenceStringBytes(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + evidenceStringBytes(item), 0);
  if (isRecord(value)) {
    return Object.values(value).reduce<number>((sum, item) => sum + evidenceStringBytes(item), 0);
  }
  return 0;
}

function isRelationshipId(value: unknown): value is string {
  return isBoundedString(value, 128) &&
    /^[A-Za-z_][A-Za-z0-9._-]*$/u.test(value);
}

function isRawRelationshipTarget(value: unknown): value is string {
  return isBoundedString(value, 256) &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function isNormalizedPartPath(value: unknown): value is string {
  if (!isBoundedString(value, 256) || value.length === 0 ||
      value.startsWith('/') || value.includes('\\') ||
      value.includes('?') || value.includes('#') || value.includes(':')) return false;
  const segments = value.split('/');
  return segments.length > 1 && segments[0] === 'word' &&
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' &&
      !/[\u0000-\u001f\u007f]/u.test(segment));
}

function isNoteIdentity(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ['relationshipId', 'normalizedPartPath']) &&
    isRelationshipId(value.relationshipId) &&
    isNormalizedPartPath(value.normalizedPartPath);
}

function isDefinitionStory(value: unknown, expectedKind: string): value is LeanDefinitionStoryJson {
  if (!isRecord(value) ||
      !hasExactKeys(value, ['kind', 'partPresent'], ['relationship']) ||
      value.kind !== expectedKind || typeof value.partPresent !== 'boolean') return false;
  const hasRelationship = 'relationship' in value;
  return (!hasRelationship && value.partPresent === false) ||
    (hasRelationship && isNoteIdentity(value.relationship));
}

function isReferenceSource(value: unknown, expectedOrdinal: number): boolean {
  if (!isRecord(value) ||
      !hasExactKeys(value, ['sourceOrdinal', 'sourceStory', 'normalizedPartPath'], ['physicalStoryOrdinal']) ||
      value.sourceOrdinal !== expectedOrdinal ||
      !['main', 'header', 'footer'].includes(value.sourceStory as string) ||
      !isBoundedString(value.normalizedPartPath, 256)) return false;
  if (expectedOrdinal === 0) {
    return value.sourceStory === 'main' && value.normalizedPartPath === 'word/document.xml' &&
      !('physicalStoryOrdinal' in value);
  }
  return value.sourceStory !== 'main' &&
    isNonnegativeInteger(value.physicalStoryOrdinal, 383);
}

function isPartition(value: unknown, expectedSide: string): value is DocumentIntegrityReferenceSourcePartition {
  if (!isRecord(value) ||
      !hasExactKeys(value, ['side', 'status', 'sources', 'definitionStories']) ||
      value.side !== expectedSide || !['complete', 'incomplete'].includes(value.status as string) ||
      !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 385 ||
      !value.sources.every((source, index) => isReferenceSource(source, index)) ||
      !Array.isArray(value.definitionStories) || value.definitionStories.length !== 2) return false;
  return isDefinitionStory(value.definitionStories[0], 'footnotes') &&
    isDefinitionStory(value.definitionStories[1], 'endnotes');
}

function isNoteStory(value: unknown, expectedKind: string): value is LeanNoteStoryJson {
  if (!isRecord(value) ||
      !hasExactKeys(value, [
        'kind', 'status', 'original', 'revised', 'compared', 'parsedTokenCounts',
      ], ['report']) ||
      value.kind !== expectedKind || !NOTE_STATUSES.includes(value.status as never) ||
      !isDefinitionStory(value.original, expectedKind) ||
      !isDefinitionStory(value.revised, expectedKind) ||
      !isDefinitionStory(value.compared, expectedKind) ||
      !isCounts(value.parsedTokenCounts)) return false;
  const evaluated = value.status !== 'not_evaluated';
  if (evaluated !== ('report' in value) ||
      (evaluated && !isReport(value.report))) return false;
  if (!evaluated) {
    const counts = value.parsedTokenCounts as LeanStoryJson['parsedTokenCounts'];
    return counts.original === 0 && counts.revised === 0 && counts.combined === 0;
  }
  return (value.report as { passed: boolean }).passed === (value.status === 'passed');
}

function isDefinitionCounts(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ['user', 'separator', 'continuationSeparator', 'continuationNotice']) &&
    Object.values(value).every((count) => isNonnegativeInteger(count, 4096));
}

function isNoteInventory(value: unknown, expectedSide: string, expectedKind: string): boolean {
  if (!isRecord(value) ||
      !hasExactKeys(value, [
        'side', 'kind', 'status', 'referenceOccurrences', 'uniqueReferenceIds',
        'definitions', 'forbiddenDefinitionStoryReferences',
      ], ['relationship']) ||
      value.side !== expectedSide || value.kind !== expectedKind ||
      !NOTE_STATUSES.includes(value.status as never) ||
      !isNonnegativeInteger(value.referenceOccurrences, 8192) ||
      !isNonnegativeInteger(value.uniqueReferenceIds, 4096) ||
      !isDefinitionCounts(value.definitions) ||
      !isNonnegativeInteger(value.forbiddenDefinitionStoryReferences, 4096) ||
      ('relationship' in value && !isNoteIdentity(value.relationship))) return false;
  if (value.status === 'not_evaluated') {
    return value.referenceOccurrences === 0 && value.uniqueReferenceIds === 0 &&
      value.forbiddenDefinitionStoryReferences === 0 &&
      Object.values(value.definitions as Record<string, number>).every((count) => count === 0);
  }
  return true;
}

function isIssueSource(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['sourceStory', 'sourceStoryOrdinal']) ||
      !['main', 'header', 'footer', 'footnotes', 'endnotes'].includes(value.sourceStory as string)) {
    return false;
  }
  if (value.sourceStory === 'header' || value.sourceStory === 'footer') {
    return isNonnegativeInteger(value.sourceStoryOrdinal, 383);
  }
  return value.sourceStoryOrdinal === 0;
}

function isNoteIssue(value: unknown): boolean {
  if (!isRecord(value) ||
      !hasExactKeys(value, [
        'code', 'side', 'kind', 'detail', 'ordinalSpace', 'firstOccurrenceOrdinal',
        'occurrenceCount',
      ], [
        'source', 'canonicalId', 'rawId', 'rawIdByteLength', 'rawIdDigest',
        'referencedKind', 'relationshipId', 'rawTarget', 'normalizedPartPath',
      ]) ||
      !NOTE_ISSUE_CODES.has(value.code as string) ||
      !SIDES.includes(value.side as never) || !NOTE_KINDS.includes(value.kind as never) ||
      !NOTE_ORDINAL_SPACES.includes(value.ordinalSpace as never) ||
      !isBoundedString(value.detail, 256) ||
      !isNonnegativeInteger(value.firstOccurrenceOrdinal, 8192) ||
      !isNonnegativeInteger(value.occurrenceCount, 8192) || value.occurrenceCount === 0) return false;
  const terminal = value.code === 'NOTE_ISSUE_LIMIT_EXCEEDED' ||
    value.code === 'NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED';
  if (terminal) {
    const expectedDetail = value.code === 'NOTE_ISSUE_LIMIT_EXCEEDED'
      ? 'protocol v5 aggregate ordinary issue limit exceeded'
      : 'protocol v5 escaped evidence string budget exceeded';
    return !('source' in value) && value.side === 'original' && value.kind === 'footnotes' &&
      value.ordinalSpace === 'aggregate' && value.firstOccurrenceOrdinal === 0 &&
      value.occurrenceCount === 1 && value.detail === expectedDetail &&
      !['canonicalId', 'rawId', 'rawIdByteLength', 'rawIdDigest', 'referencedKind',
        'relationshipId', 'rawTarget', 'normalizedPartPath'].some((key) => key in value);
  }
  if (value.ordinalSpace === 'aggregate') return false;
  if (!isIssueSource(value.source)) return false;
  if ('canonicalId' in value &&
      (!isBoundedString(value.canonicalId, 64) ||
       !/^(?:0|-?[1-9][0-9]*)$/.test(value.canonicalId as string))) return false;
  if ('rawId' in value && !isBoundedString(value.rawId, 64)) return false;
  if ('rawIdByteLength' in value && !isNonnegativeInteger(value.rawIdByteLength, 16 * 1024 * 1024)) return false;
  if ('rawIdDigest' in value &&
      (typeof value.rawIdDigest !== 'string' || !/^[0-9a-f]{8}$/.test(value.rawIdDigest))) return false;
  if ('referencedKind' in value && !NOTE_KINDS.includes(value.referencedKind as never)) return false;
  if ('relationshipId' in value && !isRelationshipId(value.relationshipId)) return false;
  if ('rawTarget' in value && !isRawRelationshipTarget(value.rawTarget)) return false;
  if ('normalizedPartPath' in value &&
      !isNormalizedPartPath(value.normalizedPartPath)) return false;
  const ordinalMaximum = {
    relationship: 1_024,
    source: 386,
    definition: 4_096,
    reference: 8_192,
    poison: 4_096,
  }[value.ordinalSpace as 'relationship' | 'source' | 'definition' | 'reference' | 'poison'];
  if (value.firstOccurrenceOrdinal > ordinalMaximum) return false;
  if (value.code === 'NOTE_ID_LEXICAL_LIMIT_EXCEEDED') {
    if ('rawId' in value || 'canonicalId' in value ||
        !('rawIdByteLength' in value) || !('rawIdDigest' in value)) return false;
  } else if ('rawIdByteLength' in value || 'rawIdDigest' in value) {
    return false;
  }
  const optionalKeys = [
    'canonicalId', 'rawId', 'rawIdByteLength', 'rawIdDigest', 'referencedKind',
    'relationshipId', 'rawTarget', 'normalizedPartPath',
  ] as const;
  const hasOnlyOptional = (allowed: readonly string[]) =>
    optionalKeys.every((key) => allowed.includes(key) || !(key in value));
  const source = value.source as { sourceStory: string; sourceStoryOrdinal: number };
  const sourceIsKind = source.sourceStory === value.kind && source.sourceStoryOrdinal === 0;
  const sourceIsValidReferenceStory = ['main', 'header', 'footer'].includes(source.sourceStory);
  const relationshipCodes = new Set([
    'NOTE_RELATIONSHIP_AMBIGUOUS', 'NOTE_RELATIONSHIP_EXTERNAL',
    'NOTE_RELATIONSHIP_INVALID_TARGET_MODE', 'NOTE_RELATIONSHIP_UNSAFE_TARGET',
    'NOTE_RELATIONSHIP_TARGET_LIMIT_EXCEEDED',
  ]);
  const partCodes = new Set([
    'NOTE_PART_MISSING', 'NOTE_PART_INVALID_UTF8', 'NOTE_PART_INVALID_XML',
    'NOTE_PART_ROOT_MISMATCH', 'NOTE_PART_LIMIT_EXCEEDED',
  ]);
  if (relationshipCodes.has(value.code as string)) {
    if (value.ordinalSpace !== 'relationship' || value.firstOccurrenceOrdinal >= 1_024 ||
        source.sourceStory !== 'main' || source.sourceStoryOrdinal !== 0) return false;
    if (value.code === 'NOTE_RELATIONSHIP_AMBIGUOUS') return hasOnlyOptional([]);
    if (value.code === 'NOTE_RELATIONSHIP_TARGET_LIMIT_EXCEEDED') {
      return 'relationshipId' in value &&
        hasOnlyOptional(['relationshipId']);
    }
    return 'relationshipId' in value && 'rawTarget' in value &&
      hasOnlyOptional(['relationshipId', 'rawTarget']);
  }
  if (value.code === 'NOTE_RELATIONSHIP_REQUIRED') {
    return value.ordinalSpace === 'relationship' && value.firstOccurrenceOrdinal === 1_024 &&
      sourceIsKind && hasOnlyOptional([]);
  }
  if (partCodes.has(value.code as string)) {
    return value.ordinalSpace === 'source' && sourceIsKind &&
      value.firstOccurrenceOrdinal <= 386 &&
      'normalizedPartPath' in value && hasOnlyOptional(['normalizedPartPath']);
  }
  if (value.code === 'NOTE_SOURCE_PARTITION_INCOMPLETE') {
    return value.ordinalSpace === 'source' && value.firstOccurrenceOrdinal <= 386 &&
      hasOnlyOptional([]);
  }
  if (value.code === 'NOTE_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED') {
    return value.ordinalSpace === 'reference' &&
      value.firstOccurrenceOrdinal === 8_192 &&
      value.occurrenceCount === 1 &&
      sourceIsValidReferenceStory &&
      value.detail === 'protocol v5 valid-source reference occurrence limit exceeded' &&
      hasOnlyOptional([]);
  }
  if (value.code === 'NOTE_UNIQUE_REFERENCE_LIMIT_EXCEEDED') {
    return value.ordinalSpace === 'reference' &&
      value.occurrenceCount === 1 &&
      sourceIsValidReferenceStory &&
      value.detail === 'protocol v5 unique note reference ID limit exceeded' &&
      'canonicalId' in value && hasOnlyOptional(['canonicalId']);
  }
  if (value.code === 'NOTE_DEFINITION_LIMIT_EXCEEDED') {
    return value.ordinalSpace === 'definition' &&
      value.firstOccurrenceOrdinal === 4_096 &&
      value.occurrenceCount === 1 &&
      sourceIsKind &&
      value.detail === 'protocol v5 direct note definition limit exceeded' &&
      hasOnlyOptional([]);
  }
  if (value.code === 'NOTE_POISON_REFERENCE_LIMIT_EXCEEDED') {
    return value.ordinalSpace === 'poison' &&
      value.firstOccurrenceOrdinal === 4_096 &&
      value.occurrenceCount === 1 &&
      sourceIsKind &&
      value.detail === 'protocol v5 definition-story reference limit exceeded' &&
      'referencedKind' in value && hasOnlyOptional(['referencedKind']);
  }
  if (value.code === 'NOTE_REFERENCE_IN_DEFINITION_STORY') {
    return value.ordinalSpace === 'poison' && sourceIsKind &&
      'referencedKind' in value && hasOnlyOptional(['referencedKind']);
  }
  if (value.code === 'NOTE_USER_DEFINITION_DUPLICATE') {
    return value.ordinalSpace === 'definition' && sourceIsKind &&
      'canonicalId' in value && hasOnlyOptional(['canonicalId']);
  }
  if (value.code === 'NOTE_REFERENCE_MISSING_DEFINITION') {
    return value.ordinalSpace === 'reference' && sourceIsValidReferenceStory &&
      'canonicalId' in value && hasOnlyOptional(['canonicalId']);
  }
  if (value.code === 'NOTE_TYPE_INVALID') {
    return value.ordinalSpace === 'definition' && sourceIsKind && hasOnlyOptional([]);
  }
  if (value.code === 'NOTE_ID_MISSING') {
    return ((value.ordinalSpace === 'definition' && sourceIsKind) ||
      (value.ordinalSpace === 'reference' && sourceIsValidReferenceStory) ||
      (value.ordinalSpace === 'poison' && sourceIsKind &&
        'referencedKind' in value)) &&
      hasOnlyOptional(value.ordinalSpace === 'poison' ? ['referencedKind'] : []);
  }
  if (value.code === 'NOTE_ID_INVALID_DECIMAL') {
    return ((value.ordinalSpace === 'definition' && sourceIsKind) ||
      (value.ordinalSpace === 'reference' && sourceIsValidReferenceStory) ||
      (value.ordinalSpace === 'poison' && sourceIsKind &&
        'referencedKind' in value)) &&
      'rawId' in value && hasOnlyOptional(
        value.ordinalSpace === 'poison' ? ['rawId', 'referencedKind'] : ['rawId']);
  }
  if (value.code === 'NOTE_ID_LEXICAL_LIMIT_EXCEEDED') {
    return ((value.ordinalSpace === 'definition' && sourceIsKind) ||
      (value.ordinalSpace === 'reference' && sourceIsValidReferenceStory) ||
      (value.ordinalSpace === 'poison' && sourceIsKind &&
        'referencedKind' in value)) &&
      hasOnlyOptional(value.ordinalSpace === 'poison'
        ? ['rawIdByteLength', 'rawIdDigest', 'referencedKind']
        : ['rawIdByteLength', 'rawIdDigest']);
  }
  return false;
}

function isCommentIdentity(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, [
      'relationshipId', 'relationshipRecordOrdinal', 'normalizedPartPath',
    ]) &&
    isRelationshipId(value.relationshipId) &&
    isNonnegativeInteger(value.relationshipRecordOrdinal, 1_023) &&
    isNormalizedPartPath(value.normalizedPartPath);
}

function isCommentStorySide(value: unknown): value is DocumentIntegrityCommentStorySide {
  if (!isRecord(value) ||
      !hasExactKeys(value, ['status', 'relationship', 'partPresent']) ||
      !COMMENT_STATUSES.includes(value.status as never) ||
      typeof value.partPresent !== 'boolean' ||
      !(value.relationship === null || isCommentIdentity(value.relationship))) return false;
  if (value.status === 'absent') return value.relationship === null && !value.partPresent;
  if (value.status === 'passed' || value.status === 'failed') {
    return value.relationship !== null && value.partPresent;
  }
  return true;
}

function isCommentStory(value: unknown): value is LeanCommentStoryJson {
  if (!isRecord(value) ||
      !hasExactKeys(value, [
        'status', 'original', 'revised', 'compared', 'parsedTokenCounts',
      ]) ||
      !['passed', 'failed', 'not_evaluated'].includes(value.status as string) ||
      !isCommentStorySide(value.original) || !isCommentStorySide(value.revised) ||
      !isCommentStorySide(value.compared) || !isCounts(value.parsedTokenCounts)) return false;
  const sides = [value.original, value.revised, value.compared] as const;
  const expected = sides.some((side) => side.status === 'not_evaluated')
    ? 'not_evaluated'
    : sides.some((side) => side.status === 'failed') ? 'failed' : 'passed';
  return value.status === expected;
}

function isCommentInventory(
  value: unknown,
  expectedSide: (typeof SIDES)[number],
): value is DocumentIntegrityCommentInventory {
  if (!isRecord(value) ||
      !hasExactKeys(value, [
        'side', 'status', 'relationship', 'referenceOccurrences',
        'rangeStartOccurrences', 'rangeEndOccurrences', 'uniqueReferenceIds',
        'definitions', 'unreferencedDefinitions', 'nonDirectDefinitions',
      ]) ||
      value.side !== expectedSide ||
      !['passed', 'failed', 'not_evaluated'].includes(value.status as string) ||
      !(value.relationship === null || isCommentIdentity(value.relationship)) ||
      !isNonnegativeInteger(value.referenceOccurrences, 4_096) ||
      !isNonnegativeInteger(value.rangeStartOccurrences, 4_096) ||
      !isNonnegativeInteger(value.rangeEndOccurrences, 4_096) ||
      !isNonnegativeInteger(value.uniqueReferenceIds, 4_096) ||
      !isNonnegativeInteger(value.definitions, 4_096) ||
      !isNonnegativeInteger(value.unreferencedDefinitions, 4_096) ||
      !isNonnegativeInteger(value.nonDirectDefinitions, 4_096)) return false;
  if ((value.uniqueReferenceIds as number) >
        (value.referenceOccurrences as number) +
        (value.rangeStartOccurrences as number) +
        (value.rangeEndOccurrences as number) ||
      (value.unreferencedDefinitions as number) > (value.definitions as number)) return false;
  if (value.status === 'passed' &&
      ((value.uniqueReferenceIds as number) !== (value.referenceOccurrences as number) ||
        (value.rangeStartOccurrences as number) !== (value.rangeEndOccurrences as number) ||
        (value.rangeStartOccurrences as number) > (value.uniqueReferenceIds as number) ||
        (value.definitions as number) !==
          (value.uniqueReferenceIds as number) + (value.unreferencedDefinitions as number) ||
        value.nonDirectDefinitions !== 0)) return false;
  return value.status !== 'not_evaluated' ||
    [value.referenceOccurrences, value.rangeStartOccurrences, value.rangeEndOccurrences,
      value.uniqueReferenceIds, value.definitions, value.unreferencedDefinitions,
      value.nonDirectDefinitions].every((count) => count === 0);
}

function isCanonicalDecimalId(value: unknown): value is string {
  return isBoundedString(value, 64) &&
    (value === '0' || /^-?[1-9][0-9]*$/u.test(value));
}

export function isCommentIssue(value: unknown): value is DocumentIntegrityCommentFailure {
  if (!isRecord(value) ||
      !hasExactKeys(value, [
        'code', 'side', 'kind', 'detail', 'ordinalSpace',
        'firstOccurrenceOrdinal', 'occurrenceCount',
      ], [
        'source', 'sourceSetOrdinal', 'sourceEventOrdinal', 'relatedSource',
        'relatedSourceSetOrdinal', 'relatedSourceEventOrdinal', 'canonicalId',
        'rawId', 'rawIdByteLength', 'relationshipId', 'rawTarget',
        'rawTargetByteLength', 'targetMode', 'normalizedPartPath',
        'rangeEndEventOrdinal',
      ]) ||
      !COMMENT_ISSUE_CODES.has(value.code as string) ||
      !SIDES.includes(value.side as never) || value.kind !== 'comments' ||
      !isBoundedString(value.detail, 256) ||
      !['relationship', 'source', 'definition', 'rangeStart', 'rangeEnd', 'reference', 'aggregate']
        .includes(value.ordinalSpace as string) ||
      !isNonnegativeInteger(value.firstOccurrenceOrdinal, 4_096) ||
      !isNonnegativeInteger(value.occurrenceCount, 4_096) ||
      value.occurrenceCount === 0) return false;
  const isSource = (source: unknown, comments: boolean): source is Record<string, unknown> =>
    isRecord(source) &&
    hasExactKeys(source, ['sourceStory', 'sourceStoryOrdinal']) &&
    [...(comments ? ['comments'] : []), 'main', 'header', 'footer', 'footnotes', 'endnotes']
      .includes(source.sourceStory as string) &&
    isNonnegativeInteger(source.sourceStoryOrdinal, 383) &&
    (source.sourceStory === 'header' || source.sourceStory === 'footer'
      ? true
      : source.sourceStoryOrdinal === 0);
  if ('source' in value && !isSource(value.source, true)) return false;
  if ('relatedSource' in value && !isSource(value.relatedSource, false)) return false;
  if ('sourceSetOrdinal' in value &&
      !isNonnegativeInteger(value.sourceSetOrdinal, 386)) return false;
  if ('relatedSourceSetOrdinal' in value &&
      !isNonnegativeInteger(value.relatedSourceSetOrdinal, 386)) return false;
  if ('sourceEventOrdinal' in value &&
      !isNonnegativeInteger(value.sourceEventOrdinal, 499_999)) return false;
  if ('relatedSourceEventOrdinal' in value &&
      !isNonnegativeInteger(value.relatedSourceEventOrdinal, 499_999)) return false;
  if ('rangeEndEventOrdinal' in value &&
      !isNonnegativeInteger(value.rangeEndEventOrdinal, 499_999)) return false;
  if ('canonicalId' in value && !isCanonicalDecimalId(value.canonicalId)) return false;
  if ('rawId' in value && !isBoundedString(value.rawId, 64)) return false;
  if ('rawIdByteLength' in value &&
      (!isNonnegativeInteger(value.rawIdByteLength, 16_777_216) ||
        value.rawIdByteLength < 65)) return false;
  if ('relationshipId' in value && !isRelationshipId(value.relationshipId)) return false;
  if ('rawTarget' in value && !isBoundedString(value.rawTarget, 256)) return false;
  if ('rawTargetByteLength' in value &&
      !isNonnegativeInteger(value.rawTargetByteLength)) return false;
  if ('targetMode' in value && !isBoundedString(value.targetMode, 16)) return false;
  if ('normalizedPartPath' in value && !isNormalizedPartPath(value.normalizedPartPath)) return false;
  const terminal = value.code === 'COMMENT_ISSUE_LIMIT_EXCEEDED' ||
    value.code === 'COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED';
  if (terminal) {
    const expectedDetail = value.code === 'COMMENT_ISSUE_LIMIT_EXCEEDED'
      ? 'protocol v7 aggregate ordinary issue limit exceeded'
      : 'protocol v7 escaped evidence string budget exceeded';
    const terminalExtras = [
      'source', 'sourceSetOrdinal', 'sourceEventOrdinal', 'relatedSource',
      'relatedSourceSetOrdinal', 'relatedSourceEventOrdinal', 'canonicalId',
      'rawId', 'rawIdByteLength', 'relationshipId', 'rawTarget',
      'rawTargetByteLength', 'targetMode', 'normalizedPartPath',
      'rangeEndEventOrdinal',
    ] as const;
    return value.ordinalSpace === 'aggregate' && value.side === 'original' &&
      value.detail === expectedDetail &&
      value.firstOccurrenceOrdinal === 0 && value.occurrenceCount === 1 &&
      terminalExtras.every((key) => !(key in value));
  }
  if (!('source' in value)) return false;
  const source = value.source as Record<string, unknown>;
  const sourceStory = source.sourceStory as string;
  const sourceOrdinal = source.sourceStoryOrdinal as number;
  if ((sourceStory === 'main' || sourceStory === 'footnotes' ||
      sourceStory === 'endnotes' || sourceStory === 'comments') &&
      sourceOrdinal !== 0) return false;
  const optionalKeys = [
    'sourceSetOrdinal', 'sourceEventOrdinal', 'relatedSource',
    'relatedSourceSetOrdinal', 'relatedSourceEventOrdinal', 'canonicalId',
    'rawId', 'rawIdByteLength', 'relationshipId', 'rawTarget',
    'rawTargetByteLength', 'targetMode', 'normalizedPartPath',
    'rangeEndEventOrdinal',
  ] as const;
  const hasExactExtras = (required: readonly string[]) =>
    required.every((key) => key in value) &&
    optionalKeys.every((key) => required.includes(key) || !(key in value));
  const noExtras = new Set([
    'COMMENT_RELATIONSHIP_AMBIGUOUS', 'COMMENT_SOURCE_PARTITION_INCOMPLETE',
    'COMMENT_DEFINITION_ID_MISSING',
    'COMMENT_DEFINITION_LIMIT_EXCEEDED',
    'COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED',
  ]);
  const identityPathCodes = new Set([
    'COMMENT_PART_MISSING', 'COMMENT_SELECTED_PART_LIMIT_EXCEEDED',
    'COMMENT_TRIPLE_SELECTED_PART_LIMIT_EXCEEDED',
    'COMMENT_PART_COMPRESSED_LIMIT_EXCEEDED', 'COMMENT_PART_EXPANDED_LIMIT_EXCEEDED',
    'COMMENT_PART_RATIO_LIMIT_EXCEEDED', 'COMMENT_CUMULATIVE_COMPRESSED_LIMIT_EXCEEDED',
    'COMMENT_CUMULATIVE_EXPANDED_LIMIT_EXCEEDED',
    'COMMENT_TRIPLE_COMPRESSED_LIMIT_EXCEEDED',
    'COMMENT_TRIPLE_EXPANDED_LIMIT_EXCEEDED', 'COMMENT_PART_EXTRACTION_FAILED',
    'COMMENT_PART_INVALID_UTF8', 'COMMENT_PART_INVALID_XML',
    'COMMENT_PART_XML_DEPTH_LIMIT_EXCEEDED', 'COMMENT_PART_XML_EVENT_LIMIT_EXCEEDED',
    'COMMENT_CUMULATIVE_XML_EVENT_LIMIT_EXCEEDED',
    'COMMENT_TRIPLE_XML_EVENT_LIMIT_EXCEEDED', 'COMMENT_PART_ROOT_MISMATCH',
  ]);
  const relationshipCodes = new Set([
    'COMMENT_RELATIONSHIP_AMBIGUOUS', 'COMMENT_RELATIONSHIP_EXTERNAL',
    'COMMENT_RELATIONSHIP_INVALID_TARGET_MODE',
    'COMMENT_RELATIONSHIP_TARGET_LIMIT_EXCEEDED',
    'COMMENT_RELATIONSHIP_UNSAFE_TARGET',
  ]);
  const definitionCodes = new Set([
    'COMMENT_DEFINITION_ID_MISSING', 'COMMENT_DEFINITION_ID_MALFORMED',
    'COMMENT_DEFINITION_ID_TOO_LONG', 'COMMENT_DEFINITION_LIMIT_EXCEEDED',
    'COMMENT_DEFINITION_NOT_DIRECT',
    'COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED',
    'COMMENT_DEFINITION_DUPLICATE',
  ]);
  const referenceCodes = new Set([
    'COMMENT_RELATIONSHIP_REQUIRED', 'COMMENT_REFERENCE_ID_MISSING',
    'COMMENT_REFERENCE_ID_MALFORMED', 'COMMENT_REFERENCE_ID_TOO_LONG',
    'COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED',
  ]);
  const markerCodeSpace = new Map<string, 'rangeStart' | 'rangeEnd' | 'reference'>([
    ['COMMENT_REFERENCE_ID_MISSING', 'reference'],
    ['COMMENT_REFERENCE_ID_MALFORMED', 'reference'],
    ['COMMENT_REFERENCE_ID_TOO_LONG', 'reference'],
    ['COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED', 'reference'],
    ['COMMENT_RANGE_START_ID_MISSING', 'rangeStart'],
    ['COMMENT_RANGE_START_ID_MALFORMED', 'rangeStart'],
    ['COMMENT_RANGE_START_ID_TOO_LONG', 'rangeStart'],
    ['COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED', 'rangeStart'],
    ['COMMENT_RANGE_END_ID_MISSING', 'rangeEnd'],
    ['COMMENT_RANGE_END_ID_MALFORMED', 'rangeEnd'],
    ['COMMENT_RANGE_END_ID_TOO_LONG', 'rangeEnd'],
    ['COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED', 'rangeEnd'],
  ]);
  const topologyCodes = new Set([
    'COMMENT_REFERENCE_DUPLICATE', 'COMMENT_REFERENCE_MISSING',
    'COMMENT_RANGE_START_DUPLICATE', 'COMMENT_RANGE_END_DUPLICATE',
    'COMMENT_RANGE_START_ORPHANED', 'COMMENT_RANGE_END_ORPHANED',
    'COMMENT_RANGE_CROSS_STORY', 'COMMENT_RANGE_REVERSED',
  ]);
  const relationshipOrdinalCodes = new Set([
    ...relationshipCodes,
    ...identityPathCodes,
  ]);
  const referenceLimitCodes = new Set([
    'COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED',
  ]);
  const definitionLimitCodes = new Set([
    'COMMENT_DEFINITION_LIMIT_EXCEEDED',
    'COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED',
  ]);
  const coalescedSemanticCodes = new Set([
    'COMMENT_DEFINITION_DUPLICATE',
    'COMMENT_DEFINITION_MISSING',
    'COMMENT_REFERENCE_DUPLICATE',
    'COMMENT_RANGE_START_DUPLICATE',
    'COMMENT_RANGE_END_DUPLICATE',
  ]);
  if (relationshipOrdinalCodes.has(value.code as string) &&
      (value.ordinalSpace !== 'relationship' ||
        value.firstOccurrenceOrdinal >= 1_024 ||
        value.occurrenceCount !== 1)) return false;
  if (value.code === 'COMMENT_SOURCE_PARTITION_INCOMPLETE' &&
      (value.ordinalSpace !== 'source' ||
        value.firstOccurrenceOrdinal > 386 ||
        value.occurrenceCount !== 1)) return false;
  if (referenceCodes.has(value.code as string) &&
      value.code !== 'COMMENT_RELATIONSHIP_REQUIRED' &&
      (value.ordinalSpace !== 'reference' ||
        (referenceLimitCodes.has(value.code as string)
          ? value.firstOccurrenceOrdinal !== 4_096
          : value.firstOccurrenceOrdinal >= 4_096) ||
        (!coalescedSemanticCodes.has(value.code as string) &&
          value.occurrenceCount !== 1))) return false;
  if (definitionCodes.has(value.code as string) &&
      (value.ordinalSpace !== 'definition' ||
        (definitionLimitCodes.has(value.code as string)
          ? value.firstOccurrenceOrdinal !== 4_096
          : value.firstOccurrenceOrdinal >= 4_096) ||
        (!coalescedSemanticCodes.has(value.code as string) &&
          value.occurrenceCount !== 1))) return false;
  if (value.code === 'COMMENT_RELATIONSHIP_TARGET_LIMIT_EXCEEDED' &&
      (!('rawTargetByteLength' in value) ||
        (value.rawTargetByteLength as number) <= 256)) return false;
  if ((value.code === 'COMMENT_REFERENCE_ID_TOO_LONG' ||
      value.code === 'COMMENT_RANGE_START_ID_TOO_LONG' ||
      value.code === 'COMMENT_RANGE_END_ID_TOO_LONG' ||
      value.code === 'COMMENT_DEFINITION_ID_TOO_LONG') &&
      (!('rawIdByteLength' in value) ||
        (value.rawIdByteLength as number) <= 64)) return false;
  if (relationshipCodes.has(value.code as string) &&
      (sourceStory !== 'main' || sourceOrdinal !== 0)) return false;
  if ((identityPathCodes.has(value.code as string) ||
      definitionCodes.has(value.code as string)) &&
      (sourceStory !== 'comments' || sourceOrdinal !== 0)) return false;
  if (referenceCodes.has(value.code as string) && sourceStory === 'comments') return false;
  const code = value.code as string;
  const markerSpace = markerCodeSpace.get(code);
  const markerLimit = code.endsWith('_OCCURRENCE_LIMIT_EXCEEDED');
  if (markerSpace !== undefined &&
      (value.ordinalSpace !== markerSpace ||
        (markerLimit
          ? value.firstOccurrenceOrdinal !== 4_096
          : value.firstOccurrenceOrdinal >= 4_096) ||
        value.occurrenceCount !== 1)) return false;
  if (value.code === 'COMMENT_RELATIONSHIP_REQUIRED' &&
      (!['rangeStart', 'rangeEnd', 'reference'].includes(value.ordinalSpace as string) ||
        value.firstOccurrenceOrdinal !== 0 || value.occurrenceCount !== 1)) return false;
  if (value.code === 'COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED' &&
      (!['rangeStart', 'rangeEnd', 'reference'].includes(value.ordinalSpace as string) ||
        value.firstOccurrenceOrdinal >= 4_096 || value.occurrenceCount !== 1)) return false;
  if (value.code === 'COMMENT_DEFINITION_MISSING' &&
      (!['rangeStart', 'rangeEnd', 'reference'].includes(value.ordinalSpace as string) ||
        value.firstOccurrenceOrdinal >= 4_096 || value.occurrenceCount !== 1)) return false;
  if (topologyCodes.has(code)) {
    const expectedSpace = code === 'COMMENT_REFERENCE_DUPLICATE'
      ? 'reference'
      : code === 'COMMENT_REFERENCE_MISSING'
        ? value.ordinalSpace
        : code.includes('START') || code === 'COMMENT_RANGE_REVERSED'
          ? 'rangeStart'
          : code.includes('END') ? 'rangeEnd' : value.ordinalSpace;
    if (value.ordinalSpace !== expectedSpace ||
        !['rangeStart', 'rangeEnd', 'reference'].includes(value.ordinalSpace as string) ||
        value.firstOccurrenceOrdinal >= 4_096 ||
        (!coalescedSemanticCodes.has(value.code as string) && value.occurrenceCount !== 1)) return false;
    if ([
      'COMMENT_REFERENCE_DUPLICATE',
      'COMMENT_RANGE_START_DUPLICATE',
      'COMMENT_RANGE_END_DUPLICATE',
    ].includes(code) && value.occurrenceCount > 4_095) return false;
    if (code === 'COMMENT_RANGE_CROSS_STORY') {
      if (!isRecord(value.source) || !isRecord(value.relatedSource) ||
          !isNonnegativeInteger(value.sourceSetOrdinal, 386) ||
          !isNonnegativeInteger(value.relatedSourceSetOrdinal, 386) ||
          !isNonnegativeInteger(value.sourceEventOrdinal, 499_999) ||
          !isNonnegativeInteger(value.relatedSourceEventOrdinal, 499_999)) return false;
      const source = value.source as Record<string, unknown>;
      const related = value.relatedSource as Record<string, unknown>;
      const sourceSetOrdinal = value.sourceSetOrdinal as number;
      const relatedSourceSetOrdinal = value.relatedSourceSetOrdinal as number;
      const sourceEventOrdinal = value.sourceEventOrdinal as number;
      const relatedSourceEventOrdinal = value.relatedSourceEventOrdinal as number;
      if (source.sourceStory === related.sourceStory &&
          source.sourceStoryOrdinal === related.sourceStoryOrdinal) return false;
      if (relatedSourceSetOrdinal < sourceSetOrdinal ||
          (relatedSourceSetOrdinal === sourceSetOrdinal &&
            relatedSourceEventOrdinal <= sourceEventOrdinal)) return false;
    }
    if (code === 'COMMENT_RANGE_REVERSED' &&
        (value.rangeEndEventOrdinal as number) >
          (value.sourceEventOrdinal as number)) return false;
  }
  const markerOrTopology = markerSpace !== undefined ||
    topologyCodes.has(value.code as string) ||
    value.code === 'COMMENT_RELATIONSHIP_REQUIRED' ||
    value.code === 'COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED' ||
    value.code === 'COMMENT_DEFINITION_MISSING';
  if (markerOrTopology &&
      (!('sourceSetOrdinal' in value) || !('sourceEventOrdinal' in value) ||
        sourceStory === 'comments')) return false;
  if (noExtras.has(value.code as string)) return hasExactExtras([]);
  if (identityPathCodes.has(value.code as string)) {
    return hasExactExtras(['relationshipId', 'normalizedPartPath']);
  }
  switch (value.code) {
    case 'COMMENT_RELATIONSHIP_EXTERNAL':
    case 'COMMENT_RELATIONSHIP_UNSAFE_TARGET':
      return hasExactExtras(['relationshipId', 'rawTarget']);
    case 'COMMENT_RELATIONSHIP_INVALID_TARGET_MODE':
      return hasExactExtras(['relationshipId', 'rawTarget', 'targetMode']);
    case 'COMMENT_RELATIONSHIP_TARGET_LIMIT_EXCEEDED':
      return hasExactExtras(['relationshipId', 'rawTargetByteLength']);
    case 'COMMENT_REFERENCE_ID_MALFORMED':
    case 'COMMENT_RANGE_START_ID_MALFORMED':
    case 'COMMENT_RANGE_END_ID_MALFORMED':
    case 'COMMENT_DEFINITION_ID_MALFORMED':
      return hasExactExtras(markerSpace === undefined
        ? ['rawId']
        : ['sourceSetOrdinal', 'sourceEventOrdinal', 'rawId']);
    case 'COMMENT_REFERENCE_ID_TOO_LONG':
    case 'COMMENT_RANGE_START_ID_TOO_LONG':
    case 'COMMENT_RANGE_END_ID_TOO_LONG':
    case 'COMMENT_DEFINITION_ID_TOO_LONG':
      return hasExactExtras(markerSpace === undefined
        ? ['rawIdByteLength']
        : ['sourceSetOrdinal', 'sourceEventOrdinal', 'rawIdByteLength']);
    case 'COMMENT_REFERENCE_ID_MISSING':
    case 'COMMENT_RANGE_START_ID_MISSING':
    case 'COMMENT_RANGE_END_ID_MISSING':
    case 'COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED':
    case 'COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED':
    case 'COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED':
    case 'COMMENT_RELATIONSHIP_REQUIRED':
      return hasExactExtras(['sourceSetOrdinal', 'sourceEventOrdinal']);
    case 'COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED':
    case 'COMMENT_REFERENCE_DUPLICATE':
    case 'COMMENT_REFERENCE_MISSING':
    case 'COMMENT_RANGE_START_DUPLICATE':
    case 'COMMENT_RANGE_END_DUPLICATE':
    case 'COMMENT_RANGE_START_ORPHANED':
    case 'COMMENT_RANGE_END_ORPHANED':
    case 'COMMENT_DEFINITION_DUPLICATE':
    case 'COMMENT_DEFINITION_MISSING':
      return hasExactExtras(markerOrTopology
        ? ['sourceSetOrdinal', 'sourceEventOrdinal', 'canonicalId']
        : ['canonicalId']);
    case 'COMMENT_RANGE_CROSS_STORY':
      return hasExactExtras([
        'sourceSetOrdinal', 'sourceEventOrdinal', 'relatedSource',
        'relatedSourceSetOrdinal', 'relatedSourceEventOrdinal', 'canonicalId',
      ]);
    case 'COMMENT_RANGE_REVERSED':
      return hasExactExtras([
        'sourceSetOrdinal', 'sourceEventOrdinal', 'canonicalId',
        'rangeEndEventOrdinal',
      ]);
    case 'COMMENT_DEFINITION_NOT_DIRECT':
      return hasExactExtras('canonicalId' in value ? ['canonicalId'] : []);
    default:
      return false;
  }
}

export function isLeanVerifierJson(value: unknown): value is LeanVerifierJson {
  if (!isRecord(value) || !hasExactKeys(value, [
    'protocolVersion', 'checker', 'passed', 'fixedStories', 'presenceMismatches',
    'fixedStoryIssues', 'relationshipSlots', 'relationshipStories', 'selectionIssues',
    'referenceSourcePartitions', 'noteStories', 'noteInventories', 'noteIntegrityIssues',
    'commentStory', 'commentInventories', 'commentIntegrityIssues',
  ])) return false;
  if (value.protocolVersion !== 7 ||
      value.checker !== 'safe-docx-lean-conventional-main-comment-range-integrity-checker' ||
      typeof value.passed !== 'boolean') return false;
  if (!Array.isArray(value.fixedStories) || !value.fixedStories.every(isFixedStory)) return false;
  const fixedNames = value.fixedStories.map((story) => story.name);
  if (fixedNames.length !== 1 || fixedNames[0] !== 'main') return false;
  if (!value.fixedStories[0]!.presence.original || !value.fixedStories[0]!.presence.revised ||
      !value.fixedStories[0]!.presence.combined) return false;
  if (!Array.isArray(value.presenceMismatches) || value.presenceMismatches.length !== 0) return false;
  if (!Array.isArray(value.fixedStoryIssues) || value.fixedStoryIssues.length !== 0) return false;
  if (!Array.isArray(value.relationshipSlots) || value.relationshipSlots.length > 384 ||
      !value.relationshipSlots.every(isSlot)) return false;
  if (!Array.isArray(value.relationshipStories) || value.relationshipStories.length > 384 ||
      !value.relationshipStories.every(isRelationshipStory)) return false;
  if (!Array.isArray(value.selectionIssues) ||
      value.selectionIssues.length > 511 ||
      !value.selectionIssues.every(isSelectionIssue)) return false;
  if (!Array.isArray(value.referenceSourcePartitions) ||
      value.referenceSourcePartitions.length !== 3 ||
      !value.referenceSourcePartitions.every((partition, index) =>
        isPartition(partition, SIDES[index]!))) return false;
  if (!Array.isArray(value.noteStories) || value.noteStories.length !== 2 ||
      !value.noteStories.every((story, index) => isNoteStory(story, NOTE_KINDS[index]!))) return false;
  if (!Array.isArray(value.noteInventories) || value.noteInventories.length !== 6 ||
      !value.noteInventories.every((inventory, index) =>
        isNoteInventory(inventory, SIDES[Math.floor(index / 2)]!, NOTE_KINDS[index % 2]!))) return false;
  if (!Array.isArray(value.noteIntegrityIssues) ||
      !value.noteIntegrityIssues.every(isNoteIssue)) return false;
  if (!isCommentStory(value.commentStory) ||
      !Array.isArray(value.commentInventories) || value.commentInventories.length !== 3 ||
      !value.commentInventories.every((inventory, index) =>
        isCommentInventory(inventory, SIDES[index]!)) ||
      !Array.isArray(value.commentIntegrityIssues) ||
      !value.commentIntegrityIssues.every(isCommentIssue) ||
      value.selectionIssues.length + value.noteIntegrityIssues.length +
        value.commentIntegrityIssues.length > 511) return false;

  const slots = value.relationshipSlots;
  if (slots.some((slot, index) => slot.slotOrdinal !== index ||
      (index > 0 && compareSlots(slots[index - 1]!, slot) >= 0))) return false;
  if (new Set(slots.map((slot) => `${slot.sectionOrdinal}:${slot.kind}:${slot.role}`)).size !== slots.length) {
    return false;
  }

  const stories = value.relationshipStories;
  if (stories.some((story, index) => story.physicalStoryOrdinal !== index)) return false;
  const selectedOrdinals = stories.flatMap((story) => story.selectingSlotOrdinals);
  if (selectedOrdinals.length !== slots.length ||
      new Set(selectedOrdinals).size !== slots.length ||
      selectedOrdinals.some((ordinal) => ordinal >= slots.length)) return false;
  for (const story of stories) {
    if (story.selectingSlotOrdinals.some((ordinal, index) =>
      index > 0 && story.selectingSlotOrdinals[index - 1]! >= ordinal)) return false;
    if (Math.min(...story.selectingSlotOrdinals) !== story.selectingSlotOrdinals[0]) return false;
    for (const ordinal of story.selectingSlotOrdinals) {
      const slot = slots[ordinal]!;
      if (slot.physicalStoryOrdinal !== story.physicalStoryOrdinal || slot.kind !== story.kind ||
          slot.original.normalizedPartPath !== story.originalPartPath ||
          slot.revised.normalizedPartPath !== story.revisedPartPath ||
          slot.compared.normalizedPartPath !== story.comparedPartPath) return false;
    }
  }
  const physicalKeys = stories.map((story) =>
    `${story.kind}\0${story.originalPartPath}\0${story.revisedPartPath}\0${story.comparedPartPath}`);
  if (new Set(physicalKeys).size !== physicalKeys.length) return false;
  for (const sidePath of ['originalPartPath', 'revisedPartPath', 'comparedPartPath'] as const) {
    if (new Set(stories.map((story) => story[sidePath])).size > 256) return false;
  }
  if (stories.some((story, index) => index > 0 &&
      story.selectingSlotOrdinals[0]! <= stories[index - 1]!.selectingSlotOrdinals[0]!)) return false;

  if (new Set(value.selectionIssues.map(issueIdentity)).size !== value.selectionIssues.length ||
      new Set(value.noteIntegrityIssues.map(noteIssueCoalesceIdentity)).size !==
        value.noteIntegrityIssues.length ||
      new Set(value.commentIntegrityIssues.map(commentIssueCoalesceIdentity)).size !==
        value.commentIntegrityIssues.length) return false;
  if (!isStrictlyOrdered(value.selectionIssues, selectionIssueOrder) ||
      !isStrictlyOrdered(value.noteIntegrityIssues, noteIssueOrder) ||
      !isStrictlyOrdered(value.commentIntegrityIssues, commentIssueOrder)) return false;
  const terminalIssues = value.commentIntegrityIssues.filter((issue) =>
    issue.code === 'COMMENT_ISSUE_LIMIT_EXCEEDED' ||
    issue.code === 'COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED');
  const evidenceBytes = evidenceStringBytes(value);
  if (terminalIssues.length === 0
    ? evidenceBytes > MAX_ORDINARY_EVIDENCE_STRING_BYTES
    : evidenceBytes > MAX_EVIDENCE_STRING_BYTES) return false;
  if (terminalIssues.length > 0 && (
    value.commentIntegrityIssues.length !== 1 ||
    value.noteIntegrityIssues.length !== 0 ||
    value.selectionIssues.length !== 0 ||
    value.fixedStories.length !== 1 ||
    value.fixedStories[0]!.name !== 'main' ||
    value.relationshipSlots.length !== 0 ||
    value.relationshipStories.length !== 0 ||
    value.referenceSourcePartitions.some((partition) =>
      partition.status !== 'incomplete' || partition.sources.length !== 1 ||
      partition.definitionStories.some((story) =>
        story.partPresent || story.relationship !== undefined)) ||
    value.noteStories.some((story) => story.status !== 'not_evaluated' ||
      story.original.partPresent || story.original.relationship !== undefined ||
      story.revised.partPresent || story.revised.relationship !== undefined ||
      story.compared.partPresent || story.compared.relationship !== undefined) ||
    value.noteInventories.some((inventory) => inventory.status !== 'not_evaluated' ||
      inventory.relationship !== undefined) ||
    value.commentStory.status !== 'not_evaluated' ||
    value.commentInventories.some((inventory) =>
      inventory.status !== 'not_evaluated' || inventory.relationship !== null) ||
    value.passed
  )) return false;
  for (let sideIndex = 0; sideIndex < 3; sideIndex += 1) {
    const partition = value.referenceSourcePartitions[sideIndex]!;
    const inventories = value.noteInventories.slice(sideIndex * 2, sideIndex * 2 + 2);
    if (partition.status === 'incomplete' &&
        inventories.some((inventory) => inventory.status !== 'not_evaluated')) return false;
    if (partition.status === 'complete' &&
        inventories.some((inventory) => inventory.status === 'not_evaluated')) return false;
    const sideKey = SIDES[sideIndex]!;
    const expectedPhysicalSources = value.relationshipStories.map((story, physicalStoryOrdinal) => ({
      sourceOrdinal: physicalStoryOrdinal + 1,
      sourceStory: story.kind,
      physicalStoryOrdinal,
      normalizedPartPath: story[`${sideKey}PartPath` as
        'originalPartPath' | 'revisedPartPath' | 'comparedPartPath'],
    }));
    if (partition.sources.length !== expectedPhysicalSources.length + 1 ||
        partition.sources.slice(1).some((source, index) => {
      const expected = expectedPhysicalSources[index];
      return !expected ||
        source.sourceOrdinal !== expected.sourceOrdinal ||
        source.sourceStory !== expected.sourceStory ||
        source.physicalStoryOrdinal !== expected.physicalStoryOrdinal ||
        source.normalizedPartPath !== expected.normalizedPartPath;
    })) return false;
    for (let kindIndex = 0; kindIndex < 2; kindIndex += 1) {
      const definition = partition.definitionStories[kindIndex]!;
      const inventory = inventories[kindIndex] as unknown as Record<string, unknown>;
      const story = value.noteStories[kindIndex] as unknown as Record<string, unknown>;
      const storySide = story[sideKey];
      if (JSON.stringify(definition) !== JSON.stringify(storySide)) return false;
      if (JSON.stringify(definition.relationship) !== JSON.stringify(inventory.relationship)) return false;
      if (definition.partPresent && !definition.relationship) return false;
      if ((partition.status === 'complete' || inventory.status !== 'not_evaluated') &&
          ('relationship' in definition) !== definition.partPresent) return false;
    }
  }
  for (const issue of value.noteIntegrityIssues) {
    if (issue.code === 'NOTE_ISSUE_LIMIT_EXCEEDED' ||
        issue.code === 'NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED') continue;
    const record = issue as unknown as Record<string, unknown>;
    const source = record.source as Record<string, unknown>;
    const sourceStory = source.sourceStory as string;
    const sourceOrdinal = source.sourceStoryOrdinal as number;
    const relationshipCode = issue.code.startsWith('NOTE_RELATIONSHIP_');
    const partCode = issue.code.startsWith('NOTE_PART_');
    if (relationshipCode && issue.code !== 'NOTE_RELATIONSHIP_REQUIRED' &&
        (sourceStory !== 'main' || sourceOrdinal !== 0)) return false;
    if (issue.code === 'NOTE_RELATIONSHIP_REQUIRED' &&
        (sourceStory !== issue.kind || sourceOrdinal !== 0 ||
         issue.firstOccurrenceOrdinal !== 1_024)) return false;
    if ((partCode || issue.ordinalSpace === 'definition' || issue.ordinalSpace === 'poison') &&
        (sourceStory !== issue.kind || sourceOrdinal !== 0)) return false;
    if (issue.code === 'NOTE_SOURCE_PARTITION_INCOMPLETE') {
      const sideIndex = SIDES.indexOf(issue.side);
      const partition = value.referenceSourcePartitions[sideIndex]!;
      const sourceIssueOrdinal = issue.firstOccurrenceOrdinal;
      const expected = sourceIssueOrdinal < partition.sources.length
        ? (() => {
            const candidate = partition.sources[sourceIssueOrdinal]!;
            return {
              sourceStory: candidate.sourceStory,
              sourceStoryOrdinal: candidate.sourceStory === 'main'
                ? 0
                : candidate.physicalStoryOrdinal!,
            };
          })()
        : (() => {
            const definitionIndex = sourceIssueOrdinal - partition.sources.length;
            const candidate = partition.definitionStories[definitionIndex];
            return candidate?.partPresent
              ? { sourceStory: candidate.kind, sourceStoryOrdinal: 0 }
              : undefined;
          })();
      if (!expected || expected.sourceStory !== sourceStory ||
          expected.sourceStoryOrdinal !== sourceOrdinal) return false;
      const firstSourceFailure = value.noteIntegrityIssues
        .filter((candidate) => candidate.side === issue.side &&
          candidate.ordinalSpace === 'source')
        .reduce((minimum, candidate) =>
          Math.min(minimum, candidate.firstOccurrenceOrdinal), Number.POSITIVE_INFINITY);
      if (issue.firstOccurrenceOrdinal !== firstSourceFailure) return false;
    }
    if (issue.ordinalSpace === 'reference') {
      const sideIndex = SIDES.indexOf(issue.side);
      const sources = value.referenceSourcePartitions[sideIndex]!.sources;
      const matchingSource = sources.some((candidate) =>
        candidate.sourceStory === sourceStory &&
        (candidate.sourceStory === 'main'
          ? sourceOrdinal === 0
          : candidate.physicalStoryOrdinal === sourceOrdinal));
      if (!matchingSource) return false;
    }
    const sideIndex = SIDES.indexOf(issue.side);
    const sideInventories = value.noteInventories.slice(sideIndex * 2, sideIndex * 2 + 2);
    const containingInventory = sideInventories[NOTE_KINDS.indexOf(issue.kind)];
    if (!containingInventory || containingInventory.status === 'passed') return false;
    if (issue.code === 'NOTE_REFERENCE_IN_DEFINITION_STORY' &&
        issue.referencedKind !== issue.kind) {
      const referencedInventory = sideInventories[NOTE_KINDS.indexOf(issue.referencedKind!)];
      if (!referencedInventory || referencedInventory.status === 'passed') return false;
    }
  }
  for (const inventory of value.noteInventories) {
    if (inventory.status !== 'failed') continue;
    const hasApplicableIssue = value.noteIntegrityIssues.some((issue) =>
      issue.side === inventory.side &&
      (issue.kind === inventory.kind ||
        (issue.code === 'NOTE_REFERENCE_IN_DEFINITION_STORY' &&
          issue.referencedKind === inventory.kind)));
    if (!hasApplicableIssue) return false;
  }
  for (let sideIndex = 0; sideIndex < 3; sideIndex += 1) {
    const side = SIDES[sideIndex]!;
    const storySide = value.commentStory[side];
    const inventory = value.commentInventories[sideIndex]!;
    if (storySide.relationship === null
      ? inventory.relationship !== null
      : JSON.stringify(storySide.relationship) !== JSON.stringify(inventory.relationship)) return false;
    if (storySide.status === 'absent' &&
        (inventory.status !== 'passed' || inventory.relationship !== null ||
          inventory.referenceOccurrences !== 0 || inventory.rangeStartOccurrences !== 0 ||
          inventory.rangeEndOccurrences !== 0 || inventory.definitions !== 0)) return false;
    if (storySide.status !== 'absent' && storySide.status !== inventory.status) return false;
    if (inventory.status === 'failed' &&
        !value.commentIntegrityIssues.some((issue) => issue.side === side)) return false;
    if (inventory.status === 'passed' &&
        value.commentIntegrityIssues.some((issue) => issue.side === side)) return false;
  }
  const semanticCommentCodes = new Set([
    'COMMENT_REFERENCE_ID_MISSING', 'COMMENT_REFERENCE_ID_MALFORMED',
    'COMMENT_REFERENCE_ID_TOO_LONG',
    'COMMENT_RANGE_START_ID_MISSING', 'COMMENT_RANGE_START_ID_MALFORMED',
    'COMMENT_RANGE_START_ID_TOO_LONG', 'COMMENT_RANGE_END_ID_MISSING',
    'COMMENT_RANGE_END_ID_MALFORMED', 'COMMENT_RANGE_END_ID_TOO_LONG',
    'COMMENT_DEFINITION_ID_MISSING', 'COMMENT_DEFINITION_ID_MALFORMED',
    'COMMENT_DEFINITION_ID_TOO_LONG', 'COMMENT_DEFINITION_NOT_DIRECT',
    'COMMENT_DEFINITION_DUPLICATE', 'COMMENT_DEFINITION_MISSING',
    'COMMENT_REFERENCE_DUPLICATE', 'COMMENT_REFERENCE_MISSING',
    'COMMENT_RANGE_START_DUPLICATE', 'COMMENT_RANGE_END_DUPLICATE',
    'COMMENT_RANGE_START_ORPHANED', 'COMMENT_RANGE_END_ORPHANED',
    'COMMENT_RANGE_REVERSED', 'COMMENT_RANGE_CROSS_STORY',
  ]);
  for (const issue of value.commentIntegrityIssues) {
    if (issue.code === 'COMMENT_ISSUE_LIMIT_EXCEEDED' ||
        issue.code === 'COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED') continue;
    const sideIndex = SIDES.indexOf(issue.side);
    const storySide = value.commentStory[issue.side];
    const inventory = value.commentInventories[sideIndex]!;
    const expectedStatus = semanticCommentCodes.has(issue.code)
      ? 'failed'
      : 'not_evaluated';
    if (storySide.status !== expectedStatus || inventory.status !== expectedStatus) return false;

    const source = issue.source!;
    const canonicalSources = [
      { sourceStory: 'main', sourceStoryOrdinal: 0 },
      ...value.relationshipStories.map((story) => ({
        sourceStory: story.kind,
        sourceStoryOrdinal: story.physicalStoryOrdinal,
      })),
      ...value.noteStories.flatMap((story) => {
        const sideStory = story[issue.side];
        return sideStory.partPresent
          ? [{ sourceStory: story.kind, sourceStoryOrdinal: 0 }]
          : [];
      }),
    ];
    if ('sourceSetOrdinal' in issue) {
      const exact = canonicalSources[issue.sourceSetOrdinal!];
      if (!exact || exact.sourceStory !== source.sourceStory ||
          exact.sourceStoryOrdinal !== source.sourceStoryOrdinal) return false;
    }
    if ('relatedSourceSetOrdinal' in issue) {
      const exact = canonicalSources[issue.relatedSourceSetOrdinal!];
      if (!exact || !issue.relatedSource ||
          exact.sourceStory !== issue.relatedSource.sourceStory ||
          exact.sourceStoryOrdinal !== issue.relatedSource.sourceStoryOrdinal) return false;
    }
    if (issue.code === 'COMMENT_SOURCE_PARTITION_INCOMPLETE') {
      const exact = canonicalSources[issue.firstOccurrenceOrdinal];
      if (!exact || exact.sourceStory !== source.sourceStory ||
          exact.sourceStoryOrdinal !== source.sourceStoryOrdinal) return false;
    }
    if (issue.ordinalSpace === 'reference' &&
        !canonicalSources.some((candidate) =>
          candidate.sourceStory === source.sourceStory &&
          candidate.sourceStoryOrdinal === source.sourceStoryOrdinal)) return false;
    if (issue.code === 'COMMENT_DEFINITION_DUPLICATE' &&
        issue.occurrenceCount > Math.max(0, inventory.definitions - 1)) return false;
    if (issue.code === 'COMMENT_DEFINITION_MISSING' &&
        issue.occurrenceCount > inventory.referenceOccurrences +
          inventory.rangeStartOccurrences! + inventory.rangeEndOccurrences!) return false;
  }
  const expectedPassed = value.selectionIssues.length === 0 && value.noteIntegrityIssues.length === 0 &&
    value.commentIntegrityIssues.length === 0 &&
    value.presenceMismatches.length === 0 &&
    value.fixedStories.every((story) => story.report.passed) &&
    value.relationshipStories.every((story) => story.report.passed) &&
    value.referenceSourcePartitions.every((partition) => partition.status === 'complete') &&
    value.noteStories.every((story) => story.status === 'passed') &&
    value.noteInventories.every((inventory) => inventory.status === 'passed') &&
    value.commentStory.status === 'passed' &&
    value.commentInventories.every((inventory) => inventory.status === 'passed');
  return value.passed === expectedPassed;
}

class CanonicalJsonScanner {
  private offset = 0;

  constructor(private readonly input: string) {}

  parse(): void {
    this.parseValue();
    if (this.offset !== this.input.length) {
      throw new Error('Lean verifier JSON has trailing bytes');
    }
  }

  private current(): string | undefined {
    return this.input[this.offset];
  }

  private consume(expected: string): void {
    if (!this.input.startsWith(expected, this.offset)) {
      throw new Error(`Lean verifier JSON expected ${expected} at byte ${this.offset}`);
    }
    this.offset += expected.length;
  }

  private parseValue(): void {
    const token = this.current();
    if (token === '{') this.parseObject();
    else if (token === '[') this.parseArray();
    else if (token === '"') this.parseString();
    else if (token === 't') this.consume('true');
    else if (token === 'f') this.consume('false');
    else if (token === 'n') this.consume('null');
    else if (token === '-' || (token !== undefined && token >= '0' && token <= '9')) {
      this.parseNumber();
    } else {
      throw new Error(`Lean verifier JSON has an invalid token at byte ${this.offset}`);
    }
  }

  private parseObject(): void {
    this.consume('{');
    if (this.current() === '}') {
      this.offset++;
      return;
    }
    let previousKey: string | undefined;
    const keys = new Set<string>();
    while (true) {
      if (this.current() !== '"') {
        throw new Error(`Lean verifier JSON object key is not a string at byte ${this.offset}`);
      }
      const key = this.parseString();
      if (keys.has(key)) {
        throw new Error(`Lean verifier JSON contains duplicate object key ${JSON.stringify(key)}`);
      }
      if (previousKey !== undefined && previousKey >= key) {
        throw new Error('Lean verifier JSON object keys are not in canonical order');
      }
      keys.add(key);
      previousKey = key;
      this.consume(':');
      this.parseValue();
      if (this.current() === '}') {
        this.offset++;
        return;
      }
      this.consume(',');
    }
  }

  private parseArray(): void {
    this.consume('[');
    if (this.current() === ']') {
      this.offset++;
      return;
    }
    while (true) {
      this.parseValue();
      if (this.current() === ']') {
        this.offset++;
        return;
      }
      this.consume(',');
    }
  }

  private parseString(): string {
    const start = this.offset;
    this.consume('"');
    while (true) {
      const token = this.current();
      if (token === undefined) throw new Error('Lean verifier JSON has an unterminated string');
      if (token === '"') {
        this.offset++;
        return JSON.parse(this.input.slice(start, this.offset)) as string;
      }
      if (token.charCodeAt(0) < 0x20) {
        throw new Error('Lean verifier JSON string contains an unescaped control character');
      }
      if (token === '\\') {
        this.offset++;
        const escape = this.current();
        if (escape === undefined || !'"\\/bfnrtu'.includes(escape)) {
          throw new Error('Lean verifier JSON string contains an invalid escape');
        }
        this.offset++;
        if (escape === 'u') {
          const digits = this.input.slice(this.offset, this.offset + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
            throw new Error('Lean verifier JSON string contains an invalid Unicode escape');
          }
          this.offset += 4;
        }
      } else {
        this.offset++;
      }
    }
  }

  private parseNumber(): void {
    const rest = this.input.slice(this.offset);
    const match = /^-?(?:0|[1-9]\d*)/.exec(rest);
    if (!match) throw new Error(`Lean verifier JSON has an invalid number at byte ${this.offset}`);
    this.offset += match[0].length;
  }
}

export function validateCanonicalProtocolJson(raw: string): void {
  new CanonicalJsonScanner(raw).parse();
  const parsed = JSON.parse(raw) as unknown;
  if (JSON.stringify(parsed) !== raw) {
    throw new Error('Lean verifier JSON is not in the canonical wire encoding');
  }
}

function runExecutable(
  executablePath: string,
  payload: string,
  timeoutMs: number,
  tempRoot: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const child = spawn(executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached,
      env: { ...process.env, SAFE_DOCX_LEAN_TEMP_ROOT: tempRoot },
    });
    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    const killTree = () => {
      if (child.pid && detached) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          // The process group may already have exited.
        }
      }
      if (child.pid && process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore', windowsHide: true,
        });
        return;
      }
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_RESPONSE_BYTES) killTree();
      else stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderrBytes += Buffer.byteLength(chunk, 'utf8');
      if (stderrBytes > MAX_STDERR_BYTES) killTree();
      else stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(timedOut ? new Error(`Lean relationship-story checker timed out after ${timeoutMs}ms`) : error);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (timedOut) reject(new Error(`Lean relationship-story checker timed out after ${timeoutMs}ms`));
      else if (stdoutBytes > MAX_RESPONSE_BYTES || stderrBytes > MAX_STDERR_BYTES) {
        reject(new Error('Lean relationship-story checker exceeded protocol output limits'));
      } else if (code === 0) {
        const stdoutBuffer = Buffer.concat(stdoutChunks);
        let stdout: string;
        try {
          stdout = new TextDecoder('utf-8', { fatal: true }).decode(stdoutBuffer);
        } catch {
          reject(new Error('Lean relationship-story checker emitted invalid UTF-8'));
          return;
        }
        if (stdoutBuffer.at(-1) !== 0x0a ||
            stdoutBuffer.length - 1 > MAX_RESPONSE_JSON_BYTES ||
            stdoutBytes !== stdoutBuffer.length) {
          reject(new Error('Lean relationship-story checker violated the protocol-v7 stdout envelope'));
        } else {
          resolve(stdout);
        }
      }
      else reject(new Error(`Lean relationship-story checker exited with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(payload);
  });
}

interface LeanXmlVerifierSupervisorDependencies {
  removeRoot: (path: string) => Promise<void>;
}

const DEFAULT_SUPERVISOR_DEPENDENCIES: LeanXmlVerifierSupervisorDependencies = {
  removeRoot: (path) => rm(path, { recursive: true, force: true }),
};

async function removeVerifierRoot(
  path: string,
  dependencies: LeanXmlVerifierSupervisorDependencies,
): Promise<void> {
  try {
    await dependencies.removeRoot(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Lean verifier private temporary-root cleanup failed for ${path}: ${detail}`, {
      cause: error,
    });
  }
}

function baseCertificate(input: LeanVerifierInput): Omit<
  DocumentIntegrityCertificate,
  'status' | 'stories' | 'checks'
> {
  return {
    verifier: 'Lean XML triple checker',
    protocolVersion: 1,
    scope: 'word/document.xml',
    reconstructionMode: input.reconstructionMode,
    inputSha256: {
      originalDocumentXml: sha256(input.legacyDocumentXml.original),
      revisedDocumentXml: sha256(input.legacyDocumentXml.revised),
      comparedDocumentXml: sha256(input.legacyDocumentXml.compared),
    },
    inputPackageSha256: {
      originalDocx: sha256(input.originalDocx),
      revisedDocx: sha256(input.revisedDocx),
      comparedDocx: sha256(input.comparedDocx),
    },
    exclusions: [
      'ECMA-permitted unmatched comment endpoint point anchors and Microsoft threaded-comment extensions',
      'inherited header/footer role semantics and unselected package parts',
      'complete relationship, OPC, content-type, and XML Schema validation',
      'association of individual moveFrom or moveTo wrapper revision IDs with move ranges',
      'pagination, rendering, field evaluation, and full ECMA-376 validation',
    ],
  };
}

async function runLeanXmlTripleVerifierWithDependencies(
  input: LeanVerifierInput,
  dependencies: LeanXmlVerifierSupervisorDependencies,
): Promise<DocumentIntegrityCertificate> {
  const snapshot: LeanVerifierInput = {
    ...input,
    originalDocx: Buffer.from(input.originalDocx),
    revisedDocx: Buffer.from(input.revisedDocx),
    comparedDocx: Buffer.from(input.comparedDocx),
    legacyDocumentXml: { ...input.legacyDocumentXml },
    options: { ...input.options },
  };
  const base = baseCertificate(snapshot);
  if (snapshot.reconstructionMode !== 'inplace') {
    return {
      ...base,
      status: 'not_applicable',
      stories: [],
      checks: unevaluatedChecks(),
      reason: 'Lean relationship-story verification covers inplace comparison output only.',
    };
  }

  const executablePath = snapshot.options.executablePath ??
    process.env.SAFE_DOCX_LEAN_XML_CHECKER ?? DEFAULT_EXECUTABLE;
  const timeoutMs = snapshot.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let scratch: string | undefined;
  try {
    scratch = await mkdtemp(join(tmpdir(), 'safe-docx-lean-verifier-'));
    await chmod(scratch, 0o700);
    const originalDocxPath = join(scratch, 'original.docx');
    const revisedDocxPath = join(scratch, 'revised.docx');
    const comparedDocxPath = join(scratch, 'compared.docx');
    await Promise.all([
      writeFile(originalDocxPath, snapshot.originalDocx),
      writeFile(revisedDocxPath, snapshot.revisedDocx),
      writeFile(comparedDocxPath, snapshot.comparedDocx),
    ]);
    const payload = JSON.stringify({
      protocolVersion: 7, originalDocxPath, revisedDocxPath, comparedDocxPath,
    });
    if (Buffer.byteLength(payload, 'utf8') > 64 * 1024) throw new Error('Lean verifier request exceeds 64 KiB');
    const stdout = await runExecutable(executablePath, payload, timeoutMs, scratch);
    const rawJson = stdout.slice(0, -1);
    validateCanonicalProtocolJson(rawJson);
    const parsed: unknown = JSON.parse(rawJson);
    if (!isLeanVerifierJson(parsed)) {
      throw new Error('Lean relationship-story checker returned an unexpected JSON shape');
    }
    const stories = parsed.fixedStories.map(storyCertificate);
    const mainReport = parsed.fixedStories[0]!;
    const main = stories[0]!;
    return {
      ...base,
      checkerProtocolVersion: 7,
      status: parsed.passed ? 'passed' : 'failed',
      stories,
      checks: {
        acceptingAllTrackedChangesMatchesRevisedText:
          main.checks.acceptingAllTrackedChangesMatchesRevisedText,
        rejectingAllTrackedChangesMatchesOriginalText:
          main.checks.rejectingAllTrackedChangesMatchesOriginalText,
        acceptingAllTrackedChangesKeepsValidFieldStructure:
          main.checks.acceptingAllTrackedChangesKeepsValidFieldStructure,
        rejectingAllTrackedChangesKeepsValidFieldStructure:
          main.checks.rejectingAllTrackedChangesKeepsValidFieldStructure,
        comparedDocumentHasNoFieldMarkersInsideDeletions:
          main.checks.comparedStoryHasNoFieldMarkersInsideDeletions,
        trackedMoveRangesAreCorrectlyPaired: check(
          mainReport.report.checks.combinedHasValidMoveRanges,
          'Tracked move range markers are structurally paired by range ID and move name.'
        ),
      },
      parsedTokenCounts: main.parsedTokenCounts,
      presenceMismatches: [],
      fixedStoryFailures: parsed.fixedStoryIssues,
      relationshipStoryScope: {
        selection: 'direct-explicit-section-bindings',
        alignment: 'sectionOrdinal-kind-role',
        kinds: ['header', 'footer'],
        roles: ['first', 'default', 'even'],
        inheritedRoles: false,
        reconstructionMode: 'inplace',
      },
      relationshipSlots: parsed.relationshipSlots,
      relationshipStories: parsed.relationshipStories.map(relationshipStoryCertificate),
      relationshipSelectionFailures: parsed.selectionIssues,
      noteStoryScope: {
        selection: 'fixed-word-document-main-relationships',
        mainDocumentPart: 'word/document.xml',
        relationshipsPart: 'word/_rels/document.xml.rels',
        alignment: 'semantic-note-kind',
        namespaces: 'transitional',
        reconstructionMode: 'inplace',
      },
      referenceSourcePartitions: parsed.referenceSourcePartitions,
      noteStories: parsed.noteStories.map((story): DocumentIntegrityNoteStory => ({
        kind: story.kind,
        status: story.status,
        original: story.original,
        revised: story.revised,
        compared: story.compared,
        parsedTokenCounts: {
          original: story.parsedTokenCounts.original,
          revised: story.parsedTokenCounts.revised,
          compared: story.parsedTokenCounts.combined,
        },
      })),
      noteInventories: parsed.noteInventories,
      noteIntegrityFailures: parsed.noteIntegrityIssues,
      commentStoryScope: {
        selection: 'fixed-word-document-main-relationships',
        mainDocumentPart: 'word/document.xml',
        relationshipsPart: 'word/_rels/document.xml.rels',
        referenceStories: 'admitted-main-note-header-footer-stories',
        namespaces: 'transitional',
        reconstructionMode: 'inplace',
        rangeTopology: false,
        threadedComments: false,
      },
      commentRangeTopology: {
        checkerProtocolVersion: 7,
        crossParagraphRanges: true,
        crossingRanges: true,
        ecmaUnmatchedEndpointPointAnchorsAccepted: false,
        profile: 'safe-docx-paired-or-point',
        samePhysicalStoryRequired: true,
        status: parsed.commentStory.status,
      },
      commentStory: {
        status: parsed.commentStory.status,
        original: parsed.commentStory.original,
        revised: parsed.commentStory.revised,
        compared: parsed.commentStory.compared,
        parsedTokenCounts: {
          original: parsed.commentStory.parsedTokenCounts.original,
          revised: parsed.commentStory.parsedTokenCounts.revised,
          compared: parsed.commentStory.parsedTokenCounts.combined,
        },
      },
      commentInventories: parsed.commentInventories,
      commentIntegrityFailures: parsed.commentIntegrityIssues,
      fixedStoryScope: parsed.noteStories.every((story) =>
        story.status !== 'not_evaluated' &&
        story.original.partPresent && story.revised.partPresent && story.compared.partPresent &&
        story.original.relationship?.normalizedPartPath === `word/${story.kind}.xml` &&
        story.revised.relationship?.normalizedPartPath === `word/${story.kind}.xml` &&
        story.compared.relationship?.normalizedPartPath === `word/${story.kind}.xml`) &&
        parsed.noteInventories.every((inventory) => inventory.relationship?.normalizedPartPath ===
          `word/${inventory.kind}.xml`)
        ? ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']
        : undefined,
      exclusions: base.exclusions,
      reason: parsed.passed ? undefined :
        'One or more fixed, relationship-selected, note-integrity, or comment-integrity checks failed.',
    };
  } catch (error) {
    return {
      ...base,
      status: 'not_run',
      stories: [],
      checks: unevaluatedChecks(),
      reason: error instanceof Error ? error.message : 'Lean relationship-story checker failed',
    };
  } finally {
    if (scratch) await removeVerifierRoot(scratch, dependencies);
  }
}

/**
 * Runs the compiled verifier for decimal comment IDs, range anchors, and
 * reference marks across retained physical WordprocessingML stories.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.18.10
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.13.4.3 — Safe-DOCX rejects orphan endpoints under its stronger paired-or-point verification profile
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.13.4.4 — Safe-DOCX rejects orphan range starts under its stronger paired-or-point verification profile
 * @see https://github.com/UseJunior/safe-docx/issues/729
 */
export function runLeanXmlTripleVerifier(
  input: LeanVerifierInput,
): Promise<DocumentIntegrityCertificate> {
  return runLeanXmlTripleVerifierWithDependencies(input, DEFAULT_SUPERVISOR_DEPENDENCIES);
}

/** @internal Test-only entry point; dependencies are scoped to one invocation. */
export function runLeanXmlTripleVerifierForTest(
  input: LeanVerifierInput,
  dependencies: LeanXmlVerifierSupervisorDependencies,
): Promise<DocumentIntegrityCertificate> {
  return runLeanXmlTripleVerifierWithDependencies(input, dependencies);
}
