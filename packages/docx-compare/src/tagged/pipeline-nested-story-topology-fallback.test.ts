/**
 * When the main-body table-topology guard refuses a header or footer story's
 * tables, the comparison does not abort: a part with no text box in it is
 * left uncompared and listed in `unrepresentedChanges`, and a text-box story
 * keeps the unguarded comparison it used before #1393.
 *
 * No real input is known to reach the refusal once the eligibility gates
 * have admitted a story, so the guard is wrapped to refuse any story that
 * contains a marker word.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @see https://github.com/UseJunior/safe-docx/issues/1393
 */

import { describe, expect, vi } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import type { TaggedNode } from './taggedTree.js';

const REFUSE_MARKER = 'RefuseThisStory';

vi.mock('./tableTopologyGuard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tableTopologyGuard.js')>();
  return {
    ...actual,
    guardBodyTableTopology: (tree: TaggedNode): void => {
      const root = tree.tag === 'both' ? tree.revised : tree.node;
      if ((root.textContent ?? '').includes(REFUSE_MARKER)) {
        throw new actual.UnsupportedTableTopologyComparisonError('occupancy', 0, 0);
      }
      actual.guardBodyTableTopology(tree);
    },
  };
});

const TEST_FEATURE = 'add-markdoc-header-footer-authoring';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' });

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-13T00:00:00.000Z') };

const paragraph = (value: string): string => `<w:p><w:r><w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;
const row = (value: string): string => `<w:tr><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${paragraph(value)}</w:tc></w:tr>`;
const table = (...rows: string[]): string =>
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4500"/></w:tblGrid>${rows.join('')}</w:tbl>`;
const textBox = (value: string): string =>
  '<w:p><w:r><w:pict><v:shape id="shape1" o:spid="_x0000_s1026"><v:textbox><w:txbxContent>'
  + `${paragraph(value)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;

/** One section with a default header part holding `headerContent`. */
async function headerPackage(bodyText: string, headerContent: string): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(paragraph(bodyText), [], { namespaces: { r: R_NS } }));
  archive.setDocumentXml((await archive.getDocumentXml())
    .replace('<w:sectPr/>', '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>'));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdHeader" Type="${R_NS}/header" Target="header1.xml"/></Relationships>`,
  );
  archive.setFile(
    'word/header1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}"`
      + ' xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
      + `${headerContent}</w:hdr>`,
  );
  return archive.save();
}

const headerXml = async (buffer: Buffer): Promise<string> =>
  (await (await DocxArchive.load(buffer)).getFile('word/header1.xml'))!;
const bodyText = async (buffer: Buffer, project: (xml: string) => string = (xml) => xml): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));
const revisionCount = (xml: string): number => {
  const document = parseXml(xml);
  return ['ins', 'del'].reduce((count, name) => count + document.getElementsByTagNameNS(W_NS, name).length, 0);
};

describe('a header story whose tables the topology guard refuses (#1393)', () => {
  test.openspec('[SDX-CMP-STORY-05] Unsupported topology remains unrepresented')(
    'lists a refused header part instead of aborting and leaves it as the revised part',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('a header table that gains a row the guard refuses, beside a body edit', () =>
        Promise.all([
          headerPackage('Body draft', table(row(REFUSE_MARKER)) + paragraph('Header')),
          headerPackage('Body final', table(row(REFUSE_MARKER), row('Added')) + paragraph('Header')),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the default header is listed and carries the revised part without revisions', async () => {
        expect(result.unrepresentedChanges).toEqual([
          expect.objectContaining({ scope: 'header', kind: 'changed', role: 'default' }),
        ]);
        expect(await headerXml(result.document)).toBe(await headerXml(revised));
      });
      await then('the body edit is tracked', async () => {
        expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
        expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
      });
    },
  );

  test.openspec('[SDX-CMP-STORY-01] Ordinary selected header text receives native revisions')(
    'keeps the unguarded comparison for a refused header text-box story',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('a header text box whose text changes in a story the guard refuses', () =>
        Promise.all([
          headerPackage('Body', textBox(`${REFUSE_MARKER} draft`)),
          headerPackage('Body', textBox(`${REFUSE_MARKER} final`)),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the text-box edit is tracked and nothing is listed', async () => {
        expect(result.unrepresentedChanges).toBeUndefined();
        const xml = await headerXml(result.document);
        expect(revisionCount(xml)).toBeGreaterThan(0);
        expect(extractRoundTripComparisonText(acceptAllChanges(xml))).toContain(`${REFUSE_MARKER} final`);
        expect(extractRoundTripComparisonText(rejectAllChanges(xml))).toContain(`${REFUSE_MARKER} draft`);
      });
    },
  );
});
