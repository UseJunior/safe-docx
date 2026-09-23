import JSZip from 'jszip';
import {
  DocxDocument,
  addTrackedRangeComments,
  computeContentFingerprint,
  getParagraphBookmarkId,
  getParagraphRuns,
  parseXml,
  serializeXml,
  type ReplacementPart,
} from '@usejunior/docx-core';
import {
  compareDocumentsAtomizer,
  compareFormattingFidelity,
  type FormattingFidelityReport,
} from '@usejunior/docx-compare';
import { DocxMarkdocError } from './errors.js';
import { sha256 } from './hash.js';
import { requireMarkdoc } from './markdoc.js';
import { assessDraftCompleteness } from './completeness.js';
import { projectAnnotations, type AnnotationProjectionResult } from './presentation.js';
import type {
  CompileResult,
  CompileOptions,
  EditOperation,
  FormattingProjectionDiagnostic,
  FormattingProjectionReport,
  InsertOperation,
  MarkdocEditIR,
  RetainedFormat,
  RetainedFormatSpan,
  RetainedFormattingReport,
  RunFormat,
  RunFormatSpan,
  TableRowOperation,
  TableTopologyReport,
  VerificationCertificate,
  RevisionGroupingPolicy,
  RevisionGroupingSource,
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
  const document = parseXml(xml);
  for (const localName of ['commentRangeStart', 'commentRangeEnd']) {
    for (const marker of Array.from(document.getElementsByTagNameNS('*', localName))) {
      marker.parentNode?.removeChild(marker);
    }
  }
  for (const reference of Array.from(document.getElementsByTagNameNS('*', 'commentReference'))) {
    const run = reference.parentNode;
    if (run?.nodeType === 1 && (run as Element).localName === 'r') run.parentNode?.removeChild(run);
  }
  return serializeXml(document).replace(/<w:rPr\s*\/>|<w:rPr\s*>\s*<\/w:rPr>/gu, '');
}

function emittedRevisionGrouping(xml: string): { coalescedSpaceTokens: number; groupedChains: number } {
  const document = parseXml(xml);
  const tokens = (text: string): string[] => text.match(/\s+|[\p{L}\p{N}\p{M}_]+|[^\s\p{L}\p{N}\p{M}_]/gu) ?? [];
  const wrapperText = (wrapper: Element, deletion: boolean): string => {
    const names = deletion ? ['delText', 't'] : ['t'];
    return names.flatMap((name) => Array.from(wrapper.getElementsByTagNameNS('*', name)))
      .map((node) => node.textContent ?? '').join('');
  };
  let coalescedSpaceTokens = 0;
  let groupedChains = 0;
  for (const paragraph of Array.from(document.getElementsByTagNameNS('*', 'p'))) {
    const children = Array.from(paragraph.childNodes).filter((node): node is Element => node.nodeType === 1);
    for (let index = 0; index < children.length;) {
      if (children[index]!.localName !== 'del' || wrapperText(children[index]!, true) === '') { index += 1; continue; }
      const deleted: string[] = [];
      while (index < children.length && children[index]!.localName === 'del') {
        const text = wrapperText(children[index]!, true);
        if (text) deleted.push(text);
        index += 1;
      }
      while (index < children.length && (children[index]!.textContent ?? '') === '') index += 1;
      const inserted: string[] = [];
      while (index < children.length && children[index]!.localName === 'ins') {
        const text = wrapperText(children[index]!, false);
        if (text) inserted.push(text);
        index += 1;
      }
      if (deleted.length === 0 || inserted.length === 0) continue;
      const left = tokens(deleted.join('')).slice(1, -1).filter((token) => /^ +$/u.test(token));
      const right = tokens(inserted.join('')).slice(1, -1).filter((token) => /^ +$/u.test(token));
      const rightCounts = new Map<string, number>();
      right.forEach((token) => rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1));
      let count = 0;
      for (const token of new Set(left)) {
        count += Math.min(left.filter((candidate) => candidate === token).length, rightCounts.get(token) ?? 0);
      }
      if (count > 0) { groupedChains += 1; coalescedSpaceTokens += count; }
    }
  }
  return { coalescedSpaceTokens, groupedChains };
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
  sourceContainsRevisions = false,
): Promise<{
  rejectAllFormattingEqualsSource: boolean;
  acceptAllFormattingEqualsClean: boolean;
  formattingProjections: FormattingProjectionReport;
}> {
  let projectedSource = source;
  let projectedClean = clean;
  if (sourceContainsRevisions) {
    const rejectedSource = await DocxDocument.load(source);
    const acceptedClean = await DocxDocument.load(clean);
    await Promise.all([rejectedSource.rejectChanges(), acceptedClean.acceptChanges()]);
    [projectedSource, projectedClean] = await Promise.all([
      rejectedSource.toBuffer({ cleanBookmarks: false }).then((result) => result.buffer),
      acceptedClean.toBuffer({ cleanBookmarks: false }).then((result) => result.buffer),
    ]);
  }
  const [sourceXml, cleanXml] = await Promise.all([documentXml(projectedSource), documentXml(projectedClean)]);
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
  | 'existingRevisionsPreserved'
  | 'retainedFormatting'
  | 'tableTopology'
>): boolean {
  return checks.sourceSha256Matches
    && checks.scaffoldComplete
    && checks.paragraphFingerprintsMatch
    && checks.operationsAppliedExactlyOnce
    && checks.rejectAllEqualsSource
    && checks.acceptAllEqualsClean
    && checks.rejectAllFormattingEqualsSource
    && checks.acceptAllFormattingEqualsClean
    && checks.unchangedPackagePartsPreserved
    && checks.existingRevisionsPreserved
    && (checks.retainedFormatting?.passed ?? true)
    && (checks.tableTopology?.passed ?? true);
}

function directElementChildren(parent: Element, localName?: string): Element[] {
  return Array.from(parent.childNodes).filter((child): child is Element =>
    child.nodeType === 1 && (localName === undefined || (child as Element).localName === localName));
}

type NormalizedTable = {
  gridWidths: string[];
  rows: Array<{
    height?: [string, string];
    header?: string;
    cells: Array<{
      width?: [string, string];
      gridSpan?: string;
      vMerge?: string;
      paragraphs: string[];
    }>;
  }>;
};

async function normalizedTableTopology(buffer: Buffer): Promise<NormalizedTable[]> {
  const xml = parseXml(await documentXml(buffer));
  const body = Array.from(xml.getElementsByTagNameNS('*', 'body'))[0];
  if (!body) return [];
  const attr = (element: Element | undefined, name: string): string | undefined =>
    element?.getAttribute(`w:${name}`) || element?.getAttribute(name) || undefined;
  return directElementChildren(body, 'tbl').map((table) => {
    const grid = directElementChildren(table, 'tblGrid')[0];
    const gridWidths = grid ? directElementChildren(grid, 'gridCol').map((column) => attr(column, 'w') ?? '') : [];
    const rows = directElementChildren(table, 'tr').map((row) => {
      const trPr = directElementChildren(row, 'trPr')[0];
      const height = trPr && directElementChildren(trPr, 'trHeight')[0];
      const header = trPr && directElementChildren(trPr, 'tblHeader')[0];
      return {
        height: height ? [attr(height, 'val') ?? '', attr(height, 'hRule') ?? ''] as [string, string] : undefined,
        header: header ? (attr(header, 'val') ?? 'true') : undefined,
        cells: directElementChildren(row, 'tc').map((cell) => {
        const tcPr = directElementChildren(cell, 'tcPr')[0];
        const width = tcPr && directElementChildren(tcPr, 'tcW')[0];
        const span = tcPr && directElementChildren(tcPr, 'gridSpan')[0];
        const merge = tcPr && directElementChildren(tcPr, 'vMerge')[0];
        return {
          width: width ? [attr(width, 'w') ?? '', attr(width, 'type') ?? ''] as [string, string] : undefined,
          gridSpan: attr(span, 'val'),
          vMerge: merge ? (attr(merge, 'val') ?? 'continue') : undefined,
          paragraphs: directElementChildren(cell, 'p').map((paragraph) =>
            Array.from(paragraph.getElementsByTagNameNS('*', 't')).map((text) => text.textContent ?? '').join('')),
        };
        }),
      };
    });
    return { gridWidths, rows };
  });
}

function topologyDiagnostics(
  projection: 'source-reject' | 'clean-accept',
  expected: NormalizedTable[],
  actual: NormalizedTable[],
): TableTopologyReport['diagnostics'] {
  const length = Math.max(expected.length, actual.length);
  for (let tableIndex = 0; tableIndex < length; tableIndex += 1) {
    const expectedTable = expected[tableIndex];
    const actualTable = actual[tableIndex];
    if (!expectedTable || !actualTable) return [{ projection, tableIndex, expected: JSON.stringify(expectedTable), actual: JSON.stringify(actualTable) }];
    if (JSON.stringify(expectedTable.gridWidths) !== JSON.stringify(actualTable.gridWidths)) {
      return [{ projection, tableIndex, expected: JSON.stringify(expectedTable.gridWidths), actual: JSON.stringify(actualTable.gridWidths) }];
    }
    const rowLength = Math.max(expectedTable.rows.length, actualTable.rows.length);
    for (let rowIndex = 0; rowIndex < rowLength; rowIndex += 1) {
      const expectedRow = expectedTable.rows[rowIndex];
      const actualRow = actualTable.rows[rowIndex];
      if (!expectedRow || !actualRow) return [{ projection, tableIndex, rowIndex, expected: JSON.stringify(expectedRow), actual: JSON.stringify(actualRow) }];
      if (JSON.stringify([expectedRow.height, expectedRow.header]) !== JSON.stringify([actualRow.height, actualRow.header])) {
        return [{ projection, tableIndex, rowIndex, expected: JSON.stringify([expectedRow.height, expectedRow.header]), actual: JSON.stringify([actualRow.height, actualRow.header]) }];
      }
      const cellLength = Math.max(expectedRow.cells.length, actualRow.cells.length);
      for (let cellIndex = 0; cellIndex < cellLength; cellIndex += 1) {
        const expectedCell = expectedRow.cells[cellIndex];
        const actualCell = actualRow.cells[cellIndex];
        if (JSON.stringify(expectedCell) !== JSON.stringify(actualCell)) {
          return [{ projection, tableIndex, rowIndex, cellIndex, expected: JSON.stringify(expectedCell), actual: JSON.stringify(actualCell) }];
        }
      }
    }
  }
  return [];
}

/**
 * Revision containers and range markers whose serialized XML must survive an
 * annotation-only projection unchanged. The set is deliberately the one that
 * docx-core accept/reject resolves — `w:ins`/`w:del`, the move family, and the
 * six property-change kinds — plus `w:tblGridChange`. `w:numberingChange`,
 * `w:cellIns`/`w:cellDel`/`w:cellMerge`, and the `w:customXml*Range*` markers
 * are outside the set: they are neither preservation-checked nor treated as
 * existing revisions when gating operative edits.
 *
 * Limitation: the non-greedy body match ends at the first closing tag of the
 * same name, so a container nested inside another container of the same kind
 * truncates the outer capture. That topology is schema-valid but rare in Word
 * output, and the truncation is symmetric across source and projection.
 */
const REVISION_ELEMENT_PATTERN = /<w:(ins|del|moveFrom|moveTo|moveFromRangeStart|moveFromRangeEnd|moveToRangeStart|moveToRangeEnd|rPrChange|pPrChange|tblPrChange|tblGridChange|trPrChange|tcPrChange|sectPrChange)\b(?:[^>]*\/>|[\s\S]*?<\/w:\1>)/gu;

type RevisionSnapshot = Array<{ part: string; xml: string }>;

type RevisionDescriptor = { part: string; element: string; id?: string };

type RevisionPreservationReport = {
  preserved: boolean;
  /** Source revisions, in source order, that the projection no longer contains verbatim at or after the previous match. */
  missing: RevisionDescriptor[];
};

/**
 * Capture exact revision elements together with their WordprocessingML story.
 * This intentionally retains serialized IDs, authors, dates, content, and
 * wrapper structure rather than reducing revisions to visible text.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @see https://github.com/UseJunior/safe-docx/issues/949
 */
async function revisionSnapshot(buffer: Buffer): Promise<RevisionSnapshot> {
  const zip = await JSZip.loadAsync(buffer);
  const snapshot: RevisionSnapshot = [];
  const parts = Object.keys(zip.files)
    .filter((name) => /^word\/(?:document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/u.test(name))
    .sort();
  for (const part of parts) {
    const xml = await zip.file(part)?.async('string');
    if (!xml) continue;
    for (const match of xml.matchAll(REVISION_ELEMENT_PATTERN)) snapshot.push({ part, xml: match[0] });
  }
  return snapshot;
}

function describeRevision(item: RevisionSnapshot[number]): RevisionDescriptor {
  const element = /^<w:(\w+)/u.exec(item.xml)?.[1] ?? 'unknown';
  const id = /^<[^>]*?\sw:id="([^"]*)"/u.exec(item.xml)?.[1];
  return { part: item.part, element, ...(id === undefined ? {} : { id }) };
}

/**
 * Every source revision must reappear verbatim in the projected output, in
 * the same story part and in the same relative order. Projection may add
 * revision markup of its own (see issue #961), so this is an ordered
 * subsequence check per part rather than equality.
 */
function verifyRevisionPreservation(source: RevisionSnapshot, projected: RevisionSnapshot): RevisionPreservationReport {
  const projectedByPart = new Map<string, string[]>();
  for (const item of projected) {
    const list = projectedByPart.get(item.part) ?? [];
    list.push(item.xml);
    projectedByPart.set(item.part, list);
  }
  const cursors = new Map<string, number>();
  const missing: RevisionDescriptor[] = [];
  for (const item of source) {
    const candidates = projectedByPart.get(item.part) ?? [];
    let index = cursors.get(item.part) ?? 0;
    while (index < candidates.length && candidates[index] !== item.xml) index += 1;
    if (index >= candidates.length) {
      missing.push(describeRevision(item));
      continue;
    }
    cursors.set(item.part, index + 1);
  }
  return { preserved: missing.length === 0, missing };
}

function verificationText(document: DocxDocument): string {
  // The comparison engine may legitimately move internal paragraph bookmarks
  // while preserving the rejected/accepted document text. Verification must
  // therefore use physical paragraph/run text, not treat the internal anchor
  // layout of a generated redline as operative content.
  return document.getParagraphs().map((paragraph) => getParagraphRuns(paragraph).map((run) => run.text).join('')).join('\n');
}

type TrackedCharacter = { text: string; revisionWrapped: boolean; run?: Element };

function trackedCharacters(paragraph: Element, projection: 'accept' | 'reject'): TrackedCharacter[] {
  const characters: TrackedCharacter[] = [];
  const visit = (node: Node, wrappers: Set<string>, run?: Element): void => {
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.localName === 'rPr') return;
    const nextWrappers = new Set(wrappers);
    if (['ins', 'del', 'moveFrom', 'moveTo'].includes(element.localName)) nextWrappers.add(element.localName);
    const nextRun = element.localName === 'r' ? element : run;
    const excluded = projection === 'accept'
      ? nextWrappers.has('del') || nextWrappers.has('moveFrom')
      : nextWrappers.has('ins') || nextWrappers.has('moveTo');
    if (element.localName === 't' || element.localName === 'delText') {
      if (!excluded) {
        for (const character of element.textContent ?? '') {
          characters.push({ text: character, revisionWrapped: nextWrappers.size > 0, run: nextRun });
        }
      }
      return;
    }
    if ((element.localName === 'tab' || element.localName === 'br') && !excluded) {
      characters.push({ text: element.localName === 'tab' ? '\t' : '\n', revisionWrapped: nextWrappers.size > 0, run: nextRun });
      return;
    }
    for (const child of Array.from(element.childNodes)) visit(child, nextWrappers, nextRun);
  };
  visit(paragraph, new Set());
  return characters;
}

function runHasPropertyChange(run: Element | undefined): boolean {
  if (!run) return false;
  return Array.from(run.getElementsByTagNameNS('*', 'rPrChange')).length > 0;
}

function directRunProperties(run: Element | undefined, localName: string): Element[] {
  if (!run) return [];
  const rPr = Array.from(run.childNodes).find((child): child is Element =>
    child.nodeType === 1 && (child as Element).localName === 'rPr');
  return rPr ? Array.from(rPr.childNodes).filter((child): child is Element =>
    child.nodeType === 1 && (child as Element).localName === localName) : [];
}

function runMatchesRetainedFormat(run: Element | undefined, format: RetainedFormat): boolean {
  const underline = directRunProperties(run, 'u');
  const highlight = directRunProperties(run, 'highlight');
  const underlineMatches = format.underline === undefined || (format.underline === 'none'
    ? underline.length === 0
    : underline.length === 1 && ['', 'single'].includes(underline[0]!.getAttribute('w:val') ?? ''));
  const highlightMatches = format.highlight === undefined || (format.highlight === 'none'
    ? highlight.length === 0
    : highlight.length === 1 && highlight[0]!.getAttribute('w:val') === format.highlight);
  return underlineMatches && highlightMatches;
}

/**
 * Certify native run-property revisions without trusting comparator summary
 * statistics, and reject text-revision wrappers over property-only intervals.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @see #998
 */
export function certifyRetainedFormatting(document: DocxDocument, spans: ResolvedRetainedSpan[]): RetainedFormattingReport {
  const diagnostics: RetainedFormattingReport['diagnostics'] = spans.map((span) => {
    const paragraph = document.getParagraphElementById(span.paragraphId);
    if (!paragraph) {
      return {
        operationId: span.operationId,
        paragraphId: span.paragraphId,
        revisedStart: span.start,
        revisedEnd: span.end,
        sourceStart: span.sourceStart,
        sourceEnd: span.sourceEnd,
        properties: span.changedProperties ?? Object.keys(span.format).sort() as Array<'highlight' | 'underline'>,
        emittedPropertyRanges: 0,
        textRevisionOverlaps: span.end - span.start,
        propertyCoverageComplete: false,
        textMatches: false,
        propertyStateMatches: false,
      };
    }
    const accept = trackedCharacters(paragraph, 'accept').slice(span.start, span.end);
    const reject = trackedCharacters(paragraph, 'reject').slice(span.sourceStart, span.sourceEnd);
    const textRevisionOverlaps = accept.filter((character) => character.revisionWrapped).length
      + reject.filter((character) => character.revisionWrapped).length
      + Math.max(0, span.end - span.start - accept.length)
      + Math.max(0, span.sourceEnd - span.sourceStart - reject.length);
    const emittedPropertyRanges = new Set(accept.map((character) => character.run).filter(runHasPropertyChange)).size;
    const propertyCoverageComplete = accept.length === span.end - span.start
      && accept.every((character) => runHasPropertyChange(character.run));
    const expectedText = span.expectedText ?? '';
    const textMatches = expectedText.length > 0
      && accept.map((character) => character.text).join('') === expectedText
      && reject.map((character) => character.text).join('') === expectedText;
    const propertyStateMatches = accept.length === span.end - span.start
      && accept.every((character) => runMatchesRetainedFormat(character.run, span.format));
    return {
      operationId: span.operationId,
      paragraphId: span.paragraphId,
      revisedStart: span.start,
      revisedEnd: span.end,
      sourceStart: span.sourceStart,
      sourceEnd: span.sourceEnd,
      properties: span.changedProperties ?? Object.keys(span.format).sort() as Array<'highlight' | 'underline'>,
      emittedPropertyRanges,
      textRevisionOverlaps,
      propertyCoverageComplete,
      textMatches,
      propertyStateMatches,
    };
  });
  const report = {
    declaredSpans: spans.length,
    changedProperties: diagnostics.reduce((sum, diagnostic) => sum + diagnostic.properties.length, 0),
    emittedPropertyRanges: diagnostics.reduce((sum, diagnostic) => sum + diagnostic.emittedPropertyRanges, 0),
    textRevisionOverlaps: diagnostics.reduce((sum, diagnostic) => sum + diagnostic.textRevisionOverlaps, 0),
    diagnostics,
    passed: true,
  };
  report.passed = report.textRevisionOverlaps === 0
    && diagnostics.every((diagnostic) => diagnostic.emittedPropertyRanges > 0
      && diagnostic.propertyCoverageComplete
      && diagnostic.textMatches
      && diagnostic.propertyStateMatches);
  return report;
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

export type ResolvedRetainedSpan = RetainedFormatSpan & {
  operationId: string;
  paragraphId: string;
  sourceStart: number;
  sourceEnd: number;
  expectedText: string;
  changedProperties?: Array<'highlight' | 'underline'>;
};

function runSpans(paragraph: Element): RunSpan[] {
  let offset = 0;
  return getParagraphRuns(paragraph).filter((run) => run.text.length > 0).map((run) => {
    const span = { start: offset, end: offset + run.text.length, run: run.r, signature: directRunPropertySignature(run.r) };
    offset = span.end;
    return span;
  });
}

function directRunPropertiesForSource(run: Element, localName: string): Element[] {
  const rPr = Array.from(run.childNodes).find((child): child is Element =>
    child.nodeType === 1 && (child as Element).localName === 'rPr');
  return rPr === undefined ? [] : Array.from(rPr.childNodes).filter((child): child is Element =>
    child.nodeType === 1 && (child as Element).localName === localName);
}

function propertyValue(property: Element): string {
  return (property.getAttribute('w:val') ?? '').toLowerCase();
}

function changedRetainedProperties(run: Element, format: RetainedFormat): Array<'highlight' | 'underline'> {
  const underline = directRunPropertiesForSource(run, 'u');
  const highlight = directRunPropertiesForSource(run, 'highlight');
  const changed: Array<'highlight' | 'underline'> = [];
  if (format.underline !== undefined && (format.underline === 'none'
    ? underline.some((property) => propertyValue(property) !== 'none')
    : underline.length !== 1 || !['', 'single', '1', 'true', 'on'].includes(propertyValue(underline[0]!)))) changed.push('underline');
  if (format.highlight !== undefined && (format.highlight === 'none'
      ? highlight.some((property) => propertyValue(property) !== 'none')
      : highlight.length !== 1 || propertyValue(highlight[0]!) !== format.highlight)) changed.push('highlight');
  return changed.sort();
}

function mapRetainedSpan(
  operationId: string,
  paragraphId: string,
  span: RetainedFormatSpan,
  hunks: TextHunk[],
  sourceSpans: RunSpan[],
  sourceText: string,
): ResolvedRetainedSpan {
  const overlapsChange = hunks.some((hunk) => {
    if (hunk.revisedStart === hunk.revisedEnd) {
      return hunk.start !== hunk.end && hunk.revisedStart > span.start && hunk.revisedStart < span.end;
    }
    return hunk.revisedStart < span.end && hunk.revisedEnd > span.start;
  });
  if (overlapsChange) {
    throw new DocxMarkdocError('NON_COMMON_RETAINED_SCOPE', `Operation ${operationId} retain-format span overlaps changed text.`);
  }
  const delta = hunks
    .filter((hunk) => hunk.revisedEnd <= span.start)
    .reduce((sum, hunk) => sum + hunk.replacement.length - (hunk.end - hunk.start), 0);
  const sourceStart = span.start - delta;
  const sourceEnd = span.end - delta;
  const touched = sourceSpans.filter((candidate) => candidate.start < sourceEnd && candidate.end > sourceStart);
  if (touched.length === 0 || sourceStart < 0 || sourceEnd <= sourceStart) {
    throw new DocxMarkdocError('NON_COMMON_RETAINED_SCOPE', `Operation ${operationId} retain-format span cannot be mapped to source text.`);
  }
  if (new Set(touched.map((candidate) => candidate.signature)).size !== 1) {
    throw new DocxMarkdocError('MIXED_FORMAT_RETAINED_SCOPE', `Operation ${operationId} retain-format span crosses multiple source formatting classes.`);
  }
  const changedProperties = changedRetainedProperties(touched[0]!.run, span.format);
  if (changedProperties.length === 0) {
    throw new DocxMarkdocError('NOOP_RETAINED_FORMAT', `Operation ${operationId} retain-format declaration changes no admitted direct property.`);
  }
  return { ...span, operationId, paragraphId, sourceStart, sourceEnd, expectedText: sourceText.slice(sourceStart, sourceEnd), changedProperties };
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

function validateRunFormatScopes(ir: MarkdocEditIR, source: DocxDocument): ResolvedRetainedSpan[] {
  const retained: ResolvedRetainedSpan[] = [];
  for (const operation of ir.operations) {
    if (isTableRowOperation(operation)) continue;
    if (!operation.runFormat && !(operation.runFormatSpans?.length) && !(operation.retainedFormatSpans?.length)) continue;
    if (isInsertOperation(operation)) {
      if (operation.retainedFormatSpans?.length) {
        throw new DocxMarkdocError('NON_COMMON_RETAINED_SCOPE', `Operation ${operation.operationId} cannot retain-format generated insertion text.`);
      }
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
    let hunks: TextHunk[];
    try {
      hunks = textHunks(original, operation.revisedText);
    } catch (error) {
      if (operation.retainedFormatSpans?.length && error instanceof DocxMarkdocError
        && error.code === 'FORMATTING_ALIGNMENT_TOO_COMPLEX') {
        throw new DocxMarkdocError('NON_COMMON_RETAINED_SCOPE', `Operation ${operation.operationId} retain-format span exceeds the bounded common-text alignment.`, { cause: error.message });
      }
      throw error;
    }
    if (operation.runFormat) requireSingleGeneratedHunk(operation.operationId, hunks);
    validateInlineRunFormatSpans(operation.operationId, hunks, operation.runFormatSpans ?? []);
    const paragraph = assertAdmittedStructure(source, operation.id);
    const sourceSpans = runSpans(paragraph);
    let previousEnd = -1;
    for (const span of operation.retainedFormatSpans ?? []) {
      if (span.start < previousEnd || span.end <= span.start || span.end > operation.revisedText.length) {
        throw new DocxMarkdocError('AMBIGUOUS_RETAINED_FORMAT_SCOPE', `Operation ${operation.operationId} has empty, overlapping, or out-of-range retain-format spans.`);
      }
      previousEnd = span.end;
      retained.push(mapRetainedSpan(operation.operationId, operation.id, span, hunks, sourceSpans, original));
    }
  }
  return retained;
}

function isInsertOperation(operation: EditOperation): operation is InsertOperation {
  return operation.kind === 'insert-before' || operation.kind === 'insert-after';
}

function isTableRowOperation(operation: EditOperation): operation is TableRowOperation {
  return operation.kind === 'insert-table-rows' || operation.kind === 'delete-table-row';
}

function sourceOperationId(operation: EditOperation): string | null {
  return isInsertOperation(operation) || isTableRowOperation(operation) ? null : operation.id;
}

function nearestTableCell(paragraph: Element | null): Element | undefined {
  for (let current = paragraph?.parentNode; current; current = current.parentNode) {
    if (current.nodeType === 1 && (current as Element).localName === 'tc') return current as Element;
  }
  return undefined;
}

function nearestTableRow(paragraph: Element | null): Element | undefined {
  for (let current = paragraph?.parentNode; current; current = current.parentNode) {
    if (current.nodeType === 1 && (current as Element).localName === 'tr') return current as Element;
  }
  return undefined;
}

function directChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.childNodes)
    .filter((child): child is Element => child.nodeType === 1 && (child as Element).localName === localName);
}

const TABLE_CELL_BLOCK_ELEMENTS = new Set(['p', 'tbl', 'sdt', 'customXml', 'altChunk']);

/**
 * A vertical-merge continuation cell does not own independently visible
 * content; Word renders the restart cell's content for the merged region.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.84
 * @see https://github.com/UseJunior/safe-docx/issues/998
 */
function isVerticalMergeContinuation(cell: Element): boolean {
  const tcPr = directChildren(cell, 'tcPr')[0];
  const merge = tcPr ? directChildren(tcPr, 'vMerge')[0] : undefined;
  if (!merge) return false;
  const value = merge.getAttribute('w:val') || merge.getAttribute('val');
  return !value || value === 'continue';
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
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const cellForId = (id: string): Element | undefined => nearestTableCell(source.getParagraphElementById(id));
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
    // Only legacy source-only syntax omits the before state. A change block's
    // authored before text is evidence to verify, never a placeholder to replace.
    if (projected.originalTextFromSource && replacement?.originalTextFromSource) {
      projected.originalText = sourceText;
      replacement.originalText = sourceText;
      delete projected.originalTextFromSource;
      delete replacement.originalTextFromSource;
    }
    if (projected.originalText !== sourceText || (replacement && replacement.originalText !== sourceText)) {
      throw new DocxMarkdocError('SOURCE_TEXT_DRIFT', `Paragraph ${node.id} original projection does not match source.`);
    }
    if (node.table_context) unsupported.add('table-grid-operations');
    if (node.footnote_refs?.length) unsupported.add('footnotes');
    if (node.comments?.length) unsupported.add('comments');
  });
  const deletionsByCell = new Map<Element, { paragraphs: Set<Element>; operationId: string }>();
  for (const operation of ir.operations) {
    const id = sourceOperationId(operation);
    if (!id) continue;
    const node = nodeById.get(id);
    if (!node) throw new DocxMarkdocError('MISSING_ANCHOR', `Operation ${operation.operationId} targets missing paragraph ${id}.`);
    const cell = cellForId(id);
    if ((cell && isVerticalMergeContinuation(cell)) || node.footnote_refs?.length || node.comments?.length) {
      throw new DocxMarkdocError('UNSUPPORTED_EDIT_STRUCTURE', `Operation ${operation.operationId} intersects unsupported structure at ${id}.`);
    }
    if (cell && operation.kind === 'delete-source') {
      const paragraph = source.getParagraphElementById(id);
      if (!paragraph) throw new DocxMarkdocError('MISSING_ANCHOR', `Paragraph ${id} was not found.`);
      const entry = deletionsByCell.get(cell) ?? {
        paragraphs: new Set<Element>(),
        operationId: operation.operationId,
      };
      entry.paragraphs.add(paragraph);
      deletionsByCell.set(cell, entry);
    }
  }
  for (const [cell, entry] of deletionsByCell) {
    const remainingBlocks = Array.from(cell.childNodes)
      .filter((child): child is Element => child.nodeType === 1)
      .filter((child) => TABLE_CELL_BLOCK_ELEMENTS.has(child.localName) && !entry.paragraphs.has(child));
    if (remainingBlocks.at(-1)?.localName !== 'p') {
      throw new DocxMarkdocError(
        'UNSUPPORTED_EDIT_STRUCTURE',
        `Operation ${entry.operationId} would leave a table cell without a trailing paragraph.`,
      );
    }
  }
  for (const operation of ir.operations.filter(isInsertOperation)) {
    const anchor = nodeById.get(operation.anchorId);
    if (!anchor) {
      throw new DocxMarkdocError('MISSING_ANCHOR', `Operation ${operation.operationId} targets missing paragraph ${operation.anchorId}.`);
    }
    if (anchor.footnote_refs?.length || anchor.comments?.length) {
      throw new DocxMarkdocError('UNSUPPORTED_EDIT_STRUCTURE', `Operation ${operation.operationId} intersects unsupported structure at ${operation.anchorId}.`);
    }
    const styleSource = operation.styleSourceId
      ? nodeById.get(operation.styleSourceId)
      : anchor;
    if (!styleSource) {
      throw new DocxMarkdocError(
        'MISSING_STYLE_SOURCE',
        `Operation ${operation.operationId} names missing style source ${operation.styleSourceId}.`,
      );
    }
    const anchorCell = cellForId(anchor.id);
    const styleCell = cellForId(styleSource.id);
    const crossesTableCell = anchorCell ? styleCell !== anchorCell : styleCell !== undefined;
    if ((anchorCell && isVerticalMergeContinuation(anchorCell))
      || crossesTableCell || styleSource.footnote_refs?.length || styleSource.comments?.length) {
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

  const structuralRows = new Map<Element, TableRowOperation>();
  const deletedRows = new Map<Element, TableRowOperation>();
  for (const operation of ir.operations.filter(isTableRowOperation)) {
    const anchor = nodeById.get(operation.anchorId);
    if (!anchor) throw new DocxMarkdocError('MISSING_ANCHOR', `Operation ${operation.operationId} targets missing paragraph ${operation.anchorId}.`);
    const row = nearestTableRow(source.getParagraphElementById(operation.anchorId));
    if (!row) throw new DocxMarkdocError('UNSUPPORTED_EDIT_STRUCTURE', `Operation ${operation.operationId} does not target a table row.`);
    const prior = structuralRows.get(row);
    if (prior) {
      throw new DocxMarkdocError('CONFLICTING_TABLE_ROW_OPERATIONS', `Operations ${prior.operationId} and ${operation.operationId} target the same source row.`);
    }
    structuralRows.set(row, operation);
    if (operation.kind === 'delete-table-row') deletedRows.set(row, operation);
  }
  for (const operation of ir.operations) {
    if (isTableRowOperation(operation)) {
      if (operation.kind === 'insert-table-rows') {
        const row = nearestTableRow(source.getParagraphElementById(operation.anchorId));
        if (row && deletedRows.has(row)) {
          throw new DocxMarkdocError('STRUCTURAL_ANCHOR_DELETED', `Operation ${operation.operationId} is anchored on a row deleted by the same build.`);
        }
      }
      continue;
    }
    const targetId = isInsertOperation(operation) ? operation.anchorId : operation.id;
    const targetRow = nearestTableRow(source.getParagraphElementById(targetId));
    if (targetRow && deletedRows.has(targetRow)) {
      throw new DocxMarkdocError('STRUCTURAL_TARGET_DELETED', `Operation ${operation.operationId} targets a row deleted by the same build.`);
    }
    if (isInsertOperation(operation) && operation.styleSourceId) {
      const styleRow = nearestTableRow(source.getParagraphElementById(operation.styleSourceId));
      if (styleRow && deletedRows.has(styleRow)) {
        throw new DocxMarkdocError('STRUCTURAL_FORMAT_SOURCE_DELETED', `Operation ${operation.operationId} uses a formatting source in a deleted row.`);
      }
    }
  }
  for (const annotation of ir.annotations) {
    if (annotation.id.startsWith('rationale:')) continue;
    const positions = annotation.anchor.kind === 'point'
      ? [annotation.anchor.point]
      : [annotation.anchor.start, annotation.anchor.end];
    if (positions.some((position) => {
      const row = nearestTableRow(source.getParagraphElementById(position.paragraphId));
      return row !== undefined && deletedRows.has(row);
    })) {
      throw new DocxMarkdocError('STRUCTURAL_ANNOTATION_TARGET_DELETED', `Annotation ${annotation.id} targets a row deleted by the same build.`);
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

async function applyOperations(
  sourceBuffer: Buffer,
  ir: MarkdocEditIR,
  retainedSpans: ResolvedRetainedSpan[],
): Promise<{ buffer: Buffer; ranges: AttributedRange[] }> {
  const document = await DocxDocument.load(sourceBuffer);
  const ranges: AttributedRange[] = [];
  for (const operation of ir.operations) {
    if (operation.kind === 'insert-table-rows') {
      const insertedCells: Array<{ id: string; text: string }> = [];
      let anchorId = operation.anchorId;
      for (const row of operation.rows) {
        const inserted = document.insertTableRow({
          positionalAnchorNodeId: anchorId,
          relativePosition: operation.relativePosition,
          cellTexts: row,
        });
        insertedCells.push(...inserted.cellParagraphIds.map((id, index) => ({ id, text: row[index] ?? '' })));
        if (operation.relativePosition === 'AFTER') anchorId = inserted.cellParagraphIds[0]!;
      }
      const nonEmptyCells = insertedCells.filter((cell) => cell.text.length > 0);
      if (nonEmptyCells.length > 0) {
        ranges.push({
          operationId: operation.operationId,
          projection: 'clean',
          startParagraphId: nonEmptyCells[0]!.id,
          start: 0,
          endParagraphId: nonEmptyCells.at(-1)!.id,
          end: nonEmptyCells.at(-1)!.text.length,
        });
      }
      continue;
    }
    if (operation.kind === 'delete-table-row') {
      const anchorParagraph = document.getParagraphElementById(operation.anchorId);
      const row = nearestTableRow(anchorParagraph);
      if (!row) throw new DocxMarkdocError('UNSUPPORTED_EDIT_STRUCTURE', `Operation ${operation.operationId} does not target a table row.`);
      const rowParagraphs = Array.from(row.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p'));
      const ids = rowParagraphs.map((paragraph) => getParagraphBookmarkId(paragraph)).filter((id): id is string => Boolean(id));
      if (ids.length === 0) throw new DocxMarkdocError('MISSING_ANCHOR', `Operation ${operation.operationId} row has no anchored paragraphs.`);
      const nonEmptyParagraphs = ids.map((id) => ({ id, text: document.getParagraphTextById(id) ?? '' }))
        .filter((paragraph) => paragraph.text.length > 0);
      if (nonEmptyParagraphs.length > 0) {
        ranges.push({
          operationId: operation.operationId,
          projection: 'source',
          startParagraphId: nonEmptyParagraphs[0]!.id,
          start: 0,
          endParagraphId: nonEmptyParagraphs.at(-1)!.id,
          end: nonEmptyParagraphs.at(-1)!.text.length,
        });
      }
      document.deleteTableRow({ targetParagraphId: operation.anchorId });
      continue;
    }
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
    const operationRetained = retainedSpans.filter((span) => span.operationId === operation.operationId);
    for (const span of [...operationRetained].reverse()) {
      try {
        document.formatTextAtRange({
          targetParagraphId: operation.id,
          start: span.start,
          end: span.end,
          format: span.format,
        });
      } catch (error) {
        const cause = error as Error & { code?: string };
        if (cause.code === 'UNSUPPORTED_EDIT') {
          throw new DocxMarkdocError(
            'UNSUPPORTED_EDIT_STRUCTURE',
            `Operation ${operation.operationId} retain-format span intersects unsupported run content.`,
            { cause: cause.message },
          );
        }
        throw error;
      }
    }
    if (operationHunks.length === 0 && operationRetained.length > 0) {
      ranges.push({
        operationId: operation.operationId,
        projection: 'clean',
        startParagraphId: operation.id,
        start: operationRetained[0]!.start,
        endParagraphId: operation.id,
        end: operationRetained.at(-1)!.end,
      });
    }
  }
  return { buffer: (await document.toBuffer({ cleanBookmarks: false })).buffer, ranges };
}

async function preflightTableRowOperations(sourceBuffer: Buffer, ir: MarkdocEditIR): Promise<void> {
  const operations = ir.operations.filter(isTableRowOperation);
  if (operations.length === 0) return;
  const document = await DocxDocument.load(sourceBuffer);
  let activeOperation: TableRowOperation | undefined;
  try {
    for (const operation of operations) {
      activeOperation = operation;
      if (operation.kind === 'delete-table-row') {
        document.deleteTableRow({ targetParagraphId: operation.anchorId });
        continue;
      }
      let anchorId = operation.anchorId;
      for (const row of operation.rows) {
        const inserted = document.insertTableRow({
          positionalAnchorNodeId: anchorId,
          relativePosition: operation.relativePosition,
          cellTexts: row,
        });
        if (operation.relativePosition === 'AFTER') anchorId = inserted.cellParagraphIds[0]!;
      }
    }
  } catch (error) {
    if (error instanceof DocxMarkdocError) throw error;
    const cause = error as Error & { code?: string; detail?: unknown };
    throw new DocxMarkdocError(
      'TABLE_ROW_PREFLIGHT_FAILED',
      `Table-row operation ${activeOperation?.operationId ?? '<unknown>'} failed structural preflight: ${cause.message}`,
      { operationId: activeOperation?.operationId, causeCode: cause.code, causeDetail: cause.detail },
    );
  }
}

type RationaleMaterialization = {
  range: AttributedRange;
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
  revisionGrouping: { policy: RevisionGroupingPolicy; source: RevisionGroupingSource };
};

function resolveCompilation(options: CompileOptions, ir: MarkdocEditIR): ResolvedCompilation {
  const profile = ir.compilation;
  if (options.revisionGrouping
      && !['token-minimal', 'readable-whitespace'].includes(options.revisionGrouping.policy)) {
    throw new DocxMarkdocError('INVALID_REVISION_GROUPING', 'revisionGrouping.policy must be token-minimal or readable-whitespace.');
  }
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
  const revisionGrouping = options.revisionGrouping
    ? { policy: options.revisionGrouping.policy, source: options.revisionGrouping.source ?? 'api' as const }
    : profile?.revisionGrouping
      ? { policy: profile.revisionGrouping, source: 'markdoc' as const }
      : { policy: 'token-minimal' as const, source: 'default' as const };
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
    revisionGrouping,
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
  return [...grouped].map(([operationId, texts]) => ({
    range: { operationId } as AttributedRange,
    texts,
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
  const sourceRevisions = await revisionSnapshot(sourceBuffer);
  const sourceContainsRevisions = sourceRevisions.length > 0;
  if (sourceContainsRevisions && ir.operations.length > 0) {
    throw new DocxMarkdocError(
      'EXISTING_REVISIONS_WITH_OPERATIVE_EDITS_UNSUPPORTED',
      'A source with existing revisions can only compile annotation-only changes.',
      { existingRevisionCount: sourceRevisions.length, operationIds: ir.operations.map((operation) => operation.operationId) },
    );
  }
  const sourceDocument = await DocxDocument.load(sourceBuffer);
  const { unsupported } = validateAgainstSource(ir, sourceDocument);
  const retainedSpans = validateRunFormatScopes(ir, sourceDocument);
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
  await preflightTableRowOperations(sourceBuffer, ir);
  const applied = await applyOperations(sourceBuffer, ir, retainedSpans);
  const clean = applied.buffer;
  const rangesByOperation = new Map(applied.ranges.map((range) => [range.operationId, range]));
  for (const item of materializations) {
    const range = rangesByOperation.get(item.range.operationId);
    if (!range) throw new DocxMarkdocError('RATIONALE_ANCHOR_UNAVAILABLE', `Operation ${item.range.operationId} has no attributable edit range.`);
    item.range = range;
  }
  const comparisonOptions: NonNullable<Parameters<typeof compareDocumentsAtomizer>[2]> = {
    author: resolvedCompilation.author,
    date: resolvedCompilation.date,
    revisionAttributionRanges: materializations.map(({ range }) => ({
      operationId: range.operationId,
      side: range.projection === 'source' ? 'original' : 'revised',
      startParagraphId: range.startParagraphId,
      start: range.start,
      endParagraphId: range.endParagraphId,
      end: range.end,
    })),
    revisionGrouping: resolvedCompilation.revisionGrouping.policy,
    // No finite refinement budget: dense rewrites must retain preservable
    // lexical and punctuation tokens. Readability-oriented whitespace bridging
    // remains valid where it coalesces an otherwise fragmented replacement
    // without changing either accept/reject character projection.
    // See https://github.com/UseJunior/safe-docx/issues/846 and pull/43.
  };
  let comparison: Awaited<ReturnType<typeof compareDocumentsAtomizer>> | undefined;
  try {
    comparison = ir.operations.length === 0
      ? undefined
      : await compareDocumentsAtomizer(sourceBuffer, clean, comparisonOptions);
  } catch (error) {
    if (materializations.length === 0) throw error;
    throw new DocxMarkdocError(
      'RATIONALE_ANCHOR_AMBIGUOUS',
      'Selected rationale could not be mapped to one exact tracked edit range.',
      { cause: (error as Error).message },
    );
  }
  // A no-operation replay has no comparison to represent. Preserve the exact
  // source package instead of needlessly reassembling relationship IDs and
  // turning package-normalization noise into a false formatting failure.
  let tracked = comparison?.document ?? sourceBuffer;
  if (materializations.length > 0) {
    const identity = resolvedCompilation.commentIdentity!;
    try {
      if (comparison?.engine !== 'tagged-tree') {
        throw new Error('tagged attribution comparison did not publish the tagged strategy');
      }
      const attributedByOperation = new Map(
        (comparison.revisionAttributions ?? []).map((item) => [item.operationId, item]),
      );
      const comments = materializations.flatMap((item) => {
        const attributed = attributedByOperation.get(item.range.operationId);
        if (!attributed) {
          throw new Error(`operation ${item.range.operationId} has no exact tagged revision range`);
        }
        return item.texts.map((text) => ({
          startRevision: attributed.startRevision,
          endRevision: attributed.endRevision,
          text,
        }));
      });
      tracked = await addTrackedRangeComments(comparison.document, comments.map((item) => ({
        ...item,
        author: identity.author,
        initials: identity.initials,
        date: resolvedCompilation.date.toISOString(),
      })));
    } catch (error) {
      throw new DocxMarkdocError(
        'RATIONALE_ANCHOR_AMBIGUOUS',
        'Selected rationale could not be mapped to one exact tracked edit range.',
        { cause: (error as Error).message },
      );
    }
  }
  let annotationProjection: AnnotationProjectionResult = {
    buffer: tracked,
    profile: options.annotationPresentation ?? ir.compilation?.annotationPresentation ?? {},
    profileDigest: sha256(Buffer.from(JSON.stringify(options.annotationPresentation ?? ir.compilation?.annotationPresentation ?? {}))),
    dispositions: [],
    warnings: [],
  };
  if (ir.annotations.some((annotation) => !annotation.id.startsWith('rationale:'))) {
    annotationProjection = await projectAnnotations(tracked, ir, options.annotationPresentation ?? ir.compilation?.annotationPresentation);
    tracked = annotationProjection.buffer;
  }
  const trackedRevisions = await revisionSnapshot(tracked);
  const revisionPreservation = verifyRevisionPreservation(sourceRevisions, trackedRevisions);
  if (!revisionPreservation.preserved) {
    throw new DocxMarkdocError(
      'ANNOTATION_REVISION_TOPOLOGY_UNSUPPORTED',
      'Annotation projection would change existing revision XML, order, or story placement.',
      {
        sourceRevisionCount: sourceRevisions.length,
        projectedRevisionCount: trackedRevisions.length,
        missingRevisions: revisionPreservation.missing.slice(0, 8),
      },
    );
  }
  const existingRevisionsPreserved = revisionPreservation.preserved;
  const retainedFormatting = certifyRetainedFormatting(await DocxDocument.load(tracked), retainedSpans);
  const acceptedDoc = await DocxDocument.load(tracked);
  const rejectedDoc = await DocxDocument.load(tracked);
  const [acceptResult, rejectResult] = await Promise.all([acceptedDoc.acceptChanges(), rejectedDoc.rejectChanges()]);
  const cleanDoc = await DocxDocument.load(clean);
  let sourceProjectionDocument = sourceDocument;
  let cleanProjectionDocument = cleanDoc;
  if (sourceContainsRevisions) {
    sourceProjectionDocument = await DocxDocument.load(sourceBuffer);
    cleanProjectionDocument = await DocxDocument.load(clean);
    await Promise.all([sourceProjectionDocument.rejectChanges(), cleanProjectionDocument.acceptChanges()]);
  }
  const sourceText = verificationText(sourceProjectionDocument);
  const rejectedText = verificationText(rejectedDoc);
  const cleanText = verificationText(cleanProjectionDocument);
  const acceptedText = verificationText(acceptedDoc);
  const completeness = assessDraftCompleteness(ir, declaredOperationIds, cleanText);
  const rejectAllEqualsSource = rejectedText === sourceText;
  const acceptAllEqualsClean = acceptedText === cleanText;
  const formattingProjection = await verifyFormattingProjections(sourceBuffer, clean, tracked, sourceContainsRevisions);
  const unchangedPackagePartsPreserved = await unchangedPartsEqual(sourceBuffer, clean);
  let tableTopology: TableTopologyReport | undefined;
  if (ir.operations.some(isTableRowOperation)) {
    const [acceptedBuffer, rejectedBuffer] = await Promise.all([
      acceptedDoc.toBuffer({ cleanBookmarks: false }).then((result) => result.buffer),
      rejectedDoc.toBuffer({ cleanBookmarks: false }).then((result) => result.buffer),
    ]);
    const [sourceTables, rejectedTables, cleanTables, acceptedTables] = await Promise.all([
      normalizedTableTopology(sourceBuffer),
      normalizedTableTopology(rejectedBuffer),
      normalizedTableTopology(clean),
      normalizedTableTopology(acceptedBuffer),
    ]);
    const sourceRejectDiagnostics = topologyDiagnostics('source-reject', sourceTables, rejectedTables);
    const cleanAcceptDiagnostics = topologyDiagnostics('clean-accept', cleanTables, acceptedTables);
    const sourceRejectAllEqual = sourceRejectDiagnostics.length === 0;
    const cleanAcceptAllEqual = cleanAcceptDiagnostics.length === 0;
    const unresolvedRowRevisions = {
      accept: acceptResult.unresolvedRowRevisions,
      reject: rejectResult.unresolvedRowRevisions,
    };
    tableTopology = {
      sourceRejectAllEqual,
      cleanAcceptAllEqual,
      unresolvedRowRevisions,
      diagnostics: [...sourceRejectDiagnostics, ...cleanAcceptDiagnostics],
      passed: sourceRejectAllEqual && cleanAcceptAllEqual
        && unresolvedRowRevisions.accept === 0 && unresolvedRowRevisions.reject === 0,
    };
  }
  // Sources with revisions are restricted above to annotation-only builds, so
  // every replacement wrapper in their output predates this compilation. The
  // certificate records grouping introduced by this build, not the physical
  // grouping of preserved third-party revisions (the release verifier reports
  // that independent finished-OOXML evidence separately).
  const revisionGroupingEvidence = sourceContainsRevisions
    ? { coalescedSpaceTokens: 0, groupedChains: 0 }
    : emittedRevisionGrouping(await documentXml(tracked));
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
    existingRevisionsPreserved,
    existingRevisionCount: sourceRevisions.length,
    projectedRevisionCount: trackedRevisions.length,
    unsupportedStructures: unsupported,
    appliedOperations: declaredOperationIds,
    retainedFormatting,
    revisionGrouping: {
      ...resolvedCompilation.revisionGrouping,
      ...revisionGroupingEvidence,
    },
    ...(tableTopology ? { tableTopology } : {}),
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
    annotationRendering: {
      profile: annotationProjection.profile,
      profileDigest: annotationProjection.profileDigest,
      dispositions: annotationProjection.dispositions,
      warnings: annotationProjection.warnings,
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
  if (!certificate.projectionPassed) throw new DocxMarkdocError(
    retainedSpans.length > 0 && !retainedFormatting.passed ? 'NON_COMMON_RETAINED_SCOPE' : 'VERIFICATION_FAILED',
    retainedSpans.length > 0 && !retainedFormatting.passed
      ? 'Retained formatting could not be certified over comparator-common text.'
      : 'Strict replay verification failed.', {
    certificate,
    sourceText,
    rejectedText,
    cleanText,
    acceptedText,
  });
  return { clean, tracked, ir, certificate };
}
