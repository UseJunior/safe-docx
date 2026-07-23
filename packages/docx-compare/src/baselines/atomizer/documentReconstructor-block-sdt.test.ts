/**
 * Focused forced-rebuild evidence for direct body-level block SDTs.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/582
 */

import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Document Reconstructor Block SDT',
    story: 'Opaque Direct Body Block Content Control Preservation',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.29' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.34' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.38' },
  );

function paragraph(text: string, id: string): string {
  return `<w:p w14:paraId="${id}" w14:textId="77777777" w:rsidR="00112233">` +
    (text ? `<w:r><w:t>${text}</w:t></w:r>` : '') + '</w:p>';
}

function blockSdt(content: string): string {
  return '<w:sdt>' +
    '<w:sdtPr><w:alias w:val="Opaque block"/><w:id w:val="582"/></w:sdtPr>' +
    '<w:sdtEndPr><w:rPr><w:b/></w:rPr></w:sdtEndPr>' +
    `<w:sdtContent>${content}</w:sdtContent>` +
    '</w:sdt>';
}

async function packageFor(body: string): Promise<Buffer> {
  return buildDocxFromBodyXml(body);
}

async function rebuild(originalBody: string, revisedBody: string): Promise<string> {
  const result = await compareDocumentsAtomizer(
    await packageFor(originalBody),
    await packageFor(revisedBody),
    {
      author: 'Issue 582 Test',
      date: new Date('2026-07-22T00:00:00Z'),
      reconstructionMode: 'rebuild',
    },
  );
  expect(result.reconstructionModeUsed).toBe('rebuild');
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

function directBodyControls(xml: string): Element[] {
  const body = parseXml(xml).getElementsByTagNameNS(OOXML.W_NS, 'body')[0]!;
  return Array.from(body.childNodes).filter((node): node is Element =>
    node.nodeType === 1 &&
    (node as Element).namespaceURI === OOXML.W_NS &&
    (node as Element).localName === 'sdt',
  );
}

describe('direct body block content-control passthrough', () => {
  test.openspec('[SDX-SDT-BLOCK-01] Outside edits retain a complete block control')(
    'preserves ordered properties, empty paragraphs, and every controlled attribute',
    async ({ given, when, then, and }: AllureBddContext) => {
      const control = blockSdt(paragraph('Controlled first', '00000001') + paragraph('', '00000002'));
      let output = '';

      await given('a direct body block control with an empty controlled paragraph', () => {});
      await when('an outside paragraph changes through forced rebuild', async () => {
        output = await rebuild(control + paragraph('Outside old', '00000003'),
          control + paragraph('Outside new', '00000003'));
      });
      await then('the complete block shape and controlled attributes remain present once', () => {
        const controls = directBodyControls(output);
        expect(controls).toHaveLength(1);
        expect(Array.from(controls[0]!.childNodes)
          .filter((node): node is Element => node.nodeType === 1)
          .map((node) => node.localName)).toEqual(['sdtPr', 'sdtEndPr', 'sdtContent']);
        const paragraphs = controls[0]!.getElementsByTagNameNS(OOXML.W_NS, 'p');
        expect(paragraphs).toHaveLength(2);
        expect(paragraphs[1]!.getAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml', 'paraId'))
          .toBe('00000002');
        expect(paragraphs[1]!.getElementsByTagNameNS(OOXML.W_NS, 't')).toHaveLength(0);
      });
      await and('accept and reject apply only the outside edit', () => {
        expect(extractTextWithParagraphs(acceptAllChanges(output))).toContain('Outside new');
        expect(extractTextWithParagraphs(rejectAllChanges(output))).toContain('Outside old');
      });
    },
  );

  test.openspec('[SDX-SDT-BLOCK-02] Multiple identical controls pair locally and deterministically')(
    'retains identical sibling controls at their own body positions',
    async ({ given, when, then }: AllureBddContext) => {
      const identical = blockSdt(paragraph('Same controlled payload', '00000011'));
      const original = identical + paragraph('Between', '00000012') + identical + paragraph('Tail old', '00000013');
      const revised = identical + paragraph('Between', '00000012') + identical + paragraph('Tail new', '00000013');
      let output = '';

      await given('two byte-identical direct body controls separated by an ordinary paragraph', () => {});
      await when('the tail paragraph changes through forced rebuild', async () => {
        output = await rebuild(original, revised);
      });
      await then('both controls remain distinct, ordered, and emitted once', () => {
        expect(directBodyControls(output)).toHaveLength(2);
        expect((output.match(/Same controlled payload/g) ?? [])).toHaveLength(2);
      });
    },
  );
});

describe('unsupported body block ownership fails closed', () => {
  test.openspec('[SDX-SDT-BLOCK-03] Unsupported block ownership fails before output')(
    'rejects mutation, insertion, deletion, reorder, movement, nesting, and table or cell placement',
    async ({ given, then }: AllureBddContext) => {
      const first = paragraph('First', '00000021');
      const second = paragraph('Second', '00000022');
      const stable = blockSdt(first + second);
      const outside = paragraph('Outside', '00000023');
      const nested = blockSdt(paragraph('Outer', '00000024') + blockSdt(paragraph('Inner', '00000025')));
      const tableBlock = blockSdt(
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      );
      const cellControl = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
        `<w:tr><w:tc><w:tcPr/>${blockSdt(paragraph('Cell control', '00000026'))}</w:tc></w:tr></w:tbl>`;
      const cases: Array<[string, string, string]> = [
        ['mutation', stable + outside, blockSdt(paragraph('Changed', '00000021') + second) + outside],
        ['insertion', stable + outside, blockSdt(first + paragraph('Inserted', '00000027') + second) + outside],
        ['deletion', stable + outside, blockSdt(first) + outside],
        ['reorder', stable + outside, blockSdt(second + first) + outside],
        ['movement', stable + outside, outside + stable],
        ['nesting', nested + outside, nested + outside],
        ['table content', tableBlock + outside, tableBlock + outside],
        ['cell placement', cellControl + outside, cellControl + outside],
      ];

      await given('block shapes outside the bounded immutable direct-body contract', () => {});
      await then('each shape rejects without returning lossy rebuilt XML', async () => {
        for (const [name, original, revised] of cases) {
          await expect(rebuild(original, revised), name).rejects.toThrow(/Opaque passthrough:/);
        }
      });
    },
  );
});
