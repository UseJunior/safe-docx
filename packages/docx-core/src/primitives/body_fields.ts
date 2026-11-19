import { OOXML, W } from './namespaces.js';

/**
 * A complex field over one or more consecutive runs of a footnote or comment
 * body (`FootnoteStyledRun.field`, `CommentBodyRun.field`). Consecutive runs
 * whose `field` has the same `instruction` and `key` form one field, and
 * their text is its cached result. `key` tells two adjacent fields with the
 * same instruction apart.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @see https://github.com/UseJunior/safe-docx/issues/1260
 */
export type BodyRunField = { instruction: string; key?: string };

function sameField(left: BodyRunField | undefined, right: BodyRunField | undefined): boolean {
  return left !== undefined && right !== undefined
    && left.instruction === right.instruction && (left.key ?? '') === (right.key ?? '');
}

/**
 * Split body runs into the stretches a body writer emits: ordinary runs one
 * at a time, and each field's runs together. A field run may not also be a
 * hyperlink run, since its result would then sit in a `w:hyperlink` the field
 * markers are outside of.
 */
export function groupBodyFieldRuns<Run extends { field?: BodyRunField; hyperlink?: unknown }>(runs: readonly Run[]): Array<{ field?: BodyRunField; runs: Run[] }> {
  const groups: Array<{ field?: BodyRunField; runs: Run[] }> = [];
  for (const run of runs) {
    if (run.field && run.hyperlink) throw new Error('A body field run cannot also be a hyperlink run');
    if (run.field && typeof run.field.instruction !== 'string') throw new Error('A body field needs an instruction');
    const last = groups.at(-1);
    if (run.field && last?.field && sameField(last.field, run.field)) last.runs.push(run);
    else groups.push({ ...(run.field ? { field: run.field } : {}), runs: [run] });
  }
  return groups;
}

function markerRun(template: Element, marker: Element): Element {
  const run = template.cloneNode(false) as Element;
  for (const child of Array.from(template.childNodes)) {
    if (child.nodeType === 1 && (child as Element).namespaceURI === OOXML.W_NS && (child as Element).localName === W.rPr) {
      run.appendChild(child.cloneNode(true));
    }
  }
  run.appendChild(marker);
  return run;
}

/**
 * Wrap a field's result runs in its markers: `begin`, the instruction,
 * `separate`, the results, `end`, each marker in a run with the first result
 * run's properties, as generation and Word write them.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 */
export function buildBodyFieldRuns(doc: Document, instruction: string, resultRuns: readonly Element[]): Element[] {
  const template = resultRuns[0];
  if (!template) throw new Error('A body field needs at least one result run');
  const fldChar = (type: 'begin' | 'separate' | 'end'): Element => {
    const element = doc.createElementNS(OOXML.W_NS, 'w:fldChar');
    element.setAttributeNS(OOXML.W_NS, 'w:fldCharType', type);
    return element;
  };
  const instrText = doc.createElementNS(OOXML.W_NS, 'w:instrText');
  instrText.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  instrText.appendChild(doc.createTextNode(instruction));
  return [
    markerRun(template, fldChar('begin')),
    markerRun(template, instrText),
    markerRun(template, fldChar('separate')),
    ...resultRuns,
    markerRun(template, fldChar('end')),
  ];
}
