import { childElements } from '@usejunior/docx-core';
import type { BothNode, OriginalNode, RevisedNode, TaggedNode } from './taggedTree.js';
import { rowShape } from './tableTopologyGuard.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function isRow(element: Element): boolean {
  return element.namespaceURI === W_NS && element.localName === 'tr';
}

/**
 * Whether a row is outside this pass and stays with the table-topology guard:
 * a vertical merge (#1397), a pending cell-level topology revision, or cells
 * inside a cell-level content control, whose grid intervals a whole-row
 * replacement does not inventory.
 */
function keepsGuardedTopology(row: Element): boolean {
  if (childElements(row).some((child) =>
    child.namespaceURI === W_NS && ['sdt', 'customXml'].includes(child.localName))) return true;
  for (const cell of childElements(row)) {
    if (cell.namespaceURI !== W_NS || cell.localName !== 'tc') continue;
    const tcPr = childElements(cell).find((child) => child.namespaceURI === W_NS && child.localName === 'tcPr');
    if (tcPr && childElements(tcPr).some((child) => child.namespaceURI === W_NS
      && ['vMerge', 'cellIns', 'cellDel', 'cellMerge'].includes(child.localName))) return true;
  }
  return false;
}

/** A matched row whose cell skeleton changed and that this pass replaces. */
function replacesRow(node: TaggedNode): node is BothNode {
  return node.tag === 'both' && isRow(node.original) && isRow(node.revised)
    && rowShape(node.original) !== rowShape(node.revised)
    && !keepsGuardedTopology(node.original) && !keepsGuardedTopology(node.revised);
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
 * Rows the pass leaves alone (see {@link keepsGuardedTopology}), and grid
 * changes, still reach the table-topology guard.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.17
 * @see https://github.com/UseJunior/safe-docx/issues/1396
 */
export function replaceSkeletonChangedRows(tree: TaggedNode): void {
  const visit = (node: TaggedNode): void => {
    if (node.opaque || node.children.length === 0) return;
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
