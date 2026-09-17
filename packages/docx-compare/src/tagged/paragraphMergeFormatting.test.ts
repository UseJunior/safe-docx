import { describe, expect } from 'vitest';
import { buildDocxFromParts, parseXml, serializeXml, acceptChanges, rejectChanges } from '@usejunior/docx-core';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { testAllure } from '../testing/allure-test.js';
import { fldChar, delInstrText, resultText, completeField } from '../testing/ooxml-fixtures.js';
import { constructTaggedTree } from './taggedTreeConstruction.js';
import { createPreservePlan, serializeTaggedTree } from './taggedTreeSerializer.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph merge formatting' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' });
const wrap = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
const cases = ['accept', 'reject'].flatMap(op => [false, true].flatMap(first => [false, true].map(second => {
  const tag = op === 'accept' ? 'del' : 'ins';
  const run = (text: string, keep: boolean, id: number) => keep ? `<w:r><w:t>${text}</w:t></w:r>`
    : `<w:${tag} w:id="${id}" w:author="Comparator"><w:r><w:${tag === 'del' ? 'delText' : 't'}>${text}</w:${tag === 'del' ? 'delText' : 't'}></w:r></w:${tag}>`;
  const body = `<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:${tag} w:id="1" w:author="Comparator"/></w:rPr></w:pPr>${run('FIRST', first, 2)}</w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('SECOND', second, 3)}</w:p><w:p><w:r><w:t>TAIL</w:t></w:r></w:p>`;
  return { op: op as 'accept' | 'reject', first, second, body, text: `${first ? 'FIRST' : ''}${second ? 'SECOND' : ''}`,
    alignment: first || (op === 'reject' && !second) ? 'right' : 'center' };
})));

describe('paragraph merge formatting decision table', () => {
  for (const op of ['accept', 'reject'] as const) {
    for (const history of ['paragraph', 'mark'] as const) test.openspec('Selective merge retains following pending property history')(`${op}: resolve following ${history} history before selecting merge formatting`, () => {
      const tag = op === 'accept' ? 'del' : 'ins';
      const pending = history === 'paragraph'
        ? '<w:pPrChange w:id="8" w:author="Other"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange>'
        : '<w:rPr><w:color w:val="0000FF"/><w:rPrChange w:id="7" w:author="Other"><w:rPr><w:color w:val="00FF00"/></w:rPr></w:rPrChange></w:rPr>';
      const input = wrap(`<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:${tag} w:id="1" w:author="T"/><w:color w:val="FF0000"/></w:rPr></w:pPr><w:r><w:t>A</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/>${pending}</w:pPr><w:r><w:t>B</w:t></w:r></w:p>`);
      const native = parseXml(input);
      if (op === 'accept') acceptChanges(native); else rejectChanges(native);
      for (const xml of [serializeXml(native), op === 'accept' ? acceptAllChanges(input) : rejectAllChanges(input)]) {
        const doc = parseXml(xml);
        expect(doc.getElementsByTagNameNS(W, 'p')).toHaveLength(1);
        expect(doc.getElementsByTagNameNS(W, 'p')[0]!.textContent).toBe('AB');
        expect(doc.getElementsByTagNameNS(W, 'jc')[0]!.getAttributeNS(W, 'val')).toBe('right');
        expect(doc.getElementsByTagNameNS(W, 'color')[0]!.getAttributeNS(W, 'val')).toBe('FF0000');
        expect(doc.getElementsByTagNameNS(W, 'pPrChange')).toHaveLength(0);
        expect(doc.getElementsByTagNameNS(W, 'rPrChange')).toHaveLength(0);
      }
    });
  }
  for (const op of ['accept', 'reject'] as const) test(`${op}: an empty run does not own merge formatting`, () => {
    const tag = op === 'accept' ? 'del' : 'ins';
    const input = wrap(`<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:${tag} w:id="1" w:author="T"/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t/></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>SECOND</w:t></w:r></w:p>`);
    const doc = parseXml(input);
    if (op === 'accept') acceptChanges(doc); else rejectChanges(doc);
    for (const xml of [serializeXml(doc), op === 'accept' ? acceptAllChanges(input) : rejectAllChanges(input)]) {
      expect(parseXml(xml).getElementsByTagNameNS(W, 'jc')[0]?.getAttributeNS(W, 'val')).toBe('center');
    }
  });
  test('preserves the leading mark font while retaining the surviving section and pending mark revision', () => {
    const input = wrap('<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:color w:val="FF0000"/><w:sz w:val="40"/><w:del w:id="1" w:author="T"/></w:rPr></w:pPr><w:r><w:t>FIRST</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:color w:val="0000FF"/><w:ins w:id="2" w:author="Other"/></w:rPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr><w:r><w:t>SECOND</w:t></w:r></w:p>');
    const doc = parseXml(input);
    acceptChanges(doc, { filter: element => element.getAttributeNS(W, 'author') === 'T' });
    const p = doc.getElementsByTagNameNS(W, 'p')[0]!;
    expect(p.getElementsByTagNameNS(W, 'color')[0]!.getAttributeNS(W, 'val')).toBe('FF0000');
    expect(p.getElementsByTagNameNS(W, 'sz')[0]!.getAttributeNS(W, 'val')).toBe('40');
    expect(p.getElementsByTagNameNS(W, 'ins')[0]!.getAttributeNS(W, 'author')).toBe('Other');
    expect(p.getElementsByTagNameNS(W, 'sectPr')).toHaveLength(1);
    expect(Array.from(p.getElementsByTagNameNS(W, 'rPr')[0]!.childNodes)
      .filter(child => child.nodeType === 1).map(child => (child as Element).localName)).toEqual(['ins', 'color', 'sz']);
  });
  for (const op of ['accept', 'reject'] as const) test(`${op}: cascading breaks retain the first surviving format and partial text`, async () => {
    const tag = op === 'accept' ? 'del' : 'ins';
    const mark = (id: number) => `<w:rPr><w:${tag} w:id="${id}" w:author="T"/></w:rPr>`;
    const removed = `<w:${tag} w:id="3" w:author="T"><w:r><w:${tag === 'del' ? 'delText' : 't'}>DROP</w:${tag === 'del' ? 'delText' : 't'}></w:r></w:${tag}>`;
    const xml = wrap(`<w:p><w:pPr><w:jc w:val="right"/>${mark(1)}</w:pPr><w:r><w:t>FIRST</w:t></w:r>${removed}</w:p><w:p><w:pPr><w:jc w:val="left"/>${mark(2)}</w:pPr><w:r><w:t>MIDDLE</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>LAST</w:t></w:r></w:p>`);
    const doc = parseXml(xml);
    if (op === 'accept') acceptChanges(doc); else rejectChanges(doc);
    for (const result of [serializeXml(doc), op === 'accept' ? acceptAllChanges(xml) : rejectAllChanges(xml)]) {
      const ps = parseXml(result).getElementsByTagNameNS(W, 'p');
      expect(ps).toHaveLength(1);
      expect(ps[0]!.textContent).toBe('FIRSTMIDDLELAST');
      expect(ps[0]!.getElementsByTagNameNS(W, 'jc')[0]!.getAttributeNS(W, 'val')).toBe('right');
    }
    if (process.env.SAFE_DOCX_NOTE_READER_REQUIRED === '1') {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const [actual] = await runLibreOfficeOracle([{ op, documentXml: xml }]);
      const ps = parseXml(actual!).getElementsByTagNameNS(W, 'p');
      expect(ps).toHaveLength(1);
      expect(ps[0]!.textContent).toBe('FIRSTMIDDLELAST');
      expect(ps[0]!.getElementsByTagNameNS(W, 'jc')[0]!.getAttributeNS(W, 'val')).toBe('right');
    }
  }, 180_000);
  for (const c of cases) test(`${c.op}: first survives=${c.first}, second survives=${c.second}`, () => {
    const ast = c.op === 'accept' ? acceptAllChanges(wrap(c.body)) : rejectAllChanges(wrap(c.body));
    const primitive = parseXml(wrap(c.body));
    if (c.op === 'accept') acceptChanges(primitive); else rejectChanges(primitive);
    for (const xml of [ast, serializeXml(primitive)]) {
      const paragraphs = Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p'));
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0]!.textContent).toBe(c.text);
      expect(paragraphs[0]!.getElementsByTagNameNS(W, 'jc')[0]!.getAttributeNS(W, 'val')).toBe(c.alignment);
    }
  });
});

const reader = process.env.SAFE_DOCX_NOTE_READER_REQUIRED === '1' ? describe : describe.skip;
reader('independent paragraph merge formatting decision table', () => {
  test('emitted multiple-field paragraph deletion retains the following paragraph formatting in the reader', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const fields = completeField(' REF Removed \\h ', '1') + completeField(' REF Removed \\h ', '1');
    const survivor = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>SURVIVOR</w:t></w:r></w:p>';
    const original = parseXml(wrap(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:bookmarkStart w:id="1" w:name="Removed"/>${fields}<w:bookmarkEnd w:id="1"/></w:p>` + survivor)).documentElement;
    const revised = parseXml(wrap(survivor)).documentElement;
    const { tree } = constructTaggedTree(original, revised);
    const xml = serializeTaggedTree(tree, createPreservePlan(original, revised, tree, { author: 'T', date: '2026-09-15T00:00:00Z' }));
    const [actual] = await runLibreOfficeOracle([{ op: 'accept', documentXml: xml }]);
    const doc = parseXml(actual!);
    expect(doc.getElementsByTagNameNS(W, 'p')).toHaveLength(1);
    expect(doc.getElementsByTagNameNS(W, 'fldChar')).toHaveLength(0);
    expect(doc.getElementsByTagNameNS(W, 'jc')[0]?.getAttributeNS(W, 'val')).toBe('center');
  }, 180_000);
  test('characterizes empty runs and surviving field delimiters independently of paragraph removal', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    for (const residual of ['<w:r><w:rPr><w:b/></w:rPr></w:r>', '<w:r><w:t/></w:r>', fldChar('begin') + fldChar('separate') + fldChar('end')]) {
      for (const op of ['accept', 'reject'] as const) {
        const tag = op === 'accept' ? 'del' : 'ins';
        const xml = wrap(`<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:${tag} w:id="1" w:author="T"/></w:rPr></w:pPr>${residual}</w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>SECOND</w:t></w:r></w:p>`);
        const [actual] = await runLibreOfficeOracle([{ op, documentXml: xml }]);
        const doc = parseXml(actual!);
        expect(doc.getElementsByTagNameNS(W, 'p')).toHaveLength(1);
        expect(doc.getElementsByTagNameNS(W, 'jc')[0]?.getAttributeNS(W, 'val'), `${op}: ${residual}`).toBe(residual.includes('fldChar') ? 'right' : 'center');
      }
    }
  }, 180_000);
  test('characterizes deleted field instructions and results with unwrapped field delimiters', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const deleted = (xml: string) => `<w:del w:id="2" w:author="T">${xml}</w:del>`;
    const field = fldChar('begin') + deleted(delInstrText(' REF Removed \\h ')) + fldChar('separate') + deleted(resultText('1').replaceAll('w:t', 'w:delText')) + fldChar('end');
    const xml = wrap(`<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:del w:id="1" w:author="T"/></w:rPr></w:pPr>${field}</w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>SECOND</w:t></w:r></w:p>`);
    const fullyDeleted = xml.replace(field, deleted(field.replace(/<w:del [^>]*>/g, '').replaceAll('</w:del>', '')));
    const actuals = await runLibreOfficeOracle([{ op: 'accept', documentXml: xml }, { op: 'accept', documentXml: fullyDeleted }]);
    for (const [i, actual] of actuals.entries()) {
      const doc = parseXml(actual!);
      expect(doc.getElementsByTagNameNS(W, 'p')).toHaveLength(1);
      // Controls outside the deletion survive and own the merged formatting.
      // A fully deleted field disappears and leaves the following format intact.
      expect(doc.getElementsByTagNameNS(W, 'jc')[0]?.getAttributeNS(W, 'val')).toBe(i === 0 ? 'right' : 'center');
    }
  }, 180_000);
  test('measures the leading paragraph-mark font on Accept and Reject', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    for (const op of ['accept', 'reject'] as const) {
      const tag = op === 'accept' ? 'del' : 'ins';
      const [xml] = await runLibreOfficeOracle([{ op, documentXml: wrap(`<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:color w:val="FF0000"/><w:sz w:val="40"/><w:${tag} w:id="1" w:author="T"/></w:rPr></w:pPr><w:r><w:t>FIRST</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:color w:val="0000FF"/><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:t>SECOND</w:t></w:r></w:p>`) }]);
      const props = parseXml(xml!).getElementsByTagNameNS(W, 'pPr')[0]!;
      expect(props.getElementsByTagNameNS(W, 'color')[0]!.getAttributeNS(W, 'val')).toBe('FF0000');
      expect(props.getElementsByTagNameNS(W, 'sz')[0]!.getAttributeNS(W, 'val')).toBe('40');
    }
  }, 180_000);
  test('checks inherited, direct and suppressed numbering against independently loaded clean controls', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const stylesXml = `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Alpha"><w:name w:val="Alpha"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:jc w:val="right"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Beta"><w:name w:val="Beta"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr><w:jc w:val="center"/></w:pPr></w:style></w:styles>`;
    const numberingXml = `<w:numbering xmlns:w="${W}">${[1, 2].map(id => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>`).join('')}${[1, 2].map(id => `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join('')}</w:numbering>`;
    const pack = (bodyXml: string) => buildDocxFromParts({ bodyXml, stylesXml, numberingXml, documentRelEntries: ['styles', 'numbering'].map(name => `<Relationship Id="${name}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${name}" Target="${name}.xml"/>`) });
    for (const mode of ['inherited', 'direct', 'suppressed'] as const) {
      const properties = (first: boolean) => `<w:pStyle w:val="${first ? 'Alpha' : 'Beta'}"/>${mode === 'inherited' ? '' : `<w:numPr><w:numId w:val="${mode === 'suppressed' ? 0 : first ? 1 : 2}"/></w:numPr>`}`;
      const jobs = await Promise.all(cases.flatMap(c => {
        const body = c.body.replace('<w:jc w:val="right"/>', properties(true)).replace('<w:jc w:val="center"/>', properties(false));
        const expected = `<w:p><w:pPr>${properties(c.alignment === 'right')}</w:pPr>${c.text ? `<w:r><w:t>${c.text}</w:t></w:r>` : ''}</w:p><w:p><w:r><w:t>TAIL</w:t></w:r></w:p>`;
        return [pack(body).then(docx => ({ op: c.op, docx, saveAs: 'odt' as const })), pack(expected).then(docx => ({ op: 'identity' as const, docx, saveAs: 'odt' as const }))];
      }));
      const results = await runLibreOfficeOracle(jobs);
      const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
      const S = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
      const project = (xml: string) => {
        const doc = parseXml(xml); const styles = Array.from(doc.getElementsByTagNameNS(S, 'style'));
        return Array.from(doc.getElementsByTagNameNS(T, 'p')).map(p => {
          const id = p.getAttributeNS(T, 'style-name'); const style = styles.find(s => s.getAttributeNS(S, 'name') === id);
          return { text: p.textContent, style: style?.getAttributeNS(S, 'parent-style-name') || id, listHeader: p.getAttributeNS(T, 'is-list-header') === 'true', suppressed: !!style?.hasAttributeNS(S, 'list-style-name') && style.getAttributeNS(S, 'list-style-name') === '', listItem: (p.parentNode as Element)?.localName === 'list-item' };
        });
      };
      for (let i = 0; i < cases.length; i++) expect(project(results[i * 2]!), `${mode}: ${JSON.stringify(cases[i])}`).toEqual(project(results[i * 2 + 1]!));
    }
  }, 180_000);
  test('checks the complete survival matrix in LibreOffice, including the all-empty asymmetry', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const results = await runLibreOfficeOracle(await Promise.all(cases.map(async c => ({ op: c.op, docx: await buildDocxFromParts({ bodyXml: c.body }), saveAs: 'odt' as const }))));
    const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
    const S = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
    const FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
    for (let i = 0; i < cases.length; i++) {
      const doc = parseXml(results[i]!);
      const paragraphs = Array.from(doc.getElementsByTagNameNS(T, 'p'));
      const first = paragraphs[0]!;
      const style = Array.from(doc.getElementsByTagNameNS(S, 'style')).find(s => s.getAttributeNS(S, 'name') === first.getAttributeNS(T, 'style-name'))!;
      expect(paragraphs, JSON.stringify(cases[i])).toHaveLength(2);
      expect(first.textContent).toBe(cases[i]!.text);
      expect(style.getElementsByTagNameNS(S, 'paragraph-properties')[0]!.getAttributeNS(FO, 'text-align')).toBe(cases[i]!.alignment);
    }
  }, 180_000);
});
