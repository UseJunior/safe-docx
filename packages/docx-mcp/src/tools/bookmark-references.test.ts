import { expect } from 'vitest';
import { DocxDocument, OOXML, parseXml } from '@usejunior/docx-core';
const { buildDocxFromBodyXml, completeField, paragraphWithText } = await import(new URL('../../../docx-core/src/testing/ooxml-fixtures.ts', import.meta.url).href);
import { testAllure, allureJsonAttachment, type AllureBddContext } from '../testing/allure-test.js';
import { collectLocalUserBookmarks, collectTargetingRefFields } from './bookmark_references.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Paragraph Deletion' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' });
const W = OOXML.W_NS;

test('local user bookmarks exclude spanning, incomplete, internal and duplicate names', async ({ given, when, then }: AllureBddContext) => {
  let p!: Element; let names!: string[];
  await given('local, spanning and malformed bookmark endpoints in one imported paragraph', () => {
    // Missing-id/name endpoints are deliberately malformed input, the subject of the filter.
    p = parseXml(`<w:p xmlns:w="${W}">
      <w:bookmarkStart w:id="1" w:name="Target"/><w:bookmarkEnd w:id="1"/>
      <w:bookmarkStart w:id="2" w:name="Target"/><w:bookmarkEnd w:id="2"/>
      <w:bookmarkStart w:id="3" w:name="Spanning"/>
      <w:bookmarkStart w:id="4" w:name="_bk_internal"/><w:bookmarkEnd w:id="4"/>
      <w:bookmarkStart w:id="5" w:name="_GoBack"/><w:bookmarkEnd w:id="5"/>
      <w:bookmarkStart w:name="MissingId"/><w:bookmarkEnd/>
      <w:bookmarkStart w:id="6"/><w:bookmarkEnd w:id="6"/>
      <w:bookmarkStart w:id="7" w:name="Second"/><w:bookmarkEnd w:id="7"/>
    </w:p>`).documentElement!;
    // Older DOM callers used prefixed attributes without an attribute namespace.
    const start = p.ownerDocument!.createElementNS(W, 'w:bookmarkStart');
    start.setAttribute('w:id', '8'); start.setAttribute('w:name', 'Legacy');
    const end = p.ownerDocument!.createElementNS(W, 'w:bookmarkEnd'); end.setAttribute('w:id', '8');
    p.appendChild(start); p.appendChild(end);
  });
  await when('local user targets are collected', () => { names = collectLocalUserBookmarks(p); });
  await then('only unique complete user bookmarks are retained in document order', async () => {
    expect(names).toEqual(['Target', 'Second', 'Legacy']);
    await allureJsonAttachment('Retained targets', names);
  });
});

test('reference reporting includes live complex and simple targets and excludes deleted or unrelated fields', async ({ given, when, then }: AllureBddContext) => {
  let doc!: DocxDocument; let target!: Element; let instructions!: string[];
  await given('a target beside live, deleted, moved and unrelated reference fields', async () => {
    doc = await DocxDocument.load(await buildDocxFromBodyXml(
      `<w:p><w:bookmarkStart w:id="1" w:name="Target"/><w:r><w:t>target</w:t></w:r>${completeField(' REF Target ', 'self')}<w:bookmarkEnd w:id="1"/></w:p>`
      + `<w:p>${completeField(' REF &quot;Target&quot; \\h ', 'one')}${completeField(' PAGEREF Target ', 'two')}${completeField(' NOTEREF Other ', 'not targeted')}</w:p>`
      + '<w:p><w:fldSimple w:instr=" NOTEREF &quot;Target&quot; "><w:r><w:t>three</w:t></w:r></w:fldSimple>'
      + '<w:fldSimple w:instr="  Target \\h "><w:r><w:t>four</w:t></w:r></w:fldSimple>'
      + '<w:fldSimple w:instr=" &quot;Target&quot; "><w:r><w:t>quoted implicit</w:t></w:r></w:fldSimple>'
      + '<w:ins w:id="2" w:author="A"><w:fldSimple w:instr=" REF Target "><w:r><w:t>five</w:t></w:r></w:fldSimple></w:ins>'
      + '<w:del w:id="3" w:author="A"><w:fldSimple w:instr=" REF Target "><w:r><w:delText>deleted</w:delText></w:r></w:fldSimple></w:del>'
      + '<w:moveFrom w:id="4" w:author="A"><w:fldSimple w:instr=" REF Target "><w:r><w:delText>moved</w:delText></w:r></w:fldSimple></w:moveFrom>'
      + '<w:fldSimple w:instr=" REF Other "><w:r><w:t>other</w:t></w:r></w:fldSimple>'
      + '<w:fldSimple w:instr=" Other \\h "><w:r><w:t>other implicit</w:t></w:r></w:fldSimple>'
      + '<w:fldSimple w:instr=" REF \\h "><w:r><w:t>invalid</w:t></w:r></w:fldSimple>'
      // Deliberately malformed simple field: absent instruction is an input-filter negative case.
      + '<w:fldSimple><w:r><w:t>missing instruction</w:t></w:r></w:fldSimple></w:p>'
      + paragraphWithText('unrelated'),
    ));
    target = doc.getParagraphs()[0]!;
  });
  await when('fields referencing the removed target are collected', () => {
    const fields = collectTargetingRefFields(doc, target, ['Target']);
    expect(fields.every(field => field.bookmark === 'Target' && field.paragraph_id === null)).toBe(true);
    instructions = fields.map(field => field.instruction);
  });
  await then('live reference forms are reported once, with trimmed instructions', async () => {
    expect(instructions).toEqual(['REF "Target" \\h', 'PAGEREF Target', 'NOTEREF "Target"', 'Target \\h', '"Target"', 'REF Target']);
    expect(collectTargetingRefFields(doc, target, [])).toEqual([]);
    await allureJsonAttachment('Affected live instructions', instructions);
  });
});
