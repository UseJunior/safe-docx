import { describe, expect } from 'vitest';
import { OOXML, parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { extractRoundTripComparisonText } from './fieldComparisonSemantics.js';
import {
  compareTexts,
  extractTextWithParagraphs,
} from './baselines/atomizer/trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Symbol Character Projection' });

const symbolConformance = { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.30' } as const;

/** The private-use codepoint a Wingdings ballot box occupies. */
const BALLOT_BOX = '\uF0A8';
/** A different Wingdings glyph, used as a discriminating control. */
const CHECKED_BOX = '\uF0FE';

const WINGDINGS_RPR = '<w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr>';

function documentXml(body: string): string {
  return (
    `<w:document xmlns:w="${OOXML.W_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`
  );
}

/** `Alpha <glyph> Bravo`, with the glyph spelled as `w:sym`. */
function withSym(char = 'F0A8', font = 'Wingdings'): string {
  return documentXml(
    '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r>'
      + `<w:r>${WINGDINGS_RPR}<w:sym w:font="${font}" w:char="${char}"/></w:r>`
      + '<w:r><w:t xml:space="preserve"> Bravo</w:t></w:r></w:p>',
  );
}

/** The same glyph, spelled as a literal private-use character inside `w:t`. */
function withLiteralCodepoint(char = BALLOT_BOX): string {
  return documentXml(
    '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r>'
      + `<w:r>${WINGDINGS_RPR}<w:t>${char}</w:t></w:r>`
      + '<w:r><w:t xml:space="preserve"> Bravo</w:t></w:r></w:p>',
  );
}

/** The same paragraph with the glyph gone: the loss the gate has to catch. */
function withGlyphLost(): string {
  return documentXml(
    '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r>'
      + '<w:r><w:t xml:space="preserve"> Bravo</w:t></w:r></w:p>',
  );
}

/**
 * The projection as it stood before this regression existed: `w:t` and
 * `w:delText` character data only. Kept in the test rather than in the library
 * so the assertions below can show *why* the shipped projection had to widen,
 * instead of merely asserting that it did.
 */
function legacyTextOnlyProjection(xml: string): string {
  const document = parseXml(xml);
  const paragraphs = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'p'));
  return paragraphs
    .map((paragraph) => {
      const parts: string[] = [];
      for (const localName of ['t', 'delText']) {
        const nodes = paragraph.getElementsByTagNameNS(OOXML.W_NS, localName);
        for (let index = 0; index < nodes.length; index += 1) {
          parts.push(nodes.item(index)?.textContent ?? '');
        }
      }
      return parts.join('');
    })
    .join('\n');
}

describe('round-trip comparison projection of w:sym', () => {
  test.conformance(symbolConformance)(
    'a lost symbol glyph now fails the round-trip text comparison the safety gate runs',
    async ({ given, when, then }: AllureBddContext) => {
      let kept!: string;
      let lost!: string;
      let gate!: ReturnType<typeof compareTexts>;
      let unchangedGate!: ReturnType<typeof compareTexts>;
      let legacyKept!: string;
      let legacyLost!: string;

      await given(
        'one paragraph carrying a Wingdings glyph as w:sym, and the same paragraph with the glyph dropped',
        async () => {},
      );
      await when('both are projected and compared the way evaluateSafetyChecks compares them', async () => {
        kept = extractRoundTripComparisonText(withSym());
        lost = extractRoundTripComparisonText(withGlyphLost());
        gate = compareTexts(kept, lost);
        // Control in the opposite direction: the same comparison over a pair
        // that really is unchanged must still report a match, so a green run
        // above is a result and not a stuck assertion.
        unchangedGate = compareTexts(kept, extractRoundTripComparisonText(withSym()));
        legacyKept = legacyTextOnlyProjection(withSym());
        legacyLost = legacyTextOnlyProjection(withGlyphLost());
      });
      await then('the gate reports a difference, which the w:t-only projection could not', async () => {
        expect(gate.normalizedIdentical).toBe(false);
        expect(unchangedGate.normalizedIdentical).toBe(true);
        // Negative control: this is exactly what used to let the loss through.
        expect(legacyKept).toBe(legacyLost);
      });
    },
  );

  test.conformance(symbolConformance)(
    'the w:sym and literal-codepoint spellings of one glyph project identically',
    async ({ given, when, then }: AllureBddContext) => {
      let asSym!: string;
      let asLiteral!: string;
      let asOtherGlyph!: string;
      let legacyAsSym!: string;
      let legacyAsLiteral!: string;

      await given('the two legal spellings Word renders identically', async () => {});
      await when('both are projected, alongside a genuinely different glyph', async () => {
        asSym = extractRoundTripComparisonText(withSym());
        asLiteral = extractRoundTripComparisonText(withLiteralCodepoint());
        asOtherGlyph = extractRoundTripComparisonText(withLiteralCodepoint(CHECKED_BOX));
        legacyAsSym = legacyTextOnlyProjection(withSym());
        legacyAsLiteral = legacyTextOnlyProjection(withLiteralCodepoint());
      });
      await then('a re-spelling is not a difference, but a re-glyphing still is', async () => {
        expect(asSym).toBe(asLiteral);
        expect(asSym).toContain(BALLOT_BOX);
        expect(asOtherGlyph).not.toBe(asSym);
        // Negative control: the w:t-only projection reported the re-spelling
        // as a mass character loss.
        expect(legacyAsSym).not.toBe(legacyAsLiteral);
      });
    },
  );

  test.conformance(symbolConformance)(
    'w:sym/@w:font is deliberately outside the projected text identity',
    async ({ given, when, then }: AllureBddContext) => {
      let wingdings!: string;
      let symbolFont!: string;
      let differentChar!: string;

      await given('one w:char under two symbol fonts, and a second w:char', async () => {});
      await when('all three paragraphs are projected', async () => {
        wingdings = extractRoundTripComparisonText(withSym('F0A8', 'Wingdings'));
        symbolFont = extractRoundTripComparisonText(withSym('F0A8', 'Symbol'));
        differentChar = extractRoundTripComparisonText(withSym('F0FE', 'Wingdings'));
      });
      await then('the font does not separate them and the codepoint does', async () => {
        // Including the font would make the literal-codepoint spelling — which
        // carries its font on w:rFonts, not on the glyph — unequal to the
        // w:sym spelling by construction. Font drift is a formatting concern.
        expect(wingdings).toBe(symbolFont);
        expect(differentChar).not.toBe(wingdings);
      });
    },
  );

  test.conformance(symbolConformance)(
    'a symbol inside a suppressed TOC page-number cache stays suppressed',
    async ({ given, when, then }: AllureBddContext) => {
      let projected!: string;
      let plainParagraph!: string;

      await given('a TOC PAGEREF whose cached result contains a w:sym', async () => {});
      await when('the paragraph is projected', async () => {
        projected = extractRoundTripComparisonText(
          documentXml(
            '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>'
              + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
              + '<w:r><w:instrText xml:space="preserve"> PAGEREF _Toc1 \\h </w:instrText></w:r>'
              + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
              + '<w:r><w:sym w:font="Wingdings" w:char="F0A8"/><w:t>19</w:t></w:r>'
              + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
          ),
        );
        plainParagraph = extractRoundTripComparisonText(withSym());
      });
      await then('the pagination cache is replaced wholesale, glyph included', async () => {
        expect(projected).toBe('__safe_docx_pageref__|PAGEREF _Toc1 \\h');
        expect(projected).not.toContain(BALLOT_BOX);
        // Control: outside a suppressed cache the same glyph does project.
        expect(plainParagraph).toContain(BALLOT_BOX);
      });
    },
  );

  test.conformance(symbolConformance)(
    'extractTextWithParagraphs closes the same hole without moving w:t-only output',
    async ({ given, when, then }: AllureBddContext) => {
      let kept!: string;
      let lost!: string;
      let asLiteral!: string;
      let symFreeBefore!: string;

      await given('the exported paragraph-text projection used by the benchmark gates', async () => {});
      await when('it is run over the symbol pair and over a symbol-free control', async () => {
        kept = extractTextWithParagraphs(withSym());
        lost = extractTextWithParagraphs(withGlyphLost());
        asLiteral = extractTextWithParagraphs(withLiteralCodepoint());
        symFreeBefore = extractTextWithParagraphs(
          documentXml(
            '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r>'
              + '<w:del w:id="1" w:author="a" w:date="2026-01-01T00:00:00Z">'
              + '<w:r><w:delText>Charlie</w:delText></w:r></w:del>'
              + '<w:r><w:t xml:space="preserve"> Bravo</w:t></w:r></w:p>',
          ),
        );
      });
      await then('the glyph is visible, the spellings agree, and mixed-revision output is unchanged', async () => {
        expect(kept).not.toBe(lost);
        expect(kept).toBe(asLiteral);
        // Control: this projection's long-standing "live text first, then
        // deleted text" grouping is untouched for documents without w:sym.
        expect(symFreeBefore).toBe('Alpha  BravoCharlie');
      });
    },
  );
});
