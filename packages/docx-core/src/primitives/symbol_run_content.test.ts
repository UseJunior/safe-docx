import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { OOXML } from './namespaces.js';
import { projectSymbolRun } from './symbol_run_content.js';
import { parseXml } from './xml.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Symbol Character Projection' });

function firstChildOfRun(runChildXml: string): Element {
  const document = parseXml(
    `<w:document xmlns:w="${OOXML.W_NS}"><w:body><w:p><w:r>${runChildXml}</w:r></w:p></w:body></w:document>`,
  );
  const run = document.getElementsByTagNameNS(OOXML.W_NS, 'r').item(0)!;
  for (let child = run.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) return child as Element;
  }
  throw new Error('run has no element child');
}

describe('w:sym character resolution', () => {
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.30' })(
    'resolves w:char to its codepoint and leaves other run content alone',
    async ({ given, when, then }: AllureBddContext) => {
      let symbol: string | undefined;
      let text: string | undefined;
      await given('a Wingdings checkbox spelled as w:sym and an ordinary w:t', async () => {});
      await when('each run child is offered to the resolver', async () => {
        symbol = projectSymbolRun(
          firstChildOfRun('<w:sym w:font="Wingdings" w:char="F0A8"/>'),
        );
        text = projectSymbolRun(firstChildOfRun('<w:t>Alpha</w:t>'));
      });
      await then('only the symbol resolves, and it resolves to U+F0A8', async () => {
        expect(symbol).toBe('\uF0A8');
        expect(text).toBeUndefined();
      });
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.30' })(
    'keeps w:font out of the resolved value',
    async ({ given, when, then }: AllureBddContext) => {
      let wingdings: string | undefined;
      let symbolFont: string | undefined;
      let otherChar: string | undefined;
      await given('one w:char under two different symbol fonts, and a second w:char', async () => {});
      await when('all three are resolved', async () => {
        wingdings = projectSymbolRun(
          firstChildOfRun('<w:sym w:font="Wingdings" w:char="F0A8"/>'),
        );
        symbolFont = projectSymbolRun(
          firstChildOfRun('<w:sym w:font="Symbol" w:char="F0A8"/>'),
        );
        otherChar = projectSymbolRun(
          firstChildOfRun('<w:sym w:font="Wingdings" w:char="F0FE"/>'),
        );
      });
      await then('the font does not separate them but the codepoint does', async () => {
        // Deliberate: these are text projections, which exclude w:rFonts too.
        // Folding the font in would make the w:sym and literal-codepoint
        // spellings of one glyph unequal by construction.
        expect(wingdings).toBe(symbolFont);
        // Discriminating control: resolution is not returning a constant.
        expect(otherChar).not.toBe(wingdings);
      });
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.30' })(
    'projects an unresolved identity when w:char is outside ST_ShortHexNumber',
    async ({ given, when, then }: AllureBddContext) => {
      let resolved: Array<string | undefined> = [];
      let unresolved: Array<string | undefined> = [];
      await given(
        'w:char values inside and outside the four-hex-digit lexical space, and an absent w:char',
        async () => {},
      );
      await when('each is projected', async () => {
        resolved = ['F0A8', '0041', 'f0a8'].map((value) =>
          projectSymbolRun(firstChildOfRun(`<w:sym w:font="Wingdings" w:char="${value}"/>`)),
        );
        unresolved = ['A', 'AB', 'ABC', 'ABCDE', 'not-hex', ''].map((value) =>
          projectSymbolRun(firstChildOfRun(`<w:sym w:font="Wingdings" w:char="${value}"/>`)),
        );
        unresolved.push(projectSymbolRun(firstChildOfRun('<w:sym w:font="Wingdings"/>')));
      });
      await then(
        'only exactly four hex digits resolve, and the rest project a framed identity',
        async () => {
          // ST_ShortHexNumber is xsd:hexBinary length="2" -- four hex digits,
          // no more and no fewer. A short value is not a character.
          expect(resolved).toEqual(['\uF0A8', 'A', '\uF0A8']);
          expect(new Set(unresolved)).toEqual(new Set(['__safe_docx_sym__|unresolved']));
        },
      );
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.30' })(
    'the unresolved identity cannot be authored as ordinary text',
    async ({ given, when, then }: AllureBddContext) => {
      let unresolved: string | undefined;
      let replacementCharacter: string | undefined;
      await given('a w:sym with no w:char, and a w:sym carrying U+FFFD as its glyph', async () => {});
      await when('both are projected', async () => {
        unresolved = projectSymbolRun(firstChildOfRun('<w:sym w:font="Wingdings"/>'));
        replacementCharacter = projectSymbolRun(
          firstChildOfRun('<w:sym w:font="Wingdings" w:char="FFFD"/>'),
        );
      });
      await then('an unresolvable symbol is not equal to a document that authored U+FFFD', async () => {
        // U+FFFD was the obvious sentinel and is wrong: a document may author
        // it literally, and the two would then compare equal.
        expect(replacementCharacter).toBe('\uFFFD');
        expect(unresolved).not.toBe(replacementCharacter);
      });
    },
  );
});
