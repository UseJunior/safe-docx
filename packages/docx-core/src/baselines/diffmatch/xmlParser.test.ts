import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import { parseXml } from '../../primitives/xml.js';
import {
  extractParagraphs,
  extractRunProperties,
  extractSectPr,
  getBodyContent,
} from './xmlParser.js';

describe('diffmatch xml parser (xmldom)', () => {
  it('extracts direct body paragraphs, preserving pPr XML and run text', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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

    const paragraphs = extractParagraphs(xml);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.originalIndex).toBe(0);
    expect(paragraphs[0]?.text).toBe('Hello world\t\nline');
    expect(paragraphs[0]?.runs).toHaveLength(2);
    expect(paragraphs[0]?.runs[0]?.properties?.bold).toBe(true);
    expect(paragraphs[0]?.pPrXml).toContain('<w:pPr>');
    expect(paragraphs[0]?.pPrXml).toContain('<w:pStyle w:val="Normal"/>');
    expect(paragraphs[1]?.originalIndex).toBe(1);
    expect(paragraphs[1]?.text).toBe('Second');
  });

  it('extracts run properties from w:rPr', () => {
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

    const rPr = doc.getElementsByTagName('w:rPr')[0];
    expect(rPr).toBeDefined();

    const props = extractRunProperties(rPr!);
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

  it('extracts body content and trailing sectPr for reconstruction', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>A</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;

    const parts = getBodyContent(xml);
    const extracted = extractSectPr(parts.bodyContent);

    expect(parts.beforeBody).toContain('<w:body>');
    expect(parts.afterBody).toContain('</w:body>');
    expect(extracted.content).toContain('<w:p>');
    expect(extracted.sectPr).toContain('<w:sectPr>');
  });
});
