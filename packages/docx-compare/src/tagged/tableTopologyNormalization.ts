import { childElements } from '@usejunior/docx-core';
import type { UnrepresentedChange } from '../compare-types.js';
import type { BothNode, OriginalNode, RevisedNode, TaggedNode } from './taggedTree.js';
import { rowShape } from './tableTopologyGuard.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function isRow(element: Element): boolean {
  return element.namespaceURI === W_NS && element.localName === 'tr';
}

function isW(element: Element, ...names: string[]): boolean {
  return element.namespaceURI === W_NS && names.includes(element.localName);
}

/**
 * The cells of a row in document order, including cells inside cell-level
 * content controls (`w:sdt`/`w:sdtContent`, §17.5.2.32) and cell-level
 * custom XML elements (`w:customXml`, §17.5.1.4), which occupy the grid like
 * direct cells.
 */
function rowCells(row: Element): Element[] {
  return childElements(row).flatMap((child) => {
    if (isW(child, 'tc')) return [child];
    if (isW(child, 'sdt', 'sdtContent', 'customXml')) return rowCells(child);
    return [];
  });
}

/** The `w:tcPr` children of each cell of a row, wrapped or not. */
function cellProperties(row: Element): Element[][] {
  return rowCells(row).map((cell) => {
    const tcPr = childElements(cell).find((child) => isW(child, 'tcPr'));
    return tcPr ? childElements(tcPr) : [];
  });
}

/**
 * The pending cell-level topology revisions of a row, per cell in document
 * order: each cell's `w:cellIns` (§17.13.5.2), `w:cellDel` (§17.13.5.1) and
 * `w:cellMerge` (§17.13.5.3, with the merge states it records). Identifiers,
 * authors and dates are attribution, not topology, and are left out.
 */
function cellTopologyRevisions(row: Element): string {
  return JSON.stringify(cellProperties(row).map((properties) => properties
    .filter((child) => isW(child, 'cellIns', 'cellDel', 'cellMerge'))
    .map((child) => [child.localName, child.getAttributeNS(W_NS, 'vMerge') ?? '',
      child.getAttributeNS(W_NS, 'vMergeOrig') ?? ''])));
}

/**
 * The pending row revisions of a row: the `w:ins` (§17.13.5.17) and `w:del`
 * (§17.13.5.12) markers of its `w:trPr`, by name.
 */
function rowRevisionMarkers(row: Element): string {
  const trPr = childElements(row).find((child) => isW(child, 'trPr'));
  return trPr ? childElements(trPr).filter((child) => isW(child, 'ins', 'del'))
    .map((child) => child.localName).sort().join(',') : '';
}

/**
 * Whether a matched row changed its topology: its cell skeleton (see
 * {@link rowShape}), the pending cell-level topology revisions its cells
 * carry, or its own pending row insertion or deletion.
 *
 * A row whose pending revisions differ between the documents is replaced
 * like a row whose skeleton changed: the deleted original row keeps the
 * original's pending revisions and the inserted revised row the revised
 * ones, so Reject All resolves the original's and Accept All the revised's,
 * exactly as each source does, and every prior revision stays in place on
 * its own copy (#1400). A row property change record could not carry them:
 * `w:trPrChange` holds a `CT_TrPrBase`, which has no `w:ins` or `w:del`
 * (§17.13.5.37). No new cell-level revision is ever written.
 */
function rowTopologyChanged(original: Element, revised: Element): boolean {
  return rowShape(original) !== rowShape(revised)
    || cellTopologyRevisions(original) !== cellTopologyRevisions(revised)
    || rowRevisionMarkers(original) !== rowRevisionMarkers(revised);
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
 * A matched row whose topology changed (see {@link rowTopologyChanged}) and
 * that this pass replaces: a row with a vertical merge on either side is left
 * to the band pass ({@link replaceVerticalMergeBands}).
 */
function replacesRow(node: TaggedNode): node is BothNode {
  return node.tag === 'both' && isRow(node.original) && isRow(node.revised)
    && rowTopologyChanged(node.original, node.revised)
    && !hasVerticalMerge(node.original) && !hasVerticalMerge(node.revised);
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
 * A band also starts from a matched row whose pending cell-level or row
 * revisions differ (see {@link rowTopologyChanged}), and a band holding a row
 * with a pending cell-level revision is replaced like any other, each copy
 * keeping its source's pending revisions (#1400). A table with row-level
 * content controls, whose rows the band cannot reorder, is left to the
 * guard. Cells
 * inside cell-level content controls count like any other cell, so a band
 * holding one is replaced with the control whole in each of its rows.
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
    if (!rowTopologyChanged(child.original, child.revised)) return [];
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
 * A row holding a cell-level content control (`w:sdt` wrapping `w:tc`,
 * §17.5.2.32) or cell-level custom XML element (§17.5.1.4) is replaced the
 * same way when its skeleton, counting the wrapped cells, changes: each of
 * the two rows keeps its own whole wrapper, so Accept All keeps the revised
 * control and Reject All the original one, and no revision wrapper ever
 * holds a cell. The copies keep their `w:sdtPr/w:id` as authored: each
 * projection then holds exactly its source control, and a reader that opens
 * the unresolved redline with two controls of one id assigns the later one a
 * new id (§17.5.2.18). Pending revisions inside the wrapped cells stay with
 * each copy, as in any other replaced row.
 *
 * A matched row whose pending cell-level topology revisions or pending row
 * markers differ is replaced the same way (see {@link rowTopologyChanged}),
 * and so is a row holding a pending cell-level revision whose skeleton
 * changes: each copy keeps its own source's pending revisions, so Reject All
 * resolves the original's and Accept All the revised's (#1400).
 *
 * Grid changes, and rows in a table with row-level content controls that the
 * band pass leaves alone, still reach the table-topology guard.
 *
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.13.5.1 — a pending w:cellDel is carried in place on its own row copy, not resolved
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.13.5.2 — a pending w:cellIns is carried in place on its own row copy, not resolved
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.13.5.3 — a pending w:cellMerge is carried in place on its own row copy, not resolved
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.84
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.18
 * @see https://github.com/UseJunior/safe-docx/issues/1396
 * @see https://github.com/UseJunior/safe-docx/issues/1397
 * @see https://github.com/UseJunior/safe-docx/issues/1483
 * @see https://github.com/UseJunior/safe-docx/issues/1400
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

/**
 * Leave out of the redline each table with no rows (a `w:tbl` holding no
 * `w:tr`) present in one document only, and name it in
 * `unrepresentedChanges`.
 *
 * A table is inserted or deleted only through the revision markers of its
 * rows (`w:trPr/w:ins`, `w:trPr/w:del`), so a table without rows has nothing
 * to carry one: published, it would survive the projection that should drop
 * it. Such a table holds no cell, paragraph or text, so leaving it out changes
 * no content of either projection; Accept All of an added one (Reject All of a
 * removed one) lacks only the empty table, which the returned entry reports.
 * A table present in both documents is published as it is.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.37
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @see https://github.com/UseJunior/safe-docx/issues/1400
 */
export function leaveOutRowlessTables(tree: TaggedNode): UnrepresentedChange[] {
  const changes: UnrepresentedChange[] = [];
  let sectionIndex = 0;
  const visit = (node: TaggedNode): void => {
    const element = node.tag === 'both' ? node.revised : node.node;
    // A paragraph-bound w:sectPr closes the section it sits in, as in
    // collectContentControlPropertyChanges.
    if (node.tag !== 'original' && isW(element, 'sectPr')) sectionIndex++;
    if (node.opaque) return;
    node.children = node.children.filter((child) => {
      if (child.tag === 'both' || !isW(child.node, 'tbl')
        || child.node.getElementsByTagNameNS(W_NS, 'tr').length > 0) {
        visit(child);
        return true;
      }
      const tables = Array.from(child.node.ownerDocument!.getElementsByTagNameNS(W_NS, 'tbl'));
      changes.push({
        scope: 'table',
        kind: child.tag === 'revised' ? 'added' : 'removed',
        sectionIndex,
        table: { story: 'body', index: tables.indexOf(child.node) },
      });
      return false;
    });
  };
  visit(tree);
  return changes;
}
