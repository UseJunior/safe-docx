import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxArchive } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { compareDocuments } from './index.js';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import {
  buildDocxFromBodyXml,
  paragraphWithText,
} from './testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Comparison Options' });
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
          engine: 'atomizer',
          date: FIXED_DATE,
          ignoreFormatting: false,
        }),
      );
      const ignored = await when('formatting differences are ignored', () =>
        compareDocuments(original, revised, {
          engine: 'atomizer',
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
          engine: 'atomizer',
          date: FIXED_DATE,
          detectMoves: true,
        }),
      );
      const disabled = await when('move comparison is disabled', () =>
        compareDocuments(original, revised, {
          engine: 'atomizer',
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
          engine: 'atomizer',
          date: FIXED_DATE,
        }),
      );
      const explicitDefaults = await when('the fixture is compared with current defaults explicit', () =>
        compareDocuments(fixture, fixture, {
          engine: 'atomizer',
          date: FIXED_DATE,
          ignoreFormatting: false,
          detectMoves: true,
        }),
      );

      await then('the reconstructed document.xml is identical', async () => {
        expect(await documentXml(omitted.document)).toBe(await documentXml(explicitDefaults.document));
      });
    },
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
          engine: 'atomizer',
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
});
