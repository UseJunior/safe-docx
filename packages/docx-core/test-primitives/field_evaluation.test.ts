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

  const refField = (instruction: string, result: string): string =>
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
      + `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>`
      + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
      + `<w:r><w:t>${result}</w:t></w:r>`
      + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

  conformanceTest.openspec('[SDX-FIELD-EVAL-08] Layout-bearing bookmark projection is refused')(
    'refuses tabbed and multi-paragraph bookmark projections instead of flattening them',
    () => {
      const tabbed = documentXml(
        '<w:p><w:bookmarkStart w:id="1" w:name="bk"/>'
          + '<w:r><w:t>One</w:t><w:tab/><w:t>Two</w:t></w:r>'
          + '<w:bookmarkEnd w:id="1"/></w:p>'
          + `<w:p>${refField(' REF bk \\h ', 'Stale')}</w:p>`,
      );
      const spanning = documentXml(
        '<w:p><w:bookmarkStart w:id="1" w:name="bk"/><w:r><w:t>One</w:t></w:r></w:p>'
          + '<w:p><w:r><w:t>Two</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
          + `<w:p>${refField(' REF bk \\h ', 'Stale')}</w:p>`,
      );

      for (const xml of [tabbed, spanning]) {
        const result = refreshDocumentFieldsXml(xml);
        expect(result.changed).toBe(false);
        expect(result.documentXml).toBe(xml);
        expect(result.outcomes[0]).toMatchObject({
          status: 'unsupported',
          reason: 'unsupported-bookmark-layout',
        });
      }
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-09] Simple field inside a cached result is opaque')(
    'leaves a nested simple field cached result untouched',
    () => {
      const xml = documentXml(
        '<w:p><w:bookmarkStart w:id="1" w:name="bk"/>'
          + '<w:r><w:t>Clause 5</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
          + '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
          + '<w:r><w:instrText xml:space="preserve"> REF bk \\h </w:instrText></w:r>'
          + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
          + '<w:r><w:t>Stale</w:t></w:r>'
          + '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>'
          + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      );

      const result = refreshDocumentFieldsXml(xml);

      expect(result.outcomes[0]).toMatchObject({ status: 'evaluated' });
      expect(result.documentXml).toContain('<w:t>Clause 5</w:t>');
      expect(result.documentXml).toContain(
        '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>',
      );
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-10] Revised instruction classifies from the surviving text')(
    'reports the surviving instruction rather than a deleted and current chimera',
    () => {
      const xml = documentXml(
        '<w:p><w:bookmarkStart w:id="1" w:name="New"/>'
          + '<w:r><w:t>Fresh</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
          + '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
          + '<w:del w:id="4" w:author="a" w:date="2026-01-01T00:00:00Z">'
          + '<w:r><w:instrText xml:space="preserve"> REF Old \\h </w:instrText></w:r></w:del>'
          + '<w:ins w:id="5" w:author="a" w:date="2026-01-01T00:00:00Z">'
          + '<w:r><w:instrText xml:space="preserve"> REF New \\h </w:instrText></w:r></w:ins>'
          + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
          + '<w:r><w:t>Stale</w:t></w:r>'
          + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      );

      const result = refreshDocumentFieldsXml(xml);

      expect(result.changed).toBe(false);
      expect(result.outcomes[0]).toMatchObject({
        kind: 'REF',
        instruction: 'REF New \\h',
        target: 'New',
        status: 'unsupported',
        reason: 'field-contains-revisions',
      });
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-11] Unread field-bearing stories are named')(
    'names header and footnote parts the main-story refresh did not read',
    async () => {
      const source = await buildDocxFromBodyXml(
        '<w:p><w:bookmarkStart w:id="7" w:name="Clause_1"/>'
          + '<w:r><w:t>Fresh</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>'
          + `<w:p>${completeField(FIELD_INSTRUCTIONS.REF, 'Stale')}</w:p>`,
      );
      const archive = await DocxArchive.load(source);
      archive.setFile(
        'word/header1.xml',
        `<w:hdr xmlns:w="${W_NS}"><w:p/></w:hdr>`,
      );
      archive.setFile(
        'word/footnotes.xml',
        `<w:footnotes xmlns:w="${W_NS}"/>`,
      );

      const result = await refreshDocxFields(await archive.save());

      expect(result.skippedStories).toEqual([
        'word/footnotes.xml',
        'word/header1.xml',
      ]);
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-04] Ambiguous bookmark does not retarget')(
    'reports each bookmark-resolution failure without touching the cached result',
    () => {
      const ref = `<w:p>${refField(' REF bk \\h ', 'Stale')}</w:p>`;
      const cases: Array<[string, string]> = [
        [
          'duplicate-bookmark-name',
          '<w:p><w:bookmarkStart w:id="1" w:name="bk"/><w:r><w:t>A</w:t></w:r><w:bookmarkEnd w:id="1"/>'
            + '<w:bookmarkStart w:id="2" w:name="bk"/><w:r><w:t>B</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p>',
        ],
        [
          'missing-or-duplicate-bookmark-end',
          '<w:p><w:bookmarkStart w:id="1" w:name="bk"/><w:r><w:t>A</w:t></w:r></w:p>',
        ],
        [
          'reversed-bookmark-range',
          '<w:p><w:bookmarkEnd w:id="1"/><w:r><w:t>A</w:t></w:r><w:bookmarkStart w:id="1" w:name="bk"/></w:p>',
        ],
        [
          'unsupported-bookmark-content',
          '<w:p><w:bookmarkStart w:id="1" w:name="bk"/><w:r><w:drawing/></w:r>'
            + '<w:bookmarkEnd w:id="1"/></w:p>',
        ],
        ['bookmark-not-found', '<w:p><w:r><w:t>nothing named bk</w:t></w:r></w:p>'],
        [
          'duplicate-or-missing-bookmark-id',
          '<w:p><w:bookmarkStart w:id="1" w:name="bk"/><w:r><w:t>A</w:t></w:r><w:bookmarkEnd w:id="1"/>'
            + '<w:bookmarkStart w:id="1" w:name="other"/><w:r><w:t>B</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>',
        ],
      ];

      for (const [reason, prelude] of cases) {
        const xml = documentXml(prelude + ref);
        const result = refreshDocumentFieldsXml(xml);
        expect(result.changed, reason).toBe(false);
        expect(result.documentXml).toBe(xml);
        expect(result.outcomes.at(-1)).toMatchObject({ status: 'unsupported', reason });
      }
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-04] Ambiguous bookmark does not retarget')(
    'refuses a bookmark range that encloses the field referencing it',
    () => {
      const xml = documentXml(
        `<w:p><w:bookmarkStart w:id="1" w:name="bk"/>${refField(' REF bk \\h ', 'Stale')}`
          + '<w:bookmarkEnd w:id="1"/></w:p>',
      );

      expect(refreshDocumentFieldsXml(xml).outcomes[0]).toMatchObject({
        status: 'unsupported',
        reason: 'self-referential-bookmark',
      });
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-05] Malformed field topology fails transactionally')(
    'rejects stray, unknown, and unclosed field characters before mutating',
    () => {
      const malformed = [
        '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
        '<w:p><w:r><w:fldChar w:fldCharType="wat"/></w:r></w:p>',
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>',
        '<w:p><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>',
      ];

      for (const body of malformed) {
        expect(() => refreshDocumentFieldsXml(documentXml(body)), body).toThrow(
          FieldRefreshError,
        );
      }
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-03] Unsupported REF projection is preserved')(
    'reports nested, locked, cross-paragraph, and result-less fields as unsupported',
    () => {
      const bookmark =
        '<w:p><w:bookmarkStart w:id="1" w:name="bk"/><w:r><w:t>Fresh</w:t></w:r>'
        + '<w:bookmarkEnd w:id="1"/></w:p>';
      const cases: Array<[string, string]> = [
        [
          'nested-field',
          `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>`
            + '<w:r><w:instrText xml:space="preserve"> REF bk \\h </w:instrText></w:r>'
            + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
            + refField(' PAGE ', '1')
            + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
        ],
        [
          'locked-field',
          '<w:p><w:r><w:fldChar w:fldCharType="begin" w:fldLock="true"/></w:r>'
            + '<w:r><w:instrText xml:space="preserve"> REF bk \\h </w:instrText></w:r>'
            + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Stale</w:t></w:r>'
            + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
        ],
        [
          'cross-paragraph-field',
          '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            + '<w:r><w:instrText xml:space="preserve"> REF bk \\h </w:instrText></w:r>'
            + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Stale</w:t></w:r></w:p>'
            + '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
        ],
        [
          'incomplete-field',
          '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            + '<w:r><w:instrText xml:space="preserve"> REF bk \\h </w:instrText></w:r>'
            + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
        ],
        [
          'missing-cached-result-text',
          '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            + '<w:r><w:instrText xml:space="preserve"> REF bk \\h </w:instrText></w:r>'
            + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
            + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
        ],
      ];

      for (const [reason, body] of cases) {
        const result = refreshDocumentFieldsXml(documentXml(bookmark + body));
        expect(result.changed, reason).toBe(false);
        expect(result.outcomes.at(-1), reason).toMatchObject({ status: 'unsupported', reason });
      }
    },
  );

  test('reports already-current and already-dirty fields as unchanged', () => {
    const current = documentXml(
      '<w:p><w:bookmarkStart w:id="1" w:name="bk"/><w:r><w:t>Fresh</w:t></w:r>'
        + '<w:bookmarkEnd w:id="1"/></w:p>'
        + `<w:p>${refField(' REF bk \\h ', 'Fresh')}</w:p>`,
    );
    const dirty = documentXml(
      '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'
        + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
        + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>'
        + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    );

    const currentResult = refreshDocumentFieldsXml(current);
    const dirtyResult = refreshDocumentFieldsXml(dirty, { markLayoutDependentDirty: true });

    expect(currentResult.changed).toBe(false);
    expect(currentResult.documentXml).toBe(current);
    expect(currentResult.outcomes[0]).toMatchObject({
      status: 'unchanged',
      reason: 'cached-result-current',
    });
    expect(dirtyResult.changed).toBe(false);
    expect(dirtyResult.outcomes[0]).toMatchObject({
      status: 'unchanged',
      reason: 'already-dirty',
    });
  });

  test('preserves layout-dependent fields when dirty marking is not requested', () => {
    const xml = documentXml(`<w:p>${refField(' PAGE ', '4')}</w:p>`);

    const result = refreshDocumentFieldsXml(xml);

    expect(result.changed).toBe(false);
    expect(result.outcomes[0]).toMatchObject({
      kind: 'PAGE',
      status: 'preserved',
      reason: 'layout-refresh-not-requested',
    });
  });

  test('sets xml:space only when the refreshed value has edge whitespace', () => {
    const build = (bookmarked: string): string =>
      documentXml(
        `<w:p><w:bookmarkStart w:id="1" w:name="bk"/><w:r><w:t xml:space="preserve">${bookmarked}</w:t></w:r>`
          + '<w:bookmarkEnd w:id="1"/></w:p>'
          + `<w:p>${refField(' REF bk \\h ', 'Stale')}</w:p>`,
      );

    const padded = refreshDocumentFieldsXml(build(' Fresh '));
    const bare = refreshDocumentFieldsXml(build('Fresh'));

    expect(padded.documentXml).toContain('<w:t xml:space="preserve"> Fresh </w:t>');
    expect(bare.documentXml).toContain('<w:t>Fresh</w:t>');
  });

  test('returns the original buffer when no field changed', async () => {
    const source = await buildDocxFromBodyXml('<w:p><w:r><w:t>no fields here</w:t></w:r></w:p>');

    const result = await refreshDocxFields(source);

    expect(result.changed).toBe(false);
    expect(result.document).toBe(source);
    expect(result.outcomes).toEqual([]);
  });

  test('omits the paragraph ordinal for a field with no paragraph ancestor', () => {
    const xml = documentXml(refField(' PAGE ', '1'));

    const result = refreshDocumentFieldsXml(xml, { markLayoutDependentDirty: true });

    expect(result.changed).toBe(false);
    expect(result.outcomes[0]).toMatchObject({
      status: 'unsupported',
      reason: 'field-outside-paragraph',
    });
    expect(result.outcomes[0]!.locator).not.toHaveProperty('paragraphOrdinal');
  });
});
