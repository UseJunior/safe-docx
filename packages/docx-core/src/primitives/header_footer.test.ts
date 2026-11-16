import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxWithAncillaryParts } from '../testing/ooxml-fixtures.js';
import { DocxDocument } from './document.js';
import {
  HeaderFooterError,
  buildHeaderFooterPartXml,
  readEvenAndOddHeaders,
  type SetHeaderFooterMutation,
} from './header_footer.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';

const TEST_FEATURE = 'header-footer-attach-primitive';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const HEADER_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
const SETTINGS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';

const footer = (text: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W_NS}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:ftr>`;
const header = (text: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:hdr>`;
const para = (text: string, sectPr = '') => `<w:p>${sectPr ? `<w:pPr>${sectPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** Three sections; section 0 owns footer1 (default) and header1, section 2's final sectPr is given. */
async function threeSections(finalSectPr: string, opts: { evenAndOdd?: boolean; styles?: boolean } = {}) {
  const parts = [
    { path: 'word/footer1.xml', xml: footer('Footer one'), contentType: FOOTER_CT },
    { path: 'word/header1.xml', xml: header('Header one'), contentType: HEADER_CT },
  ];
  if (opts.styles) {
    parts.push({ path: 'word/styles.xml', contentType: STYLES_CT, xml: `<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:styleId="Footer"/></w:styles>` });
  }
  if (opts.evenAndOdd) {
    parts.push({ path: 'word/settings.xml', contentType: SETTINGS_CT, xml: `<w:settings xmlns:w="${W_NS}"><w:evenAndOddHeaders/></w:settings>` });
  }
  return DocxDocument.load(await buildDocxWithAncillaryParts({
    bodyXml: para('A', '<w:sectPr><w:footerReference w:type="default" r:id="rF1"/><w:headerReference w:type="default" r:id="rH1"/></w:sectPr>')
      + para('B', '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>') + para('C'),
    sectPrXml: finalSectPr,
    relationships: [
      { id: 'rF1', type: FOOTER_REL, target: 'footer1.xml' },
      { id: 'rH1', type: HEADER_REL, target: 'header1.xml' },
      { id: 'rX', type: 'http://example.com/other', target: 'other.xml' },
    ],
    parts,
  }));
}

const content = (text: string): SetHeaderFooterMutation['source'] => ({ kind: 'content', paragraphs: [{ alignment: 'center', runs: [{ text }] }] });

async function partText(doc: DocxDocument, path: string): Promise<string | undefined> {
  const zip = await JSZip.loadAsync((await doc.toBuffer()).buffer);
  return zip.file(path)?.async('string');
}

describe('header/footer primitives', () => {
  test('resolves own and inherited references for each kind and type', async () => {
    const doc = await threeSections('<w:sectPr><w:titlePg w:val="0"/></w:sectPr>', { evenAndOdd: true });
    const { sections, evenAndOddHeaders } = await doc.getHeaderFooterSections();
    expect(evenAndOddHeaders).toBe(true);
    expect(sections).toHaveLength(3);
    expect(sections[2]!.titlePage).toBe(false);
    const def = (i: number) => sections[i]!.footers.find((f) => f.type === 'default')!;
    expect(def(0)).toMatchObject({ relationshipId: 'rF1', partName: 'word/footer1.xml', inherited: false, sourceSectionIndex: 0 });
    expect(def(2)).toMatchObject({ relationshipId: 'rF1', inherited: true, sourceSectionIndex: 0 });
    expect(sections[1]!.headers.find((h) => h.type === 'default')!.partName).toBe('word/header1.xml');
    expect(sections[0]!.footers.find((f) => f.type === 'even')).toMatchObject({ relationshipId: null, partName: null, inherited: false });
    expect(await doc.getStoryParagraphs('word/footer1.xml')).toEqual([{ id: null, text: 'Footer one' }]);
  });

  test('reads evenAndOddHeaders values', () => {
    expect(readEvenAndOddHeaders(null)).toBe(false);
    expect(readEvenAndOddHeaders(`<w:settings xmlns:w="${W_NS}"/>`)).toBe(false);
    expect(readEvenAndOddHeaders(`<w:settings xmlns:w="${W_NS}"><w:evenAndOddHeaders w:val="false"/></w:settings>`)).toBe(false);
    expect(readEvenAndOddHeaders(`<w:settings xmlns:w="${W_NS}"><w:evenAndOddHeaders w:val="1"/></w:settings>`)).toBe(true);
  });

  test('builds header and footer parts with styles, fields and escaping', () => {
    const xml = buildHeaderFooterPartXml('header', [{ alignment: 'right', runs: [{ text: 'A & <B>' }, { field: 'NUMPAGES' }] }], 'Header');
    expect(xml).toContain('<w:hdr ');
    expect(xml).toContain('<w:pStyle w:val="Header"/><w:jc w:val="right"/>');
    expect(xml).toContain('A &amp; &lt;B&gt;');
    expect(xml).toContain(' NUMPAGES ');
    expect(buildHeaderFooterPartXml('footer', [], null)).toContain('<w:ftr ');
  });

  test('attaches to a middle section, pins the next, and uses the Footer style', async () => {
    const doc = await threeSections('<w:sectPr/>', { styles: true });
    const result = await doc.setHeaderFooter({ kind: 'footer', sectionIndex: 1, type: 'default', source: content('Middle') });
    expect(result.changed).toBe(true);
    expect(result.partsCreated).toEqual(['word/footer2.xml']);
    expect(result.pinnedSections).toEqual([{ sectionIndex: 2, relationshipId: 'rF1', partName: 'word/footer1.xml', partCreated: false }]);
    expect(result.packagePartsChanged).toEqual(['word/footer2.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml']);
    expect(await partText(doc, 'word/footer2.xml')).toContain('<w:pStyle w:val="Footer"/>');
    const ct = await partText(doc, '[Content_Types].xml');
    expect(ct).toContain(`PartName="/word/footer2.xml" ContentType="${FOOTER_CT}"`);
    expect(await doc.getSelectedHeaderFooterPartPaths()).toContain('word/footer2.xml');
  });

  test('first type sets titlePg; even reports the setting; existing reuses a part', async () => {
    const doc = await threeSections('<w:sectPr><w:titlePg w:val="false"/></w:sectPr>');
    const first = await doc.setHeaderFooter({ kind: 'header', sectionIndex: 2, type: 'first', source: content('Cover') });
    expect(first.titlePageSet).toBe(true);
    const again = await doc.setHeaderFooter({ kind: 'header', sectionIndex: 1, type: 'first', source: content('Cover 2') });
    expect(again.titlePageSet).toBe(true);
    const even = await doc.setHeaderFooter({ kind: 'footer', sectionIndex: 2, type: 'even', source: { kind: 'existing', relationshipId: 'rF1' } });
    expect(even).toMatchObject({ evenAndOddHeaders: false, relationshipId: 'rF1', partsCreated: [] });
    const same = await doc.setHeaderFooter({ kind: 'footer', sectionIndex: 2, type: 'even', source: { kind: 'existing', relationshipId: 'rF1' } });
    expect(same.changed).toBe(false);
  });

  test('link_to_previous removes the reference; a session-created part is rewritten for its sole consumer', async () => {
    const doc = await threeSections('<w:sectPr/>');
    const created = await doc.setHeaderFooter({ kind: 'footer', sectionIndex: 2, type: 'default', source: content('Last') });
    const rewritten = await doc.setHeaderFooter({ kind: 'footer', sectionIndex: 2, type: 'default', source: content('Last v2') });
    expect(rewritten).toMatchObject({ partsCreated: [], relationshipId: created.relationshipId, packagePartsChanged: [created.partName] });
    expect(await partText(doc, created.partName!)).toContain('Last v2');
    const linked = await doc.setHeaderFooter({ kind: 'footer', sectionIndex: 2, type: 'default', source: { kind: 'link_to_previous' } });
    expect(linked).toMatchObject({ changed: true, relationshipId: 'rF1' });
    const noop = await doc.setHeaderFooter({ kind: 'footer', sectionIndex: 2, type: 'default', source: { kind: 'link_to_previous' } });
    expect(noop.changed).toBe(false);
  });

  test('tracked mode records sectPrChange; existing AI sectPrChange is kept', async () => {
    const doc = await threeSections('<w:sectPr/>');
    const ctx = createRevisionContext({ author: 'AI', date: new Date('2026-02-01T00:00:00Z'), idState: createRevisionIdState(500) });
    await doc.setHeaderFooter({ kind: 'footer', sectionIndex: 2, type: 'first', source: content('Cover') }, ctx);
    await doc.setHeaderFooter({ kind: 'footer', sectionIndex: 2, type: 'even', source: content('Even') }, ctx);
    const xml = await partText(doc, 'word/document.xml');
    expect(xml!.match(/<w:sectPrChange /g)).toHaveLength(1);
  });

  test('rejects invalid requests', async () => {
    const doc = await threeSections('<w:sectPr/>');
    const cases: Array<[SetHeaderFooterMutation, string]> = [
      [{ kind: 'side' as never, sectionIndex: 0, type: 'default', source: content('x') }, 'INVALID_HEADER_FOOTER_REQUEST'],
      [{ kind: 'footer', sectionIndex: 0, type: 'odd' as never, source: content('x') }, 'INVALID_HEADER_FOOTER_REQUEST'],
      [{ kind: 'footer', sectionIndex: 9, type: 'default', source: content('x') }, 'SECTION_NOT_FOUND'],
      [{ kind: 'footer', sectionIndex: 0, type: 'default', source: { kind: 'link_to_previous' } }, 'INVALID_HEADER_FOOTER_REQUEST'],
      [{ kind: 'footer', sectionIndex: 0, type: 'default', source: { kind: 'existing', relationshipId: 'rH1' } }, 'RELATIONSHIP_NOT_FOUND'],
      [{ kind: 'footer', sectionIndex: 0, type: 'default', source: { kind: 'existing', relationshipId: 'rX' } }, 'RELATIONSHIP_NOT_FOUND'],
      [{ kind: 'footer', sectionIndex: 0, type: 'default', source: { kind: 'content', paragraphs: [] } }, 'INVALID_HEADER_FOOTER_REQUEST'],
      [{ kind: 'footer', sectionIndex: 0, type: 'default', source: { kind: 'content', paragraphs: [{} as never] } }, 'INVALID_HEADER_FOOTER_REQUEST'],
      [{ kind: 'footer', sectionIndex: 0, type: 'default', source: { kind: 'content', paragraphs: [{ alignment: 'middle' as never, runs: [] }] } }, 'INVALID_HEADER_FOOTER_REQUEST'],
      [{ kind: 'footer', sectionIndex: 0, type: 'default', source: { kind: 'content', paragraphs: [{ runs: [{ field: 'DATE' } as never] }] } }, 'INVALID_HEADER_FOOTER_REQUEST'],
      [{ kind: 'footer', sectionIndex: 0, type: 'default', source: { kind: 'content', paragraphs: [{ runs: [{ text: 'bad\u0001' }] }] } }, 'INVALID_HEADER_FOOTER_REQUEST'],
    ];
    for (const [mutation, code] of cases) {
      await expect(doc.setHeaderFooter(mutation)).rejects.toMatchObject({ code });
    }
  });

  test('a refused call on a section with a foreign sectPrChange leaves the document unchanged', async () => {
    const doc = await threeSections('<w:sectPr><w:sectPrChange w:id="90" w:author="Alice" w:date="2026-01-01T00:00:00Z"><w:sectPr/></w:sectPrChange></w:sectPr>');
    const before = await doc.getMutationSnapshot();
    const ctx = createRevisionContext({ author: 'AI', date: new Date('2026-02-01T00:00:00Z'), idState: createRevisionIdState() });
    await expect(doc.setHeaderFooter({ kind: 'footer', sectionIndex: 2, type: 'first', source: content('Cover') }, ctx))
      .rejects.toBeInstanceOf(HeaderFooterError);
    expect((await doc.getMutationSnapshot()).equals(before)).toBe(true);
  });

  test('story paragraph ids: lookup, tracked replace, and clean export restoring untouched bytes', async () => {
    const doc = await threeSections('<w:sectPr/>');
    const original = await partText(doc, 'word/header1.xml');
    await doc.insertStoryParagraphBookmarks('word/footer1.xml', 't');
    await doc.insertStoryParagraphBookmarks('word/header1.xml', 't');
    const [footerPara] = await doc.getStoryParagraphs('word/footer1.xml');
    expect(footerPara!.id).toMatch(/^_bk_/);
    expect(await doc.findStoryPartForParagraph(footerPara!.id!)).toBe('word/footer1.xml');
    expect(await doc.findStoryPartForParagraph('_bk_missing')).toBeNull();
    const ctx = createRevisionContext({ author: 'AI', date: new Date('2026-02-01T00:00:00Z'), idState: createRevisionIdState(700) });
    await doc.replaceStoryTextAtRange({ partPath: 'word/footer1.xml', targetParagraphId: footerPara!.id!, start: 7, end: 10, replaceText: 'two' }, ctx);
    const clean = await JSZip.loadAsync((await doc.toBuffer({ cleanBookmarks: true })).buffer);
    expect(await clean.file('word/header1.xml')!.async('string')).toBe(original);
    const footerXml = await clean.file('word/footer1.xml')!.async('string');
    expect(footerXml).toContain('<w:ins ');
    expect(footerXml).not.toContain('_bk_');
    const storyOnly = await JSZip.loadAsync((await doc.toBuffer({ cleanStoryBookmarks: true })).buffer);
    expect(await storyOnly.file('word/header1.xml')!.async('string')).toBe(original);
    const forked = doc.fork();
    const forkClean = await JSZip.loadAsync((await forked.toBuffer({ cleanBookmarks: true })).buffer);
    expect(await forkClean.file('word/header1.xml')!.async('string')).toBe(original);
  });
});
