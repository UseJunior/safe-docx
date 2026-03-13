#!/usr/bin/env node
/**
 * End-to-end test: create DOCX files with tables, render via document view,
 * and write output files for visual inspection.
 */
import { DocxDocument, createZipBuffer, renderToon } from '@usejunior/docx-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const CT_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

// Letter page usable width: 8.5" - 1" margins each side = 6.5" = 9360 DXA
const PAGE_CONTENT_WIDTH_DXA = 9360;

// Table properties modeled on Open Agreements checklist tables:
// - fixed layout with explicit tblGrid column widths
// - single-line borders (all sides + inside grid)
// - cell margins for readability
function tblPr(numCols) {
  const colWidth = Math.floor(PAGE_CONTENT_WIDTH_DXA / numCols);
  const grid = Array.from({ length: numCols }, () =>
    `<w:gridCol w:w="${colWidth}"/>`
  ).join('');

  return (
    `<w:tblPr>` +
    `<w:tblW w:type="dxa" w:w="${PAGE_CONTENT_WIDTH_DXA}"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:color="auto" w:sz="4" w:space="0"/>` +
    `<w:left w:val="single" w:color="auto" w:sz="4" w:space="0"/>` +
    `<w:bottom w:val="single" w:color="auto" w:sz="4" w:space="0"/>` +
    `<w:right w:val="single" w:color="auto" w:sz="4" w:space="0"/>` +
    `<w:insideH w:val="single" w:color="auto" w:sz="4" w:space="0"/>` +
    `<w:insideV w:val="single" w:color="auto" w:sz="4" w:space="0"/>` +
    `</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar>` +
    `<w:top w:type="dxa" w:w="80"/>` +
    `<w:left w:type="dxa" w:w="115"/>` +
    `<w:bottom w:type="dxa" w:w="80"/>` +
    `<w:right w:type="dxa" w:w="115"/>` +
    `</w:tblCellMar>` +
    `<w:tblLook w:val="04A0"/>` +
    `</w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>`
  );
}

// Header cell: light gray shading
const HEADER_TC_PR =
  `<w:tcPr>` +
  `<w:shd w:fill="F2F2F2" w:color="auto" w:val="clear"/>` +
  `</w:tcPr>`;

function p(text) {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function cell(text) {
  return `<w:tc>${p(text)}</w:tc>`;
}

function headerCell(text) {
  return `<w:tc>${HEADER_TC_PR}<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function row(cells) {
  return `<w:tr>${cells.map(cell).join('')}</w:tr>`;
}

function headerRow(cells) {
  return `<w:tr>${cells.map(headerCell).join('')}</w:tr>`;
}

function table(headers, rows) {
  return `<w:tbl>${tblPr(headers.length)}${headerRow(headers)}${rows.map(row).join('')}</w:tbl>`;
}

async function buildAndRender(name, bodyXml) {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`;

  const buf = await createZipBuffer({
    '[Content_Types].xml': CT_XML,
    '_rels/.rels': RELS_XML,
    'word/document.xml': xml,
  });

  const doc = await DocxDocument.load(buf);
  doc.insertParagraphBookmarks('e2e');
  const { nodes } = doc.buildDocumentView();
  const toon = renderToon(nodes);

  // Also render JSON (first 2 nodes with table_context for brevity)
  const tableNodes = nodes.filter(n => n.table_context);
  const jsonSample = JSON.stringify(tableNodes.slice(0, 4).map(n => ({
    id: n.id,
    clean_text: n.clean_text,
    style: n.style,
    table_context: n.table_context,
  })), null, 2);

  const outDir = path.join(import.meta.dirname, '..', 'tmp-table-test');
  await fs.mkdir(outDir, { recursive: true });

  const toonPath = path.join(outDir, `${name}.toon.txt`);
  const jsonPath = path.join(outDir, `${name}.json`);
  const docxPath = path.join(outDir, `${name}.docx`);

  await fs.writeFile(toonPath, toon);
  await fs.writeFile(jsonPath, jsonSample);
  const { buffer } = await doc.toBuffer();
  await fs.writeFile(docxPath, buffer);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${name}`);
  console.log(`${'='.repeat(70)}`);
  console.log(toon);
  console.log(`\nJSON sample (first 4 table nodes):`);
  console.log(jsonSample);
  console.log(`\nFiles: ${toonPath}`);
  console.log(`       ${jsonPath}`);
  console.log(`       ${docxPath}`);

  return { toonPath, jsonPath, docxPath };
}

// ── Test 1: Simple contract-style table ──────────────────────────────
const test1Body =
  p('EXHIBIT A - SERVICE LEVELS') +
  table(
    ['Metric', 'Target', 'Measurement Period'],
    [
      ['Uptime', '99.9%', 'Monthly'],
      ['Response Time', '< 200ms', 'Weekly'],
      ['Error Rate', '< 0.1%', 'Daily'],
    ],
  ) +
  p('The above metrics shall be measured continuously.');

// ── Test 2: Multiple tables with body text between ───────────────────
const test2Body =
  p('Section 1: Team Roster') +
  table(
    ['Name', 'Role', 'Start Date'],
    [
      ['Alice', 'Engineer', '2024-01-15'],
      ['Bob', 'Designer', '2024-03-01'],
    ],
  ) +
  p('Section 2: Project Milestones') +
  table(
    ['Milestone', 'Due Date', 'Status'],
    [
      ['Alpha', '2024-06-01', 'Complete'],
      ['Beta', '2024-09-01', 'In Progress'],
      ['GA', '2025-01-01', 'Planned'],
    ],
  ) +
  p('All dates are tentative.');

// ── Test 3: Table with gridSpan (merged cells) ───────────────────────
const test3Body =
  p('Pricing Summary') +
  `<w:tbl>${tblPr(3)}` +
  headerRow(['Plan', 'Monthly', 'Annual']) +
  `<w:tr>` +
  cell('Starter') +
  cell('$9') +
  cell('$99') +
  `</w:tr>` +
  `<w:tr>` +
  cell('Pro') +
  cell('$29') +
  cell('$299') +
  `</w:tr>` +
  `<w:tr>` +
  `<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p('Enterprise pricing')}</w:tc>` +
  cell('Contact us') +
  `</w:tr>` +
  `</w:tbl>` +
  p('All prices in USD.');

// ── Test 4: Multi-paragraph cells ────────────────────────────────────
const test4Body =
  `<w:tbl>${tblPr(2)}` +
  headerRow(['Term', 'Definition']) +
  `<w:tr>` +
  cell('Force Majeure') +
  `<w:tc>` +
  p('Events beyond reasonable control including:') +
  p('- Natural disasters') +
  p('- Government actions') +
  p('- Epidemics') +
  `</w:tc>` +
  `</w:tr>` +
  `<w:tr>` +
  cell('Confidential Information') +
  `<w:tc>` +
  p('Any non-public information disclosed by either party.') +
  p('Excludes information that becomes publicly available.') +
  `</w:tc>` +
  `</w:tr>` +
  `</w:tbl>`;

async function main() {
  const files = [];
  files.push(await buildAndRender('1-simple-table', test1Body));
  files.push(await buildAndRender('2-multiple-tables', test2Body));
  files.push(await buildAndRender('3-gridspan-merged', test3Body));
  files.push(await buildAndRender('4-multi-paragraph-cells', test4Body));

  console.log('\n' + '='.repeat(70));
  console.log('All output files:');
  for (const f of files) {
    console.log(`  ${f.toonPath}`);
  }

  return files;
}

const files = await main();
// Export paths for the caller
const allPaths = files.flatMap(f => [f.toonPath, f.jsonPath]);
console.log('\n__PATHS__');
for (const p of allPaths) console.log(p);
