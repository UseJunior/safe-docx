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
});
