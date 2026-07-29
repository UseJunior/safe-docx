import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { OOXML } from './namespaces.js';
import { extractEffectiveRunFormatting, parseStylesXml, type RunFormatting, type StylesModel } from './styles.js';
import { parseXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Effective Run Formatting',
});

const DOC_DEFAULTS = (rPr: string): string =>
  `<w:docDefaults><w:rPrDefault><w:rPr>${rPr}</w:rPr></w:rPrDefault></w:docDefaults>`;

const CHARACTER_STYLE = (styleId: string, rPr: string): string =>
  `<w:style w:type="character" w:styleId="${styleId}"><w:rPr>${rPr}</w:rPr></w:style>`;

function stylesModel(stylesInner: string): StylesModel {
  return parseStylesXml(parseXml(`<w:styles xmlns:w="${OOXML.W_NS}">${stylesInner}</w:styles>`));
}

function extract(
  stylesInner: string,
  runProperties = '',
  opts: { inTable?: boolean; styles?: StylesModel } = {},
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
  });
}

describe('unresolved effective run formatting (#752)', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.5.1' })(
      'docDefaults-only declarations remain explicitly unresolved',
      async ({ given, when, then }: AllureBddContext) => {
        let formatting!: RunFormatting;

        await given('a font, bold, colour, underline and highlight declared only in docDefaults', async () => {});
        await when('effective formatting is extracted without consulting docDefaults', async () => {
          formatting = extract(
            DOC_DEFAULTS(
              '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:color w:val="112233"/>' +
                '<w:u w:val="single"/><w:highlight w:val="yellow"/>',
            ),
          );
        });
        await then('the result reports unresolved values instead of neutral-looking sentinels', async () => {
          expect(formatting.fontName).toBeNull();
          expect(formatting.bold).toBeNull();
          expect(formatting.colorHex).toBeNull();
          expect(formatting.underline).toBeNull();
          expect(formatting.highlightVal).toBeNull();
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

  test('a docDefaults declaration of the default value itself does not make a property unresolved', async ({
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
    await then('the defaults are resolved, and the unread size stays unresolved', async () => {
      expect(formatting.bold).toBe(false);
      expect(formatting.italic).toBe(false);
      expect(formatting.underline).toBe(false);
      expect(formatting.highlightVal).toBe(false);
      expect(formatting.colorHex).toBe('auto');
      expect(formatting.fontSizePt).toBeNull();
    });
  });

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.3' })(
      'a style-level toggle over a docDefaults toggle is unresolved; a direct one is absolute',
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
        await then('only the style-only result depends on the unread base', async () => {
          expect(styleOnly.bold).toBeNull();
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
});
