/**
 * Opt-in compatibility settings (`DocumentSpec.compatibility`).
 *
 * A fully justified paragraph stretches every line but its last, including a
 * short line that ends in a manual line break (an address block written with
 * line breaks comes out spread edge to edge). `w:doNotExpandShiftReturn` in
 * `w:compat` keeps such lines unstretched. These assertions prove the setting
 * is written only on request, in the CT_Compat position before the baseline
 * compatSetting, and that an invalid value is refused before compilation.
 */

import { describe, expect } from 'vitest';
import { childElements } from '../primitives/dom-helpers.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-created-paragraph-layout';
const test = testAllure
  .epic('Document Generation')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.15.3.5' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A justified paragraph with an address block written with manual line breaks. */
function addressSpec(compatibility?: DocumentSpec['compatibility']): DocumentSpec {
  return {
    meta: { title: 'Compat', author: 'safe-docx', createdIso: '2026-01-01T00:00:00Z' },
    ...(compatibility === undefined ? {} : { compatibility }),
    sections: [{
      blocks: [{
        kind: 'paragraph',
        alignment: 'justify',
        runs: [
          { kind: 'text', text: 'Return to:' },
          { kind: 'break', breakType: 'line' },
          { kind: 'text', text: 'Jane Roe' },
        ],
      }],
    }],
  };
}

/** The local names of the children of `w:compat`, in document order. */
async function compatChildren(buffer: Buffer): Promise<string[]> {
  const settings = parseXml((await readZipText(buffer, 'word/settings.xml'))!);
  const compat = settings.getElementsByTagNameNS(W_NS, 'compat');
  expect(compat, 'missing w:compat').toHaveLength(1);
  return childElements(compat[0]!).map((element) => element.localName);
}

describe('Opt-in compatibility settings', () => {
  test.openspec('[SDX-GEN-135] doNotExpandShiftReturn is written into w:compat only on request')(
    'Scenario: doNotExpandShiftReturn is written into w:compat only on request',
    async ({ given, then, attachPrettyJson }: AllureBddContext) => {
      let requested!: Buffer;
      let plain!: Buffer;
      await given('one spec with compatibility.doNotExpandShiftReturn true and the same spec without the key', async () => {
        requested = await generateDocx(addressSpec({ doNotExpandShiftReturn: true }));
        plain = await generateDocx(addressSpec());
        await attachPrettyJson('settings-xml', { requested: await readZipText(requested, 'word/settings.xml'), plain: await readZipText(plain, 'word/settings.xml') });
      });

      await then('the requested package carries w:doNotExpandShiftReturn before the compatibilityMode setting', async () => {
        expect(await compatChildren(requested)).toEqual(['doNotExpandShiftReturn', 'compatSetting']);
        const settings = parseXml((await readZipText(requested, 'word/settings.xml'))!);
        const element = settings.getElementsByTagNameNS(W_NS, 'doNotExpandShiftReturn')[0]!;
        // CT_OnOff with no w:val means true.
        expect(element.attributes.length).toBe(0);
      });

      await then('the package without the key, or with it false, carries only the compatibilityMode setting', async () => {
        expect(await compatChildren(plain)).toEqual(['compatSetting']);
        const off = await generateDocx(addressSpec({ doNotExpandShiftReturn: false }));
        expect(await compatChildren(off)).toEqual(['compatSetting']);
        // A false setting compiles to the same bytes as an absent one.
        expect(off.equals(plain)).toBe(true);
      });

      await then('both packages pass the structural checks and compile byte-identically', async () => {
        for (const [buffer, spec] of [[requested, addressSpec({ doNotExpandShiftReturn: true })], [plain, addressSpec()]] as const) {
          const result = await checkGeneratedPackage(buffer);
          expect(result.ok, JSON.stringify(result.issues)).toBe(true);
          expect((await generateDocx(spec)).equals(buffer)).toBe(true);
        }
      });

      await then('an unknown setting or a non-boolean value is refused before compilation', async () => {
        await expect(generateDocx({ ...addressSpec(), compatibility: { doNotExpandTabs: true } as unknown as DocumentSpec['compatibility'] }))
          .rejects.toBeInstanceOf(GenerationSpecError);
        await expect(generateDocx({ ...addressSpec(), compatibility: { doNotExpandShiftReturn: 'yes' } as unknown as DocumentSpec['compatibility'] }))
          .rejects.toThrow(/doNotExpandShiftReturn must be a boolean/);
      });
    },
  );
});
