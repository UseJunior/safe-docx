import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { hasFldCharInsideDel, splitStories, validateFieldStructure } from './pipeline.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Field Structure Validation (ECMA-376)' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 4, section: '17.16.5' });

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

// =============================================================================
// Per-story validation (issue #212)
//
// ECMA-376 Part 4 (fldChar topic) treats each footnote and endnote entry as
// its own document story. A complex field whose begin/end markers straddle a
// story boundary breaks Word's field state machine even when global counts
// balance — the renderer discards the field characters and emits the runs as
// literal text. These tests exercise the per-story partitioning provided by
// `splitStories` + the array-input form of `validateFieldStructure`.
// =============================================================================

function buildFootnotes(entries: Array<{ id: string; content: string; type?: string }>): string {
  const body = entries
    .map(
      (e) =>
        `<w:footnote w:id="${e.id}"${e.type ? ` w:type="${e.type}"` : ''}>${e.content}</w:footnote>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:footnotes ${NS}>${body}</w:footnotes>`
  );
}

function buildEndnotes(entries: Array<{ id: string; content: string; type?: string }>): string {
  const body = entries
    .map(
      (e) =>
        `<w:endnote w:id="${e.id}"${e.type ? ` w:type="${e.type}"` : ''}>${e.content}</w:endnote>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:endnotes ${NS}>${body}</w:endnotes>`
  );
}

const DOC_WITH_FOOTNOTE_REF = buildDoc(
  `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
);

const DOC_WITH_OPEN_FIELD_AND_FOOTNOTE_REF = buildDoc(
  `<w:p>` +
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
    `<w:r><w:footnoteReference w:id="1"/></w:r>` +
    `</w:p>`,
);

describe('validateFieldStructure: per-story (issue #212)', () => {
  test(
    'balanced field inside a footnote entry is valid',
    async ({ given, when, then }: AllureBddContext) => {
      let stories: ReturnType<typeof splitStories> = [];
      let ok = false;

      await given('a footnote entry containing a complete NUMPAGES field', () => {
        const footnotesXml = buildFootnotes([
          { id: '1', content: `<w:p>${COMPLETE_FIELD}</w:p>` },
        ]);
        stories = splitStories(DOC_WITH_FOOTNOTE_REF, [footnotesXml], [null]);
      });
      await when('the multi-story input is validated', () => {
        ok = validateFieldStructure(stories);
      });
      await then('it passes', () => {
        expect(ok).toBe(true);
      });
    },
  );

  test(
    'field that opens in the main body and "ends" in a footnote is rejected',
    async ({ given, when, then, and }: AllureBddContext) => {
      let stories: ReturnType<typeof splitStories> = [];
      let ok = true;
      let globalCountsBalance = false;

      await given(
        'a body with an unclosed fldChar[begin] and a footnote whose only fldChar is an unbalanced end',
        () => {
          const footnotesXml = buildFootnotes([
            {
              id: '1',
              content:
                `<w:p>` +
                `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
                `<w:r><w:t>x</w:t></w:r>` +
                `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
                `</w:p>`,
            },
          ]);
          stories = splitStories(DOC_WITH_OPEN_FIELD_AND_FOOTNOTE_REF, [footnotesXml], [null]);
          const allXml = stories.map((s) => s.xml).join('');
          const begins = (allXml.match(/w:fldCharType="begin"/g) ?? []).length;
          const ends = (allXml.match(/w:fldCharType="end"/g) ?? []).length;
          globalCountsBalance = begins === ends;
        },
      );
      await and('global fldChar begin/end counts across all stories happen to balance', () => {
        expect(globalCountsBalance).toBe(true);
      });
      await when('the multi-story input is validated', () => {
        ok = validateFieldStructure(stories);
      });
      await then('it is rejected — the unbalanced body story trips the per-story check', () => {
        expect(ok).toBe(false);
      });
    },
  );

  test(
    'a footnote with an unclosed field is rejected',
    async ({ given, when, then }: AllureBddContext) => {
      let stories: ReturnType<typeof splitStories> = [];
      let ok = true;

      await given('a body without fields and a footnote whose field begin has no matching end', () => {
        const footnotesXml = buildFootnotes([
          {
            id: '1',
            content:
              `<w:p>` +
              `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
              `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
              `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
              `<w:r><w:t>3</w:t></w:r>` +
              `</w:p>`,
          },
        ]);
        stories = splitStories(DOC_WITH_FOOTNOTE_REF, [footnotesXml], [null]);
      });
      await when('the multi-story input is validated', () => {
        ok = validateFieldStructure(stories);
      });
      await then('it is rejected', () => {
        expect(ok).toBe(false);
      });
    },
  );

  test(
    'separator footnote entries with no field content pass',
    async ({ given, when, then }: AllureBddContext) => {
      let stories: ReturnType<typeof splitStories> = [];
      let ok = false;

      await given('a footnotes sidecar containing only the standard separator entries', () => {
        const footnotesXml = buildFootnotes([
          { id: '-1', type: 'separator', content: `<w:p><w:r><w:separator/></w:r></w:p>` },
          {
            id: '0',
            type: 'continuationSeparator',
            content: `<w:p><w:r><w:continuationSeparator/></w:r></w:p>`,
          },
        ]);
        stories = splitStories(
          buildDoc(`<w:p><w:r><w:t>hi</w:t></w:r></w:p>`),
          [footnotesXml],
          [null],
        );
      });
      await when('the multi-story input is validated', () => {
        ok = validateFieldStructure(stories);
      });
      await then('it passes', () => {
        expect(ok).toBe(true);
      });
    },
  );

  test(
    'a balanced field inside an endnote entry is valid',
    async ({ given, when, then }: AllureBddContext) => {
      let stories: ReturnType<typeof splitStories> = [];
      let ok = false;

      await given('an endnotes sidecar with one entry containing a complete field', () => {
        const endnotesXml = buildEndnotes([
          { id: '1', content: `<w:p>${COMPLETE_FIELD}</w:p>` },
        ]);
        stories = splitStories(
          buildDoc(`<w:p><w:r><w:endnoteReference w:id="1"/></w:r></w:p>`),
          [null],
          [endnotesXml],
        );
      });
      await when('the multi-story input is validated', () => {
        ok = validateFieldStructure(stories);
      });
      await then('it passes', () => {
        expect(ok).toBe(true);
      });
    },
  );

  test(
    'missing footnote/endnote sidecars yield a single document story',
    async ({ given, when, then, and }: AllureBddContext) => {
      let stories: ReturnType<typeof splitStories> = [];

      await given('a document with no footnote or endnote sidecars', () => {
        stories = splitStories(buildDoc(`<w:p><w:r><w:t>hi</w:t></w:r></w:p>`), [null], [null]);
      });
      await when('split into stories', () => {
        // no-op; splitStories already ran
      });
      await then('only the document story is emitted', () => {
        expect(stories).toHaveLength(1);
        expect(stories[0]?.label).toBe('document');
      });
      await and('validation still succeeds via the array path', () => {
        expect(validateFieldStructure(stories)).toBe(true);
      });
    },
  );
});

// Targeted #217 combined-output gate. See `pipeline.ts` `hasFldCharInsideDel`.
describe('hasFldCharInsideDel (issue #217 combined-output gate)', () => {
  test(
    'returns true when w:fldChar appears inside w:del',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let result = false;

      await given('a document with the canonical non-conformant pattern', () => {
        xml = buildDoc(
          `<w:p><w:del><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:del></w:p>`,
        );
      });
      await when('the targeted gate runs', () => {
        result = hasFldCharInsideDel(xml);
      });
      await then('the violation is reported', () => {
        expect(result).toBe(true);
      });
    },
  );

  test(
    'returns false on the fragmented modification fixture',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let result = false;

      await given('the canonical MODIFIED_FIELD_FRAGMENTED layout', () => {
        xml = buildDoc(`<w:p>${MODIFIED_FIELD_FRAGMENTED}</w:p>`);
      });
      await when('the targeted gate runs', () => {
        result = hasFldCharInsideDel(xml);
      });
      await then('no violation is reported', () => {
        expect(result).toBe(false);
      });
    },
  );

  test(
    'returns false when w:fldChar appears inside w:ins (insertion of a complete field is conformant)',
    async ({ given, when, then }: AllureBddContext) => {
      let xml = '';
      let result = false;

      await given('an insertion wrapping a complete NUMPAGES field', () => {
        xml = buildDoc(`<w:p><w:ins>${COMPLETE_FIELD}</w:ins></w:p>`);
      });
      await when('the targeted gate runs', () => {
        result = hasFldCharInsideDel(xml);
      });
      await then('no violation is reported', () => {
        expect(result).toBe(false);
      });
    },
  );
});
