import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { childElements } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec, NumberingSpec } from './types.js';

const TEST_FEATURE = 'add-numbering-level-justification';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

/** One numbering definition whose levels opt into right/center and omit (default left). */
function justificationNumbering(): NumberingSpec {
  return {
    numId: 'clauses',
    levels: [
      { ilvl: 0, numFmt: 'decimal', lvlText: '%1.', lvlJc: 'right', indentTwips: { left: 720, hanging: 360 } },
      { ilvl: 1, numFmt: 'decimal', lvlText: '%1.%2', lvlJc: 'center', indentTwips: { left: 1440, hanging: 360 } },
      { ilvl: 2, numFmt: 'lowerRoman', lvlText: '(%3)', indentTwips: { left: 2160, hanging: 360 } },
    ],
  };
}

function justificationSpec(): DocumentSpec {
  return {
    meta: { title: 'Numbering level justification', createdIso: '2026-06-16T00:00:00Z' },
    numbering: [justificationNumbering()],
    sections: [
      {
        blocks: [
          { kind: 'paragraph', list: { numId: 'clauses', ilvl: 0 }, runs: [{ kind: 'text', text: 'Definitions' }] },
          { kind: 'paragraph', list: { numId: 'clauses', ilvl: 1 }, runs: [{ kind: 'text', text: 'Confidential Information' }] },
          { kind: 'paragraph', list: { numId: 'clauses', ilvl: 2 }, runs: [{ kind: 'text', text: 'public information' }] },
        ],
      },
    ],
  };
}

describe('Traceability: numbering level justification', () => {
  test
    .openspec('[SDX-GEN-063] level justification is authorable')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.7' })(
    'Scenario: level justification is authorable',
    async ({ given, when, then, and, attachPrettyXml }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a numbering definition with right/center levels and one default level', async () => {
        buffer = await generateDocx(justificationSpec());
        expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
      });

      let levels!: Element[];
      await when('word/numbering.xml is parsed back', async () => {
        const numberingXml = (await readZipText(buffer, 'word/numbering.xml'))!;
        expect(numberingXml).toBeTruthy();
        await attachPrettyXml('word/numbering.xml', numberingXml);
        const abstract = parseXml(numberingXml).getElementsByTagName('w:abstractNum').item(0)!;
        levels = Array.from(abstract.getElementsByTagName('w:lvl'));
        expect(levels).toHaveLength(3);
      });

      await then('each level emits w:lvlJc with the authored value, defaulting to left', async () => {
        const lvlJc = (lvl: Element) => lvl.getElementsByTagName('w:lvlJc').item(0)!.getAttribute('w:val');
        expect(lvlJc(levels[0]!)).toBe('right');
        expect(lvlJc(levels[1]!)).toBe('center');
        expect(lvlJc(levels[2]!)).toBe('left');
      });

      await and('w:lvlJc keeps its CT_Lvl position after w:lvlText and before w:pPr', async () => {
        const names = childElements(levels[0]!).map((el) => el.tagName);
        expect(names.indexOf('w:lvlJc')).toBe(names.indexOf('w:lvlText') + 1);
        expect(names.indexOf('w:lvlJc')).toBeLessThan(names.indexOf('w:pPr'));
      });

      await and('a re-render of the same spec is byte-identical', async () => {
        const second = await generateDocx(justificationSpec());
        expect(second.equals(buffer)).toBe(true);
      });

      let rejection!: unknown;
      await and('an out-of-enum lvlJc is rejected before emission', async () => {
        const invalidSpec: DocumentSpec = {
          meta: { title: 'Invalid', createdIso: '2026-06-16T00:00:00Z' },
          numbering: [
            {
              numId: 'bad',
              // Bypass the type to simulate a JSON/JS caller supplying a bad value.
              levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.', lvlJc: 'justify' as never }],
            },
          ],
          sections: [{ blocks: [{ kind: 'paragraph', list: { numId: 'bad', ilvl: 0 }, runs: [{ kind: 'text', text: 'x' }] }] }],
        };
        rejection = await generateDocx(invalidSpec).then(
          () => null,
          (err: unknown) => err,
        );
        expect(rejection).toBeInstanceOf(GenerationSpecError);
        const specError = rejection as GenerationSpecError;
        expect(specError.code).toBe('invalid_value');
        expect(specError.path).toBe('/numbering/0/levels/0/lvlJc');
        expect(specError.message).toMatch(/lvlJc must be one of/);
      });
    },
  );
});
