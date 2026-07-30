import { expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { OOXML } from './namespaces.js';
import { validateDocument } from './validate_document.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Document Validation', story: 'Tracked-change structure' });
const paragraphDeletionTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
);

function documentWithBody(bodyXml: string): Document {
  return parseXml(
    `<w:document xmlns:w="${OOXML.W_NS}"><w:body>${bodyXml}</w:body></w:document>`,
  );
}

paragraphDeletionTest('accepts an empty paragraph-mark deletion as revision metadata', async ({
  given,
  when,
  then,
}: AllureBddContext) => {
  let result: ReturnType<typeof validateDocument>;

  await given('a paragraph with a legal empty deletion marker in its paragraph-mark rPr', () => {
    const doc = documentWithBody(
      '<w:p><w:pPr><w:rPr>' +
        '<w:del w:id="2" w:author="SafeDocX" w:date="2026-07-29T12:00:00Z"/>' +
        '<w:rFonts w:ascii="Georgia"/><w:sz w:val="44"/>' +
      '</w:rPr></w:pPr><w:del w:id="1" w:author="SafeDocX" w:date="2026-07-29T12:00:00Z">' +
        '<w:r><w:delText>Delete me</w:delText></w:r>' +
      '</w:del></w:p>',
    );

    result = validateDocument(doc);
  });

  await when('structural validation inspects tracked-change elements', () => {});

  await then('it does not mistake paragraph-mark metadata for an empty wrapper', () => {
    expect(result.warnings).toEqual([]);
    expect(result.isValid).toBe(true);
  });
});

test('still warns for an empty run-level tracked-change wrapper', async ({
  given,
  when,
  then,
}: AllureBddContext) => {
  let result: ReturnType<typeof validateDocument>;

  await given('an empty deletion wrapper at paragraph content level', () => {
    const doc = documentWithBody(
      '<w:p><w:del w:id="7" w:author="SafeDocX" w:date="2026-07-29T12:00:00Z"/></w:p>',
    );
    result = validateDocument(doc);
  });

  await when('structural validation inspects the wrapper', () => {});

  await then('the empty-wrapper warning remains active', () => {
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'EMPTY_TRACKED_CHANGE',
        context: 'element=w:del, id=7',
      }),
    ]);
    expect(result.isValid).toBe(false);
  });
});
