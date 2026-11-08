import { describe, expect, vi } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { testAllure } from '../testing/allure-test.js';
import {
  buildDocxFromBodyXml, buildDocxWithAncillaryParts, COMPLETE_PAGE_FIELD,
  WHOLE_FIELD_IN_DEL, WHOLE_FIELD_IN_INS,
} from '../testing/ooxml-fixtures.js';
import * as accept from './accept_changes.js';
import * as reject from './reject_changes.js';
import { DocxDocument } from './document.js';
import { readZipText } from './zip.js';
import { convertSerializedDeletionContent } from './track-changes-emitter.js';
import { getParagraphText } from './text.js';
import { parseXml } from './xml.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'refactor-revision-resolution-phases';
const serializeXml = (node: Node) => new XMLSerializer().serializeToString(node);
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.13' },
  );
const xml = (body: string) => parseXml(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const revision = (kind: string, id: string, content = '', author = 'AI') =>
  `<w:${kind} w:id="${id}" w:author="${author}">${content}</w:${kind}>`;
const elements = (doc: Document, name: string) => Array.from(doc.getElementsByTagNameNS(W, name));
const foreignFilter = (el: Element) => el.getAttributeNS(W, 'author') === 'AI';

for (const mode of ['accept', 'reject'] as const) {
  const resolve = mode === 'accept' ? accept.acceptChanges : reject.rejectChanges;
  const keep = mode === 'accept' ? 'ins' : 'del';
  const drop = mode === 'accept' ? 'del' : 'ins';
  describe(`${mode} phase preconditions`, () => {
    test('resolves row topology before discovering its marks or property histories', () => {
      const doc = xml(`<w:tbl><w:tr><w:trPr>${revision(drop, 'row')}</w:trPr><w:tc>` +
        `<w:p><w:pPr><w:rPr>${revision(drop, 'mark')}</w:rPr>` +
        `${revision('pPrChange', 'history', '<w:pPr/>')}</w:pPr>${revision(keep, 'inner', run('gone'))}</w:p>` +
        `</w:tc></w:tr><w:tr><w:tc><w:p>${run('kept')}</w:p></w:tc></w:tr></w:tbl>`);
      const visited: string[] = [];
      const result = resolve(doc, { filter: el => { visited.push(el.getAttributeNS(W, 'id') ?? ''); return true; } });
      // The row sweep filters all same-name markers once before checking trPr.
      // Paragraph discovery must not revisit a marker from the removed row.
      expect(visited.filter(id => id === 'mark')).toHaveLength(1);
      expect(visited).not.toContain('history');
      expect(visited).not.toContain('inner');
      expect(elements(doc, 'tr')).toHaveLength(1);
      expect(getParagraphText(elements(doc, 'p')[0]!)).toBe('kept');
      expect(result).toMatchObject(mode === 'accept'
        ? { deletionsAccepted: 1, insertionsAccepted: 0, propertyChangesResolved: 0 }
        : { insertionsRemoved: 1, deletionsRestored: 0, propertyChangesReverted: 0 });
    });

    test.openspec('structural and nested revisions interact')('merges consecutive marked paragraphs only after wrappers and properties settle, retaining object order', () => {
      const history = revision('pPrChange', 'history', '<w:pPr><w:jc w:val="left"/></w:pPr>');
      const doc = xml(`<w:tbl><w:tr><w:trPr>${revision(drop, 'row')}</w:trPr><w:tc>` +
        `<w:p><w:pPr><w:rPr>${revision(drop, 'removedMark')}</w:rPr>` +
        `${revision('pPrChange', 'removedHistory', '<w:pPr/>')}</w:pPr>${run('removed row')}</w:p></w:tc></w:tr></w:tbl>` +
        `<w:p><w:pPr><w:jc w:val="right"/><w:rPr>${revision(drop, 'mark1')}</w:rPr>${history}</w:pPr>` +
        `<w:bookmarkStart w:id="70" w:name="Cross"/><w:commentRangeStart w:id="71"/>` +
        `${revision(keep, 'outer', run('A') + revision(keep, 'inner', run('B')))}` +
        `${revision(drop, 'discard', run('discard'))}${COMPLETE_PAGE_FIELD}</w:p>` +
        `<w:p><w:pPr><w:rPr>${revision(drop, 'mark2')}</w:rPr></w:pPr>` +
        `<w:r><w:drawing/></w:r>${run('C')}</w:p><w:p>${run('D')}` +
        `<w:bookmarkEnd w:id="70"/><w:commentRangeEnd w:id="71"/><w:r><w:commentReference w:id="71"/></w:r></w:p>`);
      const content = ['bookmarkStart', 'commentRangeStart', 'fldChar', 'drawing', 'bookmarkEnd', 'commentRangeEnd', 'commentReference']
        .flatMap(name => elements(doc, name));
      const result = resolve(doc);
      expect(elements(doc, 'tr')).toHaveLength(0);
      expect(result).toMatchObject(mode === 'accept' ? { propertyChangesResolved: 1 } : { propertyChangesReverted: 1 });
      const paragraphs = elements(doc, 'p');
      expect(paragraphs).toHaveLength(1);
      expect(getParagraphText(paragraphs[0]!)).toBe('AB1CD');
      expect(elements(doc, 'jc')[0]!.getAttributeNS(W, 'val')).toBe(mode === 'accept' ? 'right' : 'left');
      expect(elements(doc, 'fldChar').map(el => el.getAttributeNS(W, 'fldCharType'))).toEqual(['begin', 'separate', 'end']);
      for (const node of content) expect(node.parentNode).not.toBeNull();
      const objectOrder = Array.from(paragraphs[0]!.getElementsByTagNameNS(W, '*'))
        .filter(el => content.includes(el));
      expect(objectOrder).toEqual(content);
      expect(serializeXml(doc)).not.toContain('discard');
    });

    test('harvests projected bookmark counterparts before deleting their wrapper', () => {
      const doc = xml(`<w:p>${revision(drop, 'drop', '<w:bookmarkStart w:id="9" w:name="Dropped"/>' + run('gone'))}` +
        `<w:bookmarkEnd w:id="9"/>${run('kept')}</w:p>`);
      resolve(doc);
      expect(elements(doc, 'bookmarkStart')).toHaveLength(0);
      expect(elements(doc, 'bookmarkEnd')).toHaveLength(0);
      expect(getParagraphText(elements(doc, 'p')[0]!)).toBe('kept');
    });

    test.openspec('selective and deferred revisions survive')('keeps foreign nested wrappers, deferred cells and save IDs byte-identical during selective resolution', () => {
      const foreign = revision(keep, 'foreign', '<w:r w:rsidDel="ABCD"><w:delText>foreign</w:delText></w:r>', 'Human');
      const doc = xml(`<w:p w:rsidDel="1234">${revision(keep, 'outer', run('A') + foreign + run('B'))}</w:p>` +
        `<w:tbl><w:tr><w:tc><w:tcPr>${revision('cellDel', 'deferred')}</w:tcPr><w:p/></w:tc></w:tr></w:tbl>`);
      const before = serializeXml(elements(doc, keep).find(el => el.getAttributeNS(W, 'id') === 'foreign')!);
      const deferred = serializeXml(elements(doc, 'tbl')[0]!);
      resolve(doc, { filter: foreignFilter });
      expect(serializeXml(elements(doc, keep)[0]!)).toBe(before);
      expect(serializeXml(elements(doc, 'tbl')[0]!)).toBe(deferred);
      expect(elements(doc, 'p')[0]!.getAttributeNS(W, 'rsidDel')).toBe('1234');
    });

    test('preserves deferred cell/grid/numbering revisions as a no-op', () => {
      const doc = xml('<w:tbl><w:tblGrid><w:tblGridChange w:id="1" w:author="AI"><w:tblGrid/></w:tblGridChange></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr><w:cellIns w:id="2" w:author="AI"/><w:cellDel w:id="3" w:author="AI"/>' +
        '<w:cellMerge w:id="4" w:author="AI"/></w:tcPr><w:p><w:pPr><w:numPr>' +
        '<w:numberingChange w:id="5" w:author="AI"/></w:numPr></w:pPr></w:p></w:tc></w:tr></w:tbl>');
      const before = serializeXml(doc);
      expect(Object.values(resolve(doc)).every(n => n === 0)).toBe(true);
      expect(serializeXml(doc)).toBe(before);
    });

    for (const [prop, current, original, host] of [
      ['rPr', '<w:b/>', '<w:i/>', 'run'],
      ['pPr', '<w:jc w:val="right"/>', '<w:jc w:val="left"/>', 'paragraph'],
      ['sectPr', '<w:pgSz w:w="10000"/>', '<w:pgSz w:w="12000"/>', 'section'],
      ['tblPr', '<w:tblStyle w:val="Now"/>', '<w:tblStyle w:val="Before"/>', 'table'],
      ['trPr', '<w:trHeight w:val="400"/>', '<w:trHeight w:val="200"/>', 'row'],
      ['tcPr', '<w:tcW w:w="400"/>', '<w:tcW w:w="200"/>', 'cell'],
    ] as const) {
      test(`settles selected ${prop} history while preserving foreign history`, () => {
        const property = `<w:${prop}>${current}${revision(`${prop}Change`, 'change', `<w:${prop}>${original}</w:${prop}>`)}</w:${prop}>`;
        const body = host === 'run' ? `<w:p><w:r>${property}<w:t>text</w:t></w:r></w:p>`
          : host === 'paragraph' ? `<w:p>${property}${run('text')}</w:p>`
          : host === 'section' ? `<w:p/>${property}`
          : `<w:tbl>${host === 'table' ? property : ''}<w:tr>${host === 'row' ? property : ''}<w:tc>${host === 'cell' ? property : ''}<w:p/></w:tc></w:tr></w:tbl>`;
        const doc = xml(body + `<w:p><w:r><w:rPr>${revision('rPrChange', 'foreign', '<w:rPr><w:b/></w:rPr>', 'Human')}</w:rPr><w:t>foreign</w:t></w:r></w:p>`);
        const foreignBefore = serializeXml(elements(doc, 'rPrChange').find(el => el.getAttributeNS(W, 'author') === 'Human')!);
        resolve(doc, { filter: foreignFilter });
        expect(serializeXml(elements(doc, prop)[0]!)).toContain(mode === 'accept' ? current : original);
        expect(serializeXml(elements(doc, 'rPrChange').find(el => el.getAttributeNS(W, 'author') === 'Human')!)).toBe(foreignBefore);
      });
    }

    test('keeps move-range selector behavior unchanged pending #1020', () => {
      const doc = xml(`<w:p><w:moveFromRangeStart w:id="1" w:author="AI"/>` +
        `${revision('moveFrom', '2', run('source'))}<w:moveFromRangeEnd w:id="1"/>` +
        `<w:moveToRangeStart w:id="3" w:author="AI"/>${revision('moveTo', '4', run('destination'))}<w:moveToRangeEnd w:id="3"/></w:p>`);
      resolve(doc, { filter: foreignFilter });
      for (const name of ['moveFrom', 'moveTo', 'moveFromRangeStart', 'moveToRangeStart']) expect(elements(doc, name)).toHaveLength(0);
      for (const name of ['moveFromRangeEnd', 'moveToRangeEnd']) expect(elements(doc, name)).toHaveLength(1);
    });

    test('propagates a selector failure after earlier in-place row resolution', () => {
      const doc = xml(`<w:tbl><w:tr><w:trPr>${revision(drop, 'row')}</w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>` +
        `<w:p><w:pPr><w:rPr>${revision('rPrChange', 'fail', '<w:rPr/>')}</w:rPr></w:pPr></w:p>`);
      const error = new Error('selector fault');
      expect(() => resolve(doc, { filter: el => { if (el.getAttributeNS(W, 'id') === 'fail') throw error; return true; } })).toThrow(error);
      expect(elements(doc, 'tr')).toHaveLength(0);
      expect(elements(doc, 'rPrChange')).toHaveLength(1);
    });

    test.openspec('resolution fails on an unpublished mutation fork')('resolves fields across supported stories and isolates a late failure to the unpublished fork', async () => {
      const content = `<w:p>${WHOLE_FIELD_IN_INS(COMPLETE_PAGE_FIELD)}${WHOLE_FIELD_IN_DEL(convertSerializedDeletionContent(COMPLETE_PAGE_FIELD))}</w:p>`;
      const storyParts = [
        ['word/comments.xml', 'comments', 'comment'], ['word/footnotes.xml', 'footnotes', 'footnote'],
        ['word/endnotes.xml', 'endnotes', 'endnote'], ['word/glossary/document.xml', 'glossaryDocument', 'docParts'],
        ['word/header1.xml', 'hdr', ''], ['word/footer1.xml', 'ftr', ''],
      ];
      const source = await buildDocxWithAncillaryParts({
        bodyXml: content + '<w:p><w:r><w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/></w:r></w:p>',
        sectPrXml: '<w:sectPr><w:headerReference w:type="default" r:id="h"/><w:footerReference w:type="default" r:id="f"/></w:sectPr>',
        relationships: ['header', 'footer'].map(type => ({ id: type[0]!, type: `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}`, target: `${type}1.xml` })),
        parts: storyParts.map(([path, root, child]) => {
          const type = root === 'hdr' ? 'header' : root === 'ftr' ? 'footer'
            : root === 'glossaryDocument' ? 'document.glossary' : root;
          const inner = root === 'glossaryDocument'
            ? `<w:docParts><w:docPart><w:docPartPr><w:name w:val="Example"/></w:docPartPr><w:docPartBody>${content}</w:docPartBody></w:docPart></w:docParts>`
            : child ? `<w:${child} w:id="1">${content}</w:${child}>` : content;
          return { path: path!, contentType: `application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml`,
            xml: `<w:${root} xmlns:w="${W}">${inner}</w:${root}>` };
        }),
      });
      const live = await DocxDocument.load(source);
      const before = await live.getMutationSnapshot();
      const failed = live.fork();
      const method = mode === 'accept' ? 'acceptChanges' : 'rejectChanges';
      const failOnHeader = (doc: Document) => {
        if (doc.documentElement.localName === 'hdr') throw new Error('late story fault');
      };
      const acceptOriginal = accept.acceptChanges;
      const rejectOriginal = reject.rejectChanges;
      const fault = mode === 'accept'
        ? vi.spyOn(accept, 'acceptChanges').mockImplementation((doc, opts) => { failOnHeader(doc); return acceptOriginal(doc, opts); })
        : vi.spyOn(reject, 'rejectChanges').mockImplementation((doc, opts) => { failOnHeader(doc); return rejectOriginal(doc, opts); });
      try { await expect(failed[method]()).rejects.toThrow('late story fault'); }
      finally { fault.mockRestore(); }
      expect(await live.getMutationSnapshot()).toEqual(before);
      expect(await failed.getMutationSnapshot()).not.toEqual(before);
      const candidate = live.fork();
      await candidate[method]();
      const output = (await candidate.toBuffer()).buffer;
      for (const path of ['word/document.xml', ...storyParts.map(row => row[0]!)]) {
        const text = await readZipText(output, path);
        expect(text).not.toBeNull();
        const part = parseXml(text!);
        expect(elements(part, 'ins')).toHaveLength(0);
        expect(elements(part, 'del')).toHaveLength(0);
        expect(elements(part, 'delInstrText')).toHaveLength(0);
        expect(elements(part, 'instrText').map(el => el.textContent)).toEqual([' PAGE ']);
        expect(elements(part, 'fldChar').map(el => el.getAttributeNS(W, 'fldCharType'))).toEqual(['begin', 'separate', 'end']);
      }
      const reopened = await DocxDocument.load(output);
      expect(Object.values(await reopened[method]()).every(n => n === 0)).toBe(true);
      expect(await live.getMutationSnapshot()).toEqual(before);
    });
  });
}

test('uses the shared minimal package builder for an empty revision no-op', async () => {
  const document = await DocxDocument.load(await buildDocxFromBodyXml('<w:p/>'));
  expect(Object.values(await document.acceptChanges()).every(n => n === 0)).toBe(true);
  expect(Object.values(await document.rejectChanges()).every(n => n === 0)).toBe(true);
});
