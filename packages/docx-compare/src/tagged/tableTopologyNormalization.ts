import { childElements } from '@usejunior/docx-core';
import type { BothNode, OriginalNode, RevisedNode, TaggedNode } from './taggedTree.js';
import { rowShape } from './tableTopologyGuard.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function isRow(element: Element): boolean {
  return element.namespaceURI === W_NS && element.localName === 'tr';
}

function isW(element: Element, ...names: string[]): boolean {
  return element.namespaceURI === W_NS && names.includes(element.localName);
}

/** The `w:tcPr` children of each direct cell of a row. */
function cellProperties(row: Element): Element[][] {
  return childElements(row).filter((cell) => isW(cell, 'tc')).map((cell) => {
    const tcPr = childElements(cell).find((child) => isW(child, 'tcPr'));
    return tcPr ? childElements(tcPr) : [];
  });
}

/**
 * Whether a row stays with the table-topology guard whatever its merges: a
 * pending cell-level topology revision, or cells inside a cell-level content
 * control, whose grid intervals a whole-row replacement does not inventory.
 */
function hasUnreplaceableCells(row: Element): boolean {
  return childElements(row).some((child) => isW(child, 'sdt', 'customXml'))
    || cellProperties(row).some((properties) =>
      properties.some((child) => isW(child, 'cellIns', 'cellDel', 'cellMerge')));
}

/** Whether a row has a cell in a vertical merge (`w:vMerge`, §17.4.84). */
function hasVerticalMerge(row: Element): boolean {
  return cellProperties(row).some((properties) => properties.some((child) => isW(child, 'vMerge')));
}

/**
 * Whether a row continues a vertical merge from the row above: one of its
 * cells has `w:vMerge` with no `w:val` or `w:val="continue"` (§17.4.84).
 */
function continuesMergeAbove(row: Element): boolean {
  return cellProperties(row).some((properties) => properties.some((child) => isW(child, 'vMerge')
    && (child.getAttributeNS(W_NS, 'val') || 'continue') === 'continue'));
}

/**
 * The grid columns at which a row's cells continue a vertical merge from the
 * row above, counting `w:gridBefore` (§17.4.15) and each cell's
 * `w:gridSpan` (§17.4.17).
 */
function continuationColumns(row: Element): Set<number> {
  const trPr = childElements(row).find((child) => isW(child, 'trPr'));
  const before = trPr && childElements(trPr).find((child) => isW(child, 'gridBefore'));
  let column = Number(before?.getAttributeNS(W_NS, 'val') ?? 0) || 0;
  const columns = new Set<number>();
  for (const properties of cellProperties(row)) {
    const merge = properties.find((child) => isW(child, 'vMerge'));
    if (merge && (merge.getAttributeNS(W_NS, 'val') || 'continue') === 'continue') columns.add(column);
    const span = properties.find((child) => isW(child, 'gridSpan'));
    column += Math.max(1, Number(span?.getAttributeNS(W_NS, 'val') ?? 1) || 1);
  }
  return columns;
}

/**
 * Whether a row is outside the single-row pass: a vertical merge, which the
 * band pass ({@link replaceVerticalMergeBands}) owns, or cells the guard keeps
 * (see {@link hasUnreplaceableCells}).
 */
function keepsGuardedTopology(row: Element): boolean {
  return hasUnreplaceableCells(row) || hasVerticalMerge(row);
}

/** A matched row whose cell skeleton changed and that this pass replaces. */
function replacesRow(node: TaggedNode): node is BothNode {
  return node.tag === 'both' && isRow(node.original) && isRow(node.revised)
    && rowShape(node.original) !== rowShape(node.revised)
    && !keepsGuardedTopology(node.original) && !keepsGuardedTopology(node.revised);
}

/** The side elements of one row-level child of a table, or null when it is not a `w:tr`. */
function rowSides(node: TaggedNode): { original?: Element; revised?: Element } | null {
  if (node.tag === 'both') return isRow(node.original) ? { original: node.original, revised: node.revised } : null;
  if (!isRow(node.node)) return null;
  return node.tag === 'original' ? { original: node.node } : { revised: node.node };
}

/**
 * Per child of a table, the vertical-merge group its row belongs to on one
 * side, or -1 when the child holds no row of that side. A group is a maximal
 * run of consecutive rows each of which, after the first, continues a merge
 * from the row above: every vertical merge chain (§17.4.84) lies inside one
 * group, and every group boundary cuts no chain.
 */
function mergeGroups(children: readonly TaggedNode[], side: 'original' | 'revised'): number[] {
  let group = -1;
  return children.map((child) => {
    const row = rowSides(child)?.[side];
    if (!row) return -1;
    if (group < 0 || !continuesMergeAbove(row)) group++;
    return group;
  });
}

/**
 * Replace each band of a table's rows that a vertical-merge change touches.
 *
 * A band starts from a matched row whose skeleton changed and that has a
 * vertical merge, or sits in a merge group of more than one row, on either
 * side; or from a merge group of one side that an unmatched row of the other
 * side interrupts without continuing its merges itself (a merged row whose
 * text changed beyond pairing). It grows until it holds every row of each merge
 * group, original or revised, that it overlaps, so each side's merge chains
 * lie wholly inside or wholly outside the band. The band is published as all
 * of its original rows deleted, immediately followed by all of its revised
 * rows inserted, so Accept All and Reject All each keep one side's unbroken
 * chains. Rows outside every band keep their ordinary alignment and redline.
 *
 * A band holding a row with cells the guard keeps (see
 * {@link hasUnreplaceableCells}) is left to the guard, as is a table with
 * row-level content controls, whose rows the band cannot reorder.
 */
function replaceVerticalMergeBands(table: BothNode): void {
  const children = table.children;
  if (children.some((child) => {
    const element = child.tag === 'both' ? child.original : child.node;
    return isW(element, 'sdt', 'customXml');
  })) return;
  const groups = { original: mergeGroups(children, 'original'), revised: mergeGroups(children, 'revised') };
  const groupSize = (side: 'original' | 'revised', group: number) =>
    groups[side].filter((entry) => entry === group).length;
  const triggers: Array<[number, number]> = children.flatMap((child, index): Array<[number, number]> => {
    if (child.tag !== 'both' || !isRow(child.original) || !isRow(child.revised)) return [];
    if (rowShape(child.original) === rowShape(child.revised)) return [];
    const merged = hasVerticalMerge(child.original) || hasVerticalMerge(child.revised)
      || groupSize('original', groups.original[index]!) > 1 || groupSize('revised', groups.revised[index]!) > 1;
    return merged ? [[index, index]] : [];
  });
  // A merge group of one side that an unmatched row of the other side
  // interrupts without itself continuing that side's merges at the same
  // columns: published as is, the redline would show the chain cut by it.
  for (const side of ['original', 'revised'] as const) {
    const other = side === 'original' ? 'revised' : 'original';
    const ranges = new Map<number, [number, number]>();
    groups[side].forEach((group, index) => {
      if (group < 0) return;
      const range = ranges.get(group);
      ranges.set(group, range ? [range[0], index] : [index, index]);
    });
    for (const [low, high] of ranges.values()) {
      const interrupted = children.slice(low + 1, high).some((child, offset) => {
        const sides = rowSides(child);
        const row = sides?.[other];
        if (row === undefined || sides?.[side] !== undefined) return false;
        // The next row of this side, which the redline shows below it.
        const below = children.slice(low + 2 + offset, high + 1).map((entry) => rowSides(entry)?.[side])
          .find((entry) => entry !== undefined)!;
        const carried = continuationColumns(row);
        return [...continuationColumns(below)].some((column) => !carried.has(column));
      });
      if (interrupted) triggers.push([low, high]);
    }
  }
  if (triggers.length === 0) return;

  const bands: Array<[number, number]> = [];
  for (const [start, end] of triggers.sort((a, b) => a[0] - b[0])) {
    if (bands.some(([low, high]) => start >= low && end <= high)) continue;
    let [low, high] = [start, end];
    for (let grown = true; grown;) {
      grown = false;
      for (const side of ['original', 'revised'] as const) {
        const touched = new Set(groups[side].slice(low, high + 1).filter((group) => group >= 0));
        groups[side].forEach((group, index) => {
          if (!touched.has(group)) return;
          if (index < low) { low = index; grown = true; }
          if (index > high) { high = index; grown = true; }
        });
      }
    }
    // A band that reaches an earlier one absorbs it.
    for (let last = bands.at(-1); last && last[1] >= low; last = bands.at(-1)) {
      bands.pop();
      low = Math.min(low, last[0]);
      high = Math.max(high, last[1]);
    }
    bands.push([low, high]);
  }

  const replaced: TaggedNode[] = [];
  let next = 0;
  for (const [low, high] of bands) {
    const members = children.slice(low, high + 1);
    const sides = members.map(rowSides);
    if (sides.some((entry) => [entry?.original, entry?.revised].some((row) => row && hasUnreplaceableCells(row)))) {
      continue;
    }
    replaced.push(...children.slice(next, low));
    // A matched non-row child between the rows (a table-level bookmark or
    // comment boundary present in both documents) keeps its order ahead of
    // the band. A side-only one stays among its own side's rows.
    replaced.push(...members.filter((member, index) => member.tag === 'both' && sides[index] === null));
    replaced.push(...members.flatMap((member, index): TaggedNode[] => {
      if (member.tag === 'original') return [member];
      if (member.tag !== 'both' || sides[index] === null) return [];
      return [{ tag: 'original', node: member.original, children: [], opaque: true }];
    }));
    replaced.push(...members.flatMap((member, index): TaggedNode[] => {
      if (member.tag === 'revised') return [member];
      if (member.tag !== 'both' || sides[index] === null) return [];
      return [{ tag: 'revised', node: member.revised, children: [], opaque: true }];
    }));
    next = high + 1;
  }
  replaced.push(...children.slice(next));
  table.children = replaced;
}

/**
 * Turn each matched table row whose cell skeleton changed (cell count,
 * `w:gridSpan`/`w:hMerge` horizontal merge or split, `w:gridBefore`/
 * `w:gridAfter` offsets) into the original row deleted, immediately followed
 * by the revised row inserted, in the same place. The serializer marks them
 * as whole rows with `w:trPr/w:del` and `w:trPr/w:ins`, so Accept All keeps
 * only the revised row and Reject All only the original one, without any
 * cell-level revision a reader may ignore.
 *
 * No move relation can end inside a replaced row: move detection never
 * takes a candidate with a `w:tbl` ancestor, so dropping the row's subtree
 * leaves every move relation intact.
 *
 * A change that touches a vertical merge (`w:vMerge`) is replaced as a band
 * of rows instead (see {@link replaceVerticalMergeBands}), so that each
 * projection holds whole merge chains.
 *
 * Rows the passes leave alone (see {@link hasUnreplaceableCells}), and grid
 * changes, still reach the table-topology guard.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.84
 * @see https://github.com/UseJunior/safe-docx/issues/1396
 * @see https://github.com/UseJunior/safe-docx/issues/1397
 */
export function replaceSkeletonChangedRows(tree: TaggedNode): void {
  const visit = (node: TaggedNode): void => {
    if (node.opaque || node.children.length === 0) return;
    if (node.tag === 'both' && isW(node.original, 'tbl')) replaceVerticalMergeBands(node);
    const children: TaggedNode[] = [];
    for (const child of node.children) {
      if (!replacesRow(child)) {
        visit(child);
        children.push(child);
        continue;
      }
      const deleted: OriginalNode = { tag: 'original', node: child.original, children: [], opaque: true };
      const inserted: RevisedNode = { tag: 'revised', node: child.revised, children: [], opaque: true };
      children.push(deleted, inserted);
    }
    node.children = children;
  };
  visit(tree);
}
