import { describe, expect } from 'vitest';
import { testAllure } from './helpers/allure-test.js';
import {
  buildDocxFromBodyXml,
  completeField,
  FIELD_INSTRUCTIONS,
  fldChar,
  instrText,
  resultText,
} from '../src/testing/ooxml-fixtures.js';
import { DocxArchive } from '../src/shared/docx/DocxArchive.js';
import {
  FieldRefreshError,
  refreshDocumentFieldsXml,
  refreshDocxFields,
} from '../src/primitives/field_evaluation.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'add-scoped-field-evaluation';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.44' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.42' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.45' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' },
);

function documentXml(body: string): string {
  return `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`;
}

describe('scoped field evaluation', () => {
  conformanceTest.openspec('[SDX-FIELD-EVAL-01] REF cache refreshes from bookmark text')(
    'replaces cached text while preserving its formatted result run',
    () => {
      const xml = documentXml(
        '<w:p><w:bookmarkStart w:id="7" w:name="Clause_1"/>'
          + '<w:r><w:t>Section </w:t></w:r><w:r><w:t>One</w:t></w:r>'
          + '<w:bookmarkEnd w:id="7"/></w:p>'
          + '<w:p>'
          + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
          + '<w:r><w:instrText xml:space="preserve"> REF Clause_1 \\h </w:instrText></w:r>'
          + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
          + '<w:r><w:rPr><w:b/></w:rPr><w:t>Stale</w:t></w:r>'
          + '<w:r><w:i/><w:t> overflow</w:t></w:r>'
          + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
          + '</w:p>',
      );

      const result = refreshDocumentFieldsXml(xml);

      expect(result.changed).toBe(true);
      expect(result.outcomes).toEqual([
        expect.objectContaining({
          kind: 'REF',
          status: 'evaluated',
          target: 'Clause_1',
        }),
      ]);
      expect(result.documentXml).toContain(
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Section One</w:t></w:r>',
      );
      expect(result.documentXml).toContain('<w:r><w:i/><w:t/></w:r>');
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-02] Layout-dependent field is marked dirty')(
    'marks layout fields for Word without overwriting their cached values',
    () => {
      const xml = documentXml(
        `<w:p>${completeField(FIELD_INSTRUCTIONS.PAGE, '17')}</w:p>`
          + `<w:p>${completeField(FIELD_INSTRUCTIONS.NUMPAGES, '24')}</w:p>`
          + `<w:p>${completeField(FIELD_INSTRUCTIONS.PAGEREF, '9')}</w:p>`
          + `<w:p>${fldChar('begin')}${instrText(' TOC \\o "1-3" ', {
            preserve: true,
          })}${fldChar('separate')}</w:p>`
          + `<w:p>${resultText('Contents')}</w:p>`
          + `<w:p>${fldChar('end')}</w:p>`,
      );

      const result = refreshDocumentFieldsXml(xml, {
        markLayoutDependentDirty: true,
      });

      expect(result.changed).toBe(true);
      expect(result.outcomes.map(({ kind, status }) => ({ kind, status }))).toEqual([
        { kind: 'PAGE', status: 'dirtied' },
        { kind: 'NUMPAGES', status: 'dirtied' },
        { kind: 'PAGEREF', status: 'dirtied' },
        { kind: 'TOC', status: 'dirtied' },
      ]);
      expect(result.documentXml.match(/w:dirty="true"/gu)).toHaveLength(4);
      expect(result.documentXml).toContain('<w:t>17</w:t>');
      expect(result.documentXml).toContain('<w:t>Contents</w:t>');
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-03] Unsupported REF projection is preserved')(
    'returns the original XML byte-for-byte for an unsupported projection switch',
    () => {
      const xml = documentXml(
        '<w:p><w:bookmarkStart w:id="7" w:name="Clause_1"/>'
          + '<w:r><w:t>Section One</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>'
          + `<w:p>${completeField(' REF Clause_1 \\p ', 'above')}</w:p>`,
      );

      const result = refreshDocumentFieldsXml(xml);

      expect(result.documentXml).toBe(xml);
      expect(result).toMatchObject({
        changed: false,
        outcomes: [{ status: 'unsupported', reason: 'unsupported-ref-switch' }],
      });
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-04] Ambiguous bookmark does not retarget')(
    'preserves a REF field when the bookmark name is duplicated',
    () => {
      const xml = documentXml(
        '<w:p><w:bookmarkStart w:id="1" w:name="Clause_1"/>'
          + '<w:r><w:t>First</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
          + '<w:p><w:bookmarkStart w:id="2" w:name="Clause_1"/>'
          + '<w:r><w:t>Second</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p>'
          + `<w:p>${completeField(FIELD_INSTRUCTIONS.REF, 'Stale')}</w:p>`,
      );

      const result = refreshDocumentFieldsXml(xml);

      expect(result.documentXml).toBe(xml);
      expect(result.outcomes[0]).toMatchObject({
        status: 'unsupported',
        reason: 'duplicate-bookmark-name',
      });
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-05] Malformed field topology fails transactionally')(
    'throws a typed error for a stray separator',
    () => {
      const xml = documentXml(
        '<w:p><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>',
      );

      try {
        refreshDocumentFieldsXml(xml);
        throw new Error('Expected field refresh to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(FieldRefreshError);
        expect(error).toMatchObject({
          name: 'FieldRefreshError',
          code: 'MALFORMED_FIELD_TOPOLOGY',
        });
      }
    },
  );

  test('refreshes the main story through the public DOCX buffer API', async () => {
    const source = await buildDocxFromBodyXml(
      '<w:p><w:bookmarkStart w:id="7" w:name="Clause_1"/>'
        + '<w:r><w:t>Fresh</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>'
        + `<w:p>${completeField(FIELD_INSTRUCTIONS.REF, 'Stale')}</w:p>`,
    );

    const result = await refreshDocxFields(source);
    const archive = await DocxArchive.load(result.document);

    expect(result.changed).toBe(true);
    expect(result.outcomes[0]).toMatchObject({ status: 'evaluated' });
    expect(await archive.getDocumentXml()).toContain('<w:t>Fresh</w:t>');
  });
});
