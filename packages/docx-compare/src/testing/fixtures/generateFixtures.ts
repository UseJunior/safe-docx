/**
 * Test fixture generator for docx-comparison package.
 *
 * Creates minimal valid DOCX files for A/B baseline comparison testing.
 * Run with: npx tsx src/testing/fixtures/generateFixtures.ts
 */

import JSZip from 'jszip';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Complete [Content_Types].xml for a DOCX file.
 */
const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
  <Override PartName="/word/webSettings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

/**
 * Complete _rels/.rels for a DOCX file.
 */
const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

/**
 * Complete word/_rels/document.xml.rels for a DOCX file.
 */
const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings" Target="webSettings.xml"/>
</Relationships>`;

/**
 * Minimal word/styles.xml for a DOCX file.
 */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Times New Roman"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault/>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`;

/**
 * Minimal word/settings.xml for a DOCX file.
 */
const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="720"/>
  <w:characterSpacingControl w:val="doNotCompress"/>
  <w:compat>
    <w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>
  </w:compat>
</w:settings>`;

/**
 * Minimal word/fontTable.xml for a DOCX file.
 */
const FONT_TABLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="Calibri">
    <w:panose1 w:val="020F0502020204030204"/>
    <w:charset w:val="00"/>
    <w:family w:val="swiss"/>
    <w:pitch w:val="variable"/>
  </w:font>
  <w:font w:name="Times New Roman">
    <w:panose1 w:val="02020603050405020304"/>
    <w:charset w:val="00"/>
    <w:family w:val="roman"/>
    <w:pitch w:val="variable"/>
  </w:font>
</w:fonts>`;

/**
 * Minimal word/webSettings.xml for a DOCX file.
 */
const WEB_SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:webSettings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:optimizeForBrowser/>
  <w:allowPNG/>
</w:webSettings>`;

/**
 * Minimal docProps/core.xml for a DOCX file.
 */
const CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Test Fixture</dc:title>
  <dc:creator>docx-comparison</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

/**
 * Minimal docProps/app.xml for a DOCX file.
 */
const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>docx-comparison</Application>
  <AppVersion>1.0</AppVersion>
</Properties>`;

/**
 * Create a minimal document.xml with the given paragraphs.
 */
function createDocumentXml(paragraphs: string[]): string {
  const paragraphXml = paragraphs
    .map(
      (text) => `
    <w:p>
      <w:r>
        <w:t>${escapeXml(text)}</w:t>
      </w:r>
    </w:p>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphXml}
    <w:sectPr/>
  </w:body>
</w:document>`;
}

/**
 * Create a document with multiple runs in a paragraph (for run-level testing).
 */
function createDocumentWithRuns(runs: Array<{ text: string; bold?: boolean }>): string {
  const runXml = runs
    .map((run) => {
      const rPr = run.bold ? '<w:rPr><w:b/></w:rPr>' : '';
      return `
      <w:r>
        ${rPr}
        <w:t>${escapeXml(run.text)}</w:t>
      </w:r>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>${runXml}
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;
}

/**
 * Escape XML special characters.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Create a complete DOCX file from document XML content.
 */
async function createDocx(documentXml: string): Promise<Buffer> {
  const zip = new JSZip();

  // Core package parts
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', ROOT_RELS_XML);

  // Word document parts
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', STYLES_XML);
  zip.file('word/settings.xml', SETTINGS_XML);
  zip.file('word/fontTable.xml', FONT_TABLE_XML);
  zip.file('word/webSettings.xml', WEB_SETTINGS_XML);

  // Document properties
  zip.file('docProps/core.xml', CORE_XML);
  zip.file('docProps/app.xml', APP_XML);

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  return buffer;
}

/**
 * Write a fixture pair to disk.
 */
async function writeFixture(
  name: string,
  original: Buffer,
  revised: Buffer
): Promise<void> {
  const fixtureDir = join(__dirname, name);

  await mkdir(fixtureDir, { recursive: true });
  await writeFile(join(fixtureDir, 'original.docx'), original);
  await writeFile(join(fixtureDir, 'revised.docx'), revised);

  console.log(`Created fixture: ${name}`);
}

/**
 * Generate all test fixtures.
 */
async function generateFixtures(): Promise<void> {
  console.log('Generating test fixtures...\n');

  // 1. simple-word-change: Single word substitution
  // "The quick fox" → "The slow fox"
  {
    const original = await createDocx(
      createDocumentXml(['The quick fox jumps over the lazy dog.'])
    );
    const revised = await createDocx(
      createDocumentXml(['The slow fox jumps over the lazy dog.'])
    );
    await writeFixture('simple-word-change', original, revised);
  }

  // 2. paragraph-insert: Add a paragraph
  // 2 paragraphs → 3 paragraphs
  {
    const original = await createDocx(
      createDocumentXml([
        'This is the first paragraph.',
        'This is the second paragraph.',
      ])
    );
    const revised = await createDocx(
      createDocumentXml([
        'This is the first paragraph.',
        'This is a new middle paragraph.',
        'This is the second paragraph.',
      ])
    );
    await writeFixture('paragraph-insert', original, revised);
  }

  // 3. paragraph-delete: Remove a paragraph
  // 3 paragraphs → 2 paragraphs
  {
    const original = await createDocx(
      createDocumentXml([
        'First paragraph stays.',
        'Second paragraph will be deleted.',
        'Third paragraph stays.',
      ])
    );
    const revised = await createDocx(
      createDocumentXml(['First paragraph stays.', 'Third paragraph stays.'])
    );
    await writeFixture('paragraph-delete', original, revised);
  }

  // 4. run-level-change: Date change spanning text
  // "January 1, 2024" → "February 15, 2024"
  {
    const original = await createDocx(
      createDocumentWithRuns([
        { text: 'The effective date is ' },
        { text: 'January 1, 2024', bold: true },
        { text: '.' },
      ])
    );
    const revised = await createDocx(
      createDocumentWithRuns([
        { text: 'The effective date is ' },
        { text: 'February 15, 2024', bold: true },
        { text: '.' },
      ])
    );
    await writeFixture('run-level-change', original, revised);
  }

  // 5. multiple-changes: Several changes in one paragraph
  {
    const original = await createDocx(
      createDocumentXml([
        'The Company shall pay the amount of $1,000 to the Contractor on the first day of each month.',
      ])
    );
    const revised = await createDocx(
      createDocumentXml([
        'The Company shall pay the amount of $1,500 to the Vendor on the fifteenth day of each month.',
      ])
    );
    await writeFixture('multiple-changes', original, revised);
  }

  // 6. no-change: Identical documents (edge case)
  {
    const content = createDocumentXml([
      'This document has no changes.',
      'It should produce zero differences.',
    ]);
    const original = await createDocx(content);
    const revised = await createDocx(content);
    await writeFixture('no-change', original, revised);
  }

  // 7. empty-to-content: Empty → Has content
  {
    const original = await createDocx(createDocumentXml([]));
    const revised = await createDocx(
      createDocumentXml(['New content has been added.'])
    );
    await writeFixture('empty-to-content', original, revised);
  }

  // 8. complete-rewrite: All content changed
  {
    const original = await createDocx(
      createDocumentXml([
        'Original paragraph one.',
        'Original paragraph two.',
        'Original paragraph three.',
      ])
    );
    const revised = await createDocx(
      createDocumentXml([
        'Completely different first paragraph.',
        'Completely different second paragraph.',
      ])
    );
    await writeFixture('complete-rewrite', original, revised);
  }

  console.log('\nAll fixtures generated successfully!');
}

// Run if executed directly
generateFixtures().catch(console.error);
