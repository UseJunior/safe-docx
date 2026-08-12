import JSZip from 'jszip';
import {
  DocxDocument,
  computeContentFingerprint,
  getParagraphRuns,
} from '@usejunior/docx-core';
import { compareDocuments } from '@usejunior/docx-compare';
import { DocxMarkdocError } from './errors.js';
import { sha256 } from './hash.js';
import { requireMarkdoc } from './markdoc.js';
import type { CompileResult, EditOperation, InsertOperation, MarkdocEditIR, VerificationCertificate } from './types.js';

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

function assertUniformFormatting(document: DocxDocument, id: string): void {
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
  const signatures = new Set(
    getParagraphRuns(paragraph)
      .filter((run) => run.text.length > 0)
      .map((run) => directRunPropertySignature(run.r)),
  );
  if (signatures.size > 1) {
    throw new DocxMarkdocError(
      'MIXED_FORMATTING_REQUIRES_DETAIL',
      `Paragraph ${id} has mixed run formatting; inspect it and use a future explicit formatting operation.`,
    );
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
    if (node.numbering.is_auto_numbered) unsupported.add('numbering');
  });
  for (const operation of ir.operations) {
    const id = sourceOperationId(operation);
    if (!id) continue;
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node) throw new DocxMarkdocError('MISSING_ANCHOR', `Operation ${operation.operationId} targets missing paragraph ${id}.`);
    if (node.table_context || node.footnote_refs?.length || node.comments?.length || node.numbering.is_auto_numbered) {
      throw new DocxMarkdocError('UNSUPPORTED_EDIT_STRUCTURE', `Operation ${operation.operationId} intersects unsupported structure at ${id}.`);
    }
  }
  return { unsupported: [...unsupported].sort() };
}

async function applyOperations(sourceBuffer: Buffer, ir: MarkdocEditIR): Promise<Buffer> {
  const document = await DocxDocument.load(sourceBuffer);
  for (const operation of ir.operations) {
    if (isInsertOperation(operation)) {
      document.insertParagraph({
        positionalAnchorNodeId: operation.anchorId,
        relativePosition: operation.kind === 'insert-before' ? 'BEFORE' : 'AFTER',
        newText: operation.revisedText,
        styleSourceId: operation.styleSourceId,
      });
      continue;
    }
    assertUniformFormatting(document, operation.id);
    const original = document.getParagraphTextById(operation.id);
    if (original === null) throw new DocxMarkdocError('MISSING_ANCHOR', `Paragraph ${operation.id} was not found.`);
    if (operation.kind === 'delete-source') {
      const paragraph = document.getParagraphElementById(operation.id);
      paragraph?.parentNode?.removeChild(paragraph);
      continue;
    }
    document.replaceTextAtRange({
      targetParagraphId: operation.id,
      start: 0,
      end: original.length,
      replaceText: operation.revisedText,
    });
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
  const clean = await applyOperations(sourceBuffer, ir);
  const comparison = await compareDocuments(sourceBuffer, clean, {
    engine: 'atomizer',
    author: options.author ?? 'Markdoc',
    date: options.date,
    reconstructionMode: 'inplace',
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
  const rejectAllEqualsSource = rejectedText === sourceText;
  const acceptAllEqualsClean = acceptedText === cleanText;
  const unchangedPackagePartsPreserved = await unchangedPartsEqual(sourceBuffer, clean);
  const certificate: VerificationCertificate = {
    version: 1,
    sourceSha256Matches: sourceHashMatches,
    scaffoldComplete: true,
    paragraphFingerprintsMatch: true,
    operationsAppliedExactlyOnce: new Set(ir.operations.map((operation) => operation.operationId)).size === ir.operations.length,
    rejectAllEqualsSource,
    acceptAllEqualsClean,
    unchangedPackagePartsPreserved,
    unsupportedStructures: unsupported,
    appliedOperations: ir.operations.map((operation) => operation.operationId),
    passed: false,
  };
  certificate.passed = certificate.sourceSha256Matches
    && certificate.scaffoldComplete
    && certificate.paragraphFingerprintsMatch
    && certificate.operationsAppliedExactlyOnce
    && certificate.rejectAllEqualsSource
    && certificate.acceptAllEqualsClean
    && certificate.unchangedPackagePartsPreserved;
  if (!certificate.passed) throw new DocxMarkdocError('VERIFICATION_FAILED', 'Strict replay verification failed.', {
    certificate,
    sourceText,
    rejectedText,
    cleanText,
    acceptedText,
  });
  return { clean, tracked, ir, certificate };
}
