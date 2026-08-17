import JSZip from 'jszip';
import {
  DocxDocument,
  addTrackedRangeComments,
  computeContentFingerprint,
  getParagraphRuns,
  getAttributeSafe,
  OOXML,
  parseXml,
  serializeXml,
  type ReplacementPart,
  type TrackedRevisionLocator,
} from '@usejunior/docx-core';
import { compareDocuments, compareFormattingFidelity, type FormattingFidelityReport } from '@usejunior/docx-compare';
import { DocxMarkdocError } from './errors.js';
import { sha256 } from './hash.js';
import { requireMarkdoc } from './markdoc.js';
import { assessDraftCompleteness } from './completeness.js';
import type {
  CompileResult,
  CompileOptions,
  EditOperation,
  FormattingProjectionDiagnostic,
  FormattingProjectionReport,
  InsertOperation,
  MarkdocEditIR,
  RunFormat,
  RunFormatSpan,
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

type TextHunk = { start: number; end: number; replacement: string; revisedStart: number; revisedEnd: number };
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
      open ??= { start: sourceOffset, end: sourceOffset, replacement: '', revisedStart: revisedTokens[revised]!.start, revisedEnd: revisedTokens[revised]!.start };
      open.replacement += revisedTokens[revised]!.text;
      open.revisedEnd = revisedTokens[revised]!.end;
      revised += 1;
    } else {
      const revisedOffset = revised < m ? revisedTokens[revised]!.start : after.length;
      open ??= { start: sourceTokens[source]!.start, end: sourceTokens[source]!.start, replacement: '', revisedStart: revisedOffset, revisedEnd: revisedOffset };
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

function validateInlineRunFormatSpans(operationId: string, hunks: TextHunk[], spans: RunFormatSpan[]): void {
  const generated = hunks.filter((hunk) => hunk.replacement.length > 0);
  let previousEnd = -1;
  for (const span of spans) {
    if (span.start < previousEnd || span.end <= span.start) {
      throw new DocxMarkdocError('AMBIGUOUS_RUN_FORMAT_SCOPE', `Operation ${operationId} has empty or overlapping inline run-format spans.`);
    }
    previousEnd = span.end;
    const containing = generated.filter((hunk) => span.start >= hunk.revisedStart && span.end <= hunk.revisedEnd);
    if (containing.length !== 1) {
      throw new DocxMarkdocError(
        'RUN_FORMAT_SPAN_OUTSIDE_GENERATED_TEXT',
        `Operation ${operationId} inline run formatting must fall wholly inside one generated replacement hunk.`,
      );
    }
  }
}

function replacementPartsForHunk(
  hunk: TextHunk,
  templateRun: Element,
  spans: RunFormatSpan[],
  operationRunFormat?: RunFormat,
): ReplacementPart[] {
  if (hunk.replacement.length === 0) return [];
  if (operationRunFormat) return [{ text: hunk.replacement, templateRun, addRunProps: addRunProps(operationRunFormat) }];
  const relevant = spans.filter((span) => span.start >= hunk.revisedStart && span.end <= hunk.revisedEnd);
  if (relevant.length === 0) return [{ text: hunk.replacement, templateRun }];
  const parts: ReplacementPart[] = [];
  let offset = 0;
  for (const span of relevant) {
    const localStart = span.start - hunk.revisedStart;
    const localEnd = span.end - hunk.revisedStart;
    if (localStart > offset) parts.push({ text: hunk.replacement.slice(offset, localStart), templateRun });
    parts.push({ text: hunk.replacement.slice(localStart, localEnd), templateRun, addRunProps: addRunProps(span.format) });
    offset = localEnd;
  }
  if (offset < hunk.replacement.length) parts.push({ text: hunk.replacement.slice(offset), templateRun });
  return parts;
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
  runFormatSpans: RunFormatSpan[] = [],
): void {
  const paragraph = assertAdmittedStructure(document, id);
  const spans = runSpans(paragraph);
  const hunks = textHunks(before, after);
  const formatted = runFormat ? requireSingleGeneratedHunk(id, hunks) : undefined;
  validateInlineRunFormatSpans(id, hunks, runFormatSpans);
  for (const hunk of [...hunks].reverse()) {
    const templateRun = hunk.replacement.length === 0 ? undefined : templateForHunk(spans, hunk, before, id, formatSource);
    const replacement = templateRun
      ? replacementPartsForHunk(hunk, templateRun, runFormatSpans, hunk === formatted ? runFormat : undefined)
      : [];
    document.replaceTextAtRange({ targetParagraphId: id, start: hunk.start, end: hunk.end, replaceText: replacement });
  }
}

function validateRunFormatScopes(ir: MarkdocEditIR, source: DocxDocument): void {
  for (const operation of ir.operations) {
    if (!operation.runFormat && !(operation.runFormatSpans?.length)) continue;
    if (isInsertOperation(operation)) {
      if (operation.revisedText.length === 0 || operation.revisedText.replace(/\r\n/gu, '\n').split(/\n{2,}/u).length !== 1) {
        throw new DocxMarkdocError(
          'AMBIGUOUS_RUN_FORMAT_SCOPE',
          `Operation ${operation.operationId} run formatting requires exactly one generated replacement hunk.`,
        );
      }
      insertionFormatSource(source, operation);
      insertionTemplate(source, operation);
      validateInlineRunFormatSpans(operation.operationId, [{ start: 0, end: 0, replacement: operation.revisedText, revisedStart: 0, revisedEnd: operation.revisedText.length }], operation.runFormatSpans ?? []);
      continue;
    }
    const original = source.getParagraphTextById(operation.id);
    if (original === null) throw new DocxMarkdocError('MISSING_ANCHOR', `Paragraph ${operation.id} was not found.`);
    const hunks = textHunks(original, operation.revisedText);
    if (operation.runFormat) requireSingleGeneratedHunk(operation.operationId, hunks);
    validateInlineRunFormatSpans(operation.operationId, hunks, operation.runFormatSpans ?? []);
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

type AttributedRange = {
  operationId: string;
  projection: 'source' | 'clean';
  startParagraphId: string;
  start: number;
  endParagraphId: string;
  end: number;
};

async function applyOperations(sourceBuffer: Buffer, ir: MarkdocEditIR): Promise<{ buffer: Buffer; ranges: AttributedRange[] }> {
  const document = await DocxDocument.load(sourceBuffer);
  const ranges: AttributedRange[] = [];
  for (const operation of ir.operations) {
    if (isInsertOperation(operation)) {
      const runStyleSourceText = insertionFormatSource(document, operation);
      const templateRun = operation.runFormat || operation.runFormatSpans?.length ? insertionTemplate(document, operation) : undefined;
      const inserted = document.insertParagraph({
        positionalAnchorNodeId: operation.anchorId,
        relativePosition: operation.kind === 'insert-before' ? 'BEFORE' : 'AFTER',
        newText: operation.revisedText,
        styleSourceId: operation.styleSourceId,
        runStyleSourceText,
      });
      const insertedTexts = operation.revisedText.replace(/\r\n/gu, '\n').split(/\n{2,}/u);
      ranges.push({
        operationId: operation.operationId,
        projection: 'clean',
        startParagraphId: inserted.newParagraphIds[0]!,
        start: 0,
        endParagraphId: inserted.newParagraphIds.at(-1)!,
        end: insertedTexts.at(-1)!.length,
      });
      if (templateRun) {
        document.replaceTextAtRange({
          targetParagraphId: inserted.newParagraphId,
          start: 0,
          end: operation.revisedText.length,
          replaceText: replacementPartsForHunk(
            { start: 0, end: 0, replacement: operation.revisedText, revisedStart: 0, revisedEnd: operation.revisedText.length },
            templateRun,
            operation.runFormatSpans ?? [],
            operation.runFormat,
          ),
        });
      }
      continue;
    }
    assertAdmittedStructure(document, operation.id);
    const original = document.getParagraphTextById(operation.id);
    if (original === null) throw new DocxMarkdocError('MISSING_ANCHOR', `Paragraph ${operation.id} was not found.`);
    if (operation.kind === 'delete-source') {
      ranges.push({
        operationId: operation.operationId,
        projection: 'source',
        startParagraphId: operation.id,
        start: 0,
        endParagraphId: operation.id,
        end: original.length,
      });
      const paragraph = document.getParagraphElementById(operation.id);
      paragraph?.parentNode?.removeChild(paragraph);
      continue;
    }
    const operationHunks = textHunks(original, operation.revisedText);
    const generated = operationHunks.filter((hunk) => hunk.replacement.length > 0);
    if (generated.length > 0) {
      ranges.push({
        operationId: operation.operationId,
        projection: 'clean',
        startParagraphId: operation.id,
        start: generated[0]!.revisedStart,
        endParagraphId: operation.id,
        end: generated.at(-1)!.revisedEnd,
      });
    } else if (operationHunks.length > 0) {
      ranges.push({
        operationId: operation.operationId,
        projection: 'source',
        startParagraphId: operation.id,
        start: operationHunks[0]!.start,
        endParagraphId: operation.id,
        end: operationHunks.at(-1)!.end,
      });
    }
    replacePreservingMixedFormatting(
      document,
      operation.id,
      original,
      operation.revisedText,
      operation.kind === 'replace-source' ? operation.formatSource : undefined,
      operation.runFormat,
      operation.runFormatSpans,
    );
  }
  return { buffer: (await document.toBuffer({ cleanBookmarks: false })).buffer, ranges };
}

type RationaleMaterialization = {
  range: AttributedRange;
  startSentinel: string;
  endSentinel: string;
  texts: string[];
};

type ResolvedCompilation = {
  author: string;
  date: Date;
  commentIdentity?: { author: string; initials: string };
  source: 'markdoc' | 'api' | 'cli' | 'default';
  externalRationalesFound: number;
  internalRationalesFound: number;
  externalCommentsIncluded: boolean;
  internalCommentsIncluded: boolean;
  warnings: string[];
};

function resolveCompilation(options: CompileOptions, ir: MarkdocEditIR): ResolvedCompilation {
  const profile = ir.compilation;
  const date = options.date ?? (profile?.buildDate ? new Date(profile.buildDate) : new Date());
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new DocxMarkdocError('INVALID_BUILD_DATE', 'Compilation date must be a valid instant.');
  }
  const externalRationalesFound = ir.rationales.filter((rationale) => rationale.visibility === 'external-facing').length;
  const internalRationalesFound = ir.rationales.filter((rationale) => rationale.visibility === 'internal').length;
  const includeExternal = options.externalComments ?? profile?.externalComments !== 'omit';
  const includeInternal = options.dangerouslyIncludeInternalComments === true;
  const commentAuthor = options.rationaleComments?.author ?? profile?.commentAuthor;
  const commentInitials = options.rationaleComments?.initials ?? profile?.commentInitials;
  if ((includeExternal && externalRationalesFound > 0) || (includeInternal && internalRationalesFound > 0)) {
    if (typeof commentAuthor !== 'string' || commentAuthor.trim().length === 0
      || typeof commentInitials !== 'string' || commentInitials.trim().length === 0) {
      throw new DocxMarkdocError(
        'INVALID_RATIONALE_COMMENT_IDENTITY',
        'Included rationale comments require explicit non-empty comment author and initials.',
      );
    }
  }
  const hasApiConfiguration = options.author !== undefined
    || options.date !== undefined
    || options.rationaleComments !== undefined
    || options.externalComments !== undefined
    || options.dangerouslyIncludeInternalComments !== undefined;
  return {
    author: options.author ?? profile?.revisionAuthor ?? 'Markdoc',
    date,
    ...(commentAuthor && commentInitials ? { commentIdentity: { author: commentAuthor, initials: commentInitials } } : {}),
    source: options.configurationSource ?? (hasApiConfiguration ? 'api' : profile ? 'markdoc' : 'default'),
    externalRationalesFound,
    internalRationalesFound,
    externalCommentsIncluded: includeExternal && externalRationalesFound > 0,
    internalCommentsIncluded: includeInternal && internalRationalesFound > 0,
    warnings: !includeExternal && externalRationalesFound > 0
      ? [`${externalRationalesFound} external-facing rationale(s) were present but not included.`]
      : [],
  };
}

function rationaleMaterializations(config: ResolvedCompilation, ir: MarkdocEditIR): RationaleMaterialization[] {
  const selected = ir.rationales.filter((rationale) =>
    (rationale.visibility === 'external-facing' && config.externalCommentsIncluded)
    || (rationale.visibility === 'internal' && config.internalCommentsIncluded));
  if (selected.length > 0 && !config.commentIdentity) {
    throw new DocxMarkdocError(
      'INVALID_RATIONALE_COMMENT_IDENTITY',
      'Included rationale comments require explicit comment identity.',
    );
  }
  const grouped = new Map<string, string[]>();
  for (const rationale of selected) {
    grouped.set(rationale.operationId, [...(grouped.get(rationale.operationId) ?? []), rationale.text]);
  }
  return [...grouped].map(([operationId, texts], index) => ({
    range: { operationId } as AttributedRange,
    startSentinel: `\u{E000}safe-docx-rationale-${index}-start\u{E001}`,
    endSentinel: `\u{E000}safe-docx-rationale-${index}-end\u{E001}`,
    texts,
  }));
}

async function instrumentRanges(buffer: Buffer, materializations: RationaleMaterialization[]): Promise<Buffer> {
  const document = await DocxDocument.load(buffer);
  for (const item of [...materializations].reverse()) {
    const { range } = item;
    if (range.startParagraphId === range.endParagraphId) {
      const paragraphText = document.getParagraphTextById(range.startParagraphId);
      if (paragraphText === null || range.start >= range.end || range.end > paragraphText.length) {
        throw new DocxMarkdocError('RATIONALE_ANCHOR_UNAVAILABLE', `Operation ${range.operationId} has no anchorable tracked content.`);
      }
      document.replaceTextAtRange({
        targetParagraphId: range.startParagraphId,
        start: range.start,
        end: range.end,
        replaceText: `${item.startSentinel}${paragraphText.slice(range.start, range.end)}${item.endSentinel}`,
      });
      continue;
    }
    const startText = document.getParagraphTextById(range.startParagraphId);
    const endText = document.getParagraphTextById(range.endParagraphId);
    if (startText === null || endText === null || range.start > startText.length || range.end <= 0 || range.end > endText.length) {
      throw new DocxMarkdocError('RATIONALE_ANCHOR_UNAVAILABLE', `Operation ${range.operationId} has no anchorable tracked content.`);
    }
    document.replaceTextAtRange({
      targetParagraphId: range.endParagraphId,
      start: range.end,
      end: range.end,
      replaceText: item.endSentinel,
    });
    document.replaceTextAtRange({
      targetParagraphId: range.startParagraphId,
      start: range.start,
      end: range.start,
      replaceText: item.startSentinel,
    });
  }
  return (await document.toBuffer({ cleanBookmarks: false })).buffer;
}

type ResolvedRationaleComment = {
  startRevision: TrackedRevisionLocator;
  endRevision: TrackedRevisionLocator;
  text: string;
};

function nearestRevision(node: Node): Element | null {
  let current: Node | null = node.parentNode;
  while (current) {
    const element = current.nodeType === 1 ? current as Element : null;
    if (element && ['ins', 'del', 'moveFrom', 'moveTo'].includes(element.localName)) return element;
    current = current.parentNode;
  }
  return null;
}

function resolveSentinel(documentXml: Document, sentinel: string): { textNode: Text; revision: Element } {
  const matches: Text[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3 && (node.nodeValue ?? '').includes(sentinel)) matches.push(node as Text);
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(documentXml.documentElement);
  if (matches.length !== 1) throw new Error(`Private attribution marker must occur exactly once; found ${matches.length}.`);
  const revision = nearestRevision(matches[0]!);
  if (!revision) throw new Error('Private attribution marker is not inside tracked revision markup.');
  return { textNode: matches[0]!, revision };
}

function revisionLocator(revision: Element): TrackedRevisionLocator {
  const id = getAttributeSafe(revision, OOXML.W_NS, 'id', 'w', { bareFallback: false });
  if (!id || !['ins', 'del', 'moveFrom', 'moveTo'].includes(revision.localName)) {
    throw new Error('Attributed tracked revision has no stable OOXML identity.');
  }
  return { type: revision.localName as TrackedRevisionLocator['type'], id };
}

function removeAttributionMarker(textNode: Text, marker: string): void {
  textNode.data = textNode.data.replace(marker, '');
  if (/^\s|\s$/u.test(textNode.data)) {
    const textElement = textNode.parentNode;
    if (textElement?.nodeType === 1) {
      (textElement as Element).setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    }
  }
}

async function resolveAndRemoveAttributionMarkers(
  buffer: Buffer,
  materializations: RationaleMaterialization[],
): Promise<{ buffer: Buffer; comments: ResolvedRationaleComment[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Tracked DOCX has no word/document.xml.');
  const documentXml = parseXml(await file.async('string'));
  const comments = materializations.flatMap((item) => {
    const start = resolveSentinel(documentXml, item.startSentinel);
    const end = resolveSentinel(documentXml, item.endSentinel);
    const attributableText = start.revision === end.revision
      ? start.revision.textContent ?? ''
      : `${start.revision.textContent ?? ''}${end.revision.textContent ?? ''}`;
    const foreignMarker = attributableText.match(/\uE000safe-docx-rationale-\d+-(?:start|end)\uE001/gu)
      ?.some((marker) => marker !== item.startSentinel && marker !== item.endSentinel);
    if (foreignMarker) throw new Error('Tracked comment attribution overlaps another operation revision.');
    const resolved = {
      startRevision: revisionLocator(start.revision),
      endRevision: revisionLocator(end.revision),
    };
    removeAttributionMarker(start.textNode, item.startSentinel);
    removeAttributionMarker(end.textNode, item.endSentinel);
    return item.texts.map((text) => ({ ...resolved, text }));
  });
  zip.file('word/document.xml', serializeXml(documentXml));
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), comments };
}

async function remapResolvedCommentsToOrdinaryComparison(
  instrumented: Buffer,
  ordinary: Buffer,
  comments: ResolvedRationaleComment[],
): Promise<ResolvedRationaleComment[]> {
  const revisionNames = new Set(['ins', 'del', 'moveFrom', 'moveTo']);
  const revisions = async (buffer: Buffer): Promise<Element[]> => {
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) throw new Error('Tracked DOCX has no word/document.xml.');
    const document = parseXml(xml);
    return Array.from(document.getElementsByTagName('*')).filter((element) => revisionNames.has(element.localName));
  };
  const [instrumentedRevisions, ordinaryRevisions] = await Promise.all([revisions(instrumented), revisions(ordinary)]);
  const indexByLocator = new Map(instrumentedRevisions.map((revision, index) => [
    `${revision.localName}#${getAttributeSafe(revision, OOXML.W_NS, 'id', 'w', { bareFallback: false }) ?? ''}`,
    index,
  ]));
  const remap = (locator: TrackedRevisionLocator): TrackedRevisionLocator => {
    const index = indexByLocator.get(`${locator.type}#${locator.id}`);
    const source = index === undefined ? undefined : instrumentedRevisions[index];
    if (!source) throw new Error(`Attributed revision ${locator.type}#${locator.id} is absent from the instrumented comparison.`);
    const signature = `${source.localName}\0${source.textContent ?? ''}`;
    const sourceMatches = instrumentedRevisions.filter((revision) => `${revision.localName}\0${revision.textContent ?? ''}` === signature);
    const targetMatches = ordinaryRevisions.filter((revision) => `${revision.localName}\0${revision.textContent ?? ''}` === signature);
    const occurrence = sourceMatches.indexOf(source);
    let target = targetMatches[occurrence];
    if (!target) {
      const sourceText = source.textContent ?? '';
      const contained = ordinaryRevisions
        .filter((revision) => revision.localName === locator.type)
        .filter((revision) => {
          const text = revision.textContent ?? '';
          return text.length > 0 && (sourceText.includes(text) || text.includes(sourceText));
        })
        .sort((left, right) => (right.textContent?.length ?? 0) - (left.textContent?.length ?? 0));
      if (contained.length === 1
        || (contained.length > 1 && (contained[0]!.textContent?.length ?? 0) > (contained[1]!.textContent?.length ?? 0))) {
        target = contained[0];
      }
    }
    if (!target) {
      const candidates = ordinaryRevisions
        .filter((revision) => revision.localName === locator.type)
        .slice(0, 8)
        .map((revision) => revision.textContent ?? '');
      throw new Error(`Attributed revision ${locator.type}#${locator.id} text ${JSON.stringify(source.textContent ?? '')} has no identical ordinary-comparison revision among ${JSON.stringify(candidates)}.`);
    }
    return revisionLocator(target);
  };
  return comments.map((comment) => ({
    ...comment,
    startRevision: remap(comment.startRevision),
    endRevision: remap(comment.endRevision),
  }));
}

export async function compileMarkdoc(
  sourceBuffer: Buffer,
  markdoc: string,
  options: CompileOptions = {},
): Promise<CompileResult> {
  const ir = requireMarkdoc(markdoc);
  const resolvedCompilation = resolveCompilation(options, ir);
  const materializations = rationaleMaterializations(resolvedCompilation, ir);
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
  const applied = await applyOperations(sourceBuffer, ir);
  const clean = applied.buffer;
  const rangesByOperation = new Map(applied.ranges.map((range) => [range.operationId, range]));
  for (const item of materializations) {
    const range = rangesByOperation.get(item.range.operationId);
    if (!range) throw new DocxMarkdocError('RATIONALE_ANCHOR_UNAVAILABLE', `Operation ${item.range.operationId} has no attributable edit range.`);
    item.range = range;
  }
  const sourceMaterializations = materializations.filter((item) => item.range.projection === 'source');
  const cleanMaterializations = materializations.filter((item) => item.range.projection === 'clean');
  const [comparisonSource, comparisonClean] = await Promise.all([
    instrumentRanges(sourceBuffer, sourceMaterializations),
    instrumentRanges(clean, cleanMaterializations),
  ]);
  const comparisonOptions = {
    engine: 'atomizer',
    author: resolvedCompilation.author,
    date: resolvedCompilation.date,
    reconstructionMode: 'inplace',
    // No maxWordRefinementChangeRanges budget: a finite budget made dense
    // rewrites fall back to coarse whole-span replacement on the run-level
    // reconstruction paths, so ordinary source tokens the independent release
    // verifier proves preservable were deleted and reinserted. Token-level
    // minimality outranks "confetti" readability for authored redlines.
    // See https://github.com/UseJunior/safe-docx/issues/846.
  } as const;
  const comparison = ir.operations.length === 0
    ? undefined
    : await compareDocuments(comparisonSource, comparisonClean, comparisonOptions);
  // A no-operation replay has no comparison to represent. Preserve the exact
  // source package instead of needlessly reassembling relationship IDs and
  // turning package-normalization noise into a false formatting failure.
  let tracked = comparison?.document ?? sourceBuffer;
  if (materializations.length > 0) {
    const identity = resolvedCompilation.commentIdentity!;
    try {
      const resolved = await resolveAndRemoveAttributionMarkers(tracked, materializations);
      // Attribution markers are private discovery machinery, not authored
      // document content. Dense multi-operation documents proved that asking
      // the comparator to align those markers can perturb which source run
      // supplies formatting even after the markers are removed. Resolve the
      // operation-to-revision identities in the instrumented comparison, then
      // place comments on the ordinary comparison so the delivered redline is
      // byte-for-byte independent of marker text apart from native comments.
      const ordinaryComparison = await compareDocuments(sourceBuffer, clean, comparisonOptions);
      const ordinaryComments = await remapResolvedCommentsToOrdinaryComparison(
        resolved.buffer,
        ordinaryComparison.document,
        resolved.comments,
      );
      tracked = await addTrackedRangeComments(ordinaryComparison.document, ordinaryComments.map((item) => ({
        startRevision: item.startRevision,
        endRevision: item.endRevision,
        author: identity.author,
        initials: identity.initials,
        date: resolvedCompilation.date.toISOString(),
        text: item.text,
      })));
    } catch (error) {
      throw new DocxMarkdocError(
        'RATIONALE_ANCHOR_AMBIGUOUS',
        'Selected rationale could not be mapped to one exact tracked edit range.',
        { cause: (error as Error).message },
      );
    }
  }
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
    commentRendering: {
      configurationSource: resolvedCompilation.source,
      buildDate: resolvedCompilation.date.toISOString(),
      revisionAuthor: resolvedCompilation.author,
      ...(resolvedCompilation.commentIdentity ? {
        commentAuthor: resolvedCompilation.commentIdentity.author,
        commentInitials: resolvedCompilation.commentIdentity.initials,
      } : {}),
      externalRationalesFound: resolvedCompilation.externalRationalesFound,
      internalRationalesFound: resolvedCompilation.internalRationalesFound,
      externalCommentsIncluded: resolvedCompilation.externalCommentsIncluded,
      internalCommentsIncluded: resolvedCompilation.internalCommentsIncluded,
      warnings: resolvedCompilation.warnings,
    },
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
