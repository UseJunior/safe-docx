import type { UnrepresentedChange } from './compare-types.js';

function describeScope(change: UnrepresentedChange): string {
  if (change.scope === 'section') return 'section properties';
  return change.role ? `${change.role} ${change.scope}` : change.scope;
}

/**
 * Render one caller-facing warning per unrepresented change.
 *
 * `compareDocuments` reports `unrepresentedChanges` when an input difference
 * is preserved in the output package (always revised-based) without any
 * revision markup describing it. A caller that only reads `stats` sees a
 * clean success and never learns that part of the difference is missing from
 * the redline (#1029). Every surface that writes a redline passes the
 * structured list through and emits these strings as `warnings`.
 */
export function formatUnrepresentedChangeWarnings(
  changes: readonly UnrepresentedChange[] | undefined,
): string[] {
  if (!changes || changes.length === 0) return [];
  return changes.map((change) =>
    `Unrepresented change: ${change.kind} ${describeScope(change)} in section ${change.sectionIndex + 1} ` +
    `(sectionIndex ${change.sectionIndex}) has no tracked-change markup in the redline; ` +
    'the output carries the revised state for it without a revision. Review that part manually.',
  );
}

/** One-line summary for appending to a success message. */
export function summarizeUnrepresentedChanges(
  changes: readonly UnrepresentedChange[] | undefined,
): string | undefined {
  if (!changes || changes.length === 0) return undefined;
  const noun = changes.length === 1 ? 'input difference is' : 'input differences are';
  return `WARNING: ${changes.length} ${noun} not represented by tracked changes in the redline; see unrepresented_changes and warnings.`;
}
