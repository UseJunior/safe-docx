import { DocxMarkdocError } from './errors.js';
import type {
  AdjacentRevisionPair,
  EditOperation,
  EditPair,
  InsertOperation,
  MarkdocEditIR,
  TableRowOperation,
} from './types.js';

function isInsertOperation(operation: EditOperation): operation is InsertOperation {
  return operation.kind === 'insert-before' || operation.kind === 'insert-after';
}

function isTableRowOperation(operation: EditOperation): operation is TableRowOperation {
  return operation.kind === 'insert-table-rows' || operation.kind === 'delete-table-row';
}

export function exportEditPairs(
  ir: MarkdocEditIR,
  options: { contextParagraphs?: number; verified?: boolean; provenance?: Record<string, string> } = {},
): EditPair[] {
  if ([...ir.scaffold, ...(ir.storyScaffold ?? [])].some((paragraph) => paragraph.originalTextFromSource)) {
    throw new DocxMarkdocError('UNRESOLVED_SOURCE_TEXT', 'Compile source-only edits against the pinned DOCX before exporting edit pairs.');
  }
  if (ir.operations.some(isTableRowOperation)) {
    throw new DocxMarkdocError(
      'STRUCTURAL_EDIT_PAIR_EXPORT_UNSUPPORTED',
      'Table-row operations cannot be represented losslessly as paragraph edit pairs; compile the canonical Markdoc directly.',
    );
  }
  const context = Math.max(0, options.contextParagraphs ?? 1);
  const rationales = new Map<string, MarkdocEditIR['rationales']>();
  for (const item of ir.rationales) {
    const existing = rationales.get(item.operationId) ?? [];
    rationales.set(item.operationId, [...existing, item]);
  }
  const paragraphOperations = ir.operations.filter((operation): operation is Exclude<EditOperation, TableRowOperation> => !isTableRowOperation(operation));
  return paragraphOperations.map((operation) => {
    const anchorId = isInsertOperation(operation) ? operation.anchorId : operation.id;
    const story = 'story' in operation ? operation.story : undefined;
    const contextScaffold = story ? (ir.storyScaffold ?? []).filter((paragraph) => paragraph.story === story) : ir.scaffold;
    const contextIndex = contextScaffold.findIndex((paragraph) => paragraph.id === anchorId);
    const before = isInsertOperation(operation) ? '' : operation.originalText;
    const after = operation.kind === 'delete-source' ? '' : operation.revisedText;
    const operationRationales = rationales.get(operation.operationId) ?? [];
    const legacyRationale = operationRationales.length === 1 ? operationRationales[0] : undefined;
    return {
      operationId: operation.operationId,
      kind: operation.kind,
      ...(story ? { story } : {}),
      anchorId,
      before,
      after,
      contextBefore: contextIndex < 0 ? [] : contextScaffold.slice(Math.max(0, contextIndex - context), contextIndex).map((p) => p.originalText),
      contextAfter: contextIndex < 0 ? [] : contextScaffold.slice(contextIndex + 1, contextIndex + context + 1).map((p) => p.originalText),
      rationales: operationRationales,
      ...(legacyRationale ? { rationale: legacyRationale.text, visibility: legacyRationale.visibility } : {}),
      verified: options.verified,
      provenance: options.provenance,
    };
  });
}

/**
 * Compare two caller-supplied canonical revisions. Labels are copied exactly;
 * this package never guesses who authored a state or why it changed.
 */
export function exportAdjacentRevisionPairs(
  before: MarkdocEditIR,
  after: MarkdocEditIR,
  options: { contextParagraphs?: number; labels?: Record<string, string> } = {},
): AdjacentRevisionPair[] {
  if (before.source.sha256 !== after.source.sha256) {
    throw new Error('Adjacent revisions must reference the same pinned source DOCX.');
  }
  const context = Math.max(0, options.contextParagraphs ?? 1);
  const beforeById = new Map(before.scaffold.map((paragraph) => [paragraph.id, paragraph.revisedText]));
  const afterById = new Map(after.scaffold.map((paragraph) => [paragraph.id, paragraph.revisedText]));
  const order = before.scaffold.map((paragraph) => paragraph.id);
  if (order.length !== after.scaffold.length || order.some((id, index) => after.scaffold[index]?.id !== id)) {
    throw new Error('Adjacent revisions must have the same ordered source scaffold.');
  }
  return order.flatMap((anchorId, index) => {
    const previous = beforeById.get(anchorId) ?? '';
    const next = afterById.get(anchorId) ?? '';
    if (previous === next) return [];
    return [{
      anchorId,
      before: previous,
      after: next,
      contextBefore: before.scaffold.slice(Math.max(0, index - context), index).map((p) => p.revisedText),
      contextAfter: before.scaffold.slice(index + 1, index + context + 1).map((p) => p.revisedText),
      labels: options.labels,
    }];
  });
}
