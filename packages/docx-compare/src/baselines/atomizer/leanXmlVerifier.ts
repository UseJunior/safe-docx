import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DocumentIntegrityCertificate,
  DocumentIntegrityCheckCertificate,
  DocumentIntegrityFixedStoryFailure,
  DocumentIntegrityRelationshipSelectionFailure,
  DocumentIntegrityRelationshipSlot,
  DocumentIntegrityRelationshipStory,
  DocumentIntegrityStoryCertificate,
  LeanXmlVerifierOptions,
  ReconstructionMode,
} from '../../compare-types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_EXECUTABLE = 'verification/lean/.lake/build/bin/leanDocxChecker';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_EVIDENCE_STRING_BYTES = 1024 * 1024;

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
  protocolVersion: 4;
  checker: 'safe-docx-lean-relationship-story-checker';
  passed: boolean;
  fixedStories: LeanStoryJson[];
  presenceMismatches: [];
  fixedStoryIssues: DocumentIntegrityFixedStoryFailure[];
  relationshipSlots: DocumentIntegrityRelationshipSlot[];
  relationshipStories: LeanRelationshipStoryJson[];
  selectionIssues: DocumentIntegrityRelationshipSelectionFailure[];
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
const FIXED_ISSUE_CODES = new Set([
  'OPTIONAL_STORY_PART_LIMIT_EXCEEDED', 'OPTIONAL_STORY_AGGREGATE_LIMIT_EXCEEDED',
  'OPTIONAL_STORY_INVALID_UTF8', 'OPTIONAL_STORY_INVALID_XML',
  'OPTIONAL_STORY_ROOT_MISMATCH', 'OPTIONAL_STORY_XML_DEPTH_LIMIT_EXCEEDED',
  'OPTIONAL_STORY_XML_TOKEN_LIMIT_EXCEEDED',
]);
const SIDES = ['original', 'revised', 'compared'] as const;
const KINDS = ['header', 'footer'] as const;
const ROLES = ['first', 'default', 'even'] as const;

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

function isFixedIssue(value: unknown): value is DocumentIntegrityFixedStoryFailure {
  return isRecord(value) && hasExactKeys(value, ['code', 'name', 'side', 'packagePart', 'detail']) &&
    FIXED_ISSUE_CODES.has(value.code as string) &&
    ['footnotes', 'endnotes'].includes(value.name as string) &&
    SIDES.includes(value.side as (typeof SIDES)[number]) &&
    value.packagePart === `word/${value.name}.xml` &&
    isBoundedString(value.detail, 256);
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

function fixedIssueOrder(issue: DocumentIntegrityFixedStoryFailure): string {
  return [
    issue.name === 'footnotes' ? '0' : '1',
    String(SIDES.indexOf(issue.side)),
    issue.code,
  ].join('\0');
}

function isStrictlyOrdered<T>(values: readonly T[], key: (value: T) => string): boolean {
  return values.every((value, index) => index === 0 || key(values[index - 1]!) < key(value));
}

function evidenceStringBytes(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + evidenceStringBytes(item), 0);
  if (isRecord(value)) {
    return Object.values(value).reduce<number>((sum, item) => sum + evidenceStringBytes(item), 0);
  }
  return 0;
}

export function isLeanVerifierJson(value: unknown): value is LeanVerifierJson {
  if (!isRecord(value) || !hasExactKeys(value, [
    'protocolVersion', 'checker', 'passed', 'fixedStories', 'presenceMismatches',
    'fixedStoryIssues', 'relationshipSlots', 'relationshipStories', 'selectionIssues',
  ])) return false;
  if (value.protocolVersion !== 4 || value.checker !== 'safe-docx-lean-relationship-story-checker' ||
      typeof value.passed !== 'boolean') return false;
  if (!Array.isArray(value.fixedStories) || !value.fixedStories.every(isFixedStory)) return false;
  const fixedNames = value.fixedStories.map((story) => story.name);
  const expectedFixed = ['main', 'footnotes', 'endnotes'].filter((name) => fixedNames.includes(name as LeanStoryJson['name']));
  if (fixedNames[0] !== 'main' || fixedNames.some((name, index) => name !== expectedFixed[index]) ||
      new Set(fixedNames).size !== fixedNames.length) return false;
  if (!value.fixedStories[0]!.presence.original || !value.fixedStories[0]!.presence.revised ||
      !value.fixedStories[0]!.presence.combined) return false;
  if (!Array.isArray(value.presenceMismatches) || value.presenceMismatches.length !== 0) return false;
  if (!Array.isArray(value.fixedStoryIssues) || value.fixedStoryIssues.length > 1536 ||
      !value.fixedStoryIssues.every(isFixedIssue)) return false;
  if (!Array.isArray(value.relationshipSlots) || value.relationshipSlots.length > 384 ||
      !value.relationshipSlots.every(isSlot)) return false;
  if (!Array.isArray(value.relationshipStories) || value.relationshipStories.length > 384 ||
      !value.relationshipStories.every(isRelationshipStory)) return false;
  if (!Array.isArray(value.selectionIssues) ||
      value.selectionIssues.length + value.fixedStoryIssues.length > 1536 ||
      !value.selectionIssues.every(isSelectionIssue)) return false;

  for (const name of ['footnotes', 'endnotes'] as const) {
    const hasReport = value.fixedStories.some((story) => story.name === name);
    const hasIssue = value.fixedStoryIssues.some((issue) => issue.name === name);
    if (hasReport && hasIssue) return false;
  }

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
      new Set(value.fixedStoryIssues.map(issueIdentity)).size !== value.fixedStoryIssues.length) return false;
  if (!isStrictlyOrdered(value.selectionIssues, selectionIssueOrder) ||
      !isStrictlyOrdered(value.fixedStoryIssues, fixedIssueOrder)) return false;
  if (evidenceStringBytes(value) > MAX_EVIDENCE_STRING_BYTES) return false;
  const terminalIssues = value.selectionIssues.filter((issue) =>
    issue.code === 'ISSUE_LIMIT_EXCEEDED' || issue.code === 'EVIDENCE_STRING_BUDGET_EXCEEDED');
  if (terminalIssues.length > 0 && (
    value.selectionIssues.length !== 1 ||
    value.fixedStoryIssues.length !== 0 ||
    value.fixedStories.length !== 1 ||
    value.fixedStories[0]!.name !== 'main' ||
    value.relationshipSlots.length !== 0 ||
    value.relationshipStories.length !== 0 ||
    value.passed
  )) return false;
  const expectedPassed = value.selectionIssues.length === 0 && value.fixedStoryIssues.length === 0 &&
    value.presenceMismatches.length === 0 &&
    value.fixedStories.every((story) => story.report.passed) &&
    value.relationshipStories.every((story) => story.report.passed);
  return value.passed === expectedPassed;
}

function runExecutable(executablePath: string, payload: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const child = spawn(executablePath, [], { stdio: ['pipe', 'pipe', 'pipe'], detached });
    let stdout = '';
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
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk, 'utf8');
      if (stdoutBytes > MAX_RESPONSE_BYTES) killTree();
      else stdout += chunk;
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
      } else if (code === 0) resolve(stdout);
      else reject(new Error(`Lean relationship-story checker exited with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(payload);
  });
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
    fixedStoryScope: ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'],
    inputPackageSha256: {
      originalDocx: sha256(input.originalDocx),
      revisedDocx: sha256(input.revisedDocx),
      comparedDocx: sha256(input.comparedDocx),
    },
    exclusions: [
      'note-reference integrity',
      'inherited header/footer role semantics and unselected package parts',
      'complete relationship, OPC, content-type, and XML Schema validation',
      'association of individual moveFrom or moveTo wrapper revision IDs with move ranges',
      'pagination, rendering, field evaluation, and full ECMA-376 validation',
    ],
  };
}

export async function runLeanXmlTripleVerifier(input: LeanVerifierInput): Promise<DocumentIntegrityCertificate> {
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
    const originalDocxPath = join(scratch, 'original.docx');
    const revisedDocxPath = join(scratch, 'revised.docx');
    const comparedDocxPath = join(scratch, 'compared.docx');
    await Promise.all([
      writeFile(originalDocxPath, snapshot.originalDocx),
      writeFile(revisedDocxPath, snapshot.revisedDocx),
      writeFile(comparedDocxPath, snapshot.comparedDocx),
    ]);
    const payload = JSON.stringify({
      protocolVersion: 4, originalDocxPath, revisedDocxPath, comparedDocxPath,
    });
    if (Buffer.byteLength(payload, 'utf8') > 64 * 1024) throw new Error('Lean verifier request exceeds 64 KiB');
    const stdout = await runExecutable(executablePath, payload, timeoutMs);
    const parsed: unknown = JSON.parse(stdout);
    if (!isLeanVerifierJson(parsed)) {
      throw new Error('Lean relationship-story checker returned an unexpected JSON shape');
    }
    const stories = parsed.fixedStories.map(storyCertificate);
    const mainReport = parsed.fixedStories[0]!;
    const main = stories[0]!;
    return {
      ...base,
      checkerProtocolVersion: 4,
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
      reason: parsed.passed ? undefined : 'One or more fixed or selected relationship stories failed.',
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
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
