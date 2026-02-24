import { describe, expect } from 'vitest';
import { itAllure as it } from './helpers/allure-test.js';
import JSZip from 'jszip';
import { DocxDocument } from '../src/primitives/document.js';
import { DocxZip } from '../src/primitives/zip.js';
import { getParagraphBookmarkId } from '../src/primitives/bookmarks.js';

const test = it.epic('DOCX Primitives').withLabels({ feature: 'Document' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

async function makeDocxBuffer(bodyXml: string, extraFiles?: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', makeDocXml(bodyXml));
  for (const [name, text] of Object.entries(extraFiles ?? {})) {
    zip.file(name, text);
  }
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

async function getDocumentXmlFromBuffer(buffer: Buffer): Promise<string> {
  const zip = await DocxZip.load(buffer);
  return zip.readText('word/document.xml');
}

describe('document branch coverage', () => {
  test('replaceText throws explicit errors for missing paragraph, no match, and multiple matches', async () => {
    const buffer = await makeDocxBuffer(`<w:p><w:r><w:t>foo foo</w:t></w:r></w:p>`);
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('mcp_replace_errors');
    const paraId = doc.readParagraphs().paragraphs[0]!.id;

    expect(() => {
      doc.replaceText({
        targetParagraphId: '_bk_missing',
        findText: 'foo',
        replaceText: 'bar',
      });
    }).toThrow('Paragraph not found');

    expect(() => {
      doc.replaceText({
        targetParagraphId: paraId,
        findText: 'missing',
        replaceText: 'bar',
      });
    }).toThrow('Text not found');

    expect(() => {
      doc.replaceText({
        targetParagraphId: paraId,
        findText: 'foo',
        replaceText: 'bar',
      });
    }).toThrow('Multiple matches');
  });

  test('insertParagraph preserves spacing and emits tab/line-break run elements', async () => {
    const buffer = await makeDocxBuffer(`<w:p><w:r><w:t>Anchor</w:t></w:r></w:p>`);
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('mcp_insert_spacing');
    const anchorId = doc.readParagraphs().paragraphs[0]!.id;

    doc.insertParagraph({
      positionalAnchorNodeId: anchorId,
      relativePosition: 'AFTER',
      newText: ' leading\tline\nbreak trailing ',
    });

    const saved = await doc.toBuffer({ cleanBookmarks: false });
    const xml = await getDocumentXmlFromBuffer(saved.buffer);
    expect(xml).toContain('xml:space="preserve"');
    expect(xml).toContain('<w:tab');
    expect(xml).toContain('<w:br');
  });

  test('insertParagraph handles anchors without visible text runs and without any runs', async () => {
    const fieldOnlyBuffer = await makeDocxBuffer(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>`,
    );
    const fieldOnlyDoc = await DocxDocument.load(fieldOnlyBuffer);
    fieldOnlyDoc.insertParagraphBookmarks('mcp_field_only');
    const fieldAnchor = getParagraphBookmarkId(fieldOnlyDoc.getParagraphs()[0]!);
    expect(fieldAnchor).toBeTruthy();

    const insertedField = fieldOnlyDoc.insertParagraph({
      positionalAnchorNodeId: fieldAnchor!,
      relativePosition: 'AFTER',
      newText: 'Inserted from field-only anchor',
    });
    expect(insertedField.newParagraphIds).toHaveLength(1);

    const noRunBuffer = await makeDocxBuffer(`<w:p></w:p>`);
    const noRunDoc = await DocxDocument.load(noRunBuffer);
    noRunDoc.insertParagraphBookmarks('mcp_no_runs');
    const noRunAnchor = getParagraphBookmarkId(noRunDoc.getParagraphs()[0]!);
    expect(noRunAnchor).toBeTruthy();

    const insertedNoRun = noRunDoc.insertParagraph({
      positionalAnchorNodeId: noRunAnchor!,
      relativePosition: 'AFTER',
      newText: 'Inserted from no-run anchor',
    });
    expect(insertedNoRun.newParagraphIds).toHaveLength(1);
  });

  test('load parses optional parts and buildDocumentView cache respects option keying', async () => {
    const buffer = await makeDocxBuffer(
      `<w:p>` +
        `<w:hyperlink r:id="rId1"><w:r><w:t>Link</w:t></w:r></w:hyperlink>` +
        `<w:r><w:footnoteReference w:id="2"/></w:r>` +
      `</w:p>`,
      {
        'word/styles.xml':
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:styles xmlns:w="${W_NS}"></w:styles>`,
        'word/numbering.xml':
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:numbering xmlns:w="${W_NS}"></w:numbering>`,
        'word/footnotes.xml':
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:footnotes xmlns:w="${W_NS}">` +
            `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
            `<w:footnote w:id="2"><w:p><w:r><w:t>Footnote</w:t></w:r></w:p></w:footnote>` +
          `</w:footnotes>`,
        'word/_rels/document.xml.rels':
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ` +
            `Target="https://example.com" TargetMode="External"/>` +
          `</Relationships>`,
      },
    );

    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('mcp_optional_parts');

    const fmtOff = doc.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
    const fmtOn = doc.buildDocumentView({ includeSemanticTags: true, showFormatting: true });
    const fmtOnCached = doc.buildDocumentView({ includeSemanticTags: true, showFormatting: true });

    expect(fmtOn.nodes).not.toBe(fmtOff.nodes);
    expect(fmtOnCached.nodes).toBe(fmtOn.nodes);
    expect(fmtOn.nodes[0]!.tagged_text).toContain('https://example.com');
    expect(fmtOn.nodes[0]!.tagged_text).toContain('Link');
    expect(fmtOn.nodes[0]!.tagged_text).toContain('[^1]');
  });
});
