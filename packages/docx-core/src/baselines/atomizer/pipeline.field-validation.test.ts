import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { validateFieldStructure } from './pipeline.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Field Structure Validation (ECMA-376)' });

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function buildDoc(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ${NS}>` +
    `<w:body>${bodyXml}<w:sectPr/></w:body></w:document>`
  );
}

const COMPLETE_FIELD =
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:t>3</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

// ECMA-376 conformant field-modification pattern: a field whose instruction
// text is changing under track changes. The fldChars remain UNWRAPPED at the
// sibling-run level (they cannot enter <w:del>), while the changed instrText
// fragments into <w:ins>/<w:del> wrappers. Research summary: c-rex ECMA-376
// Part 4 fldChar topic + DeletedFieldCode placement constraint.
const MODIFIED_FIELD_FRAGMENTED =
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:ins><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r></w:ins>` +
  `<w:del><w:r><w:delInstrText xml:space="preserve"> PAGE </w:delInstrText></w:r></w:del>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:t>3</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

describe('validateFieldStructure', () => {
  test(
    'field-free document is valid',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = false;

      await given('a document with only literal text runs', () => {
        xml = buildDoc(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
      });
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it passes', () => {
        expect(ok).toBe(true);
      });
    },
  );

  test(
    'complete NUMPAGES field is valid',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = false;

      await given('a paragraph containing a well-formed NUMPAGES complex field', () => {
        xml = buildDoc(`<w:p>${COMPLETE_FIELD}</w:p>`);
      });
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it passes', () => {
        expect(ok).toBe(true);
      });
    },
  );

  test(
    'orphan w:instrText outside any field is rejected',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = true;

      await given('a paragraph with a bare w:instrText and no surrounding w:fldChar', () => {
        xml = buildDoc(`<w:p><w:r><w:instrText> PAGE </w:instrText></w:r></w:p>`);
      });
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it is rejected', () => {
        expect(ok).toBe(false);
      });
    },
  );

  test(
    'w:instrText after the separator (in the result section) is rejected',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = true;

      await given('a field whose w:instrText is placed AFTER w:fldChar separate', () => {
        xml = buildDoc(
          `<w:p>` +
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
            `<w:r><w:instrText> NUMPAGES </w:instrText></w:r>` +
            `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
            `</w:p>`,
        );
      });
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it is rejected', () => {
        expect(ok).toBe(false);
      });
    },
  );

  test(
    'unbalanced begin/end counts are rejected',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = true;

      await given('a field with two begins and only one end', () => {
        xml = buildDoc(
          `<w:p>` +
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
            `</w:p>`,
        );
      });
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it is rejected', () => {
        expect(ok).toBe(false);
      });
    },
  );

  test(
    'ECMA-376 fragmented field modification (unwrapped fldChars + ins/del instrText) is valid',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = false;

      await given(
        'a field where w:fldChar markers remain unwrapped while w:instrText/w:delInstrText fragment into <w:ins>/<w:del>',
        () => {
          xml = buildDoc(`<w:p>${MODIFIED_FIELD_FRAGMENTED}</w:p>`);
        },
      );
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it passes', () => {
        expect(ok).toBe(true);
      });
    },
  );

  test(
    'w:delInstrText outside <w:del> is rejected (ECMA-376 DeletedFieldCode)',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = true;

      await given('a field where w:delInstrText appears in a run NOT wrapped by <w:del>', () => {
        xml = buildDoc(
          `<w:p>` +
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:delInstrText> NUMPAGES </w:delInstrText></w:r>` +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
            `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
            `</w:p>`,
        );
      });
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it is rejected', () => {
        expect(ok).toBe(false);
      });
    },
  );

  test(
    'w:delInstrText inside <w:del> but outside any field body is rejected',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = true;

      await given('a <w:del> wrapping w:delInstrText with no enclosing field begin/separate', () => {
        xml = buildDoc(
          `<w:p>` +
            `<w:del><w:r><w:delInstrText> NUMPAGES </w:delInstrText></w:r></w:del>` +
            `</w:p>`,
        );
      });
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it is rejected', () => {
        expect(ok).toBe(false);
      });
    },
  );

  test(
    'w:fldChar nested inside <w:del> is rejected (ECMA-376 fatal violation)',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = true;

      await given('a <w:del> wrapping a balanced begin/end field-character pair', () => {
        xml = buildDoc(
          `<w:p>` +
            `<w:del>` +
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
            `</w:del>` +
            `</w:p>`,
        );
      });
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it is rejected', () => {
        expect(ok).toBe(false);
      });
    },
  );

  test(
    'w:fldChar inside <w:ins> is allowed (insertion of a new field is conformant)',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let ok = false;

      await given('an insertion wrapping a complete NUMPAGES field', () => {
        xml = buildDoc(`<w:p><w:ins>${COMPLETE_FIELD}</w:ins></w:p>`);
      });
      await when('the document is validated', () => {
        ok = validateFieldStructure(xml);
      });
      await then('it passes', () => {
        expect(ok).toBe(true);
      });
    },
  );
});
