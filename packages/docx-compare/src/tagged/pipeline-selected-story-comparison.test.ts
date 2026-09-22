import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const HEADER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TEST_FEATURE = 'add-markdoc-header-footer-authoring';

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function runningStory(kind: 'header' | 'footer', content: string): string {
  const root = kind === 'header' ? 'hdr' : 'ftr';
  return `<?xml version="1.0"?><w:${root} xmlns:w="${OOXML.W_NS}" xmlns:r="${R_NS}">${content}</w:${root}>`;
}

async function selectedHeaderFixture(options: {
  kind?: 'header' | 'footer';
  target?: string;
  storyContent: string;
  sectPrXml?: string;
  bodyXml?: string;
}): Promise<Buffer> {
  const kind = options.kind ?? 'header';
  const target = options.target ?? `${kind}1.xml`;
  const relationshipId = kind === 'header' ? 'rIdHeader' : 'rIdFooter';
  const relationshipType = kind === 'header' ? HEADER_RELATIONSHIP : FOOTER_RELATIONSHIP;
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(
    options.bodyXml ?? paragraph('Body'),
    [],
    { namespaces: { r: R_NS } },
  ));
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    options.sectPrXml
      ?? `<w:sectPr><w:${kind}Reference w:type="default" r:id="${relationshipId}"/></w:sectPr>`,
  ));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="${relationshipId}" Type="${relationshipType}" Target="${target}"/></Relationships>`,
  );
  archive.setFile(`word/${target}`, runningStory(kind, options.storyContent));
  return archive.save();
}

async function selectedHeaderXml(document: Buffer, path = 'word/header1.xml'): Promise<string> {
  const xml = await (await DocxArchive.load(document)).getFile(path);
  if (xml === null) throw new Error(`Missing selected story ${path}`);
  return xml;
}

function revisionCounts(xml: string): { insertions: number; deletions: number } {
  const document = parseXml(xml);
  return {
    insertions: document.getElementsByTagNameNS(OOXML.W_NS, 'ins').length,
    deletions: document.getElementsByTagNameNS(OOXML.W_NS, 'del').length,
  };
}

describe('ordinary relationship-selected story comparison', () => {
  const test = testAllure.epic('Document Comparison')
    .withLabels({ feature: TEST_FEATURE })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.3' });

  test.openspec('[SDX-CMP-STORY-01] Ordinary selected header text receives native revisions')(
    'splices native revisions into the selected header and clears represented slots',
    async () => {
      const original = await selectedHeaderFixture({ storyContent: paragraph('Draft 17 September') });
      const revised = await selectedHeaderFixture({ storyContent: paragraph('Draft 18 September') });
      const result = await compareDocumentsAtomizer(original, revised);
      const output = await selectedHeaderXml(result.document);

      expect(revisionCounts(output).insertions).toBeGreaterThan(0);
      expect(revisionCounts(output).deletions).toBeGreaterThan(0);
      expect(extractRoundTripComparisonText(acceptAllChanges(output))).toContain('Draft 18 September');
      expect(extractRoundTripComparisonText(rejectAllChanges(output))).toContain('Draft 17 September');
      expect(result.unrepresentedChanges).toBeUndefined();
    },
  );

  test.openspec('[SDX-CMP-STORY-01] Ordinary selected header text receives native revisions')(
    'compares ordinary selected footer text through the same running-story pipeline',
    async () => {
      const original = await selectedHeaderFixture({
        kind: 'footer',
        storyContent: paragraph('Confidential — draft'),
      });
      const revised = await selectedHeaderFixture({
        kind: 'footer',
        storyContent: paragraph('Confidential — final'),
      });
      const result = await compareDocumentsAtomizer(original, revised);
      const output = await selectedHeaderXml(result.document, 'word/footer1.xml');

      expect(extractRoundTripComparisonText(acceptAllChanges(output))).toContain('Confidential — final');
      expect(extractRoundTripComparisonText(rejectAllChanges(output))).toContain('Confidential — draft');
      expect(result.unrepresentedChanges).toBeUndefined();
    },
  );

  test.openspec('[SDX-CMP-STORY-02] Semantic identity survives physical part renumbering')(
    'pairs the same binding closure across different physical filenames',
    async () => {
      const original = await selectedHeaderFixture({
        target: 'header1.xml',
        storyContent: paragraph('Original allocation'),
      });
      const revised = await selectedHeaderFixture({
        target: 'header9.xml',
        storyContent: paragraph('Revised allocation'),
      });
      const result = await compareDocumentsAtomizer(original, revised);
      const output = await selectedHeaderXml(result.document, 'word/header9.xml');

      expect(extractRoundTripComparisonText(acceptAllChanges(output))).toContain('Revised allocation');
      expect(extractRoundTripComparisonText(rejectAllChanges(output))).toContain('Original allocation');
      expect(result.unrepresentedChanges).toBeUndefined();
    },
  );

  test.openspec('[SDX-CMP-STORY-03] Shared selected story compares once')(
    'represents one physical story once and clears every selector alias',
    async () => {
      const firstSection = '<w:p><w:pPr><w:sectPr>'
        + '<w:headerReference w:type="default" r:id="rIdHeader"/>'
        + '</w:sectPr></w:pPr><w:r><w:t>Section one</w:t></w:r></w:p>';
      const finalSection = '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>';
      const original = await selectedHeaderFixture({
        bodyXml: firstSection + paragraph('Section two'),
        sectPrXml: finalSection,
        storyContent: paragraph('Shared original'),
      });
      const revised = await selectedHeaderFixture({
        bodyXml: firstSection + paragraph('Section two'),
        sectPrXml: finalSection,
        storyContent: paragraph('Shared revised'),
      });
      const result = await compareDocumentsAtomizer(original, revised);
      const archive = await DocxArchive.load(result.document);
      const output = await selectedHeaderXml(result.document);

      expect(archive.listFiles().filter((path) => /^word\/header\d*\.xml$/u.test(path))).toEqual([
        'word/header1.xml',
      ]);
      expect(extractRoundTripComparisonText(acceptAllChanges(output))).toContain('Shared revised');
      expect(extractRoundTripComparisonText(rejectAllChanges(output))).toContain('Shared original');
      expect(result.unrepresentedChanges).toBeUndefined();
    },
  );

  test.openspec('[SDX-CMP-STORY-01] Ordinary selected header text receives native revisions')(
    'compares ordinary text inside an existing physical table cell without changing topology',
    async () => {
      const table = (text: string): string => '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>'
        + `<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
      const original = await selectedHeaderFixture({ storyContent: table('Cell original') });
      const revised = await selectedHeaderFixture({ storyContent: table('Cell revised') });
      const result = await compareDocumentsAtomizer(original, revised);
      const output = await selectedHeaderXml(result.document);
      const outputDoc = parseXml(output);

      expect(outputDoc.getElementsByTagNameNS(OOXML.W_NS, 'tbl')).toHaveLength(1);
      expect(outputDoc.getElementsByTagNameNS(OOXML.W_NS, 'tr')).toHaveLength(1);
      expect(outputDoc.getElementsByTagNameNS(OOXML.W_NS, 'tc')).toHaveLength(1);
      expect(extractRoundTripComparisonText(acceptAllChanges(output))).toContain('Cell revised');
      expect(extractRoundTripComparisonText(rejectAllChanges(output))).toContain('Cell original');
    },
  );

  test.openspec('[SDX-CMP-STORY-01] Ordinary selected header text receives native revisions')(
    'tracks insertion and deletion in the admitted root paragraph sequence',
    async () => {
      const original = await selectedHeaderFixture({
        storyContent: paragraph('Keep') + paragraph('Delete me'),
      });
      const revised = await selectedHeaderFixture({
        storyContent: paragraph('Keep') + paragraph('Insert me'),
      });
      const result = await compareDocumentsAtomizer(original, revised);
      const output = await selectedHeaderXml(result.document);

      expect(extractRoundTripComparisonText(acceptAllChanges(output))).toContain('Keep\nInsert me');
      expect(extractRoundTripComparisonText(rejectAllChanges(output))).toContain('Keep\nDelete me');
      expect(revisionCounts(output).insertions).toBeGreaterThan(0);
      expect(revisionCounts(output).deletions).toBeGreaterThan(0);
    },
  );

  test.openspec('[SDX-CMP-STORY-04] Field-bearing running text preserves field structure')(
    'keeps a PAGE field intact while revising neighboring ordinary text',
    async () => {
      const field = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        + '<w:r><w:instrText> PAGE </w:instrText></w:r>'
        + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        + '<w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
      const original = await selectedHeaderFixture({
        storyContent: `<w:p>${field}<w:r><w:t> — Draft</w:t></w:r></w:p>`,
      });
      const revised = await selectedHeaderFixture({
        storyContent: `<w:p>${field}<w:r><w:t> — Final</w:t></w:r></w:p>`,
      });
      const result = await compareDocumentsAtomizer(original, revised);
      const output = await selectedHeaderXml(result.document);
      const outputDoc = parseXml(output);

      expect(outputDoc.getElementsByTagNameNS(OOXML.W_NS, 'fldChar')).toHaveLength(3);
      expect(outputDoc.getElementsByTagNameNS(OOXML.W_NS, 'instrText')[0]?.textContent).toBe(' PAGE ');
      expect(extractRoundTripComparisonText(acceptAllChanges(output))).toContain('Final');
      expect(extractRoundTripComparisonText(rejectAllChanges(output))).toContain('Draft');
    },
  );

  test.openspec('[SDX-CMP-STORY-04] Field-bearing running text preserves field structure')(
    'relationship-walks unchanged selected stories into field-state validation',
    async () => {
      const malformedField = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        + '<w:r><w:instrText> PAGE </w:instrText></w:r></w:p>';
      const original = await selectedHeaderFixture({ storyContent: malformedField });
      const revised = await selectedHeaderFixture({ storyContent: malformedField });

      await expect(compareDocumentsAtomizer(original, revised)).rejects.toThrow(/ancillary story safety/i);
    },
  );

  test.openspec('[SDX-CMP-STORY-01] Ordinary selected header text receives native revisions')(
    'keeps an unchanged selected story byte-identical during an ordinary body edit',
    async () => {
      const storyContent = paragraph('Unchanged running header');
      const original = await selectedHeaderFixture({
        bodyXml: paragraph('Original body'),
        storyContent,
      });
      const revised = await selectedHeaderFixture({
        bodyXml: paragraph('Revised body'),
        storyContent,
      });
      const result = await compareDocumentsAtomizer(original, revised);

      expect(await selectedHeaderXml(result.document)).toBe(await selectedHeaderXml(revised));
    },
  );

  test.openspec('[SDX-CMP-STORY-05] Unsupported topology remains unrepresented')(
    'does not claim a structural table-row insertion as ordinary story text',
    async () => {
      const row = (text: string): string => `<w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`;
      const original = await selectedHeaderFixture({
        storyContent: `<w:tbl>${row('One')}</w:tbl>`,
      });
      const revised = await selectedHeaderFixture({
        storyContent: `<w:tbl>${row('One')}${row('Two')}</w:tbl>`,
      });
      const result = await compareDocumentsAtomizer(original, revised);
      const output = await selectedHeaderXml(result.document);

      expect(revisionCounts(output)).toEqual({ insertions: 0, deletions: 0 });
      expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: 'header', kind: 'changed', sectionIndex: 0, role: 'default' }),
      ]));
    },
  );
});
