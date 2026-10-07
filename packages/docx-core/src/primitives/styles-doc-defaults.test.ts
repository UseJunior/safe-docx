import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { buildNodesForDocumentView } from './document_view.js';
import { OOXML } from './namespaces.js';
import {
  extractEffectiveRunFormatting,
  parseStylesXml,
  parseThemeXml,
  type RunFormatting,
  type ThemeModel,
} from './styles.js';
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

const THEME = parseThemeXml(
  parseXml(
    `<a:theme xmlns:a="${OOXML.A_NS}" name="T"><a:themeElements>` +
      `<a:clrScheme name="T"><a:accent1><a:srgbClr val="C0504D"/></a:accent1></a:clrScheme>` +
      `<a:fontScheme name="T"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont>` +
      `<a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>` +
      `</a:themeElements></a:theme>`,
  ),
);

function docDefaults(rPr: string): string {
  return `<w:docDefaults><w:rPrDefault><w:rPr>${rPr}</w:rPr></w:rPrDefault></w:docDefaults>`;
}

function resolve(
  stylesInner: string,
  runRPr = '',
  opts: { paragraphStyleId?: string; inTable?: boolean; theme?: ThemeModel | null } = {},
): RunFormatting {
  const styles = parseXml(`<w:styles xmlns:w="${OOXML.W_NS}">${stylesInner}</w:styles>`);
  const paragraph = `<w:p><w:r><w:rPr>${runRPr}</w:rPr><w:t>x</w:t></w:r></w:p>`;
  const body = opts.inTable
    ? `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`
    : paragraph;
  const document = parseXml(`<w:document xmlns:w="${OOXML.W_NS}"><w:body>${body}</w:body></w:document>`);
  return extractEffectiveRunFormatting({
    run: document.getElementsByTagNameNS(OOXML.W_NS, 'r').item(0)!,
    paragraphPPr: null,
    paragraphStyleId: opts.paragraphStyleId ?? null,
    styles: parseStylesXml(styles),
    theme: opts.theme ?? null,
  });
}

describe('document-default effective run formatting (#753)', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.5.1' })(
      'resolves every supported run property when it is declared only in docDefaults',
      async ({ given, when, then }: AllureBddContext) => {
        let formatting!: RunFormatting;

        await given('a document whose complete base run formatting exists only in w:rPrDefault', async () => {});
        await when('an otherwise unformatted run is resolved', async () => {
          const toggles = TOGGLES.map(([, tag]) => `<w:${tag}/>`).join('');
          formatting = resolve(
            docDefaults(
              toggles +
                '<w:u w:val="single"/><w:highlight w:val="yellow"/>' +
                '<w:rFonts w:ascii="Courier New"/><w:sz w:val="28"/>' +
                '<w:color w:val="123456"/>',
            ),
          );
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
      async ({ given, when, then, and }: AllureBddContext) => {
        let direct!: RunFormatting;
        let paragraphStyle!: RunFormatting;

        await given('bold, Courier New and 14pt document defaults', async () => {});
        await when('a run overrides them directly, and another inherits a paragraph style', async () => {
          const defaults = docDefaults('<w:b/><w:rFonts w:ascii="Courier New"/><w:sz w:val="28"/>');
          direct = resolve(defaults, '<w:b w:val="0"/><w:rFonts w:ascii="Georgia"/><w:sz w:val="24"/>');
          paragraphStyle = resolve(
            defaults +
              '<w:style w:type="paragraph" w:styleId="Body"><w:rPr><w:sz w:val="20"/></w:rPr></w:style>',
            '',
            { paragraphStyleId: 'Body' },
          );
        });
        await then('direct formatting overrides the document-default base values', async () => {
          expect(direct).toMatchObject({ bold: false, fontName: 'Georgia', fontSizePt: 12 });
        });
        await and('a paragraph style overrides only the property it declares', async () => {
          expect(paragraphStyle).toMatchObject({ bold: true, fontName: 'Courier New', fontSizePt: 10 });
        });
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.3' })(
      'docDefaults seed toggle parity rather than acting as another style level',
      async ({ given, when, then }: AllureBddContext) => {
        let oneStyle!: RunFormatting;
        let twoStyles!: RunFormatting;
        let styleOff!: RunFormatting;

        await given('document defaults that turn every toggle on', async () => {});
        await when('styles above them turn the toggle on once, twice, or declare it off', async () => {
          const toggles = TOGGLES.map(([, tag]) => `<w:${tag}/>`).join('');
          const offs = TOGGLES.map(([, tag]) => `<w:${tag} w:val="0"/>`).join('');
          const defaults = docDefaults(toggles);
          const paragraphStyle = (rPr: string): string =>
            `<w:style w:type="paragraph" w:styleId="Body"><w:rPr>${rPr}</w:rPr></w:style>`;
          const characterStyle = `<w:style w:type="character" w:styleId="Em"><w:rPr>${toggles}</w:rPr></w:style>`;
          oneStyle = resolve(defaults + paragraphStyle(toggles), '', { paragraphStyleId: 'Body' });
          // Word oracle row <toggle>.crossLevel.threeOn: on, on, on -> on.
          twoStyles = resolve(defaults + paragraphStyle(toggles) + characterStyle, '<w:rStyle w:val="Em"/>', {
            paragraphStyleId: 'Body',
          });
          styleOff = resolve(defaults + paragraphStyle(offs), '', { paragraphStyleId: 'Body' });
        });
        await then('each style-level on inverts the seeded value and a style-level off preserves it', async () => {
          for (const [field] of TOGGLES) {
            expect(oneStyle[field]).toBe(false);
            expect(twoStyles[field]).toBe(true);
            expect(styleOff[field]).toBe(true);
          }
        });
      },
    );

  test('a theme font in docDefaults resolves through the theme and is unresolved without one', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let withTheme!: RunFormatting;
    let withoutTheme!: RunFormatting;
    let withFallback!: RunFormatting;

    await given('document defaults that name the minor theme font, as Word writes them', async () => {});
    await when('a bare run is resolved with and without the theme part', async () => {
      const defaults = docDefaults(
        '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorHAnsi" w:cstheme="minorBidi"/>' +
          '<w:sz w:val="22"/>',
      );
      withTheme = resolve(defaults, '', { theme: THEME });
      withoutTheme = resolve(defaults);
      withFallback = resolve(docDefaults('<w:rFonts w:asciiTheme="minorHAnsi" w:ascii="Calibri"/>'));
    });
    await then('the theme supplies the font; without it the font is unresolved unless an explicit name backs it', async () => {
      expect(withTheme).toMatchObject({ fontName: 'Aptos', fontSizePt: 11 });
      expect(withoutTheme).toMatchObject({ fontName: null, fontSizePt: 11 });
      expect(withFallback.fontName).toBe('Calibri');
    });
  });

  test('a table style overrides a docDefaults value inside a table (#1159)', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let overridden!: RunFormatting;
    let restated!: RunFormatting;
    let outside!: RunFormatting;
    let directWins!: RunFormatting;
    let restatedOtherCase!: RunFormatting;
    let restatedThroughTheme!: RunFormatting;

    await given('Georgia 12pt red document defaults, and table styles that sit above them', async () => {});
    await when('runs inside and outside a table are resolved', async () => {
      const defaults = docDefaults(
        '<w:rFonts w:ascii="Georgia"/><w:sz w:val="24"/><w:color w:val="FF0000"/><w:u w:val="single"/>',
      );
      const tableStyle = (rPr: string): string =>
        `<w:style w:type="table" w:styleId="Grid"><w:rPr>${rPr}</w:rPr></w:style>`;
      const overriding = tableStyle(
        '<w:rFonts w:ascii="Arial"/><w:sz w:val="18"/><w:color w:val="auto"/><w:u w:val="none"/>',
      );
      overridden = resolve(defaults + overriding, '', { inTable: true });
      outside = resolve(defaults + overriding);
      directWins = resolve(defaults + overriding, '<w:rFonts w:ascii="Verdana"/><w:sz w:val="20"/>', {
        inTable: true,
      });
      restated = resolve(
        defaults + tableStyle('<w:rFonts w:ascii="Georgia"/><w:sz w:val="24"/><w:color w:val="FF0000"/>'),
        '',
        { inTable: true },
      );
      restatedOtherCase = resolve(
        docDefaults('<w:rFonts w:ascii="Georgia"/><w:color w:val="C0504D"/>') +
          tableStyle('<w:rFonts w:ascii="georgia"/><w:color w:val="c0504d"/>'),
        '',
        { inTable: true },
      );
      restatedThroughTheme = resolve(
        docDefaults('<w:color w:val="C0504D"/>') + tableStyle('<w:color w:val="auto" w:themeColor="accent1"/>'),
        '',
        { inTable: true, theme: THEME },
      );
    });
    await then('the table-style value replaces the docDefaults value for in-table runs only', async () => {
      expect(overridden).toMatchObject({ fontName: 'Arial', fontSizePt: 9, colorHex: 'auto', underline: false });
      expect(outside).toMatchObject({ fontName: 'Georgia', fontSizePt: 12, colorHex: 'FF0000', underline: true });
      // Direct formatting sits above the table style; undeclared directly,
      // the colour still comes from the table style.
      expect(directWins).toMatchObject({ fontName: 'Verdana', fontSizePt: 10, colorHex: 'auto', underline: false });
    });
    await and('a table style that restates the docDefaults value resolves to that value', async () => {
      expect(restated).toMatchObject({ fontName: 'Georgia', fontSizePt: 12, colorHex: 'FF0000', underline: true });
      // The table style is the nearest declaration, so its spelling is kept;
      // a theme colour resolves through the theme.
      expect(restatedOtherCase).toMatchObject({ fontName: 'georgia', colorHex: 'c0504d' });
      expect(restatedThroughTheme.colorHex).toBe('C0504D');
    });
  });

  test('read_file formatting uses docDefaults as the paragraph baseline, so only the outlier is tagged', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let tagged = '';
    let body: RunFormatting | null = null;

    await given('a paragraph whose runs take Courier New 14pt from docDefaults, except one 18pt run', async () => {});
    await when('the document view is built with formatting', async () => {
      const W = OOXML.W_NS;
      const doc = parseXml(
        `<w:document xmlns:w="${W}"><w:body><w:p>` +
          `<w:r><w:t xml:space="preserve">The base text of this clause </w:t></w:r>` +
          `<w:r><w:rPr><w:sz w:val="36"/></w:rPr><w:t>LOUD</w:t></w:r>` +
          `<w:r><w:t xml:space="preserve"> continues in the base size.</w:t></w:r>` +
          `</w:p></w:body></w:document>`,
      );
      const { nodes } = buildNodesForDocumentView({
        paragraphs: Array.from(doc.getElementsByTagNameNS(W, 'p')).map((p, i) => ({ id: `_bk_${i + 1}`, p })),
        stylesXml: parseXml(
          `<w:styles xmlns:w="${W}">${docDefaults('<w:rFonts w:ascii="Courier New"/><w:sz w:val="28"/>')}</w:styles>`,
        ),
        numberingXml: null,
        include_semantic_tags: false,
        show_formatting: true,
      });
      tagged = nodes[0]!.tagged_text;
      body = nodes[0]!.body_run_formatting ?? null;
    });
    await then('the body formatting is resolved and no size="0" or face tag appears', async () => {
      expect(body).toMatchObject({ fontName: 'Courier New', fontSizePt: 14 });
      expect(tagged).toContain('size="18"');
      expect(tagged).not.toContain('size="0"');
      expect(tagged).not.toContain('face=');
      expect(tagged.match(/<font/g)?.length).toBe(1);
    });
  });
});
