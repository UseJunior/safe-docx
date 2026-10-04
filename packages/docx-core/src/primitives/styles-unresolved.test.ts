import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { OOXML } from './namespaces.js';
import {
  extractEffectiveRunFormatting,
  parseStylesXml,
  parseThemeXml,
  type RunFormatting,
  type StylesModel,
  type ThemeModel,
} from './styles.js';
import { parseXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Effective Run Formatting',
});

const DOC_DEFAULTS = (rPr: string): string =>
  `<w:docDefaults><w:rPrDefault><w:rPr>${rPr}</w:rPr></w:rPrDefault></w:docDefaults>`;

const CHARACTER_STYLE = (styleId: string, rPr: string): string =>
  `<w:style w:type="character" w:styleId="${styleId}"><w:rPr>${rPr}</w:rPr></w:style>`;

const THEME = parseThemeXml(
  parseXml(
    `<a:theme xmlns:a="${OOXML.A_NS}" name="T"><a:themeElements>` +
      `<a:clrScheme name="T"><a:accent1><a:srgbClr val="C0504D"/></a:accent1></a:clrScheme>` +
      `<a:fontScheme name="T"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont>` +
      `<a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>` +
      `</a:themeElements></a:theme>`,
  ),
);

function stylesModel(stylesInner: string): StylesModel {
  return parseStylesXml(parseXml(`<w:styles xmlns:w="${OOXML.W_NS}">${stylesInner}</w:styles>`));
}

function extract(
  stylesInner: string,
  runProperties = '',
  opts: { inTable?: boolean; styles?: StylesModel; theme?: ThemeModel | null } = {},
): RunFormatting {
  const paragraph = `<w:p><w:r><w:rPr>${runProperties}</w:rPr><w:t>x</w:t></w:r></w:p>`;
  const body = opts.inTable
    ? `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`
    : paragraph;
  const document = parseXml(
    `<w:document xmlns:w="${OOXML.W_NS}"><w:body>${body}</w:body></w:document>`,
  );
  return extractEffectiveRunFormatting({
    run: document.getElementsByTagNameNS(OOXML.W_NS, 'r').item(0)!,
    paragraphPPr: null,
    paragraphStyleId: null,
    styles: opts.styles ?? stylesModel(stylesInner),
    theme: opts.theme ?? null,
  });
}

describe('unresolved effective run formatting (#752)', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.5.1' })(
      'docDefaults-only declarations resolve from the document defaults (#753)',
      async ({ given, when, then }: AllureBddContext) => {
        let formatting!: RunFormatting;

        await given('a font, bold, colour, underline and highlight declared only in docDefaults', async () => {});
        await when('effective formatting is extracted', async () => {
          formatting = extract(
            DOC_DEFAULTS(
              '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:color w:val="112233"/>' +
                '<w:u w:val="single"/><w:highlight w:val="yellow"/>',
            ),
          );
        });
        await then('the document defaults supply the values; the undeclared size stays unresolved', async () => {
          // Before #753 docDefaults was an unread layer and all of these were null.
          expect(formatting.fontName).toBe('Georgia');
          expect(formatting.bold).toBe(true);
          expect(formatting.colorHex).toBe('112233');
          expect(formatting.underline).toBe(true);
          expect(formatting.highlightVal).toBe('yellow');
          expect(formatting.fontSizePt).toBeNull();
          // Not declared anywhere, so the OOXML default is known.
          expect(formatting.italic).toBe(false);
        });
      },
    );

  test('properties declared nowhere resolve to their OOXML defaults, font and size stay unresolved', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let formatting!: RunFormatting;

    await given('a styles part with no run properties anywhere', async () => {});
    await when('effective formatting is extracted for a bare run', async () => {
      formatting = extract('');
    });
    await then('toggles, underline, highlight and colour carry known defaults', async () => {
      expect(formatting.bold).toBe(false);
      expect(formatting.italic).toBe(false);
      expect(formatting.vanish).toBe(false);
      expect(formatting.underline).toBe(false);
      expect(formatting.highlightVal).toBe(false);
      expect(formatting.colorHex).toBe('auto');
      // No OOXML default exists for these: the application decides.
      expect(formatting.fontName).toBeNull();
      expect(formatting.fontSizePt).toBeNull();
    });
  });

  test('explicit off and automatic values remain distinct from unresolved', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let formatting!: RunFormatting;

    await given('direct run properties that select rendered defaults over docDefaults that set them', async () => {});
    await when('effective formatting is extracted', async () => {
      formatting = extract(
        DOC_DEFAULTS('<w:b/><w:u w:val="single"/><w:highlight w:val="yellow"/><w:color w:val="112233"/>'),
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

  test('a docDefaults declaration of the default value itself resolves to that default', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let formatting!: RunFormatting;

    await given('docDefaults that restate OOXML defaults', async () => {});
    await when('effective formatting is extracted for a bare run', async () => {
      formatting = extract(
        DOC_DEFAULTS(
          '<w:b w:val="0"/><w:i w:val="false"/><w:u w:val="none"/>' +
            '<w:highlight w:val="none"/><w:color w:val="auto"/><w:sz w:val="22"/>',
        ),
      );
    });
    await then('the defaults and the declared size are resolved', async () => {
      expect(formatting.bold).toBe(false);
      expect(formatting.italic).toBe(false);
      expect(formatting.underline).toBe(false);
      expect(formatting.highlightVal).toBe(false);
      expect(formatting.colorHex).toBe('auto');
      expect(formatting.fontSizePt).toBe(11);
    });
  });

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.3' })(
      'a style-level toggle inverts a docDefaults toggle seed; a direct one is absolute',
      async ({ given, when, then }: AllureBddContext) => {
        let styleOnly!: RunFormatting;
        let direct!: RunFormatting;
        let directThenStyle!: RunFormatting;

        await given('docDefaults that turn bold on', async () => {});
        await when('runs reach bold through a character style, through direct formatting, or both', async () => {
          const styles = DOC_DEFAULTS('<w:b/>') + CHARACTER_STYLE('Strong', '<w:b/>');
          styleOnly = extract(styles, '<w:rStyle w:val="Strong"/>');
          direct = extract(styles, '<w:b/>');
          directThenStyle = extract(styles, '<w:rStyle w:val="Strong"/><w:b w:val="0"/>');
        });
        await then('the style toggles the seeded base off; direct formatting is absolute', async () => {
          // Before #753 the seed was unread, so the style-only result was null.
          expect(styleOnly.bold).toBe(false);
          expect(direct.bold).toBe(true);
          expect(directThenStyle.bold).toBe(false);
        });
      },
    );

  test('table-style run properties make an undeclared property of a run inside a table unresolved', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let inTable!: RunFormatting;
    let outsideTable!: RunFormatting;
    let declaredDirectly!: RunFormatting;

    await given('a table style that sets bold, and one whose first-row condition sets colour', async () => {});
    await when('runs inside and outside a table are extracted', async () => {
      const styles =
        `<w:style w:type="table" w:styleId="Grid"><w:rPr><w:b/></w:rPr></w:style>` +
        `<w:style w:type="table" w:styleId="Banded"><w:tblStylePr w:type="firstRow">` +
        `<w:rPr><w:color w:val="FF0000"/></w:rPr></w:tblStylePr></w:style>`;
      inTable = extract(styles, '', { inTable: true });
      outsideTable = extract(styles, '');
      declaredDirectly = extract(styles, '<w:b/><w:color w:val="00FF00"/>', { inTable: true });
    });
    await then('only the in-table run reports the table-declared properties as unresolved', async () => {
      expect(inTable.bold).toBeNull();
      expect(inTable.colorHex).toBeNull();
      expect(inTable.italic).toBe(false);
      expect(outsideTable.bold).toBe(false);
      expect(outsideTable.colorHex).toBe('auto');
      expect(declaredDirectly.bold).toBe(true);
      expect(declaredDirectly.colorHex).toBe('00FF00');
    });
  });

  test('a hand-built styles model without the unread-layer fields keeps OOXML defaults', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let formatting!: RunFormatting;

    await given('a StylesModel constructed as the pre-#752 { byId } shape', async () => {});
    await when('effective formatting is extracted for a bare run inside a table', async () => {
      formatting = extract('', '', { inTable: true, styles: { byId: new Map() } });
    });
    await then('no unread layer is assumed and the defaults are reported', async () => {
      expect(formatting.bold).toBe(false);
      expect(formatting.colorHex).toBe('auto');
      expect(formatting.fontName).toBeNull();
    });
  });

  test('a missing styles part yields empty unread layers', async ({ given, when, then }: AllureBddContext) => {
    let model!: StylesModel;

    await given('no styles part', async () => {});
    await when('the styles model is parsed', async () => {
      model = parseStylesXml(null);
    });
    await then('both unread layers are empty and bare runs carry OOXML defaults', async () => {
      expect(model.docDefaultsRPr).toBeNull();
      expect(model.tableStyleRPrs).toEqual([]);
      expect(extract('', '', { styles: model }).bold).toBe(false);
    });
  });

  test('a theme colour or font reference that cannot be resolved is unresolved, not auto and not inherited', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const styles = CHARACTER_STYLE('Red', '<w:color w:val="FF0000"/><w:rFonts w:ascii="Georgia"/>');
    const direct = '<w:rStyle w:val="Red"/><w:color w:val="auto" w:themeColor="accent1"/><w:rFonts w:asciiTheme="minorHAnsi"/>';
    let noTheme!: RunFormatting;
    let emptyTheme!: RunFormatting;
    let withTheme!: RunFormatting;
    let defaultsNoTheme!: RunFormatting;
    let defaultsWithTheme!: RunFormatting;
    let hexFallback!: RunFormatting;

    await given('a run whose own colour and font are theme references, over a character style with concrete values', async () => {});
    await when('it is resolved without a theme, with an empty theme, and with a resolving theme', async () => {
      noTheme = extract(styles, direct);
      emptyTheme = extract(styles, direct, { theme: { fonts: new Map(), colors: new Map() } });
      withTheme = extract(styles, direct, { theme: THEME });
      defaultsNoTheme = extract(DOC_DEFAULTS('<w:color w:val="auto" w:themeColor="accent1"/>'));
      defaultsWithTheme = extract(DOC_DEFAULTS('<w:color w:val="auto" w:themeColor="accent1"/>'), '', { theme: THEME });
      hexFallback = extract('', '<w:color w:val="00FF00" w:themeColor="accent1"/>');
    });
    await then('without a usable theme the declared references are unresolved and the style does not show through', async () => {
      expect(noTheme.colorHex).toBeNull();
      expect(noTheme.fontName).toBeNull();
      expect(emptyTheme.colorHex).toBeNull();
      expect(emptyTheme.fontName).toBeNull();
    });
    await and('with the theme they resolve, in docDefaults as anywhere else', async () => {
      expect(withTheme.colorHex).toBe('C0504D');
      expect(withTheme.fontName).toBe('Aptos');
      expect(defaultsNoTheme.colorHex).toBeNull();
      expect(defaultsWithTheme.colorHex).toBe('C0504D');
      // An explicit hex val remains the fallback when the theme is absent.
      expect(hexFallback.colorHex).toBe('00FF00');
    });
  });

  test('explicit automatic colour and no-highlight stop inheritance from a character style', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let formatting!: RunFormatting;

    await given('a character style with red text and a yellow highlight', async () => {});
    await when('the run selects the style but sets colour auto and highlight none directly', async () => {
      formatting = extract(
        CHARACTER_STYLE('Loud', '<w:color w:val="FF0000"/><w:highlight w:val="yellow"/>'),
        '<w:rStyle w:val="Loud"/><w:color w:val="auto"/><w:highlight w:val="none"/>',
      );
    });
    await then('the direct declarations win; before #752 the style values showed through', async () => {
      expect(formatting.colorHex).toBe('auto');
      expect(formatting.highlightVal).toBe(false);
    });
  });
});
