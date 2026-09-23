import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { OOXML } from './namespaces.js';
import { extractEffectiveRunFormatting, parseStylesXml, type RunFormatting } from './styles.js';
import { parseXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Effective Run Formatting',
});

function extract(stylesInner: string, runProperties = ''): RunFormatting {
  const stylesDocument = parseXml(
    `<w:styles xmlns:w="${OOXML.W_NS}">${stylesInner}</w:styles>`,
  );
  const document = parseXml(
    `<w:document xmlns:w="${OOXML.W_NS}"><w:body><w:p><w:r>` +
      `<w:rPr>${runProperties}</w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
  );
  return extractEffectiveRunFormatting({
    run: document.getElementsByTagNameNS(OOXML.W_NS, 'r').item(0)!,
    paragraphPPr: null,
    paragraphStyleId: null,
    styles: parseStylesXml(stylesDocument),
  });
}

describe('unresolved effective run formatting', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.5.1' })(
      'docDefaults-only declarations remain explicitly unresolved',
      async ({ given, when, then }: AllureBddContext) => {
        let formatting!: RunFormatting;

        await given('a font declared only in the document-default run properties', async () => {});
        await when('effective formatting is extracted without consulting docDefaults', async () => {
          formatting = extract(
            '<w:docDefaults><w:rPrDefault><w:rPr>' +
              '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>' +
              '<w:b/><w:color w:val="112233"/>' +
            '</w:rPr></w:rPrDefault></w:docDefaults>',
          );
        });
        await then('the result reports unresolved values instead of neutral-looking sentinels', async () => {
          expect(formatting.fontName).toBeNull();
          expect(formatting.bold).toBeNull();
          expect(formatting.colorHex).toBeNull();
          expect(formatting.fontSizePt).toBeNull();
        });
      },
    );

  test('explicit off and automatic values remain distinct from unresolved', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let formatting!: RunFormatting;

    await given('direct run properties that explicitly select rendered defaults', async () => {});
    await when('effective formatting is extracted', async () => {
      formatting = extract(
        '',
        '<w:b w:val="0"/><w:u w:val="none"/><w:highlight w:val="none"/><w:color w:val="auto"/>',
      );
    });
    await then('known defaults do not use the unresolved marker', async () => {
      expect(formatting.bold).toBe(false);
      expect(formatting.underline).toBe(false);
      expect(formatting.highlightVal).toBe(false);
      expect(formatting.colorHex).toBe('auto');
    });
  });
});
