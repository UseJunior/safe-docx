import type { UnrepresentedChange } from './compare-types.js';

function describeScope(change: UnrepresentedChange): string {
  if (change.scope === 'section') return 'section properties';
  if (change.scope === 'contentControl') {
    const control = change.contentControl;
    const identity = [
      control?.tag !== undefined ? `tag "${control.tag}"` : undefined,
      control?.alias !== undefined ? `alias "${control.alias}"` : undefined,
      control?.id !== undefined ? `id ${control.id}` : undefined,
    ].filter((part) => part !== undefined);
    if (control?.element === 'sdt' || control?.element === 'customXml') {
      const noun = control.element === 'sdt' ? 'block content control' : 'block custom XML element';
      return `${noun} (w:${control.element} #${control.index + 1}${identity.length > 0 ? `, ${identity.join(', ')}` : ''})`;
    }
    const ordinal = control ? `content control #${control.index + 1}` : 'content control';
    const element = control?.element ?? 'sdtPr';
    return `properties (w:${element}) of ${ordinal}${identity.length > 0 ? ` (${identity.join(', ')})` : ''}`;
  }
  if (change.scope === 'picture') {
    const picture = change.picture;
    if (!picture) return 'picture';
    const story = picture.story === 'body'
      ? 'the main story'
      : `the ${change.role ? `${change.role} ` : ''}${picture.story} (${picture.partPath})`;
    const name = picture.name !== undefined ? ` "${picture.name}"` : '';
    const target = picture.target !== undefined ? ` -> ${picture.target}` : '';
    return `picture${name} (w:${picture.element} #${picture.index + 1}, relationship ${picture.relationshipId}${target}) ` +
      `in ${story}`;
  }
  if (change.scope === 'drawing') {
    const drawing = change.drawing;
    const shape = 'drawing (text box or picture size, position or wrap)';
    if (!drawing) return shape;
    const story = drawing.story === 'body'
      ? 'the main story'
      : `the ${change.role ? `${change.role} ` : ''}${drawing.story} (${drawing.partPath})`;
    const name = drawing.name !== undefined ? ` "${drawing.name}"` : '';
    return `${shape}${name} (w:${drawing.element}, text box #${drawing.index + 1}) in ${story}`;
  }
  return change.role ? `${change.role} ${change.scope}` : change.scope;
}

function isWholeContainer(change: UnrepresentedChange): boolean {
  return change.scope === 'contentControl'
    && (change.contentControl?.element === 'sdt' || change.contentControl?.element === 'customXml');
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
  return changes.map((change) => isWholeContainer(change)
    ? `Unrepresented change: ${change.kind} ${describeScope(change)} in section ${change.sectionIndex + 1} ` +
      `(sectionIndex ${change.sectionIndex}): the redline tracks its content, but the container itself takes no ` +
      `revision, so ${change.kind === 'added' ? 'Reject All' : 'Accept All'} leaves it empty. Review that part manually.`
    :
    `Unrepresented change: ${change.kind} ${describeScope(change)} in section ${change.sectionIndex + 1} ` +
    `(sectionIndex ${change.sectionIndex}) has no tracked-change markup in the redline; ` +
    (change.scope === 'drawing'
      ? 'the redline shows the revised shape, which Reject All keeps. Review that part manually.'
      : 'the output carries the revised state for it without a revision. Review that part manually.'),
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
