import { describe, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  DocxArchive,
  buildDocxFromParts,
  parseXml,
  OOXML,
} from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileGreenfieldMarkdoc, parseGreenfieldMarkdoc } from './greenfield.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">` +
  ['Normal', 'Heading1', 'HouseBody', 'HouseTitle'].map((id) => `<w:style w:type="paragraph" w:styleId="${id}"/>`).join('') +
  '</w:styles>';

const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: 'Template-backed greenfield Markdoc generation',
  story: 'Issue 998 greenfield generation',
  severity: 'critical',
});
const conforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.2.2' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.27' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' });

async function houseTemplate(): Promise<Buffer> {
  const base = await buildDocxFromParts({
    bodyXml: '<w:p><w:r><w:t>PLACEHOLDER MUST DISAPPEAR</w:t></w:r></w:p>',
    stylesXml: styles,
  });
  const archive = await DocxArchive.load(base);
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    '<w:sectPr><w:footerReference w:type="default" r:id="rFooter"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
  ));
  archive.setFile('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rFooter" Type="${R}/footer" Target="footer1.xml"/></Relationships>`);
  archive.setFile('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}"><w:p><w:r><w:t>HOUSE FOOTER</w:t></w:r></w:p></w:ftr>`);
  archive.setFile('word/numbering.xml', '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
  return archive.save();
}

describe('template-backed greenfield Markdoc generation', () => {
  conforming.openspec('headings and paragraphs use declared template styles')(
    '[SDX-MDOC-GREEN-01] emits only canonical blocks with explicit house styles', async () => {
      const template = await houseTemplate();
      const result = await compileGreenfieldMarkdoc(template, '# Form title\n\nName: _____\n\nA & B\n\n#not-a-heading', {
        styleProfile: { bodyStyleId: 'HouseBody', headingStyleIds: { 1: 'HouseTitle' } },
        styleProfileSource: '{"bodyStyleId":"HouseBody","headingStyleIds":{"1":"HouseTitle"}}',
      });
      const archive = await DocxArchive.load(result.clean);
      const document = parseXml(await archive.getDocumentXml());
      const texts = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 't')).map((node) => node.textContent);
      const styleIds = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'pStyle')).map((node) => node.getAttributeNS(OOXML.W_NS, 'val'));
      expect(texts).toEqual(['Form title', 'Name: _____', 'A & B', '#not-a-heading']);
      expect(styleIds).toEqual(['HouseTitle', 'HouseBody', 'HouseBody', 'HouseBody']);
      expect(await archive.getFile('word/footer1.xml')).toContain('HOUSE FOOTER');
      expect(await archive.getFile('word/numbering.xml')).toContain('w:numbering');
      expect(await archive.getDocumentXml()).not.toContain('PLACEHOLDER');
    },
  );

  test.openspec('unsupported syntax or style mapping fails transactionally')(
    '[SDX-MDOC-GREEN-02] distinguishes literal form text from parsed unsupported syntax', async () => {
      expect(parseGreenfieldMarkdoc('Name: _____\n\nA & B\n\n#not-a-heading')).toHaveLength(3);
      for (const source of ['*emphasis*', '_____', '---', '```text\nnope\n```', '---\ntitle: swallowed\n---\nBody']) {
        expect(() => parseGreenfieldMarkdoc(source), source).toThrow();
      }
      await expect(compileGreenfieldMarkdoc(await houseTemplate(), 'Body', { styleProfile: { bodyStyleId: 'Missing' } }))
        .rejects.toMatchObject({ code: 'MISSING_TEMPLATE_STYLE' });
    },
  );

  conforming.openspec('house-style and running-story scaffolding survive body replacement')(
    '[SDX-MDOC-GREEN-03] retains section, footer binding, and every non-document part byte-for-byte', async () => {
      const template = await houseTemplate();
      const before = await DocxArchive.load(template);
      const result = await compileGreenfieldMarkdoc(template, 'New body.');
      const after = await DocxArchive.load(result.clean);
      for (const path of before.listFiles().filter((path) => path !== 'word/document.xml')) {
        expect(await after.getFileBuffer(path), path).toEqual(await before.getFileBuffer(path));
      }
      expect(result.certificate.sectionBindings).toEqual([{ kind: 'footer', role: 'default', rid: 'rFooter', targetPath: 'word/footer1.xml' }]);
    },
  );

  conforming.openspec('ambiguous template topology is refused')(
    '[SDX-MDOC-GREEN-04] rejects multiple sections and revisions in selected stories', async () => {
      const template = await houseTemplate();
      const archive = await DocxArchive.load(template);
      archive.setDocumentXml((await archive.getDocumentXml()).replace('<w:sectPr>', '<w:p><w:pPr><w:sectPr/></w:pPr></w:p><w:sectPr>'));
      await expect(compileGreenfieldMarkdoc(await archive.save(), 'Body')).rejects.toMatchObject({ code: 'UNSUPPORTED_GREENFIELD_TEMPLATE_TOPOLOGY' });

      const revised = await DocxArchive.load(template);
      revised.setFile('word/footer1.xml', `<?xml version="1.0"?><w:ftr xmlns:w="${W}"><w:p><w:ins w:id="1"><w:r><w:t>changed</w:t></w:r></w:ins></w:p></w:ftr>`);
      await expect(compileGreenfieldMarkdoc(await revised.save(), 'Body')).rejects.toMatchObject({ code: 'GREENFIELD_TEMPLATE_HAS_REVISIONS' });
    },
  );

  test.openspec('successful build is reproducible and independently auditable')(
    '[SDX-MDOC-GREEN-05] produces byte-identical packages and hash-bound certificates', async () => {
      const template = await houseTemplate();
      const first = await compileGreenfieldMarkdoc(template, '# Title\n\nBody');
      const second = await compileGreenfieldMarkdoc(template, '# Title\n\nBody');
      expect(first.clean).toEqual(second.clean);
      expect(first.certificate).toEqual(second.certificate);
      expect(first.certificate.changedParts).toEqual(['word/document.xml']);
      expect(first.certificate.outputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(first.certificate.selectedRevisionStories).toEqual(['word/document.xml', 'word/footer1.xml']);
    },
  );

  test.openspec('greenfield output never invents a reject-state redline')(
    '[SDX-MDOC-GREEN-06] returns only clean output and a certificate', async () => {
      const result = await compileGreenfieldMarkdoc(await houseTemplate(), 'Clean form body.');
      expect(Object.keys(result).sort()).toEqual(['certificate', 'clean']);
      expect(JSON.stringify(result.certificate)).not.toContain('redline');
    },
  );

  conforming('[SDX-MDOC-GREEN-REAL-01] projects a real OpenAgreements house-style template without custom OOXML', async () => {
    const template = await readFile('../../tests/test_documents/open-agreements/letter-of-intent.docx');
    const before = await DocxArchive.load(template);
    const result = await compileGreenfieldMarkdoc(template, 'Template-backed synthetic form body.');
    const after = await DocxArchive.load(result.clean);
    expect(await after.getFileBuffer('word/footer1.xml')).toEqual(await before.getFileBuffer('word/footer1.xml'));
    expect(await after.getDocumentXml()).toContain('Template-backed synthetic form body.');
  });
});
