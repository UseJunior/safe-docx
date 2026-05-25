/**
 * Integration Tests — Cross-story field-closure check at the pipeline level (#212)
 *
 * Verifies that `compareDocumentsAtomizer`'s round-trip safety evaluation
 * runs `validateFieldStructure` per ECMA-376 story (document body + each
 * footnote/endnote entry) using sidecars from BOTH archives. A cross-story
 * unbalanced field — one whose `fldChar begin`/`end` markers straddle the
 * body and a footnote — must be detected even when global fldChar counts
 * across all stories balance.
 */

import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Cross-story Field Closure (#212)' });

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS14 = 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';

interface DocxParts {
  bodyXml: string;
  footnotesXml: string | null;
}

async function buildDocxWithFootnotes(parts: DocxParts): Promise<Buffer> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ${NS} ${NS14}>` +
    `<w:body>${parts.bodyXml}<w:sectPr/></w:body></w:document>`;

  const contentTypeOverrides = [
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
  ];
  const docRelEntries: string[] = [];

  const zip = new JSZip();
  if (parts.footnotesXml) {
    zip.file('word/footnotes.xml', parts.footnotesXml);
    contentTypeOverrides.push(
      `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>`,
    );
    docRelEntries.push(
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>`,
    );
  }

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    contentTypeOverrides.join('') +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    docRelEntries.join('') +
    `</Relationships>`;

  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);

  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

const BODY_WITH_FOOTNOTE_REF = (text: string): string =>
  `<w:p>` +
  `<w:r><w:t xml:space="preserve">${text} </w:t></w:r>` +
  `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>` +
  `</w:p>`;

const VALID_FOOTNOTES = (footnoteContent: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:footnotes ${NS}>` +
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1">${footnoteContent}</w:footnote>` +
  `</w:footnotes>`;

const PLAIN_FOOTNOTE_BODY = `<w:p><w:r><w:t>see source</w:t></w:r></w:p>`;

// Field begin with no matching end inside the footnote story. Note: with no
// field characters in the body, global counts across all stories are 1:0 —
// this case would also be caught by the legacy global-balance check. Useful
// for verifying the sidecar plumbing works end-to-end.
const UNCLOSED_FIELD_FOOTNOTE_BODY =
  `<w:p>` +
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:t>3</w:t></w:r>` +
  `</w:p>`;

// Body opens a field (begin + instrText) but never closes it. The footnote
// has a stray separate + end with no matching begin. GLOBAL counts:
// 1 begin / 1 end → balanced. PER-STORY counts: body 1:0, footnote 0:1 →
// both unbalanced. Only a per-story partitioning check catches this; the
// legacy global counter would have passed it. This is the fixture that
// actually proves the per-story refactor is doing the work.
const BODY_WITH_OPEN_FIELD_AND_FOOTNOTE_REF = (text: string): string =>
  `<w:p>` +
  `<w:r><w:t xml:space="preserve">${text} </w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
  `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>` +
  `</w:p>`;

const END_ONLY_FIELD_FOOTNOTE_BODY =
  `<w:p>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:t>3</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
  `</w:p>`;

describe('Cross-story field-closure check (issue #212) — pipeline-level', () => {
  test(
    'inplace comparison with a malformed field inside a footnote falls back to rebuild via fieldStructure failure',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      let original: Buffer = Buffer.alloc(0);
      let revised: Buffer = Buffer.alloc(0);
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given(
        'original/revised pair whose footnotes sidecar contains a fldChar begin with no matching end',
        async () => {
          const malformedFootnotes = VALID_FOOTNOTES(UNCLOSED_FIELD_FOOTNOTE_BODY);
          original = await buildDocxWithFootnotes({
            bodyXml: BODY_WITH_FOOTNOTE_REF('Hello'),
            footnotesXml: malformedFootnotes,
          });
          revised = await buildDocxWithFootnotes({
            bodyXml: BODY_WITH_FOOTNOTE_REF('Hello world'),
            footnotesXml: malformedFootnotes,
          });
        },
      );

      await when('compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
        await attachPrettyJson('comparison-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          fallbackReason: result.fallbackReason,
          fallbackDiagnostics: result.fallbackDiagnostics,
        });
      });

      await then('every inplace attempt records fieldStructure as failed', () => {
        const attempts = result.fallbackDiagnostics?.attempts ?? [];
        expect(attempts.length, 'at least one inplace attempt should be diagnosed').toBeGreaterThan(0);
        for (const attempt of attempts) {
          const failed = attempt.failedChecks ?? [];
          expect(
            failed.includes('fieldStructure'),
            `attempt ${attempt.pass} should report fieldStructure failure but failed=${JSON.stringify(failed)}`,
          ).toBe(true);
        }
      });

      await and('the pipeline falls back to rebuild output', () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        expect(result.fallbackReason).toBe('round_trip_safety_check_failed');
      });
    },
  );

  test(
    'globally-balanced but per-story-unbalanced field across body and footnote is rejected',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      let original: Buffer = Buffer.alloc(0);
      let revised: Buffer = Buffer.alloc(0);
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given(
        'a docx whose body opens a field that never closes and ONE archive has a footnote with a stray end',
        async () => {
          // The safety check validates sidecars from BOTH original and revised
          // archives. Putting the malformed footnote in only ONE archive
          // ensures the safety stream contains exactly one stray `end`. The
          // OTHER archive has a well-formed footnote at the same w:id so the
          // body's footnoteReference resolves and the comparison runs normally.
          //
          // Global safety-stream counts (across body + both archives' sidecar
          // entries): 1 begin (body) + 1 end (original footnote, stray) +
          // 0 (revised footnote, well-formed) = 1:1 — BALANCED. The legacy
          // global counter would accept this. Per-story counts: body 1:0,
          // original footnote 0:1, revised footnote 0:0 — only the per-story
          // partitioning catches the cross-story imbalance.
          const malformedFootnotes = VALID_FOOTNOTES(END_ONLY_FIELD_FOOTNOTE_BODY);
          const cleanFootnotes = VALID_FOOTNOTES(PLAIN_FOOTNOTE_BODY);
          original = await buildDocxWithFootnotes({
            bodyXml: BODY_WITH_OPEN_FIELD_AND_FOOTNOTE_REF('Hello'),
            footnotesXml: malformedFootnotes,
          });
          revised = await buildDocxWithFootnotes({
            bodyXml: BODY_WITH_OPEN_FIELD_AND_FOOTNOTE_REF('Hello world'),
            footnotesXml: cleanFootnotes,
          });
        },
      );

      await when('compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
        await attachPrettyJson('comparison-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          fallbackReason: result.fallbackReason,
          fallbackDiagnostics: result.fallbackDiagnostics,
        });
      });

      await then('every inplace attempt records fieldStructure as failed', () => {
        const attempts = result.fallbackDiagnostics?.attempts ?? [];
        expect(attempts.length, 'at least one inplace attempt should be diagnosed').toBeGreaterThan(0);
        for (const attempt of attempts) {
          const failed = attempt.failedChecks ?? [];
          expect(
            failed.includes('fieldStructure'),
            `attempt ${attempt.pass} should report fieldStructure failure but failed=${JSON.stringify(failed)}`,
          ).toBe(true);
        }
      });

      await and('the pipeline falls back to rebuild output', () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        expect(result.fallbackReason).toBe('round_trip_safety_check_failed');
      });
    },
  );

  test(
    'inplace comparison with valid footnote fields succeeds without a safety fallback',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let original: Buffer = Buffer.alloc(0);
      let revised: Buffer = Buffer.alloc(0);
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('original/revised pair whose footnote is a plain non-field paragraph', async () => {
        const footnotesXml = VALID_FOOTNOTES(PLAIN_FOOTNOTE_BODY);
        original = await buildDocxWithFootnotes({
          bodyXml: BODY_WITH_FOOTNOTE_REF('Hello'),
          footnotesXml,
        });
        revised = await buildDocxWithFootnotes({
          bodyXml: BODY_WITH_FOOTNOTE_REF('Hello world'),
          footnotesXml,
        });
      });

      await when('compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
        await attachPrettyJson('comparison-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          fallbackReason: result.fallbackReason,
        });
      });

      await then('no field-structure failure is recorded and inplace output is used', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.fallbackReason).toBeUndefined();
        const attempts = result.fallbackDiagnostics?.attempts ?? [];
        for (const attempt of attempts) {
          const failed = attempt.failedChecks ?? [];
          expect(failed.includes('fieldStructure')).toBe(false);
        }
      });
    },
  );
});
