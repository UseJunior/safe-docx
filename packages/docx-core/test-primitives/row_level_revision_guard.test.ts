import { describe, expect } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { testAllure } from './helpers/allure-test.js';
import { acceptChanges, type RevisionFilter } from '../src/primitives/accept_changes.js';
import { rejectChanges } from '../src/primitives/reject_changes.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'add-structural-table-row-operations';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.12' });

function docWithRows(markers: Array<{ kind: 'ins' | 'del'; id: string; text: string; inner?: string }>): Document {
  const rowXml = markers.map(({ kind, id, text, inner = '' }) =>
    `<w:tr><w:trPr><w:${kind} w:id="${id}" w:author="${id}" w:date="2026-01-01T00:00:00Z"/></w:trPr>`
      + `<w:tc><w:p>${inner}<w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`).join('');
  return new DOMParser().parseFromString(
    `<w:document xmlns:w="${W_NS}"><w:body><w:tbl>${rowXml}</w:tbl></w:body></w:document>`,
    'text/xml',
  ) as unknown as Document;
}

const xml = (doc: Document): string => new XMLSerializer().serializeToString(doc as never);
const rows = (doc: Document): number => doc.getElementsByTagNameNS(W_NS, 'tr').length;

describe('row-level revision resolution', () => {
  test.openspec('[SDX-TABLEROW-06] selective row resolution is explicit and honest')(
    'applies selected row-removal semantics and preserves a foreign row marker',
    () => {
      const deleted = docWithRows([{ kind: 'del', id: '7', text: 'gone' }, { kind: 'ins', id: '99', text: 'foreign' }]);
      const acceptResult = acceptChanges(deleted, { filter: (el) => el.getAttribute('w:id') === '7' });
      expect(rows(deleted)).toBe(1);
      expect(xml(deleted)).not.toContain('gone');
      expect(xml(deleted)).toContain('w:id="99"');
      expect(acceptResult).toMatchObject({ deletionsAccepted: 1, insertionsAccepted: 0, unresolvedRowRevisions: 0 });

      const inserted = docWithRows([{ kind: 'ins', id: '7', text: 'gone' }, { kind: 'del', id: '99', text: 'foreign' }]);
      const rejectResult = rejectChanges(inserted, { filter: (el) => el.getAttribute('w:id') === '7' });
      expect(rows(inserted)).toBe(1);
      expect(xml(inserted)).not.toContain('gone');
      expect(xml(inserted)).toContain('w:id="99"');
      expect(rejectResult).toMatchObject({ insertionsRemoved: 1, deletionsRestored: 0, unresolvedRowRevisions: 0 });
    },
  );

  test.openspec('[SDX-TABLEROW-06] selective row resolution is explicit and honest')(
    'keeps a selected inserted row on accept and a selected deleted row on reject',
    () => {
      const inserted = docWithRows([{ kind: 'ins', id: '7', text: 'keep' }]);
      expect(acceptChanges(inserted)).toMatchObject({ insertionsAccepted: 1, unresolvedRowRevisions: 0 });
      expect(rows(inserted)).toBe(1);
      expect(xml(inserted)).not.toContain('<w:ins');

      const deleted = docWithRows([{ kind: 'del', id: '7', text: 'restore' }]);
      expect(rejectChanges(deleted)).toMatchObject({ deletionsRestored: 1, unresolvedRowRevisions: 0 });
      expect(rows(deleted)).toBe(1);
      expect(xml(deleted)).not.toContain('<w:del');
    },
  );

  test.openspec('[SDX-TABLEROW-06] selective row resolution is explicit and honest')(
    'does not count inner unselected revisions when a selected row disappears',
    () => {
      const doc = docWithRows([{ kind: 'del', id: '7', text: 'gone', inner: '<w:ins w:id="8" w:author="foreign"><w:r><w:t>inner</w:t></w:r></w:ins>' }]);
      const filter: RevisionFilter = (el) => el.getAttribute('w:id') === '7';
      expect(acceptChanges(doc, { filter })).toMatchObject({ deletionsAccepted: 1, insertionsAccepted: 0, unresolvedRowRevisions: 0 });
      expect(rows(doc)).toBe(0);
    },
  );
});
