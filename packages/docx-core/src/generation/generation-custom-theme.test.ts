import { describe, expect } from 'vitest';
import { childElements } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import type { DocumentSpec, ThemeColorSlot } from './types.js';

const TEST_FEATURE = 'add-custom-theme';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function themedSpec(): DocumentSpec {
  return {
    theme: {
      colors: {
        accent1: '117086',
        text1: '222222',
      },
      fonts: {
        major: 'Aptos Display',
        minor: 'Aptos',
      },
    },
    sections: [
      {
        blocks: [
          {
            kind: 'paragraph',
            runs: [{ kind: 'text', text: 'BRAND', themeColor: 'accent1', themeTint: '99', themeShade: '33' }],
          },
          {
            kind: 'table',
            columnWidthsTwips: [4320],
            rows: [
              {
                cells: [
                  {
                    themeFill: 'accent1',
                    themeFillTint: '66',
                    themeFillShade: '22',
                    blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'cell' }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function readPartDom(buffer: Buffer, path: string): Promise<Document> {
  const xml = await readZipText(buffer, path);
  expect(xml, `${path} missing from package`).not.toBeNull();
  return parseXml(xml!);
}

function firstChildElement(el: Element): Element {
  const child = childElements(el)[0];
  expect(child).toBeTruthy();
  return child!;
}

describe('Traceability: custom theme generation', () => {
  test.openspec('[SDX-GEN-107] custom theme slots drive theme-relative authoring')(
    'Scenario: custom theme slots drive theme-relative authoring',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a spec with custom theme colors and theme-relative run and cell colors', async () => {
        buffer = await generateDocx(themedSpec());
      });

      let theme!: Document;
      let document!: Document;
      await when('the generated theme and document parts are parsed', async () => {
        const themeXml = (await readZipText(buffer, 'word/theme/theme1.xml'))!;
        const documentXml = (await readZipText(buffer, 'word/document.xml'))!;
        await attachPrettyXml('word/theme/theme1.xml', themeXml);
        await attachPrettyXml('word/document.xml', documentXml);
        theme = parseXml(themeXml);
        document = parseXml(documentXml);
      });

      await then('custom theme slots and fonts are emitted into theme1.xml', async () => {
        expect(firstChildElement(theme.getElementsByTagName('a:accent1').item(0)!).tagName).toBe('a:srgbClr');
        expect(firstChildElement(theme.getElementsByTagName('a:accent1').item(0)!).getAttribute('val')).toBe('117086');
        expect(firstChildElement(theme.getElementsByTagName('a:dk1').item(0)!).tagName).toBe('a:srgbClr');
        expect(firstChildElement(theme.getElementsByTagName('a:dk1').item(0)!).getAttribute('val')).toBe('222222');
        expect(theme.getElementsByTagName('a:majorFont').item(0)!.getElementsByTagName('a:latin').item(0)!.getAttribute('typeface')).toBe(
          'Aptos Display',
        );
        expect(theme.getElementsByTagName('a:minorFont').item(0)!.getElementsByTagName('a:latin').item(0)!.getAttribute('typeface')).toBe('Aptos');
      });

      await then('run theme color attributes are emitted on w:color', async () => {
        const color = document.getElementsByTagName('w:color').item(0)!;
        expect(color.getAttribute('w:themeColor')).toBe('accent1');
        expect(color.getAttribute('w:val')).toBe('117086');
        expect(color.getAttribute('w:themeTint')).toBe('99');
        expect(color.getAttribute('w:themeShade')).toBe('33');
      });

      await then('cell theme fill attributes are emitted on w:shd', async () => {
        const shd = document.getElementsByTagName('w:shd').item(0)!;
        expect(shd.getAttribute('w:themeFill')).toBe('accent1');
        expect(shd.getAttribute('w:fill')).toBe('117086');
        expect(shd.getAttribute('w:themeFillTint')).toBe('66');
        expect(shd.getAttribute('w:themeFillShade')).toBe('22');
      });

      await then('the default theme remains canonical when no custom theme is supplied', async () => {
        const defaultTheme = await readPartDom(
          await generateDocx({
            sections: [{ blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'plain' }] }] }],
          }),
          'word/theme/theme1.xml',
        );
        expect(firstChildElement(defaultTheme.getElementsByTagName('a:accent1').item(0)!).getAttribute('val')).toBe('4472C4');
      });

      await then('invalid theme slots and mixed literal/theme colors are rejected', async () => {
        await expect(
          generateDocx({
            theme: { colors: { notASlot: '117086' } as unknown as Partial<Record<ThemeColorSlot, string>> },
            sections: [{ blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'x' }] }] }],
          }),
        ).rejects.toThrow(/theme color slot must be one of/);

        await expect(
          generateDocx({
            sections: [
              {
                blocks: [
                  {
                    kind: 'paragraph',
                    runs: [{ kind: 'text', text: 'x', colorHex: '000000', themeColor: 'accent1' }],
                  },
                ],
              },
            ],
          }),
        ).rejects.toThrow(/themeColor cannot be set/);

        await expect(
          generateDocx({
            sections: [
              {
                blocks: [
                  {
                    kind: 'paragraph',
                    runs: [{ kind: 'text', text: 'x', themeColor: 'notASlot' as ThemeColorSlot }],
                  },
                ],
              },
            ],
          }),
        ).rejects.toThrow(/themeColor must be one of/);

        await expect(
          generateDocx({
            sections: [
              {
                blocks: [
                  {
                    kind: 'table',
                    columnWidthsTwips: [1440],
                    rows: [
                      {
                        cells: [
                          {
                            shadingHex: 'FFFFFF',
                            themeFill: 'accent1',
                            blocks: [{ kind: 'paragraph', runs: [] }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        ).rejects.toThrow(/themeFill cannot be set/);
      });
    },
  );
});
