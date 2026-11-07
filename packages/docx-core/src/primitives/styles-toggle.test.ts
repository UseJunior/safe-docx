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

function style(styleId: string, rPr: string, basedOn?: string): string {
  return (
    `<w:style w:type="character" w:styleId="${styleId}">` +
    (basedOn ? `<w:basedOn w:val="${basedOn}"/>` : '') +
    `<w:rPr>${rPr}</w:rPr></w:style>`
  );
}

function evaluate(stylesInner: string, runRPr: string): RunFormatting {
  const styles = parseXml(
    `<w:styles xmlns:w="${OOXML.W_NS}">${stylesInner}</w:styles>`,
  );
  const document = parseXml(
    `<w:document xmlns:w="${OOXML.W_NS}"><w:body><w:p><w:r><w:rPr>${runRPr}</w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
  );
  return extractEffectiveRunFormatting({
    run: document.getElementsByTagNameNS(OOXML.W_NS, 'r').item(0)!,
    paragraphPPr: null,
    paragraphStyleId: null,
    styles: parseStylesXml(styles),
  });
}

describe('effective toggle-property evaluation', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.3' })(
      'repeated style declarations use parity across the complete supported toggle set',
      async ({ given, when, then }: AllureBddContext) => {
        let formatting!: RunFormatting;

        await given('two style-level on declarations for every supported toggle', async () => {});
        await when('the derived character style is resolved', async () => {
          const declarations = TOGGLES.map(([, tag]) => `<w:${tag}/>`).join('');
          formatting = evaluate(
            style('Base', declarations) + style('Derived', declarations, 'Base'),
            '<w:rStyle w:val="Derived"/>',
          );
        });
        await then('each repeated declaration cancels by parity', async () => {
          for (const [field] of TOGGLES) expect(formatting[field]).toBe(false);
        });
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.3' })(
      'style-level false preserves inherited state while direct false forces off',
      async ({ given, when, then }: AllureBddContext) => {
        let styleOff!: RunFormatting;
        let directOff!: RunFormatting;

        await given('an enabled base style, a derived style-level off, and a direct-formatting off case', async () => {});
        await when('both runs are resolved', async () => {
          styleOff = evaluate(
            style('Base', '<w:b/>') + style('Derived', '<w:b w:val="0"/>', 'Base'),
            '<w:rStyle w:val="Derived"/>',
          );
          directOff = evaluate(style('Base', '<w:b/>'), '<w:rStyle w:val="Base"/><w:b w:val="0"/>');
        });
        await then('only direct formatting disables bold', async () => {
          expect(styleOff.bold).toBe(true);
          expect(directOff.bold).toBe(false);
        });
      },
    );

  test(
    'tracked rPrChange and pPrChange snapshots are not read as current formatting across direct runs, paragraph styles, and character styles (#1179)',
    async ({ given, when, then }: AllureBddContext) => {
      let directFormatting!: RunFormatting;
      let paragraphStyleFormatting!: RunFormatting;
      let characterStyleFormatting!: RunFormatting;

      await given('runs and styles whose current properties are off or unset while w:rPrChange records old bold, font, size, color, underline, and highlight', async () => {});

      await when('effective run formatting is resolved for direct run rPr, paragraph style rPr, and character style rPr', async () => {
        const oldRPrChange =
          `<w:rPrChange w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">` +
          `<w:rPr><w:b/><w:i/><w:u w:val="single"/><w:rFonts w:ascii="Courier New"/><w:sz w:val="32"/><w:color w:val="FF0000"/><w:highlight w:val="yellow"/></w:rPr>` +
          `</w:rPrChange>`;

        directFormatting = evaluate('', oldRPrChange);

        const paraStyleDoc = parseXml(
          `<w:document xmlns:w="${OOXML.W_NS}"><w:body>` +
            `<w:p>` +
            `<w:pPr>` +
            `<w:pStyle w:val="BodyCurrent"/>` +
            `<w:pPrChange w:id="2" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">` +
            `<w:pPr><w:pStyle w:val="OldBoldHeading"/><w:rPr><w:b/><w:color w:val="00FF00"/></w:rPr></w:pPr>` +
            `</w:pPrChange>` +
            `</w:pPr>` +
            `<w:r><w:t>x</w:t></w:r>` +
            `</w:p>` +
            `</w:body></w:document>`,
        );
        const paraStyles = parseStylesXml(
          parseXml(
            `<w:styles xmlns:w="${OOXML.W_NS}">` +
              `<w:style w:type="paragraph" w:styleId="BodyCurrent"><w:name w:val="Body Current"/><w:rPr>${oldRPrChange}</w:rPr></w:style>` +
              `<w:style w:type="paragraph" w:styleId="OldBoldHeading"><w:name w:val="Old Bold Heading"/><w:rPr><w:b/></w:rPr></w:style>` +
              `</w:styles>`,
          ),
        );
        const pEl = paraStyleDoc.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0)!;
        const pPrEl = pEl.getElementsByTagNameNS(OOXML.W_NS, 'pPr').item(0)!;
        paragraphStyleFormatting = extractEffectiveRunFormatting({
          run: pEl.getElementsByTagNameNS(OOXML.W_NS, 'r').item(0)!,
          paragraphPPr: pPrEl,
          paragraphStyleId: 'BodyCurrent',
          styles: paraStyles,
        });

        characterStyleFormatting = evaluate(
          style('EmphasisCurrent', oldRPrChange),
          `<w:rStyle w:val="EmphasisCurrent"/><w:rPrChange w:id="3" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:rPr><w:rStyle w:val="OldCharStyle"/><w:b/></w:rPr></w:rPrChange>`,
        );
      });

      await then('every layer reports the current state instead of the pre-revision w:rPrChange / w:pPrChange state', () => {
        for (const resolved of [directFormatting, paragraphStyleFormatting, characterStyleFormatting]) {
          expect(resolved.bold).toBe(false);
          expect(resolved.italic).toBe(false);
          expect(resolved.underline).toBe(false);
          expect(resolved.fontName).toBeNull();
          expect(resolved.fontSizePt).toBeNull();
          expect(resolved.colorHex).toBe('auto');
          expect(resolved.highlightVal).toBe(false);
        }
      });
    },
  );
});
