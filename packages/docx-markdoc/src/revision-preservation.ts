// Internal to docx-markdoc: imported by compile.ts and its tests, and deliberately
// not re-exported from index.ts, so the helper stays out of the package contract.

export type RevisionSnapshot = Array<{ part: string; xml: string }>;

export type RevisionDescriptor = { part: string; element: string; id?: string };

export type RevisionPreservationReport = {
  preserved: boolean;
  /** Source revisions, in source order, that the projection does not reproduce verbatim in the same part at the same relative position. */
  missing: RevisionDescriptor[];
  /** Projected revisions that repeat a source revision's XML in the same part more often than the source does. */
  duplicated: RevisionDescriptor[];
};

function describeRevision(item: RevisionSnapshot[number]): RevisionDescriptor {
  const element = /^<w:(\w+)/u.exec(item.xml)?.[1] ?? 'unknown';
  const id = /^<[^>]*?\sw:id="([^"]*)"/u.exec(item.xml)?.[1];
  return { part: item.part, element, ...(id === undefined ? {} : { id }) };
}

/**
 * The pre-existing revisions of every story part must survive projection as
 * exactly the source sequence: each source revision reappears verbatim, in
 * the same part, in the same order, and exactly once. Projection may still
 * add revision markup of its own for genuinely new annotations (see #961),
 * so the comparison is between the source sequence and the projected
 * revisions that reproduce a source revision's XML — a per-part equality of
 * the pre-existing set, not an ordered-containment check that would accept a
 * source revision being duplicated.
 */
export function verifyRevisionPreservation(source: RevisionSnapshot, projected: RevisionSnapshot): RevisionPreservationReport {
  const sourceByPart = new Map<string, RevisionSnapshot>();
  for (const item of source) {
    const list = sourceByPart.get(item.part) ?? [];
    list.push(item);
    sourceByPart.set(item.part, list);
  }
  const preexistingByPart = new Map<string, RevisionSnapshot>();
  for (const item of projected) {
    if (!sourceByPart.get(item.part)?.some((candidate) => candidate.xml === item.xml)) continue;
    const list = preexistingByPart.get(item.part) ?? [];
    list.push(item);
    preexistingByPart.set(item.part, list);
  }
  const missing: RevisionDescriptor[] = [];
  const duplicated: RevisionDescriptor[] = [];
  for (const [part, expected] of sourceByPart) {
    const actual = preexistingByPart.get(part) ?? [];
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const want = expected[index];
      const got = actual[index];
      if (want && got && want.xml === got.xml) continue;
      if (want) missing.push(describeRevision(want));
      if (got) duplicated.push(describeRevision(got));
    }
  }
  return { preserved: missing.length === 0 && duplicated.length === 0, missing, duplicated };
}
