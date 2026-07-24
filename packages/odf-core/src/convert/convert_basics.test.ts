import { describe, it, expect } from 'vitest';
import { buildDocxFromParts, parseXml } from '@usejunior/docx-core';

import { convertDocxToOdt } from './docx_to_odt.js';
import { OdfArchive } from '../shared/odf/OdfArchive.js';
import { OdfDocument } from '../document.js';
import { validateOdfArchiveSafety } from '../odf_archive_safety.js';
import { ODF_NS, ODF_PATHS, ODT_MIMETYPE } from '../shared/odf/namespaces.js';

function p(text: string, runProps = ''): string {
  const rPr = runProps ? `<w:rPr>${runProps}</w:rPr>` : '';
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function styledP(styleId: string, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

async function reopen(odt: Buffer): Promise<OdfDocument> {
  const archive = await OdfArchive.load(odt);
  return OdfDocument.fromContentXml(await archive.getContentXml());
}

describe('convertDocxToOdt — package validity, text, headings, runs', () => {
  it('[CONV-01] conversion produces a safe, valid ODT package', async () => {
    const docx = await buildDocxFromParts({ bodyXml: p('Hello world') });
    const { odt } = await convertDocxToOdt(docx);

    // ZIP local header: first entry name starts at byte 30, compression method at bytes 8–9.
    expect(odt.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(odt.readUInt16LE(8)).toBe(0); // STORED, not DEFLATE
    expect(odt.subarray(30, 30 + 'mimetype'.length).toString('utf8')).toBe('mimetype');
    expect(odt.subarray(38, 38 + ODT_MIMETYPE.length).toString('utf8')).toBe(ODT_MIMETYPE);

    const safety = await validateOdfArchiveSafety(odt);
    expect(safety.ok).toBe(true);

    const archive = await OdfArchive.load(odt);
    const manifest = await archive.getFile(ODF_PATHS.MANIFEST);
    expect(manifest).toContain('manifest:full-path="/"');
    for (const part of [ODF_PATHS.CONTENT, ODF_PATHS.STYLES, ODF_PATHS.META]) {
      expect(archive.hasFile(part)).toBe(true);
      expect(manifest).toContain(`manifest:full-path="${part}"`);
    }
    expect(await archive.getContentXml()).toContain('office:version="1.3"');
  });

  it('[CONV-02] body paragraph visible text is preserved, including multi-space runs and tabs', async () => {
    const bodyXml =
      `<w:p><w:r><w:t xml:space="preserve">Alpha  beta   gamma</w:t></w:r>` +
      `<w:r><w:tab/><w:t xml:space="preserve">after tab</w:t></w:r></w:p>` +
      p('Second paragraph') +
      '<w:p/>'; // text-empty paragraph: unsurfaced by the document view, preserved as spacing (CONV-19)
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt, lossiness } = await convertDocxToOdt(docx);

    const texts = (await reopen(odt)).getParagraphs().map((b) => b.text);
    expect(texts).toEqual(['Alpha  beta   gamma\tafter tab', 'Second paragraph', '']);
    expect(lossiness.some((e) => e.construct === 'unsurfaced-paragraphs-dropped')).toBe(false);
  });

  it('[CONV-03] supported Word headings become text:h; deeper and manually labeled paragraphs stay text:p', async () => {
    const bodyXml =
      styledP('Heading1', 'Top heading') +
      styledP('Heading2', 'Sub heading') +
      styledP('Heading9', 'Not a real heading level') +
      styledP('Heading3', '(i) Manually labeled legal paragraph') +
      p('Body paragraph.');
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt } = await convertDocxToOdt(docx);

    const contentXml = await (await OdfArchive.load(odt)).getContentXml();
    const doc = parseXml(contentXml);
    const headings = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'h'));
    expect(headings.map((h) => h.getAttributeNS(ODF_NS.TEXT, 'outline-level'))).toEqual(['1', '2']);
    expect(headings.map((h) => h.getAttributeNS(ODF_NS.TEXT, 'style-name'))).toEqual([
      'Heading_20_1',
      'Heading_20_2',
    ]);
    // The non-Heading[1-6] style, manual legal label, and body paragraph stay text:p.
    const paragraphTexts = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'p')).map((el) => el.textContent);
    expect(paragraphTexts).toContain('Not a real heading level');
    expect(paragraphTexts).toContain('(i) Manually labeled legal paragraph');
    expect(paragraphTexts).toContain('Body paragraph.');
  });

  it('[CONV-04] bold/italic/underline runs become text:span referencing deduped automatic styles', async () => {
    const bodyXml =
      `<w:p>` +
      `<w:r><w:t xml:space="preserve">plain </w:t></w:r>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">bold</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve"> mid </w:t></w:r>` +
      `<w:r><w:rPr><w:b/><w:i/></w:rPr><w:t xml:space="preserve">bolditalic</w:t></w:r>` +
      `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">under</w:t></w:r>` +
      `</w:p>` +
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold again</w:t></w:r></w:p>`;
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt } = await convertDocxToOdt(docx);

    const contentXml = await (await OdfArchive.load(odt)).getContentXml();
    const doc = parseXml(contentXml);

    const spans = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'span'));
    const styleOf = (text: string): string | null => {
      const span = spans.find((s) => s.textContent === text);
      return span ? span.getAttributeNS(ODF_NS.TEXT, 'style-name') : null;
    };
    expect(styleOf('bold')).toBeTruthy();
    expect(styleOf('bolditalic')).toBeTruthy();
    expect(styleOf('under')).toBeTruthy();
    // Dedup: the second bold run reuses the first bold style; distinct combos get distinct styles.
    expect(styleOf('bold again')).toBe(styleOf('bold'));
    expect(new Set([styleOf('bold'), styleOf('bolditalic'), styleOf('under')]).size).toBe(3);

    // The style definitions carry the matching properties.
    const styleXml = contentXml;
    expect(styleXml).toContain('fo:font-weight="bold"');
    expect(styleXml).toContain('fo:font-style="italic"');
    expect(styleXml).toContain('style:text-underline-style="solid"');
    // Visible text is intact.
    expect((await reopen(odt)).getParagraphs().map((b) => b.text)).toEqual([
      'plain bold mid bolditalicunder',
      'bold again',
    ]);
  });

  it('[CONV-05] hyperlinks become text:a with an unescaped href; unsafe schemes degrade to plain text', async () => {
    const bodyXml =
      `<w:p><w:hyperlink r:id="rId10"><w:r><w:t>safe link</w:t></w:r></w:hyperlink></w:p>` +
      `<w:p><w:hyperlink r:id="rId11"><w:r><w:t>evil link</w:t></w:r></w:hyperlink></w:p>`;
    const docx = await buildDocxFromParts({
      bodyXml,
      documentRelEntries: [
        `<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/?a=1&amp;b=2" TargetMode="External"/>`,
        `<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`,
      ],
    });
    const { odt, lossiness } = await convertDocxToOdt(docx);

    const contentXml = await (await OdfArchive.load(odt)).getContentXml();
    const doc = parseXml(contentXml);
    const anchors = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'a'));
    expect(anchors).toHaveLength(1);
    // DOM attribute value is the decoded URL — single-escaped in the serialized XML, not doubled.
    expect(anchors[0]!.getAttributeNS(ODF_NS.XLINK, 'href')).toBe('https://example.com/?a=1&b=2');
    expect(contentXml).toContain('xlink:href="https://example.com/?a=1&amp;b=2"');
    expect(contentXml).not.toContain('&amp;amp;');
    expect(contentXml).not.toContain('javascript:');
    // The unsafe link's text survives as plain text and the drop is reported.
    expect((await reopen(odt)).getParagraphs().map((b) => b.text)).toEqual(['safe link', 'evil link']);
    expect(lossiness.some((e) => e.construct === 'unsafe-hyperlink-href')).toBe(true);
  });

  it('[CONV-10] dropped constructs are reported in the lossiness summary, never silently', async () => {
    // Font/color runs map since phase 3 (CONV-14); grid gaps remain a genuinely
    // unmappable downgrade and must be reported.
    const bodyXml =
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
      `<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p><w:p/></w:tc>` +
      `<w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>` +
      `<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>red text</w:t></w:r></w:p>`;
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt, lossiness } = await convertDocxToOdt(docx);

    // Each one-cell row leaves the second grid column empty — filled and reported.
    const gridGaps = lossiness.find((e) => e.construct === 'table-grid-gaps-filled');
    expect(gridGaps).toBeDefined();
    expect(gridGaps!.count).toBeGreaterThanOrEqual(1);
    // Font formatting is mapped now, never reported as dropped.
    expect(lossiness.some((e) => e.construct === 'font-formatting-dropped')).toBe(false);
    // The text itself is preserved.
    const texts = (await reopen(odt)).getParagraphs().map((b) => b.text).filter((t) => t !== '');
    expect(texts).toEqual(['A1', 'A2', 'B1', 'red text']);
  });

  it('[CONV-11] converted output reopens through odf-core with matching visible text', async () => {
    const bodyXml = p('First') + styledP('Heading1', 'Heading') + p('Last');
    const docx = await buildDocxFromParts({ bodyXml });
    const { odt } = await convertDocxToOdt(docx);

    const reopened = await reopen(odt);
    expect(reopened.getParagraphs().map((b) => b.text)).toEqual(['First', 'Heading', 'Last']);
  });
});
