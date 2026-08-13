import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { OOXML } from './namespaces.js';
import { extractEffectiveRunFormatting, parseStylesXml, type RunFormatting } from './styles.js';
import { parseXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Effective Run Formatting' });

const TOGGLES = [
  ['bold', 'b'],
  ['italic', 'i'],
  ['caps', 'caps'],
  ['smallCaps', 'smallCaps'],
  ['strike', 'strike'],
  ['emboss', 'emboss'],
  ['imprint', 'imprint'],
  ['outline', 'outline'],
  ['shadow', 'shadow'],
  ['vanish', 'vanish'],
] as const satisfies ReadonlyArray<readonly [keyof RunFormatting, string]>;

function resolve(stylesInner: string, runRPr = ''): RunFormatting {
  const styles = parseXml(
    `<w:styles xmlns:w="${OOXML.W_NS}">${stylesInner}</w:styles>`,
  );
  const document = parseXml(
    `<w:document xmlns:w="${OOXML.W_NS}"><w:body><w:p><w:r>` +
      `<w:rPr>${runRPr}</w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
  );
  return extractEffectiveRunFormatting({
    run: document.getElementsByTagNameNS(OOXML.W_NS, 'r').item(0)!,
    paragraphPPr: null,
    paragraphStyleId: null,
    styles: parseStylesXml(styles),
  });
}

function docDefaults(rPr: string): string {
  return `<w:docDefaults><w:rPrDefault><w:rPr>${rPr}</w:rPr></w:rPrDefault></w:docDefaults>`;
}

describe('document-default effective run formatting', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.5.1' })(
      'resolves every supported run property when it is declared only in docDefaults',
      async ({ given, when, then }: AllureBddContext) => {
        let formatting!: RunFormatting;

        await given('a document whose complete base run formatting exists only in w:rPrDefault', async () => {});
        await when('an otherwise unformatted run is resolved', async () => {
          const toggles = TOGGLES.map(([, tag]) => `<w:${tag}/>`).join('');
          formatting = resolve(docDefaults(
            toggles +
              '<w:u w:val="single"/><w:highlight w:val="yellow"/>' +
              '<w:rFonts w:ascii="Courier New"/><w:sz w:val="28"/>' +
              '<w:color w:val="123456"/>',
          ));
        });
        await then('the document defaults supply every effective property', async () => {
          for (const [field] of TOGGLES) expect(formatting[field]).toBe(true);
          expect(formatting).toMatchObject({
            underline: true,
            highlightVal: 'yellow',
            fontName: 'Courier New',
            fontSizePt: 14,
            colorHex: '123456',
          });
        });
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.5.1' })(
      'docDefaults is the lowest-precedence tier for ordinary and toggle properties',
      async ({ given, when, then }: AllureBddContext) => {
        let formatting!: RunFormatting;

        await given('enabled bold and Courier defaults with conflicting direct run formatting', async () => {});
        await when('the directly formatted run is resolved', async () => {
          formatting = resolve(
            docDefaults('<w:b/><w:rFonts w:ascii="Courier New"/><w:sz w:val="28"/>'),
            '<w:b w:val="0"/><w:rFonts w:ascii="Georgia"/><w:sz w:val="24"/>',
          );
        });
        await then('direct formatting overrides the document-default base values', async () => {
          expect(formatting).toMatchObject({
            bold: false,
            fontName: 'Georgia',
            fontSizePt: 12,
          });
        });
      },
    );
});
