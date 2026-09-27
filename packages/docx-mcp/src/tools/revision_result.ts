import type { DocxDocument } from '@usejunior/docx-core';

type AcceptChangesResult = Awaited<ReturnType<DocxDocument['acceptChanges']>>;
type RejectChangesResult = Awaited<ReturnType<DocxDocument['rejectChanges']>>;

/**
 * True when an accept/reject sweep changed the document (#1084). Mirrors the
 * predicate docx-core uses to set its own dirty flag: `unresolvedRowRevisions`
 * counts revisions left in place, so it never signals a change.
 */
export function revisionResultChangedDocument(
  result: AcceptChangesResult | RejectChangesResult,
): boolean {
  if ('insertionsAccepted' in result) {
    return (
      result.insertionsAccepted > 0 ||
      result.deletionsAccepted > 0 ||
      result.movesResolved > 0 ||
      result.propertyChangesResolved > 0
    );
  }
  return (
    result.insertionsRemoved > 0 ||
    result.deletionsRestored > 0 ||
    result.movesReverted > 0 ||
    result.propertyChangesReverted > 0
  );
}
