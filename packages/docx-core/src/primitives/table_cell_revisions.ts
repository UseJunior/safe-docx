import { childElements, createWmlElement, isW } from './dom-helpers.js';
import { OOXML } from './namespaces.js';
import { removeOrphanedRangeEndpointsForSubtree, removeTableRowAndEmptyTable } from './table_rows.js';

const W = OOXML.W_NS;
const child = (el: Element, name: string) => childElements(el).find(n => isW(n, name));
const value = (el: Element | undefined, name = 'val') => el?.getAttributeNS(W, name);
const span = (cell: Element) => Number(value(child(child(cell, 'tcPr') ?? cell, 'gridSpan')) ?? 1);
function setSpan(cell: Element, size: number): void {
  const props = child(cell, 'tcPr') ?? cell.insertBefore(createWmlElement(cell.ownerDocument!, 'tcPr'), cell.firstChild) as Element;
  const old = child(props, 'gridSpan');
  if (size === 1) { if (old) props.removeChild(old); return; }
  const el = old ?? createWmlElement(cell.ownerDocument!, 'gridSpan');
  el.setAttributeNS(W, 'w:val', String(size));
  if (!old) {
    const next = childElements(props).find(n => !['cnfStyle', 'tcW'].includes(n.localName));
    props.insertBefore(el, next ?? null);
  }
}
function nearestTable(el: Element): Element | undefined {
  for (let n: Node | null = el.parentNode; n; n = n.parentNode) if (n.nodeType === 1 && isW(n as Element, 'tbl')) return n as Element;
}
function nearestRow(el: Element): Element | undefined {
  for (let n = el.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 1 && isW(n as Element, 'tr')) return n as Element;
    if (n.nodeType === 1 && isW(n as Element, 'tbl')) return undefined;
  }
}
function rowCells(row: Element): Element[] {
  return Array.from(row.getElementsByTagNameNS(W, 'tc')).filter(cell => nearestRow(cell) === row);
}
function removeCellAndEmptyWrappers(cell: Element, row: Element): void {
  let container = cell.parentNode;
  container?.removeChild(cell);
  while (container && container !== row && container.nodeType === 1) {
    const element = container as Element;
    const wrapper = isW(element, 'sdtContent') ? element.parentNode as Element : element;
    if (!wrapper || !['sdt', 'customXml'].includes(wrapper.localName) || wrapper.getElementsByTagNameNS(W, 'tc').length > 0) break;
    container = wrapper.parentNode;
    container?.removeChild(wrapper);
  }
}
function live(el: Element): boolean {
  for (let n: Node | null = el.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName.endsWith('Change')) return false;
  }
  return true;
}

// Collapse boundaries used by no surviving row, matching Word's grid normalization.
function collapseGrid(table: Element): void {
  const grid = child(table, 'tblGrid');
  if (!grid || child(grid, 'tblGridChange')) return;
  const columns = childElements(grid).filter(n => isW(n, 'gridCol'));
  const used = new Set([0, columns.length]);
  const cells: Array<{ cell: Element; start: number; end: number }> = [];
  const offsets: Array<{ element: Element; start: number; end: number }> = [];
  for (const row of Array.from(table.getElementsByTagNameNS(W, 'tr')).filter(n => nearestTable(n) === table)) {
    const before = child(child(row, 'trPr') ?? row, 'gridBefore');
    const after = child(child(row, 'trPr') ?? row, 'gridAfter');
    let start = Number(value(before) ?? 0);
    used.add(start);
    if (before) offsets.push({ element: before, start: 0, end: start });
    for (const cell of rowCells(row)) {
      const end = start + span(cell); cells.push({ cell, start, end }); used.add(end); start = end;
    }
    if (after) offsets.push({ element: after, start, end: start + Number(value(after) ?? 0) });
  }
  const boundaries = [...used].sort((a, b) => a - b);
  if (boundaries.some(n => n < 0 || n > columns.length)) return;
  for (const { cell, start, end } of cells) setSpan(cell, boundaries.filter(n => n > start && n <= end).length);
  for (const { element, start, end } of offsets) element.setAttributeNS(W, 'w:val', String(boundaries.filter(n => n > start && n <= end).length));
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1]!; const end = boundaries[i]!;
    const group = columns.slice(start, end);
    if (group.length < 2) continue;
    const widths = group.map(n => Number(value(n, 'w')));
    if (widths.every(Number.isFinite)) group[0]!.setAttributeNS(W, 'w:w', String(widths.reduce((a, b) => a + b, 0)));
    for (const col of group.slice(1)) grid.removeChild(col);
  }
}

/**
 * Resolve live cell topology after property snapshots have settled. Removing a
 * cell transfers its grid slots and preferred width to the previous cell (the
 * next cell when first), as Word Accept/Reject All does. A last cell removes
 * its row. Merge annotations select the current or original vertical state.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.3
 * @see #1401
 */
export function resolveTableCellRevisions(root: Element, mode: 'accept' | 'reject', filter: (element: Element) => boolean = () => true): { insertions: number; deletions: number; merges: number } {
  const result = { insertions: 0, deletions: 0, merges: 0 };
  const affected = new Set<Element>();
  for (const name of ['cellDel', 'cellIns', 'cellMerge']) {
    for (const mark of Array.from(root.getElementsByTagNameNS(W, name)).filter(live)) {
      const props = mark.parentNode as Element | null;
      const cell = props?.parentNode as Element | null;
      const row = cell ? nearestRow(cell) : undefined;
      if (!props || !cell || !row || !isW(props, 'tcPr') || !isW(cell, 'tc') || !isW(row, 'tr') || !filter(mark)) continue;
      if (name === 'cellMerge') {
        const state = value(mark, mode === 'accept' ? 'vMerge' : 'vMergeOrig');
        const old = child(props, 'vMerge');
        if (old) props.removeChild(old);
        if (state === 'cont' || state === 'rest') {
          const merge = createWmlElement(root.ownerDocument!, 'vMerge');
          merge.setAttributeNS(W, 'w:val', state === 'cont' ? 'continue' : 'restart');
          // vMerge follows gridSpan/hMerge, before borders and remaining properties.
          const next = childElements(props).find(n => !['cnfStyle', 'tcW', 'gridSpan', 'hMerge'].includes(n.localName));
          props.insertBefore(merge, next ?? null);
        }
        props.removeChild(mark); result.merges++; continue;
      }
      if (name === 'cellIns') result.insertions++; else result.deletions++;
      const remove = (name === 'cellDel') === (mode === 'accept');
      if (!remove) { props.removeChild(mark); continue; }
      const table = nearestTable(cell);
      const siblings = rowCells(row);
      const index = siblings.indexOf(cell);
      const neighbor = siblings[index - 1] ?? siblings[index + 1];
      if (!neighbor) { removeTableRowAndEmptyTable(root, row); continue; }
      setSpan(neighbor, span(neighbor) + span(cell));
      const a = child(child(neighbor, 'tcPr')!, 'tcW');
      const b = child(props, 'tcW');
      if (a && b && value(a, 'type') === value(b, 'type') && ['dxa', 'pct'].includes(value(a, 'type') ?? '')) {
        const width = Number(value(a, 'w')) + Number(value(b, 'w'));
        if (Number.isFinite(width)) a.setAttributeNS(W, 'w:w', String(width));
      }
      removeOrphanedRangeEndpointsForSubtree(root, cell);
      removeCellAndEmptyWrappers(cell, row);
      if (table) affected.add(table);
    }
  }
  for (const table of affected) collapseGrid(table);
  return result;
}
