import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { parseXml } from '../../primitives/xml.js';
import {
  extractParagraphs,
  extractRunProperties,
  extractSectPr,
  getBodyContent,
} from './xmlParser.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'XML Parser' });

describe('diffmatch xml parser (xmldom)', () => {
  test('extracts direct body paragraphs, preserving pPr XML and run text', async ({ given, when, then }: AllureBddContext) => {
    let xml: string;
    let paragraphs: ReturnType<typeof extractParagraphs>;

    await given('a document XML with two body paragraphs and a table', () => {
      xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r>
        <w:rPr><w:b/></w:rPr>
        <w:t>Hello</w:t>
      </w:r>
      <w:r>
        <w:t xml:space="preserve"> world</w:t>
        <w:tab/>
        <w:br/>
        <w:t>line</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>inside table</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:p>
      <w:r><w:t>Second</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;
    });

    await when('paragraphs are extracted', () => {
      paragraphs = extractParagraphs(xml);
    });

    await then('only direct body paragraphs are returned with correct properties', () => {
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0]?.originalIndex).toBe(0);
      expect(paragraphs[0]?.text).toBe('Hello world\t\nline');
      expect(paragraphs[0]?.runs).toHaveLength(2);
      expect(paragraphs[0]?.runs[0]?.properties?.bold).toBe(true);
      expect(paragraphs[0]?.pPrXml).toContain('<w:pPr');
      expect(paragraphs[0]?.pPrXml).toContain('<w:pStyle w:val="Normal"/>');
      expect(paragraphs[1]?.originalIndex).toBe(1);
      expect(paragraphs[1]?.text).toBe('Second');
    });
  });

  test('extracts run properties from w:rPr', async ({ given, when, then }: AllureBddContext) => {
    let rPr: Element;
    let props: ReturnType<typeof extractRunProperties>;

    await given('an rPr element with all common properties', () => {
      const doc = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:rPr>
    <w:b/>
    <w:i/>
    <w:u w:val="double"/>
    <w:strike/>
    <w:highlight w:val="yellow"/>
    <w:color w:val="FF0000"/>
    <w:sz w:val="24"/>
    <w:rFonts w:ascii="Calibri"/>
  </w:rPr>
</w:root>`);
      rPr = doc.getElementsByTagName('w:rPr')[0]!;
      expect(rPr).toBeDefined();
    });

    await when('run properties are extracted', () => {
      props = extractRunProperties(rPr);
    });

    await then('all properties are correctly parsed', () => {
      expect(props).toEqual({
        bold: true,
        italic: true,
        underline: 'double',
        strikethrough: true,
        highlight: 'yellow',
        color: 'FF0000',
        fontSize: 24,
        fontFamily: 'Calibri',
      });
    });
  });

  test('extracts body content and trailing sectPr for reconstruction', async ({ given, when, then }: AllureBddContext) => {
    let xml: string;
    let parts: ReturnType<typeof getBodyContent>;
    let extracted: ReturnType<typeof extractSectPr>;

    await given('a document XML with a sectPr', () => {
      xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>A</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;
    });

    await when('body content and sectPr are extracted', () => {
      parts = getBodyContent(xml);
      extracted = extractSectPr(parts.bodyContent);
    });

    await then('the body parts and sectPr are correctly separated', () => {
      expect(parts.beforeBody).toContain('<w:body>');
      expect(parts.afterBody).toContain('</w:body>');
      expect(extracted.content).toContain('<w:p>');
      expect(extracted.sectPr).toContain('<w:sectPr>');
    });
  });
});
