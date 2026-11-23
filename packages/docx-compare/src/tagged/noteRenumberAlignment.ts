import { XMLSerializer } from '@xmldom/xmldom';
import { type DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { canonicalNoteId } from './ancillaryFieldSafety.js';

const W = OOXML.W_NS;
const serializer = new XMLSerializer();

type NoteKind = 'footnote' | 'endnote';

interface NoteSide {
  document: Document;
  notes: Document;
  references: Element[];
  /** Reference IDs in document order. */
  sequence: string[];
  /** Every non-separator definition, by ID. */
  entries: Map<string, Element>;
}

/** A definition's identity apart from its own `w:id`. */
function definitionKey(entry: Element): string {
  const copy = entry.cloneNode(true) as Element;
  copy.removeAttributeNS(W, 'id');
  return serializer.serializeToString(copy);
}

function isSeparator(entry: Element): boolean {
  const type = entry.getAttributeNS(W, 'type');
  return type === 'separator' || type === 'continuationSeparator';
}

async function readSide(archive: DocxArchive, kind: NoteKind): Promise<NoteSide | undefined> {
  const part = `word/${kind}s.xml`;
  const notesXml = await archive.getFile(part);
  if (!notesXml) return;
  // References outside the main story (or nested in notes) are not aligned.
  for (const path of archive.listFiles()) {
    if (path === part || !/^word\/[^/]+\.xml$/u.test(path) || path === 'word/document.xml') continue;
    if ((await archive.getFile(path))?.includes(`${kind}Reference`)) return;
  }
  let document: Document;
  let notes: Document;
  try {
    document = parseXml(await archive.getDocumentXml());
    notes = parseXml(notesXml);
  } catch {
    return; // Publication diagnoses malformed parts.
  }
  const references = Array.from(document.getElementsByTagNameNS(W, `${kind}Reference`));
  const sequence: string[] = [];
  for (const reference of references) {
    const id = canonicalNoteId(reference.getAttributeNS(W, 'id') ?? '');
    if (id === undefined || sequence.includes(id)) return;
    sequence.push(id);
  }
  const entries = new Map<string, Element>();
  for (const entry of Array.from(notes.getElementsByTagNameNS(W, kind))) {
    const id = canonicalNoteId(entry.getAttributeNS(W, 'id') ?? '');
    if (id === undefined || entries.has(id)) return;
    if (!isSeparator(entry)) entries.set(id, entry);
  }
  if (sequence.some((id) => !entries.has(id))) return;
  return { document, notes, references, sequence, entries };
}

/** Longest common subsequence of two key lists, as index pairs. */
function alignByKey(left: string[], right: string[]): Array<[number, number]> {
  const table = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i]![j] = left[i] === right[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push([i++, j++]);
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Give each unchanged original footnote or endnote the identifier of its
 * revised counterpart before comparison, so a note that only moved to another
 * number (because a note was inserted or deleted ahead of it) compares as the
 * same live reference instead of a deleted and reinserted one.
 *
 * Notes correspond when their definitions are identical apart from `w:id` and
 * they keep their relative order: the longest common subsequence of the two
 * reference sequences, keyed by definition content. Note identifiers carry no
 * display meaning (the reference mark is numbered by document order), so
 * renaming the original's identifiers changes neither its rendering nor its
 * Reject projection. Unmatched original definitions that would collide with a
 * renamed identifier move to fresh identifiers; changed definitions keep the
 * existing collision-safe path. Packages whose references repeat, lack a
 * definition, or sit outside the main story are left unchanged.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.7
 * @see https://github.com/UseJunior/safe-docx/issues/1387
 */
export async function alignRenumberedNoteIds(
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
): Promise<void> {
  for (const kind of ['footnote', 'endnote'] as const) {
    const original = await readSide(originalArchive, kind);
    const revised = await readSide(revisedArchive, kind);
    if (!original || !revised) continue;
    const pairs = alignByKey(
      original.sequence.map((id) => definitionKey(original.entries.get(id)!)),
      revised.sequence.map((id) => definitionKey(revised.entries.get(id)!)),
    );
    const mapping = new Map<string, string>();
    for (const [i, j] of pairs) mapping.set(original.sequence[i]!, revised.sequence[j]!);
    if ([...mapping].every(([from, to]) => from === to)) continue;
    const targets = new Set(mapping.values());
    let next = 1n;
    for (const id of [...original.entries.keys(), ...revised.entries.keys()]) {
      if (BigInt(id) >= next) next = BigInt(id) + 1n;
    }
    for (const id of original.entries.keys()) {
      if (!mapping.has(id) && targets.has(id)) mapping.set(id, (next++).toString());
    }
    for (const reference of original.references) {
      const id = canonicalNoteId(reference.getAttributeNS(W, 'id') ?? '')!;
      const target = mapping.get(id);
      if (target !== undefined && target !== id) reference.setAttributeNS(W, 'w:id', target);
    }
    for (const [id, entry] of original.entries) {
      const target = mapping.get(id);
      if (target !== undefined && target !== id) entry.setAttributeNS(W, 'w:id', target);
    }
    originalArchive.setDocumentXml(serializer.serializeToString(original.document));
    originalArchive.setFile(`word/${kind}s.xml`, serializer.serializeToString(original.notes));
  }
}
