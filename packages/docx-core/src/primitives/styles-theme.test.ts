import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { OOXML } from './namespaces.js';
import { extractEffectiveRunFormatting, parseStylesXml, parseThemeXml } from './styles.js';
import { parseXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Effective Run Formatting' });

const THEME_XML =
  `<a:theme xmlns:a="${OOXML.A_NS}" name="Test"><a:themeElements>` +
  `<a:clrScheme name="Test"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
  `<a:accent1><a:srgbClr val="C0504D"/></a:accent1></a:clrScheme>` +
  `<a:fontScheme name="Test"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Yu Mincho"/><a:cs typeface="Arial"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Yu Gothic"/><a:cs typeface="Times New Roman"/></a:minorFont>` +
  `</a:fontScheme><a:fmtScheme name="Test"/></a:themeElements></a:theme>`;

function formatting(runProperties: string, withTheme = true) {
  const document = parseXml(
    `<w:document xmlns:w="${OOXML.W_NS}"><w:body><w:p><w:r><w:rPr>${runProperties}</w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
  );
  return extractEffectiveRunFormatting({
    run: document.getElementsByTagNameNS(OOXML.W_NS, 'r').item(0)!,
    paragraphPPr: null,
    paragraphStyleId: null,
    styles: parseStylesXml(null),
    theme: withTheme ? parseThemeXml(parseXml(THEME_XML)) : null,
  });
}

describe('theme-relative effective run formatting', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.26' })(
      'minorHAnsi resolves through the theme font scheme with direct fallback when absent',
      async ({ given, when, then }: AllureBddContext) => {
        let themed!: ReturnType<typeof formatting>;
        let fallback!: ReturnType<typeof formatting>;
        await given('a Word-default minorHAnsi reference and an explicit ASCII fallback', async () => {});
        await when('the run is resolved with and without theme1.xml', async () => {
          const rFonts = '<w:rFonts w:ascii="Georgia" w:asciiTheme="minorHAnsi"/>';
          themed = formatting(rFonts);
          fallback = formatting(rFonts, false);
        });
        await then('the theme wins when available and the direct value survives without it', async () => {
          expect(themed.fontName).toBe('Aptos');
          expect(fallback.fontName).toBe('Georgia');
        });
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.6' })(
      'theme colors resolve with the WordprocessingML tint and shade transforms',
      async ({ given, when, then }: AllureBddContext) => {
        let tint!: string | null;
        let shade!: string | null;
        await given('accent1 C0504D with the standard 99 tint and 80 shade examples', async () => {});
        await when('both theme-relative colors are resolved', async () => {
          tint = formatting('<w:color w:themeColor="accent1" w:themeTint="99"/>').colorHex;
          shade = formatting('<w:color w:themeColor="accent1" w:themeShade="80"/>').colorHex;
        });
        await then('the concrete colors match the normative examples', async () => {
          expect(tint).toBe('D99694');
          expect(shade).toBe('602827');
        });
      },
    );
});
