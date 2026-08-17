import type { AdjacentRevisionPair, EditOperation, EditPair, InsertOperation, MarkdocEditIR } from './types.js';

function isInsertOperation(operation: EditOperation): operation is InsertOperation {
  return operation.kind === 'insert-before' || operation.kind === 'insert-after';
}

export function exportEditPairs(
  ir: MarkdocEditIR,
  options: { contextParagraphs?: number; verified?: boolean; provenance?: Record<string, string> } = {},
): EditPair[] {
  const context = Math.max(0, options.contextParagraphs ?? 1);
  const rationales = new Map<string, MarkdocEditIR['rationales']>();
  for (const item of ir.rationales) {
    const existing = rationales.get(item.operationId) ?? [];
    rationales.set(item.operationId, [...existing, item]);
  }
  const indexById = new Map(ir.scaffold.map((paragraph, index) => [paragraph.id, index]));
  return ir.operations.map((operation) => {
    const anchorId = isInsertOperation(operation) ? operation.anchorId : operation.id;
    const index = indexById.get(anchorId) ?? -1;
    const before = isInsertOperation(operation) ? '' : operation.originalText;
    const after = operation.kind === 'delete-source' ? '' : operation.revisedText;
    const operationRationales = rationales.get(operation.operationId) ?? [];
    const legacyRationale = operationRationales.length === 1 ? operationRationales[0] : undefined;
    return {
      operationId: operation.operationId,
      kind: operation.kind,
      anchorId,
      before,
      after,
      contextBefore: index < 0 ? [] : ir.scaffold.slice(Math.max(0, index - context), index).map((p) => p.originalText),
      contextAfter: index < 0 ? [] : ir.scaffold.slice(index + 1, index + context + 1).map((p) => p.originalText),
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
