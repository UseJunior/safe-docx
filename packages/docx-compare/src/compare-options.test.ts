import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { compareDocuments, type CompareOptions } from './index.js';
import { acceptAllChanges, rejectAllChanges } from './baselines/atomizer/trackChangesAcceptorAst.js';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import {
  buildDocxFromBodyXml,
  paragraphWithText,
} from './testing/ooxml-fixtures.js';

const TEST_FEATURE = 'Comparison Options';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });
const formatTest = test.conformance({
  spec: 'ECMA-376',
  edition: 5,
  part: 1,
  section: '17.13.5.31',
});
const moveTest = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.22' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.25' });

const FIXED_DATE = new Date('2026-07-24T12:00:00Z');
const REAL_FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tests/test_documents/open-agreements',
);
const MOVED_PARAGRAPH = 'The quick brown fox jumps over the lazy dog today';

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

describe('compareDocuments options', () => {
  formatTest(
    'ignoreFormatting controls run-property revision detection',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await given('an italic run and a revised bold run with identical text', () =>
        buildDocxFromBodyXml(
          '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Same text</w:t></w:r></w:p>',
        ),
      );
      const revised = await given('the revised document applies bold formatting', () =>
        buildDocxFromBodyXml(
          '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Same text</w:t></w:r></w:p>',
        ),
      );

      const detected = await when('formatting comparison is explicitly enabled', () =>
        compareDocuments(original, revised, {
          date: FIXED_DATE,
          ignoreFormatting: false,
        }),
      );
      const ignored = await when('formatting differences are ignored', () =>
        compareDocuments(original, revised, {
          date: FIXED_DATE,
          ignoreFormatting: true,
        }),
      );

      await then('enabled formatting comparison emits a run-property revision', async () => {
        expect(await documentXml(detected.document)).toContain('<w:rPrChange');
      });
      await and('ignored formatting emits no run-property revision', async () => {
        expect(await documentXml(ignored.document)).not.toContain('<w:rPrChange');
      });
    },
  );

  moveTest(
    'detectMoves prevents matching deleted and inserted content from becoming moves',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await given('a paragraph that moves from first to last position', () =>
        buildDocxFromBodyXml(
          paragraphWithText(MOVED_PARAGRAPH) +
            paragraphWithText('Middle paragraph stays put') +
            paragraphWithText('Final paragraph also stays'),
        ),
      );
      const revised = await given('the same paragraph in its revised final position', () =>
        buildDocxFromBodyXml(
          paragraphWithText('Middle paragraph stays put') +
            paragraphWithText('Final paragraph also stays') +
            paragraphWithText(MOVED_PARAGRAPH),
        ),
      );

      const compared = await when('move comparison is explicitly enabled', () =>
        compareDocuments(original, revised, {
          date: FIXED_DATE,
          detectMoves: true,
        }),
      );
      const disabled = await when('move comparison is disabled', () =>
        compareDocuments(original, revised, {
          date: FIXED_DATE,
          detectMoves: false,
        }),
      );
      const comparedXml = await documentXml(compared.document);
      const disabledXml = await documentXml(disabled.document);

      await then('enabled move comparison emits move revisions', () => {
        expect(comparedXml).toContain('<w:moveFrom');
        expect(comparedXml).toContain('<w:moveTo');
      });
      await and('disabled move comparison retains deletion and insertion revisions', () => {
        expect(disabledXml).not.toContain('<w:moveFrom');
        expect(disabledXml).not.toContain('<w:moveTo');
        expect(disabledXml).toContain('<w:del');
        expect(disabledXml).toContain('<w:ins');
      });
    },
  );

  test(
    'omitting the options is equivalent to passing the documented defaults (same document.xml)',
    async ({ given, when, then }: AllureBddContext) => {
      // Assert on document.xml, NOT the full .docx bytes: the ZIP container is not
      // byte-deterministic across independent serializations (entry order / metadata),
      // so a raw Buffer.compare of two packages is flaky even for identical content.
      const fixture = await given('the checked-in Bonterms mutual NDA fixture', () =>
        readFile(join(REAL_FIXTURES_DIR, 'bonterms-mutual-nda.docx')),
      );

      const omitted = await when('the fixture is compared with both options omitted', () =>
        compareDocuments(fixture, fixture, {
          date: FIXED_DATE,
        }),
      );
      const explicitDefaults = await when('the fixture is compared with current defaults explicit', () =>
        compareDocuments(fixture, fixture, {
          date: FIXED_DATE,
          ignoreFormatting: false,
          detectMoves: true,
        }),
      );

      await then('the reconstructed document.xml is identical', async () => {
        expect(await documentXml(omitted.document)).toBe(await documentXml(explicitDefaults.document));
      });
    },
    10_000,
  );

  test(
    'omitted options apply the documented defaults on a differing pair (format detection on, move detection on)',
    async ({ given, when, then, and }: AllureBddContext) => {
      // A self-compare cannot prove the default *values* (no diff exists to act on).
      // Compare a pair with BOTH a formatting change and a moved paragraph, with the
      // options OMITTED, and assert the output carries the markup those defaults produce.
      const original = await given('an italic paragraph plus a paragraph that will move to the end', () =>
        buildDocxFromBodyXml(
          '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Formatting sample</w:t></w:r></w:p>' +
            paragraphWithText(MOVED_PARAGRAPH) +
            paragraphWithText('Static middle paragraph'),
        ),
      );
      const revised = await given('the same text bolded, with the movable paragraph relocated last', () =>
        buildDocxFromBodyXml(
          '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Formatting sample</w:t></w:r></w:p>' +
            paragraphWithText('Static middle paragraph') +
            paragraphWithText(MOVED_PARAGRAPH),
        ),
      );

      const omitted = await when('the pair is compared with both options omitted', () =>
        compareDocuments(original, revised, {
          date: FIXED_DATE,
        }),
      );
      const omittedXml = await documentXml(omitted.document);

      await then('the default (omitted) output detects the formatting change', () => {
        expect(omittedXml).toContain('<w:rPrChange');
      });
      await and('the default (omitted) output detects the move', () => {
        expect(omittedXml).toContain('<w:moveFrom');
        expect(omittedXml).toContain('<w:moveTo');
      });
    },
  );

  test.openspec('Public comparison uses revised-based tagged publication')(
    'publishes source-exact projections through the sole revised-based package pipeline',
    async ({ given, when, then }: AllureBddContext) => {
      const original = await given('a package with original paragraph formatting', () =>
        buildDocxFromBodyXml('<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Original package text</w:t></w:r></w:p>'));
      const revised = await given('the revised package and formatting', () =>
        buildDocxFromBodyXml('<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Revised package text</w:t></w:r></w:p>'));
      const result = await when('the pair is compared without a private override', () =>
        compareDocuments(original, revised, { date: FIXED_DATE }));
      const output = await documentXml(result.document);
      await then('the package carries both exact text projections', async () => {
        expect(parseXml(acceptAllChanges(output)).documentElement.textContent).toContain('Revised package text');
        expect(parseXml(rejectAllChanges(output)).documentElement.textContent).toContain('Original package text');
      });
    },
  );

  test.openspec('Public legacy rollback is absent')(
    'rejects every retired public comparison selector instead of ignoring it',
    async ({ given, when, then }: AllureBddContext) => {
      const original = await given('an original one-paragraph document', () =>
        buildDocxFromBodyXml(paragraphWithText('Original library-default text')),
      );
      const revised = await given('a revised one-paragraph document', () =>
        buildDocxFromBodyXml(paragraphWithText('Revised library-default text')),
      );

      const removedOptions = await when('each removed selector is supplied by a JavaScript caller', () => [
        { reconstructionMode: 'rebuild' },
        { comparisonStrategy: 'legacy' },
        { engine: 'atomizer' },
        { premergeRuns: false },
        { maxWordRefinementChangeRanges: 2 },
      ] as const);

      await then('every retired selector is rejected as unsupported', async () => {
        for (const removed of removedOptions) {
          await expect(compareDocuments(
            original,
            revised,
            removed as unknown as CompareOptions,
          )).rejects.toThrow(`Unsupported comparison option: ${Object.keys(removed)[0]}`);
        }
      });
    },
  );
});
