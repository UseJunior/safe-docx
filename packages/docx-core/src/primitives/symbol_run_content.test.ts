import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { OOXML } from './namespaces.js';
import { symbolRunCharacter } from './symbol_run_content.js';
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
        symbol = symbolRunCharacter(
          firstChildOfRun('<w:sym w:font="Wingdings" w:char="F0A8"/>'),
        );
        text = symbolRunCharacter(firstChildOfRun('<w:t>Alpha</w:t>'));
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
        wingdings = symbolRunCharacter(
          firstChildOfRun('<w:sym w:font="Wingdings" w:char="F0A8"/>'),
        );
        symbolFont = symbolRunCharacter(
          firstChildOfRun('<w:sym w:font="Symbol" w:char="F0A8"/>'),
        );
        otherChar = symbolRunCharacter(
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
    'still reports content for a w:sym whose w:char is missing or malformed',
    async ({ given, when, then }: AllureBddContext) => {
      let missing: string | undefined;
      let malformed: string | undefined;
      await given('two schema-invalid w:sym elements', async () => {});
      await when('both are resolved', async () => {
        missing = symbolRunCharacter(firstChildOfRun('<w:sym w:font="Wingdings"/>'));
        malformed = symbolRunCharacter(
          firstChildOfRun('<w:sym w:font="Wingdings" w:char="not-hex"/>'),
        );
      });
      await then('each still projects a character, so its loss stays visible', async () => {
        expect(missing).toBe('\uFFFD');
        expect(malformed).toBe('\uFFFD');
      });
    },
  );
});
