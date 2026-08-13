import JSZip from 'jszip';
import {
  DocxDocument,
  computeContentFingerprint,
  getParagraphRuns,
  type ReplacementPart,
} from '@usejunior/docx-core';
import { compareDocuments, compareFormattingFidelity, type FormattingFidelityReport } from '@usejunior/docx-compare';
import { DocxMarkdocError } from './errors.js';
import { sha256 } from './hash.js';
import { requireMarkdoc } from './markdoc.js';
import { assessDraftCompleteness } from './completeness.js';
import type {
  CompileResult,
  EditOperation,
  FormattingProjectionDiagnostic,
  FormattingProjectionReport,
  InsertOperation,
  MarkdocEditIR,
  RunFormat,
  VerificationCertificate,
} from './types.js';

const FORMATTING_DIAGNOSTIC_LIMIT = 8;

async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new DocxMarkdocError('VERIFICATION_FAILED', 'DOCX has no word/document.xml for formatting verification.');
  // Projection materialization can leave an empty direct rPr container in a
  // paragraph property block. It carries no formatting semantics but the
  // public comparator correctly treats a non-empty rPr as material; erase
  // only the syntactically empty form before handing XML to that comparator.
  return xml.replace(/<w:rPr\s*\/>|<w:rPr\s*>\s*<\/w:rPr>/gu, '');
}

function formattingDiagnostic(report: FormattingFidelityReport): FormattingProjectionDiagnostic {
  return {
    score: report.score,
    unalignedExpectedParagraphs: report.unalignedExpectedParagraphs,
    unalignedActualParagraphs: report.unalignedActualParagraphs,
    divergenceCount: report.divergences.length,
    divergences: report.divergences.slice(0, FORMATTING_DIAGNOSTIC_LIMIT).map((divergence) => ({
      scope: divergence.scope,
      property: divergence.property,
      kind: divergence.kind,
      expectedValue: divergence.expectedValue,
      actualValue: divergence.actualValue,
      paragraphIndex: divergence.paragraphIndex,
      textSample: divergence.textSample,
    })),
  };
}

function formattingEquivalent(report: FormattingFidelityReport): boolean {
  return report.score === 1
    && report.unalignedExpectedParagraphs === 0
    && report.unalignedActualParagraphs === 0
    && report.divergences.length === 0;
}

/**
 * Check the two projections that make up Markdoc replay certification.
 *
 * Source is intentionally compared only with reject-all and clean only with
 * accept-all: source ↔ clean contains authored edits and is not an invariant.
 */
export async function verifyFormattingProjections(
  source: Buffer,
  clean: Buffer,
  tracked: Buffer,
): Promise<{
  rejectAllFormattingEqualsSource: boolean;
  acceptAllFormattingEqualsClean: boolean;
  formattingProjections: FormattingProjectionReport;
}> {
  const [sourceXml, cleanXml] = await Promise.all([documentXml(source), documentXml(clean)]);
  const accepted = await DocxDocument.load(tracked);
  const rejected = await DocxDocument.load(tracked);
  await Promise.all([accepted.acceptChanges(), rejected.rejectChanges()]);
  const [acceptedXml, rejectedXml] = await Promise.all([
    documentXml((await accepted.toBuffer({ cleanBookmarks: false })).buffer),
    documentXml((await rejected.toBuffer({ cleanBookmarks: false })).buffer),
  ]);
  const sourceRejectAll = compareFormattingFidelity(sourceXml, rejectedXml);
  const cleanAcceptAll = compareFormattingFidelity(cleanXml, acceptedXml);
  return {
    rejectAllFormattingEqualsSource: formattingEquivalent(sourceRejectAll),
    acceptAllFormattingEqualsClean: formattingEquivalent(cleanAcceptAll),
    formattingProjections: {
      sourceRejectAll: formattingDiagnostic(sourceRejectAll),
      cleanAcceptAll: formattingDiagnostic(cleanAcceptAll),
    },
  };
}

export function projectionChecksPassed(checks: Pick<
  VerificationCertificate,
  | 'sourceSha256Matches'
  | 'scaffoldComplete'
  | 'paragraphFingerprintsMatch'
  | 'operationsAppliedExactlyOnce'
  | 'rejectAllEqualsSource'
  | 'acceptAllEqualsClean'
  | 'rejectAllFormattingEqualsSource'
  | 'acceptAllFormattingEqualsClean'
  | 'unchangedPackagePartsPreserved'
>): boolean {
  return checks.sourceSha256Matches
    && checks.scaffoldComplete
    && checks.paragraphFingerprintsMatch
    && checks.operationsAppliedExactlyOnce
    && checks.rejectAllEqualsSource
    && checks.acceptAllEqualsClean
    && checks.rejectAllFormattingEqualsSource
    && checks.acceptAllFormattingEqualsClean
    && checks.unchangedPackagePartsPreserved;
}

function verificationText(document: DocxDocument): string {
  // The comparison engine may legitimately move internal paragraph bookmarks
  // while preserving the rejected/accepted document text. Verification must
  // therefore use physical paragraph/run text, not treat the internal anchor
  // layout of a generated redline as operative content.
  return document.getParagraphs().map((paragraph) => getParagraphRuns(paragraph).map((run) => run.text).join('')).join('\n');
}

function directRunPropertySignature(run: Element): string {
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType === 1 && (child as Element).localName === 'rPr') return (child as Element).toString();
  }
  return '';
}

function assertAdmittedStructure(document: DocxDocument, id: string): Element {
  const paragraph = document.getParagraphElementById(id);
  if (!paragraph) throw new DocxMarkdocError('MISSING_ANCHOR', `Paragraph ${id} was not found.`);
  const unsupportedDescendants = new Set(['fldChar', 'instrText', 'hyperlink', 'sdt']);
  const encountered = Array.from(paragraph.getElementsByTagName('*'))
    .map((element) => element.localName)
    .filter((name) => unsupportedDescendants.has(name));
  if (encountered.length > 0) {
    throw new DocxMarkdocError(
      'UNSUPPORTED_EDIT_STRUCTURE',
      `Paragraph ${id} contains unsupported ${[...new Set(encountered)].sort().join(', ')} structure.`,
    );
  }
  return paragraph;
}

type TextHunk = { start: number; end: number; replacement: string };
type TextToken = { text: string; start: number; end: number };

function textTokens(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const pattern = /\s+|[\p{L}\p{N}\p{M}_]+|[^\s\p{L}\p{N}\p{M}_]/gu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    tokens.push({ text: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

/**
 * Produce minimal source ranges from an LCS alignment. The bounded matrix is
 * deliberate: formatting inheritance must fail closed instead of switching to
 * a heuristic for pathologically large, wholly rewritten paragraphs.
 */
function textHunks(before: string, after: string): TextHunk[] {
  const sourceTokens = textTokens(before);
  const revisedTokens = textTokens(after);
  const n = sourceTokens.length;
  const m = revisedTokens.length;
  if (n * m > 8_000_000) {
    throw new DocxMarkdocError(
      'FORMATTING_ALIGNMENT_TOO_COMPLEX',
      `Paragraph alignment requires ${n * m} cells; split the change into smaller source units.`,
    );
  }
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] = sourceTokens[i]!.text === revisedTokens[j]!.text
        ? 1 + lcs[(i + 1) * width + j + 1]!
        : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const result: TextHunk[] = [];
  let source = 0;
  let revised = 0;
  let open: TextHunk | null = null;
  const flush = (): void => {
    if (open) result.push(open);
    open = null;
  };
  while (source < n || revised < m) {
    if (source < n && revised < m && sourceTokens[source]!.text === revisedTokens[revised]!.text) {
      flush();
      source += 1;
      revised += 1;
    } else if (revised < m && (source === n || lcs[source * width + revised + 1]! >= lcs[(source + 1) * width + revised]!)) {
      const sourceOffset = source < n ? sourceTokens[source]!.start : before.length;
      open ??= { start: sourceOffset, end: sourceOffset, replacement: '' };
      open.replacement += revisedTokens[revised]!.text;
      revised += 1;
    } else {
      open ??= { start: sourceTokens[source]!.start, end: sourceTokens[source]!.start, replacement: '' };
      open.end = sourceTokens[source]!.end;
      source += 1;
    }
  }
  flush();
  return result;
}

type RunSpan = { start: number; end: number; run: Element; signature: string };

function runSpans(paragraph: Element): RunSpan[] {
  let offset = 0;
  return getParagraphRuns(paragraph).filter((run) => run.text.length > 0).map((run) => {
    const span = { start: offset, end: offset + run.text.length, run: run.r, signature: directRunPropertySignature(run.r) };
    offset = span.end;
    return span;
  });
}

function uniqueSourceTemplate(spans: RunSpan[], sourceText: string, needle: string, id: string): Element {
  const start = sourceText.indexOf(needle);
  if (!needle || start < 0 || sourceText.indexOf(needle, start + needle.length) >= 0) {
    throw new DocxMarkdocError('INVALID_FORMAT_SOURCE', `Paragraph ${id} format-source must identify one non-empty source substring.`);
  }
  const touched = spans.filter((span) => span.start < start + needle.length && span.end > start);
  const signatures = new Set(touched.map((span) => span.signature));
  if (touched.length === 0 || signatures.size !== 1) {
    throw new DocxMarkdocError('AMBIGUOUS_FORMAT_SOURCE', `Paragraph ${id} format-source crosses multiple run formats.`);
  }
  return touched[0]!.run;
}

function insertionFormatSource(document: DocxDocument, operation: InsertOperation): string | undefined {
  const sourceId = operation.styleSourceId ?? operation.anchorId;
  const paragraph = assertAdmittedStructure(document, sourceId);
  const sourceText = document.getParagraphTextById(sourceId);
  if (sourceText === null) throw new DocxMarkdocError('MISSING_ANCHOR', `Insertion formatting source ${sourceId} was not found.`);
  const spans = runSpans(paragraph);
  const signatures = new Set(spans.map((span) => span.signature));
  if (signatures.size <= 1) return operation.formatSource;
  if (operation.formatSource === undefined) {
    throw new DocxMarkdocError(
      'MIXED_FORMATTING_REQUIRES_DETAIL',
      `Insertion ${operation.operationId} uses mixed-format source ${sourceId}; set format-source to a unique source substring.`,
    );
  }
  uniqueSourceTemplate(spans, sourceText, operation.formatSource, sourceId);
  return operation.formatSource;
}

function templateForHunk(
  spans: RunSpan[],
  hunk: TextHunk,
  sourceText: string,
  id: string,
  explicit?: string,
): Element {
  if (explicit !== undefined) return uniqueSourceTemplate(spans, sourceText, explicit, id);
  const touched = spans.filter((span) => span.start < hunk.end && span.end > hunk.start);
  if (touched.length > 0) {
    const signatures = new Set(touched.map((span) => span.signature));
    if (signatures.size === 1) return touched[0]!.run;
  } else {
    const left = [...spans].reverse().find((span) => span.end <= hunk.start);
    const right = spans.find((span) => span.start >= hunk.start);
    if (left && right && left.signature === right.signature) return left.run;
    if (!left && right) return right.run;
    if (left && !right) return left.run;
  }
  throw new DocxMarkdocError(
    'MIXED_FORMATTING_REQUIRES_DETAIL',
    `Paragraph ${id} replacement crosses a formatting boundary; inspect normalized runs and set format-source to a unique source substring.`,
  );
}

function addRunProps(runFormat: RunFormat | undefined): ReplacementPart['addRunProps'] | undefined {
  if (!runFormat) return undefined;
  return {
    ...(runFormat.underline === undefined ? {} : { underline: runFormat.underline }),
    ...(runFormat.highlight === undefined ? {} : { highlight: runFormat.highlight }),
  };
}

function requireSingleGeneratedHunk(operationId: string, hunks: TextHunk[]): TextHunk {
  const generated = hunks.filter((hunk) => hunk.replacement.length > 0);
  if (generated.length !== 1) {
    throw new DocxMarkdocError(
      'AMBIGUOUS_RUN_FORMAT_SCOPE',
      `Operation ${operationId} run formatting requires exactly one generated replacement hunk.`,
    );
  }
  return generated[0]!;
}

function insertionTemplate(document: DocxDocument, operation: InsertOperation): Element {
  const sourceId = operation.styleSourceId ?? operation.anchorId;
  const paragraph = assertAdmittedStructure(document, sourceId);
  const sourceText = document.getParagraphTextById(sourceId);
  if (sourceText === null) throw new DocxMarkdocError('MISSING_ANCHOR', `Insertion formatting source ${sourceId} was not found.`);
  const spans = runSpans(paragraph);
  if (operation.formatSource !== undefined) return uniqueSourceTemplate(spans, sourceText, operation.formatSource, sourceId);
  if (spans.length === 0) throw new DocxMarkdocError('MIXED_FORMATTING_REQUIRES_DETAIL', `Insertion ${operation.operationId} has no source run template.`);
  return spans[0]!.run;
}

function replacePreservingMixedFormatting(
  document: DocxDocument,
  id: string,
  before: string,
  after: string,
  formatSource?: string,
  runFormat?: RunFormat,
): void {
  const paragraph = assertAdmittedStructure(document, id);
  const spans = runSpans(paragraph);
  const hunks = textHunks(before, after);
  const formatted = runFormat ? requireSingleGeneratedHunk(id, hunks) : undefined;
  for (const hunk of [...hunks].reverse()) {
    const replacement: ReplacementPart[] = hunk.replacement.length === 0
      ? []
      : [{
        text: hunk.replacement,
        templateRun: templateForHunk(spans, hunk, before, id, formatSource),
        addRunProps: hunk === formatted ? addRunProps(runFormat) : undefined,
      }];
    document.replaceTextAtRange({ targetParagraphId: id, start: hunk.start, end: hunk.end, replaceText: replacement });
  }
}

function validateRunFormatScopes(ir: MarkdocEditIR, source: DocxDocument): void {
  for (const operation of ir.operations) {
    if (!operation.runFormat) continue;
    if (isInsertOperation(operation)) {
      if (operation.revisedText.length === 0 || operation.revisedText.replace(/\r\n/gu, '\n').split(/\n{2,}/u).length !== 1) {
        throw new DocxMarkdocError(
          'AMBIGUOUS_RUN_FORMAT_SCOPE',
          `Operation ${operation.operationId} run formatting requires exactly one generated replacement hunk.`,
        );
      }
      insertionFormatSource(source, operation);
      insertionTemplate(source, operation);
      continue;
    }
    const original = source.getParagraphTextById(operation.id);
    if (original === null) throw new DocxMarkdocError('MISSING_ANCHOR', `Paragraph ${operation.id} was not found.`);
    requireSingleGeneratedHunk(operation.operationId, textHunks(original, operation.revisedText));
  }
}

function isInsertOperation(operation: EditOperation): operation is InsertOperation {
  return operation.kind === 'insert-before' || operation.kind === 'insert-after';
}

function sourceOperationId(operation: EditOperation): string | null {
  return isInsertOperation(operation) ? null : operation.id;
}

async function unchangedPartsEqual(source: Buffer, clean: Buffer): Promise<boolean> {
  const [a, b] = await Promise.all([JSZip.loadAsync(source), JSZip.loadAsync(clean)]);
  const names = new Set([...Object.keys(a.files), ...Object.keys(b.files)]);
  for (const name of names) {
    if (name === 'word/document.xml') continue;
    const left = a.file(name);
    const right = b.file(name);
    if (!left || !right) return false;
    const [leftBytes, rightBytes] = await Promise.all([left.async('uint8array'), right.async('uint8array')]);
    if (leftBytes.length !== rightBytes.length) return false;
    for (let i = 0; i < leftBytes.length; i += 1) if (leftBytes[i] !== rightBytes[i]) return false;
  }
  return true;
}

function validateAgainstSource(ir: MarkdocEditIR, source: DocxDocument): { unsupported: string[] } {
  const { nodes } = source.buildDocumentView({ includeSemanticTags: false, showFormatting: true });
  if (nodes.length !== ir.source.paragraphs || ir.scaffold.length !== nodes.length) {
    throw new DocxMarkdocError('SCAFFOLD_DRIFT', `Expected ${nodes.length} source paragraphs, found ${ir.scaffold.length}.`);
  }
  const replacements = new Map(ir.operations
    .filter((operation) => operation.kind === 'replace-source' || operation.kind === 'delete-source')
    .map((operation) => [sourceOperationId(operation), operation]));
  const unsupported = new Set<string>();
  nodes.forEach((node, index) => {
    const projected = ir.scaffold[index];
    if (!projected || projected.id !== node.id) {
      throw new DocxMarkdocError('SCAFFOLD_ORDER_DRIFT', `Scaffold position ${index} does not match source anchor ${node.id}.`);
    }
    const sourceText = node.raw_text ?? node.text;
    if (projected.fingerprint !== computeContentFingerprint(sourceText)) {
      throw new DocxMarkdocError('FINGERPRINT_DRIFT', `Paragraph ${node.id} fingerprint does not match source.`);
    }
    const replacement = replacements.get(node.id);
    // Source-anchored operations deliberately omit original text in Markdoc.
    // Hydrate both the scaffold and operation IR here so downstream archival /
    // SFT exports still receive the real minimal contrast. The first v1 build
    // (2026-08-12) resolved this text only during DOCX mutation, which produced
    // a correct redline but an empty `before` training operand.
    if (replacement) {
      projected.originalText = sourceText;
      replacement.originalText = sourceText;
    }
    if (!replacement && projected.originalText !== sourceText) {
      throw new DocxMarkdocError('SOURCE_TEXT_DRIFT', `Paragraph ${node.id} original projection does not match source.`);
    }
    if (node.table_context) unsupported.add('tables');
    if (node.footnote_refs?.length) unsupported.add('footnotes');
    if (node.comments?.length) unsupported.add('comments');
  });
  for (const operation of ir.operations) {
    const id = sourceOperationId(operation);
    if (!id) continue;
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node) throw new DocxMarkdocError('MISSING_ANCHOR', `Operation ${operation.operationId} targets missing paragraph ${id}.`);
    if (node.table_context || node.footnote_refs?.length || node.comments?.length) {
      throw new DocxMarkdocError('UNSUPPORTED_EDIT_STRUCTURE', `Operation ${operation.operationId} intersects unsupported structure at ${id}.`);
    }
  }
  for (const operation of ir.operations.filter(isInsertOperation)) {
    const anchor = nodes.find((candidate) => candidate.id === operation.anchorId);
    if (!anchor) {
      throw new DocxMarkdocError('MISSING_ANCHOR', `Operation ${operation.operationId} targets missing paragraph ${operation.anchorId}.`);
    }
    if (anchor.table_context || anchor.footnote_refs?.length || anchor.comments?.length) {
      throw new DocxMarkdocError('UNSUPPORTED_EDIT_STRUCTURE', `Operation ${operation.operationId} intersects unsupported structure at ${operation.anchorId}.`);
    }
    const styleSource = operation.styleSourceId
      ? nodes.find((candidate) => candidate.id === operation.styleSourceId)
      : anchor;
    if (!styleSource) {
      throw new DocxMarkdocError(
        'MISSING_STYLE_SOURCE',
        `Operation ${operation.operationId} names missing style source ${operation.styleSourceId}.`,
      );
    }
    if (styleSource.table_context || styleSource.footnote_refs?.length || styleSource.comments?.length) {
      throw new DocxMarkdocError(
        'UNSUPPORTED_EDIT_STRUCTURE',
        `Operation ${operation.operationId} style source ${styleSource.id} intersects unsupported structure.`,
      );
    }
    // A numbered insertion must state which existing list paragraph supplies
    // its pPr. Merely being adjacent to a list is not enough: the neighboring
    // paragraph may be a different level or a list terminator. DocxDocument
    // then clones that exact pPr, preserving numId, ilvl, style, and ind.
    if (anchor.numbering.is_auto_numbered && !operation.styleSourceId) {
      throw new DocxMarkdocError(
        'NUMBERED_INSERT_REQUIRES_STYLE_SOURCE',
        `Operation ${operation.operationId} inserts beside numbered paragraph ${anchor.id}; provide style-source explicitly.`,
      );
    }
  }
  return { unsupported: [...unsupported].sort() };
}

async function applyOperations(sourceBuffer: Buffer, ir: MarkdocEditIR): Promise<Buffer> {
  const document = await DocxDocument.load(sourceBuffer);
  for (const operation of ir.operations) {
    if (isInsertOperation(operation)) {
      const runStyleSourceText = insertionFormatSource(document, operation);
      const templateRun = operation.runFormat ? insertionTemplate(document, operation) : undefined;
      const inserted = document.insertParagraph({
        positionalAnchorNodeId: operation.anchorId,
        relativePosition: operation.kind === 'insert-before' ? 'BEFORE' : 'AFTER',
        newText: operation.revisedText,
        styleSourceId: operation.styleSourceId,
        runStyleSourceText,
      });
      if (operation.runFormat) {
        document.replaceTextAtRange({
          targetParagraphId: inserted.newParagraphId,
          start: 0,
          end: operation.revisedText.length,
          replaceText: [{
            text: operation.revisedText,
            templateRun,
            addRunProps: addRunProps(operation.runFormat),
          }],
        });
      }
      continue;
    }
    assertAdmittedStructure(document, operation.id);
    const original = document.getParagraphTextById(operation.id);
    if (original === null) throw new DocxMarkdocError('MISSING_ANCHOR', `Paragraph ${operation.id} was not found.`);
    if (operation.kind === 'delete-source') {
      const paragraph = document.getParagraphElementById(operation.id);
      paragraph?.parentNode?.removeChild(paragraph);
      continue;
    }
    replacePreservingMixedFormatting(
      document,
      operation.id,
      original,
      operation.revisedText,
      operation.kind === 'replace-source' ? operation.formatSource : undefined,
      operation.runFormat,
    );
  }
  return (await document.toBuffer({ cleanBookmarks: false })).buffer;
}

export async function compileMarkdoc(
  sourceBuffer: Buffer,
  markdoc: string,
  options: { author?: string; date?: Date } = {},
): Promise<CompileResult> {
  const ir = requireMarkdoc(markdoc);
  const sourceHashMatches = sha256(sourceBuffer) === ir.source.sha256;
  if (!sourceHashMatches) throw new DocxMarkdocError('SOURCE_HASH_DRIFT', 'Source DOCX hash does not match canonical Markdoc.');
  const sourceZip = await JSZip.loadAsync(sourceBuffer);
  const sourceXml = await sourceZip.file('word/document.xml')?.async('string');
  if (sourceXml && /<w:(?:ins|del|moveFrom|moveTo)\b/.test(sourceXml)) {
    throw new DocxMarkdocError('EXISTING_REVISIONS_UNSUPPORTED', 'V1 cannot compile a source DOCX that already contains tracked changes.');
  }
  const sourceDocument = await DocxDocument.load(sourceBuffer);
  const { unsupported } = validateAgainstSource(ir, sourceDocument);
  validateRunFormatScopes(ir, sourceDocument);
  const declaredOperationIds = ir.operations.map((operation) => operation.operationId);
  const atomicPreflight = assessDraftCompleteness(ir, declaredOperationIds);
  const incompleteAtomicSets = atomicPreflight.changeSets.filter((set) => !set.complete);
  if (incompleteAtomicSets.length > 0) {
    throw new DocxMarkdocError(
      'INCOMPLETE_ATOMIC_CHANGE_SET',
      'Atomic change sets cannot be partially applied.',
      { changeSets: incompleteAtomicSets },
    );
  }
  const clean = await applyOperations(sourceBuffer, ir);
  const comparison = await compareDocuments(sourceBuffer, clean, {
    engine: 'atomizer',
    author: options.author ?? 'Markdoc',
    date: options.date,
    reconstructionMode: 'inplace',
    // Dense rewrites are easier to review as a coarser replacement than as
    // scattered word-level "confetti". Small surgical edits remain refined.
    maxWordRefinementChangeRanges: 6,
  });
  const tracked = comparison.document;
  const acceptedDoc = await DocxDocument.load(tracked);
  const rejectedDoc = await DocxDocument.load(tracked);
  await acceptedDoc.acceptChanges();
  await rejectedDoc.rejectChanges();
  const cleanDoc = await DocxDocument.load(clean);
  const sourceText = verificationText(sourceDocument);
  const rejectedText = verificationText(rejectedDoc);
  const cleanText = verificationText(cleanDoc);
  const acceptedText = verificationText(acceptedDoc);
  const completeness = assessDraftCompleteness(ir, declaredOperationIds, cleanText);
  const rejectAllEqualsSource = rejectedText === sourceText;
  const acceptAllEqualsClean = acceptedText === cleanText;
  const formattingProjection = await verifyFormattingProjections(sourceBuffer, clean, tracked);
  const unchangedPackagePartsPreserved = await unchangedPartsEqual(sourceBuffer, clean);
  const certificate: VerificationCertificate = {
    version: 1,
    sourceSha256Matches: sourceHashMatches,
    scaffoldComplete: true,
    paragraphFingerprintsMatch: true,
    operationsAppliedExactlyOnce: new Set(ir.operations.map((operation) => operation.operationId)).size === ir.operations.length,
    rejectAllEqualsSource,
    acceptAllEqualsClean,
    rejectAllFormattingEqualsSource: formattingProjection.rejectAllFormattingEqualsSource,
    acceptAllFormattingEqualsClean: formattingProjection.acceptAllFormattingEqualsClean,
    formattingProjections: formattingProjection.formattingProjections,
    unchangedPackagePartsPreserved,
    unsupportedStructures: unsupported,
    appliedOperations: declaredOperationIds,
    projectionPassed: false,
    draftCompletenessPassed: completeness.passed,
    deliveryReady: false,
    completeness,
    passed: false,
  };
  certificate.projectionPassed = projectionChecksPassed(certificate);
  certificate.deliveryReady = certificate.projectionPassed && certificate.draftCompletenessPassed;
  certificate.passed = certificate.deliveryReady;
  if (!certificate.projectionPassed) throw new DocxMarkdocError('VERIFICATION_FAILED', 'Strict replay verification failed.', {
    certificate,
    sourceText,
    rejectedText,
    cleanText,
    acceptedText,
  });
  return { clean, tracked, ir, certificate };
}
