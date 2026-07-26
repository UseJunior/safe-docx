/**
 * Forced-rebuild evidence for table-scoped structured document tags.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.33
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/660
 */

import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure } from '../../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'Document Reconstructor Table SDT';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Table-scoped content controls remain editable in rebuild',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.29' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.32' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.33' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.34' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.38' },
  );

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function cell(content: string): string {
  return '<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' + content + '</w:tc>';
}

function control(id: string, alias: string, content: string): string {
  return '<w:sdt>' +
    `<w:sdtPr><w:alias w:val="${alias}"/><w:id w:val="${id}"/></w:sdtPr>` +
    `<w:sdtContent>${content}</w:sdtContent>` +
    '</w:sdt>';
}

function table(row: string): string {
  return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
    row +
    '</w:tbl>';
}

async function rebuild(originalBody: string, revisedBody: string): Promise<string> {
  const result = await compareDocumentsAtomizer(
    await buildDocxFromBodyXml(originalBody),
    await buildDocxFromBodyXml(revisedBody),
    {
      author: 'Issue 660 Test',
      date: new Date('2026-07-26T00:00:00Z'),
      reconstructionMode: 'rebuild',
    },
  );
  expect(result.reconstructionModeUsed).toBe('rebuild');
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

function controls(xml: string): Element[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(OOXML.W_NS, 'sdt'));
}

describe('table-scoped content controls in forced rebuild', () => {
  test.openspec('[SDX-SDT-TABLE-01] Row and cell controls retain their scaffold while content changes')(
    'reconstructs tracked text edits inside row- and cell-scoped controls',
    async () => {
      const original = paragraph('Lead paragraph.') +
        table(
          '<w:tr>' +
          control('101', 'RowControl', cell(paragraph('Original row text.'))) +
          cell(control('102', 'CellControl', paragraph('Original cell text.'))) +
          '</w:tr>',
        ) +
        paragraph('Trailing paragraph.');
      const revised = paragraph('Lead paragraph.') +
        table(
          '<w:tr>' +
          control('101', 'RowControl', cell(paragraph('Revised row text.'))) +
          cell(control('102', 'CellControl', paragraph('Revised cell text.'))) +
          '</w:tr>',
        ) +
        paragraph('Trailing paragraph.');

      const output = await rebuild(original, revised);
      const outputControls = controls(output);
      expect(outputControls).toHaveLength(2);
      expect(outputControls.map((boundary) => (boundary.parentNode as Element).localName))
        .toEqual(['tr', 'tc']);
      expect(outputControls.map((boundary) =>
        boundary.getElementsByTagNameNS(OOXML.W_NS, 'alias')[0]!.getAttributeNS(OOXML.W_NS, 'val'),
      )).toEqual(['RowControl', 'CellControl']);
      expect(outputControls[0]!.getElementsByTagNameNS(OOXML.W_NS, 'ins')).toHaveLength(1);
      expect(outputControls[0]!.getElementsByTagNameNS(OOXML.W_NS, 'del')).toHaveLength(1);
      expect(outputControls[1]!.getElementsByTagNameNS(OOXML.W_NS, 'ins')).toHaveLength(1);
      expect(outputControls[1]!.getElementsByTagNameNS(OOXML.W_NS, 'del')).toHaveLength(1);

      const accepted = extractTextWithParagraphs(acceptAllChanges(output));
      const rejected = extractTextWithParagraphs(rejectAllChanges(output));
      expect(accepted).toContain('Revised row text.');
      expect(accepted).toContain('Revised cell text.');
      expect(accepted).not.toContain('Original row text.');
      expect(rejected).toContain('Original row text.');
      expect(rejected).toContain('Original cell text.');
      expect(rejected).not.toContain('Revised row text.');
    },
  );

  test.openspec('[SDX-SDT-TABLE-02] Table control scaffold mutation fails before rebuild')(
    'rejects a changed table-scoped control wrapper instead of preserving stale metadata',
    async () => {
      const original = table(
        '<w:tr>' +
        control('201', 'StableControl', cell(paragraph('Original text.'))) +
        cell(paragraph('Static cell.')) +
        '</w:tr>',
      );
      const revised = table(
        '<w:tr>' +
        control('201', 'ChangedControl', cell(paragraph('Revised text.'))) +
        cell(paragraph('Static cell.')) +
        '</w:tr>',
      );

      await expect(rebuild(original, revised))
        .rejects.toThrow(/Opaque passthrough: boundary 0 changed paragraph ownership, moved, or mutated/);
    },
  );
});
