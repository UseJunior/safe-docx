import JSZip from 'jszip';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const wrapper = body => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const p = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>T</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const sectionParagraph = '<w:p><w:pPr><w:jc w:val="right"/><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr><w:r><w:t>B</w:t></w:r></w:p>';

export const issue891Bodies = {
  'table-original.docx': wrapper(p('A') + table + p('B') + p('C')),
  'table-revised.docx': wrapper(p('A') + table),
  'section-original.docx': wrapper(p('A') + sectionParagraph),
  'section-revised.docx': wrapper(p('A')),
};

export async function buildFixture(documentXml) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function writeIssue891Fixtures(outputDir) {
  await mkdir(outputDir, { recursive: true });
  await Promise.all(Object.entries(issue891Bodies).map(async ([name, xml]) => writeFile(resolve(outputDir, name), await buildFixture(xml))));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--output-dir');
  if (index < 0 || !process.argv[index + 1]) throw new Error('--output-dir is required');
  await writeIssue891Fixtures(resolve(process.argv[index + 1]));
}
