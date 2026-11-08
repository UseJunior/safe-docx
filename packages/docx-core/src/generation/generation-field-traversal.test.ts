import { expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import {
  buildDocxFromBodyXml,
  buildDocxWithAncillaryParts,
  COMPLETE_PAGE_FIELD,
  NESTED_IF_DOCPROPERTY_FIELD_WITH_INSTRUCTION_RESULT,
  fldChar,
  instrText,
  resultText,
} from '../testing/ooxml-fixtures.js';
import { checkGeneratedPackage } from './structural-checks.js';

const TEST_FEATURE = 'refactor-nested-field-consumers';
const test = testAllure.epic('Document Generation')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });

test.openspec('SDX-FIELD-001')('nested and spanning fields use strict story-local traversal', async () => {
  const nested = fldChar('begin') + instrText(' IF ') + COMPLETE_PAGE_FIELD +
    instrText(' = 1 ') + fldChar('separate') + resultText('Yes') + fldChar('end');
  for (const field of [nested, NESTED_IF_DOCPROPERTY_FIELD_WITH_INSTRUCTION_RESULT,
    fldChar('begin') + instrText(' XE Entry ') + fldChar('end'),
    fldChar('begin') + '</w:p><w:p>' + instrText(' PAGE ') + fldChar('separate') + resultText('1') + fldChar('end'),
  ]) {
    const buffer = await buildDocxFromBodyXml(`<w:p>${field}</w:p>`);
    const result = await checkGeneratedPackage(buffer);
    expect(result.issues, field).toEqual([]);
  }
});

test.openspec('SDX-FIELD-002')('malformed field markers fail strictly without requiring optional separators', async () => {
  for (const field of [
    fldChar('separate'), fldChar('end'), fldChar('begin'),
    fldChar('begin') + fldChar('separate') + fldChar('separate') + fldChar('end'),
    fldChar('begin') + fldChar('begin') + fldChar('end'),
    '<w:r><w:fldChar w:fldCharType="invalid"/></w:r>',
    instrText(' PAGE '),
    fldChar('begin') + fldChar('separate') + instrText('late') + fldChar('end'),
  ]) {
    const result = await checkGeneratedPackage(await buildDocxFromBodyXml(`<w:p>${field}</w:p>`));
    expect(result.ok, field).toBe(false);
    expect(result.issues.every((issue) => issue.check === 'field_pairing'), field).toBe(true);
  }
});

test('legacy differential diagnostics preserve main marker policies and exact messages', async () => {
  const cases = [
    { field: fldChar('end'), messages: ['fldChar end without a matching begin'] },
    { field: fldChar('separate'), messages: [
      'fldChar separate without a matching begin', 'Unclosed field at end of story part',
    ] },
    { field: fldChar('begin') + fldChar('separate') + fldChar('separate') + fldChar('end'),
      messages: ['fldChar separate without a matching begin'] },
    { field: fldChar('begin'), messages: ['Unclosed field at end of story part'] },
    { field: instrText(' PAGE '), messages: ['w:instrText outside a begin→separate range'] },
    { field: '<w:r><w:fldChar w:fldCharType="invalid"/></w:r>', messages: [] },
    { field: fldChar('begin') + instrText(' XE Entry ') + fldChar('end'), messages: [] },
  ];
  for (const { field, messages } of cases) {
    const result = await checkGeneratedPackage(await buildDocxFromBodyXml(`<w:p>${field}</w:p>`), {
      fieldPairing: 'legacy-differential',
    });
    expect(result.issues, field).toEqual(messages.map((message) => ({
      check: 'field_pairing', part: 'word/document.xml', message,
    })));
  }
});

test.openspec('SDX-FIELD-003')('field stacks do not pair body markers with footer markers', async () => {
  const result = await checkGeneratedPackage(await buildDocxWithAncillaryParts({
    bodyXml: `<w:p>${fldChar('begin')}${instrText(' PAGE ')}</w:p>`,
    sectPrXml: '<w:sectPr><w:footerReference w:type="default" r:id="rId1"/></w:sectPr>',
    relationships: [{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', target: 'footer1.xml' }],
    parts: [{ path: 'word/footer1.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
      xml: '<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p>' + fldChar('end') + '</w:p></w:ftr>' }],
  }));
  expect(result.ok).toBe(false);
  expect(result.issues.map((issue) => [issue.check, issue.part])).toEqual([
    ['field_pairing', 'word/document.xml'], ['field_pairing', 'word/footer1.xml'],
  ]);
});

test.openspec('SDX-FIELD-004')('notes and text boxes cannot close fields in another story in the same part', async () => {
  for (const noteKind of ['footnote', 'endnote', 'comment']) {
    const plural = `${noteKind}s`;
    const result = await checkGeneratedPackage(await buildDocxWithAncillaryParts({
      bodyXml: '<w:p/>', sectPrXml: '<w:sectPr/>',
      parts: [{ path: `word/${plural}.xml`, contentType: 'application/xml',
        xml: `<?xml version="1.0"?><w:${plural} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:${noteKind} w:id="1"><w:p>${fldChar('begin')}</w:p></w:${noteKind}>` +
          `<w:${noteKind} w:id="2"><w:p>${fldChar('end')}</w:p></w:${noteKind}>` +
          `</w:${plural}>` }],
    }));
    expect(result.issues.filter((issue) => issue.check === 'field_pairing')).toHaveLength(2);
  }
  const result = await checkGeneratedPackage(await buildDocxFromBodyXml(
    `<w:p>${fldChar('begin')}<w:r><w:pict><w:txbxContent><w:p>${fldChar('end')}` +
    '</w:p></w:txbxContent></w:pict></w:r></w:p>',
  ));
  expect(result.issues.filter((issue) => issue.check === 'field_pairing')).toHaveLength(2);
});
