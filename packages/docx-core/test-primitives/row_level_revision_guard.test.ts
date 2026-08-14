import { describe, expect } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { testAllure } from './helpers/allure-test.js';
import { acceptChanges, type RevisionFilter } from '../src/primitives/accept_changes.js';
import { rejectChanges } from '../src/primitives/reject_changes.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'guard-row-level-revision-resolution';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

/**
 * A two-row table whose FIRST row carries a row-level revision marker in its
 * `w:trPr`. The second row is untracked and must survive every projection, so a
 * test that accidentally wipes the table still fails loudly.
 */
function rowRevisionDoc(marker: 'ins' | 'del'): Document {
  return new DOMParser().parseFromString(
    `<w:document xmlns:w="${W_NS}"><w:body><w:tbl>`
      + `<w:tr><w:trPr>`
      + `<w:${marker} w:id="7" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"/>`
      + `</w:trPr>`
      + `<w:tc><w:p><w:r><w:t>ROWTEXT</w:t></w:r></w:p></w:tc></w:tr>`
      + `<w:tr><w:tc><w:p><w:r><w:t>KEEPME</w:t></w:r></w:p></w:tc></w:tr>`
      + `</w:tbl></w:body></w:document>`,
    'text/xml',
  ) as unknown as Document;
}

function serialize(doc: Document): string {
  return new XMLSerializer().serializeToString(doc as never);
}

function rowCount(doc: Document): number {
  return doc.getElementsByTagNameNS(W_NS, 'tr').length;
}

/** The row-level marker still attached to a `w:trPr`, if any. */
function rowMarker(doc: Document, localName: 'ins' | 'del'): Element | null {
  const found = doc.getElementsByTagNameNS(W_NS, localName);
  for (let i = 0; i < found.length; i++) {
    const el = found.item(i)!;
    const parent = el.parentNode as Element | null;
    if (parent && parent.namespaceURI === W_NS && parent.localName === 'trPr') return el;
  }
  return null;
}

function attrs(el: Element): { id: string | null; author: string | null; date: string | null } {
  const read = (name: string) => el.getAttributeNS(W_NS, name) ?? el.getAttribute(`w:${name}`);
  return { id: read('id'), author: read('author'), date: read('date') };
}

describe('row-level revision guard', () => {
  test.openspec('[SDX-ROWREV-01] accepting a deleted row preserves the unresolvable marker')(
    'keeps the marker, its attributes and the row instead of silently dropping the evidence',
    () => {
      const doc = rowRevisionDoc('del');

      const result = acceptChanges(doc);

      const marker = rowMarker(doc, 'del');
      expect(marker).not.toBeNull();
      expect(attrs(marker!)).toEqual({
        id: '7',
        author: 'Reviewer',
        date: '2026-01-01T00:00:00Z',
      });
      expect(rowCount(doc)).toBe(2);
      expect(serialize(doc)).toContain('ROWTEXT');
      // The marker is NOT a resolved deletion: counting it there is what told
      // callers the operation had succeeded.
      expect(result.deletionsAccepted).toBe(0);
      expect(result.unresolvedRowRevisions).toBe(1);
    },
  );

  test.openspec('[SDX-ROWREV-02] rejecting an inserted row preserves the unresolvable marker')(
    'mirrors the accept side for a row marked inserted',
    () => {
      const doc = rowRevisionDoc('ins');

      const result = rejectChanges(doc);

      const marker = rowMarker(doc, 'ins');
      expect(marker).not.toBeNull();
      expect(attrs(marker!)).toEqual({
        id: '7',
        author: 'Reviewer',
        date: '2026-01-01T00:00:00Z',
      });
      expect(rowCount(doc)).toBe(2);
      expect(serialize(doc)).toContain('ROWTEXT');
      expect(result.insertionsRemoved).toBe(0);
      expect(result.unresolvedRowRevisions).toBe(1);
    },
  );

  test.openspec('[SDX-ROWREV-03] row markers the engine resolves correctly are still removed')(
    'accepting an inserted row and rejecting a deleted row both keep the row and drop the marker',
    () => {
      const accepted = rowRevisionDoc('ins');
      const acceptResult = acceptChanges(accepted);

      expect(rowMarker(accepted, 'ins')).toBeNull();
      expect(rowCount(accepted)).toBe(2);
      expect(serialize(accepted)).toContain('ROWTEXT');
      expect(acceptResult.unresolvedRowRevisions).toBe(0);

      const rejected = rowRevisionDoc('del');
      const rejectResult = rejectChanges(rejected);

      expect(rowMarker(rejected, 'del')).toBeNull();
      expect(rowCount(rejected)).toBe(2);
      expect(serialize(rejected)).toContain('ROWTEXT');
      expect(rejectResult.unresolvedRowRevisions).toBe(0);
    },
  );

  test.openspec('[SDX-ROWREV-04] content revisions and selective filters are unaffected')(
    'content wrappers still resolve, and a selective run counts only the markers it selects',
    () => {
      const contentOnly = new DOMParser().parseFromString(
        `<w:document xmlns:w="${W_NS}"><w:body>`
          + `<w:p><w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">`
          + `<w:r><w:delText>gone</w:delText></w:r></w:del>`
          + `<w:ins w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z">`
          + `<w:r><w:t>added</w:t></w:r></w:ins></w:p>`
          + `</w:body></w:document>`,
        'text/xml',
      ) as unknown as Document;

      const result = acceptChanges(contentOnly);

      expect(result.deletionsAccepted).toBe(1);
      expect(result.insertionsAccepted).toBe(1);
      expect(result.unresolvedRowRevisions).toBe(0);
      expect(serialize(contentOnly)).not.toContain('gone');
      expect(serialize(contentOnly)).toContain('added');

      // Selective: a filter that selects no revision must not count the row
      // marker it never would have touched.
      const unselected = rowRevisionDoc('del');
      const selectsNothing: RevisionFilter = () => false;
      const unselectedResult = acceptChanges(unselected, { filter: selectsNothing });

      expect(unselectedResult.unresolvedRowRevisions).toBe(0);
      expect(rowMarker(unselected, 'del')).not.toBeNull();

      // Selective: a filter that DOES select the row marker reports it.
      const selected = rowRevisionDoc('del');
      const selectsRowMarker: RevisionFilter = (el) =>
        (el.getAttributeNS(W_NS, 'id') ?? el.getAttribute('w:id')) === '7';
      const selectedResult = acceptChanges(selected, { filter: selectsRowMarker });

      expect(selectedResult.unresolvedRowRevisions).toBe(1);
      expect(rowMarker(selected, 'del')).not.toBeNull();
    },
  );
});
